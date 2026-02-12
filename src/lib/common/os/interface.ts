export interface IFileSystem {
  exists(path: string): boolean;
  mkdir(path: string, options?: { recursive?: boolean }): void;
  read(path: string): string;
  write(path: string, content: string): void;
  append(path: string, content: string): void;
  remove(path: string, options?: { recursive?: boolean }): void;
  stat(path: string): { uid: number; gid: number; mode: number };
}

export interface ExecOptions {
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
  /**
   * Environment variables.
   */
  env?: Record<string, string | undefined>;
  /**
   * Standard input/output configuration.
   */
  stdio?: 'inherit' | 'pipe' | 'ignore';
  /**
   * Working directory.
   */
  cwd?: string;
  /**
   * Whether to run with sudo.
   */
  sudo?: boolean;
  /**
   * Whether to reject on non-zero exit code.
   */
  reject?: boolean;
  /**
   * Redirect stdout.
   */
  stdout?: 'inherit' | 'pipe' | 'ignore';
  /**
   * Redirect stderr.
   */
  stderr?: 'inherit' | 'pipe' | 'ignore';
}

export interface IProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
}

export interface ISubprocess {
  pid?: number;
  stdout?: AsyncIterable<Uint8Array | string>;
  stderr?: AsyncIterable<Uint8Array | string>;
  exited: Promise<number>;
  kill(signal?: string): void;
}

export interface IProcessRunner {
  run(file: string, args: string[], options?: ExecOptions): Promise<IProcessResult>;
  sudo(file: string, args: string[], options?: ExecOptions): Promise<IProcessResult>;
  runAsUser(username: string, command: string, options?: ExecOptions): Promise<IProcessResult>;
  spawn(file: string, args: string[], options?: ExecOptions): ISubprocess;
  ensureSudo(): Promise<void>;
}

export interface IEnv {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

export interface IOS {
  fs: IFileSystem;
  proc: IProcessRunner;
  env: IEnv;
}
