import fs from 'node:fs';
import path from 'node:path';
import { type Options, type Result, execa } from 'execa';
import { logger } from '../../logger.ts';

const LOG_DIR = '.sbx/logs';
const TRACE_LOG = path.join(LOG_DIR, 'trace.log');

/**
 * Ensures log directory exists.
 * Gracefully handles permission issues if run without sudo after a sudo run.
 */
function ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  } catch {
    /* Ignore log directory creation errors */
  }
}

ensureLogDir();

export interface ExecOptions extends Options {
  /**
   * If true, suppresses stdout and stderr in the CLI.
   * All output is still sent to the trace log.
   */
  silent?: boolean;
  /**
   * Optional timeout in milliseconds.
   */
  timeoutMs?: number;
  /**
   * Callback for real-time stdout.
   */
  onStdout?: (data: string) => void;
  /**
   * Callback for real-time stderr.
   */
  onStderr?: (data: string) => void;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
}

/**
 * Appends a message to the trace log file.
 * Gracefully ignores errors (e.g., EACCES) to prevent crashing core functionality.
 */
function trace(message: string) {
  try {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(TRACE_LOG, `[${timestamp}] ${message}\n`);
  } catch {
    /* Trace failure is non-fatal */
  }
}

/**
 * Ensures sudo is authenticated before starting automated tasks.
 * Uses non-interactive check first.
 */
export async function ensureSudo(): Promise<void> {
  try {
    // Check if we already have a valid sudo session
    await execa('sudo', ['-n', '-v']);
    return;
  } catch {
    // Session expired or doesn't exist, try interactive
    try {
      logger.info(
        '🔑 Sbx requires administrative privileges. Please enter your password if prompted.',
      );
      trace('CMD: sudo -v');
      await execa('sudo', ['-v'], { stdio: 'inherit' });
      logger.success('Sudo authentication successful.');
    } catch (err) {
      trace(`AUTH FAILED: ${err}`);
      throw new Error('Sudo authentication failed. This tool requires sudo privileges.');
    }
  }
}

/**
 * Executes a command with focused logging and trace capturing.
 */
export async function run(
  file: string,
  args: string[],
  options: ExecOptions = {},
): Promise<RunResult> {
  const { silent = true, timeoutMs = 120000, ...execaOptions } = options;

  const commandStr = `${file} ${args.join(' ')}`;

  if (process.env.SKIP_PROVISION) {
    const isSandboxOp =
      file === 'sysadminctl' ||
      (file === 'sudo' && args.some((arg) => arg.includes('sbx_'))) ||
      (file === 'su' && args.some((arg) => arg.includes('sbx_')));

    if (isSandboxOp) {
      trace(`MOCK EXEC: ${commandStr}`);
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        command: commandStr,
      };
    }
  }

  trace(`EXEC: ${commandStr}`);

  const subprocess = execa(file, args, {
    ...execaOptions,
    timeout: timeoutMs,
    all: true,
  });

  if (options.onStdout && subprocess.stdout) {
    subprocess.stdout.on('data', (chunk) => {
      options.onStdout?.(chunk.toString());
    });
  }

  if (options.onStderr && subprocess.stderr) {
    subprocess.stderr.on('data', (chunk) => {
      options.onStderr?.(chunk.toString());
    });
  }

  // Heartbeat/Watchdog
  let elapsed = 0;
  const heartbeat = setInterval(() => {
    elapsed += 5;
    if (file === 'sudo' && args.includes('sysadminctl')) {
      logger.info(
        `[PID: ${subprocess.pid}] Waiting for macOS administrative permission... (${elapsed}s)`,
      );
      trace(`STILL RUNNING: ${commandStr} (PID: ${subprocess.pid}, ELAPSED: ${elapsed}s)`);
    }
  }, 5000);

  try {
    const result = await subprocess;

    // Log complete output to trace
    if (result.all) {
      trace(`RESULT [${result.exitCode}]:\n${result.all}`);
    }

    return {
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
      exitCode: result.exitCode ?? 0,
      command: result.command ?? '',
    };
  } catch (error: unknown) {
    const result = error as Result;
    if (error && typeof error === 'object' && 'timedOut' in error && error.timedOut) {
      trace(`TIMEOUT: ${commandStr} after ${timeoutMs}ms`);
      throw new Error(`Command timed out after ${timeoutMs}ms: ${commandStr}. 
HINT: This usually happens when macOS is waiting for a GUI permission click. 
Check your screen for popups or grant your Terminal "Full Disk Access" in System Settings.`);
    }

    trace(`FAILED [${result.exitCode}]: ${result.all || result.message}`);
    throw new Error(
      `Command failed: ${result.command}\n` +
        `Exit code: ${result.exitCode}\n` +
        `Output: ${result.all || result.stderr || result.message}`,
    );
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * Executes a command with sudo.
 */
export async function sudoRun(
  file: string,
  args: string[],
  options: ExecOptions = {},
): Promise<RunResult> {
  const useInteractive = options.stdio === 'inherit';
  const sudoArgs = useInteractive ? [file, ...args] : ['-n', file, ...args];
  return run('sudo', sudoArgs, options);
}

/**
 * Executes a command as a specific user using sudo su -.
 */
export async function runAsUser(
  username: string,
  command: string,
  options: ExecOptions = {},
): Promise<RunResult> {
  const env: Record<string, string> = {};
  if (options.env) {
    for (const [k, v] of Object.entries(options.env)) {
      if (v !== undefined) env[k] = v;
    }
  }

  // Ensure TMPDIR is set to the sandbox-specific one if not provided.
  // This is a fallback in case profile files are not sourced.
  if (!env.TMPDIR) {
    env.TMPDIR = `/Users/${username}/tmp`;
  }

  // Escape values for shell.
  const envExports = Object.entries(env)
    .map(([k, v]) => {
      // Simple shell escaping: replace ' with '\'' and wrap in '
      const escaped = String(v).replace(/'/g, "'\\''");
      return `export ${k}='${escaped}'`;
    })
    .join('; ');

  // We MUST use su - (login shell) to match the sudoers NOPASSWD policy.
  // The login shell also ensures profile files are sourced.
  const finalCommand = `${envExports}; ${command}`;

  return sudoRun('su', ['-', username, '-c', finalCommand], options);
}
