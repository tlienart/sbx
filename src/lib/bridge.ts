import { execSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { join, resolve } from 'node:path';
import { type Socket, type SocketListener, listen, spawn } from 'bun';

import { runAsUser } from './exec.ts';
import { logger } from './logger.ts';
import 'dotenv/config';

export interface BridgeRequest {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export class SbxBridge {
  private commandListener: SocketListener<unknown> | null = null;
  private proxyServer: http.Server | null = null;
  private socketPath: string;
  private proxySocketPath: string;
  private bridgeDir: string;
  private hostKeys: Record<string, string> = {};
  private githubToken = '';
  private binaryPaths: Record<string, string> = {};
  private sandboxUser: string | null = null;

  constructor(hostUser: string, sandboxUser?: string) {
    this.bridgeDir = `/tmp/.sbx_${hostUser}`;
    this.sandboxUser = sandboxUser || null;

    if (!existsSync(this.bridgeDir)) {
      mkdirSync(this.bridgeDir, { recursive: true });
      chmodSync(this.bridgeDir, 0o711); // Allow sandbox user to enter
    }
    this.socketPath = join(this.bridgeDir, 'bridge.sock');
    this.proxySocketPath = join(this.bridgeDir, 'proxy.sock');

    this.harvestSecrets();
    this.resolveBinaries();
  }

  private resolveBinaries() {
    try {
      const paths = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
      for (const cmd of ['git', 'gh', 'opencode']) {
        for (const p of paths) {
          const fullPath = join(p, cmd);
          if (existsSync(fullPath)) {
            const stat = statSync(fullPath);
            if (stat.isFile()) {
              this.binaryPaths[cmd] = fullPath;
              break;
            }
          }
        }
      }
      logger.debug(`[Bridge] Resolved binaries: ${JSON.stringify(this.binaryPaths)}`);
    } catch (err) {
      logger.error(`[Bridge] Error resolving binaries: ${err}`);
    }
  }

  private harvestSecrets() {
    this.githubToken = process.env.SBX_GITHUB_TOKEN || '';
    this.hostKeys.google = process.env.SBX_GOOGLE_API_KEY || '';
    this.hostKeys.openai = process.env.SBX_OPENAI_API_KEY || '';
    this.hostKeys.anthropic = process.env.SBX_ANTHROPIC_API_KEY || '';

    const found = Object.entries(this.hostKeys)
      .filter(([_, v]) => !!v)
      .map(([k]) => k);

    if (this.githubToken) found.push('github');

    if (found.length === 0) {
      logger.warn('[Bridge] No SBX_ secrets found in environment or .env file');
    } else {
      logger.info(`[Bridge] Harvested secrets for: ${found.join(', ')}`);
    }
  }

  async start() {
    // 1. Command Bridge (for git/gh)
    if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
    this.commandListener = listen({
      unix: this.socketPath,
      socket: {
        data: async (socket, data) => {
          try {
            const request: BridgeRequest = JSON.parse(data.toString());
            logger.debug(`[Bridge] Received request: ${JSON.stringify(request)}`);
            await this.handleRequest(socket, request);
          } catch (error) {
            logger.error(`[Bridge] Error handling data: ${error}`);
            socket.write(`${JSON.stringify({ type: 'error', message: String(error) })}\n`);
            socket.end();
          }
        },
      },
    });

    if (this.sandboxUser) {
      try {
        execSync(`chmod +a "user:${this.sandboxUser} allow read,write" ${this.socketPath}`);
      } catch (err) {
        logger.debug(`[Bridge] Failed to set ACL on socket: ${err}`);
        chmodSync(this.socketPath, 0o666);
      }
    } else {
      chmodSync(this.socketPath, 0o666);
    }

    // 2. API Proxy (for OpenCode)
    if (existsSync(this.proxySocketPath)) unlinkSync(this.proxySocketPath);

    // 3. Reset isolated gh config to avoid stale/dummy account artifacts
    const isolatedHome = join(this.bridgeDir, '.isolated_home');
    const ghConfigDir = join(isolatedHome, '.config', 'gh');
    if (existsSync(ghConfigDir)) {
      try {
        const hostsFile = join(ghConfigDir, 'hosts.yml');
        if (existsSync(hostsFile)) unlinkSync(hostsFile);
      } catch {
        // ignore
      }
    } else {
      mkdirSync(ghConfigDir, { recursive: true });
    }

    const hostKeys = this.hostKeys;

    this.proxyServer = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
        logger.debug(`[Proxy] Incoming request: ${req.method} ${url.pathname}`);

        let targetHost: string | undefined;
        let targetPath: string | undefined;
        let authHeader: string | undefined;
        let authValue: string | undefined;
        let isGoogle = false;
        let providerName = '';

        if (url.pathname.startsWith('/google')) {
          providerName = 'google';
          let path = url.pathname.replace('/google', '');
          if (!path.startsWith('/v1beta')) path = `/v1beta${path}`;
          targetHost = 'generativelanguage.googleapis.com';
          targetPath = path;
          authHeader = 'x-goog-api-key';
          authValue = hostKeys.google;
          isGoogle = true;
        } else if (url.pathname.startsWith('/openai')) {
          providerName = 'openai';
          targetHost = 'api.openai.com';
          targetPath = url.pathname.replace('/openai', '');
          authHeader = 'Authorization';
          authValue = `Bearer ${hostKeys.openai}`;
        } else if (url.pathname.startsWith('/anthropic')) {
          providerName = 'anthropic';
          targetHost = 'api.anthropic.com';
          targetPath = url.pathname.replace('/anthropic', '');
          authHeader = 'x-api-key';
          authValue = hostKeys.anthropic;
        }

        if (targetHost && authValue && authHeader) {
          const finalPath = `${targetPath}${url.search}`;
          const finalUrl = new URL(`https://${targetHost}${finalPath}`);
          if (isGoogle) finalUrl.searchParams.set('key', authValue);

          const proxyReq = https.request(
            {
              hostname: targetHost,
              port: 443,
              path: `${finalUrl.pathname}${finalUrl.search}`,
              method: req.method,
              headers: {
                ...req.headers,
                host: targetHost,
                [authHeader.toLowerCase()]: authValue,
              },
            },
            (proxyRes) => {
              logger.debug(`[Proxy] Upstream response: ${proxyRes.statusCode} for ${providerName}`);
              res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
              proxyRes.pipe(res);
            },
          );

          proxyReq.on('error', (e) => {
            logger.error(`[Proxy] Upstream error: ${e.message}`);
            res.writeHead(502);
            res.end('Proxy Error');
          });

          if (req.headers['content-length']) {
            logger.debug(`[Proxy] Request body size: ${req.headers['content-length']}`);
          }

          req.pipe(proxyReq);
        } else if (providerName) {
          res.writeHead(401);
          res.end(`Missing host secret: SBX_${providerName.toUpperCase()}_API_KEY`);
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      } catch (error) {
        logger.error(`[Proxy] Internal error: ${error}`);
        res.writeHead(500);
        res.end('Internal Error');
      }
    });

    this.proxyServer.listen(this.proxySocketPath, () => {
      logger.debug(`[Bridge] API Proxy listening on ${this.proxySocketPath}`);
      if (this.sandboxUser) {
        try {
          execSync(`chmod +a "user:${this.sandboxUser} allow read,write" ${this.proxySocketPath}`);
        } catch (err) {
          logger.debug(`[Bridge] Failed to set ACL on proxy socket: ${err}`);
          chmodSync(this.proxySocketPath, 0o666);
        }
      } else {
        chmodSync(this.proxySocketPath, 0o666);
      }
    });

    // Wait for sockets to exist
    for (let i = 0; i < 20; i++) {
      if (existsSync(this.socketPath) && existsSync(this.proxySocketPath)) {
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Timed out waiting for bridge sockets');
  }

  private async handleRequest(socket: Socket<unknown>, request: BridgeRequest) {
    const allowedCommands = ['gh', 'git', 'opencode', 'ls'];
    if (!allowedCommands.includes(request.command)) {
      socket.write(
        `${JSON.stringify({ type: 'error', message: `Command ${request.command} not allowed` })}\n`,
      );
      socket.end();
      return;
    }

    const validationError = this.validateArgs(request.command, request.args);
    if (validationError) {
      logger.warn(
        `[Bridge] Blocking command ${request.command} ${request.args.join(' ')}: ${validationError}`,
      );
      socket.write(`${JSON.stringify({ type: 'error', message: validationError })}\n`);
      socket.end();
      return;
    }

    const isolatedHome = join(this.bridgeDir, '.isolated_home');
    if (!existsSync(isolatedHome)) {
      mkdirSync(isolatedHome, { recursive: true });
      chmodSync(isolatedHome, 0o700);
    }

    // Initialize isolated .gitconfig if it doesn't exist
    const gitConfigFile = join(isolatedHome, '.gitconfig');
    if (!existsSync(gitConfigFile)) {
      const config = [
        '[credential]',
        '\thelper = ',
        '\thelper = !gh auth git-credential',
        '[core]',
        '\tsshCommand = ssh -o BatchMode=yes',
        '[protocol]',
        '\tallow = always',
      ].join('\n');
      execSync(`cat <<EOF > ${gitConfigFile}\n${config}\nEOF`);
      chmodSync(gitConfigFile, 0o600);
    }

    const commandPath = this.binaryPaths[request.command] || request.command;
    logger.debug(`[Bridge] Spawning ${commandPath} with args: ${request.args.join(' ')}`);

    try {
      if (!request.cwd) {
        throw new Error('Missing CWD');
      }

      const resolvedCwd = resolve(request.cwd);
      if (!resolvedCwd.startsWith('/Users/sbx_')) {
        throw new Error(`Invalid CWD: ${resolvedCwd}. Commands must run inside a sandbox home.`);
      }

      if (!existsSync(resolvedCwd)) {
        throw new Error(`CWD does not exist: ${resolvedCwd}`);
      }

      const proc = spawn([commandPath, ...request.args], {
        cwd: resolvedCwd,
        env: {
          ...process.env,
          HOME: isolatedHome,
          GH_CONFIG_DIR: join(isolatedHome, '.config', 'gh'),
          GH_TOKEN: this.githubToken,
          GITHUB_TOKEN: this.githubToken,
          // Git isolation
          GIT_CONFIG_GLOBAL: gitConfigFile,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_AUTHOR_NAME: 'SBX Sandbox',
          GIT_AUTHOR_EMAIL: 'sbx@localhost',
          GIT_COMMITTER_NAME: 'SBX Sandbox',
          GIT_COMMITTER_EMAIL: 'sbx@localhost',
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: 'true',
          // Clear any other gh related env vars to ensure we use our token
          GITHUB_USER: '',
          GH_USER: '',
          GITHUB_ACTION: '',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const stdoutReader = this.streamToSocket(proc.stdout, socket, 'stdout');
      const stderrReader = this.streamToSocket(proc.stderr, socket, 'stderr');
      const exitCode = await proc.exited;
      await Promise.all([stdoutReader, stderrReader]);

      socket.write(`${JSON.stringify({ type: 'exit', code: exitCode })}\n`);
      socket.end();
    } catch (error) {
      socket.write(`${JSON.stringify({ type: 'error', message: String(error) })}\n`);
      socket.end();
    }
  }

  private async streamToSocket(
    stream: ReadableStream,
    socket: Socket<unknown>,
    type: 'stdout' | 'stderr',
  ) {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        socket.write(`${JSON.stringify({ type, data: Buffer.from(value).toString('base64') })}\n`);
      }
    } finally {
      reader.releaseLock();
    }
  }

  private validateArgs(command: string, args: string[]): string | null {
    if (command === 'git') {
      const blocked = [
        '--exec-path',
        '--config',
        '-c',
        '--upload-pack',
        '--receive-pack',
        'config',
        'credential',
      ];
      for (const arg of args) {
        if (blocked.some((b) => arg === b || arg.startsWith(`${b}=`))) {
          return `Flag or subcommand '${arg}' is not allowed for security reasons.`;
        }
      }
    }
    if (command === 'gh') {
      const blocked = ['alias', 'extension', 'config', 'secret'];
      for (const arg of args) {
        if (blocked.includes(arg)) {
          return `Subcommand '${arg}' is not allowed for security reasons.`;
        }
      }
      if (args.includes('auth') && !args.includes('status')) {
        return "Subcommand 'auth' (except 'status') is not allowed for security reasons.";
      }
    }
    return null;
  }

  stop() {
    this.commandListener?.stop();
    this.proxyServer?.close();
    if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
    if (existsSync(this.proxySocketPath)) unlinkSync(this.proxySocketPath);
  }

  async attachToSandbox(username: string, port: number): Promise<void> {
    if (process.env.SKIP_PROVISION) {
      logger.debug(`[Bridge] Mock skipping attach to ${username} on port ${port}`);
      return;
    }
    const sandboxLogDir = `/Users/${username}/.sbx/logs`;
    const env = {
      BRIDGE_SOCK: this.getSocketPaths().command,
      PROXY_SOCK: this.getSocketPaths().proxy,
    };

    // Check if already running on this port
    try {
      const check = await runAsUser(username, `nc -z 127.0.0.1 ${port}`);
      if (check.exitCode === 0) {
        logger.debug(`[Bridge] Already attached to ${username} on port ${port}`);
        return;
      }
    } catch {
      /* ignore */
    }

    logger.info(`[Bridge] Attaching to ${username} on port ${port}...`);

    // Try to clean up any dead process on this port just in case
    try {
      execSync(`sudo lsof -ti:${port} | xargs sudo kill -9 || true`);
    } catch {
      /* ignore */
    }

    await runAsUser(
      username,
      `mkdir -p ${sandboxLogDir} && nohup python3 -u /Users/${username}/.sbx/bin/api_bridge.py ${port} >${sandboxLogDir}/api_bridge.log 2>&1 &`,
      { env },
    );

    // Wait for the port to be open
    for (let i = 0; i < 15; i++) {
      try {
        const check = await runAsUser(username, `nc -z 127.0.0.1 ${port}`);
        if (check.exitCode === 0) return;
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(
      `Timed out waiting for API bridge to start in sandbox ${username} on port ${port}`,
    );
  }

  getSocketPaths() {
    return {
      command: this.socketPath,
      proxy: this.proxySocketPath,
    };
  }
}
