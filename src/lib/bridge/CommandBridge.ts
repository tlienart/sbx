import { join, resolve } from 'node:path';
import { type Socket, type SocketListener, listen } from 'bun';
import { getOS } from '../common/os/index.ts';
import { logger } from '../logger.ts';
import type { SecretManager } from './SecretManager.ts';

export interface BridgeRequest {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export class CommandBridge {
  private listener: SocketListener<unknown> | null = null;
  private socketPath: string;
  private bridgeDir: string;
  private binaryPaths: Record<string, string> = {};
  private sandboxUser: string | null = null;
  private os = getOS();

  constructor(
    hostUser: string,
    private secretManager: SecretManager,
    sandboxUser?: string,
  ) {
    this.bridgeDir = `/tmp/.sbx_${hostUser}`;
    this.sandboxUser = sandboxUser || null;

    if (!this.os.fs.exists(this.bridgeDir)) {
      this.os.fs.mkdir(this.bridgeDir, { recursive: true });
      this.os.proc.run('chmod', ['711', this.bridgeDir]);
    }
    this.socketPath = join(this.bridgeDir, 'bridge.sock');
    this.resolveBinaries();
  }

  private resolveBinaries() {
    const paths = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
    for (const cmd of ['git', 'gh', 'opencode']) {
      for (const p of paths) {
        const fullPath = join(p, cmd);
        if (this.os.fs.exists(fullPath)) {
          this.binaryPaths[cmd] = fullPath;
          break;
        }
      }
    }
  }

  async start() {
    if (this.os.fs.exists(this.socketPath)) this.os.fs.remove(this.socketPath);

    this.listener = listen({
      unix: this.socketPath,
      socket: {
        data: async (socket, data) => {
          try {
            const request: BridgeRequest = JSON.parse(data.toString());
            logger.debug(`[CommandBridge] Received request: ${JSON.stringify(request)}`);
            await this.handleRequest(socket, request);
          } catch (error) {
            logger.error(`[CommandBridge] Error handling data: ${error}`);
            socket.write(`${JSON.stringify({ type: 'error', message: String(error) })}\n`);
            socket.end();
          }
        },
      },
    });

    // Wait for socket
    for (let i = 0; i < 20; i++) {
      if (this.os.fs.exists(this.socketPath)) {
        this.setPermissions();
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Timed out waiting for command bridge socket');
  }

  private setPermissions() {
    if (!this.os.fs.exists(this.socketPath)) {
      logger.debug(
        `[CommandBridge] Socket path ${this.socketPath} does not exist yet, skipping permissions.`,
      );
      return;
    }

    if (this.sandboxUser) {
      try {
        this.os.proc.sudo(
          'chmod',
          ['+a', `user:${this.sandboxUser} allow read,write`, this.socketPath],
          { reject: false },
        );
      } catch (err) {
        logger.debug(`[CommandBridge] Failed to set ACL on socket: ${err}`);
        this.os.proc.run('chmod', ['666', this.socketPath], { reject: false });
      }
    } else {
      this.os.proc.run('chmod', ['666', this.socketPath], { reject: false });
    }
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
      socket.write(`${JSON.stringify({ type: 'error', message: validationError })}\n`);
      socket.end();
      return;
    }

    const isolatedHome = join(this.bridgeDir, '.isolated_home');
    if (!this.os.fs.exists(isolatedHome)) {
      this.os.fs.mkdir(isolatedHome, { recursive: true });
      this.os.proc.run('chmod', ['700', isolatedHome]);
    }

    const gitConfigFile = join(isolatedHome, '.gitconfig');
    this.ensureGitConfig(gitConfigFile);

    const commandPath = this.binaryPaths[request.command] || request.command;

    try {
      const resolvedCwd = resolve(request.cwd);
      if (!resolvedCwd.startsWith('/Users/sbx_')) {
        throw new Error(`Invalid CWD: ${resolvedCwd}`);
      }

      if (!this.os.fs.exists(resolvedCwd)) {
        throw new Error(`CWD does not exist: ${resolvedCwd}`);
      }

      const proc = this.os.proc.spawn(commandPath, request.args, {
        cwd: resolvedCwd,
        env: {
          ...process.env,
          HOME: isolatedHome,
          GH_CONFIG_DIR: join(isolatedHome, '.config', 'gh'),
          GH_TOKEN: this.secretManager.getGithubToken(),
          GITHUB_TOKEN: this.secretManager.getGithubToken(),
          GIT_CONFIG_GLOBAL: gitConfigFile,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_AUTHOR_NAME: 'SBX Sandbox',
          GIT_AUTHOR_EMAIL: 'sbx@localhost',
          GIT_COMMITTER_NAME: 'SBX Sandbox',
          GIT_COMMITTER_EMAIL: 'sbx@localhost',
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: 'true',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const stdoutReader = proc.stdout
        ? this.streamToSocket(proc.stdout, socket, 'stdout')
        : Promise.resolve();
      const stderrReader = proc.stderr
        ? this.streamToSocket(proc.stderr, socket, 'stderr')
        : Promise.resolve();
      const exitCode = await proc.exited;
      await Promise.all([stdoutReader, stderrReader]);

      socket.write(`${JSON.stringify({ type: 'exit', code: exitCode })}\n`);
      socket.end();
    } catch (error) {
      socket.write(`${JSON.stringify({ type: 'error', message: String(error) })}\n`);
      socket.end();
    }
  }

  private ensureGitConfig(path: string) {
    if (!this.os.fs.exists(path)) {
      const config = [
        '[credential]',
        '\thelper = ',
        '\thelper = !gh auth git-credential',
        '[core]',
        '\tsshCommand = ssh -o BatchMode=yes',
        '[protocol]',
        '\tallow = always',
      ].join('\n');
      this.os.fs.write(path, config);
      this.os.proc.run('chmod', ['600', path]);
    }
  }

  private async streamToSocket(
    stream: AsyncIterable<Uint8Array | string>,
    socket: Socket<unknown>,
    type: 'stdout' | 'stderr',
  ) {
    try {
      for await (const chunk of stream) {
        const data = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
        socket.write(`${JSON.stringify({ type, data: data.toString('base64') })}\n`);
      }
    } catch (err) {
      logger.error(`[CommandBridge] Stream error (${type}): ${err}`);
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
    this.listener?.stop();
    if (this.os.fs.exists(this.socketPath)) this.os.fs.remove(this.socketPath);
  }

  getSocketPath() {
    return this.socketPath;
  }
}
