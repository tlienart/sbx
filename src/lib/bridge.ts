import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { join } from 'node:path';
import { type Socket, type SocketListener, listen, spawn } from 'bun';
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

  constructor(username: string) {
    this.bridgeDir = `/tmp/.sbx_${username}`;
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
            await this.handleRequest(socket, request);
          } catch (error) {
            logger.error(`[Bridge] Error handling data: ${error}`);
            socket.write(JSON.stringify({ type: 'error', message: String(error) }));
            socket.end();
          }
        },
      },
    });
    chmodSync(this.socketPath, 0o777); // Allow sandbox user to connect

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

        let targetHost: string | null = null;
        let targetPath: string | null = null;
        let authHeader: string | null = null;
        let authValue: string | null = null;
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
              res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
              proxyRes.pipe(res);
            },
          );

          proxyReq.on('error', (e) => {
            logger.error(`[Proxy] Upstream error: ${e.message}`);
            res.writeHead(502);
            res.end('Proxy Error');
          });

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
      chmodSync(this.proxySocketPath, 0o777);
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
        JSON.stringify({ type: 'error', message: `Command ${request.command} not allowed` }),
      );
      socket.end();
      return;
    }

    const isolatedHome = join(this.bridgeDir, '.isolated_home');
    if (!existsSync(isolatedHome)) {
      mkdirSync(isolatedHome, { recursive: true });
      chmodSync(isolatedHome, 0o700);
    }

    const commandPath = this.binaryPaths[request.command] || request.command;
    logger.debug(`[Bridge] Spawning ${commandPath} with args: ${request.args.join(' ')}`);

    try {
      let effectiveCwd = process.cwd();
      if (request.cwd && existsSync(request.cwd)) {
        try {
          // Check if we can actually enter the directory
          readdirSync(request.cwd);
          effectiveCwd = request.cwd;
        } catch (e) {
          logger.debug(
            `[Bridge] Cannot access cwd ${request.cwd}, falling back to ${effectiveCwd}`,
          );
        }
      }

      const proc = spawn([commandPath, ...request.args], {
        cwd: effectiveCwd,
        env: {
          ...process.env,
          HOME: isolatedHome,
          GH_CONFIG_DIR: join(isolatedHome, '.config', 'gh'),
          GH_TOKEN: this.githubToken,
          GITHUB_TOKEN: this.githubToken,
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

  stop() {
    this.commandListener?.stop();
    this.proxyServer?.close();
    if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
    if (existsSync(this.proxySocketPath)) unlinkSync(this.proxySocketPath);
  }

  getSocketPaths() {
    return {
      command: this.socketPath,
      proxy: this.proxySocketPath,
    };
  }
}
