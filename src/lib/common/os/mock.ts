import type {
  ExecOptions,
  IEnv,
  IFileSystem,
  IOS,
  IProcessResult,
  IProcessRunner,
  ISubprocess,
} from './interface.ts';

export class MockFileSystem implements IFileSystem {
  private files: Map<string, string> = new Map();
  private dirs: Set<string> = new Set();

  exists(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }
  mkdir(path: string, _options?: { recursive?: boolean }): void {
    this.dirs.add(path);
  }
  read(path: string): string {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return content;
  }
  write(path: string, content: string): void {
    this.files.set(path, content);
  }
  append(path: string, content: string): void {
    const existing = this.files.get(path) || '';
    this.files.set(path, existing + content);
  }
  remove(path: string, _options?: { recursive?: boolean }): void {
    this.files.delete(path);
    this.dirs.delete(path);
  }
  stat(_path: string): { uid: number; gid: number; mode: number } {
    return { uid: 1000, gid: 1000, mode: 0o700 };
  }
}

export class MockEnv implements IEnv {
  private vars: Map<string, string> = new Map();
  get(key: string): string | undefined {
    return this.vars.get(key);
  }
  set(key: string, value: string): void {
    this.vars.set(key, value);
  }
}

export class MockProcessRunner implements IProcessRunner {
  private handlers: Map<string, (args: string[]) => IProcessResult> = new Map();

  setHandler(file: string, handler: (args: string[]) => IProcessResult) {
    this.handlers.set(file, handler);
  }

  async run(file: string, args: string[], options?: ExecOptions): Promise<IProcessResult> {
    if (options?.sudo) {
      return this.sudo(file, args, { ...options, sudo: false });
    }
    const handler = this.handlers.get(file);
    if (handler) return handler(args);
    return { stdout: '', stderr: '', exitCode: 0, command: `${file} ${args.join(' ')}` };
  }
  async sudo(file: string, args: string[], _options?: ExecOptions): Promise<IProcessResult> {
    const handler = this.handlers.get(file);
    if (handler) return handler(args);
    return { stdout: '', stderr: '', exitCode: 0, command: `sudo ${file} ${args.join(' ')}` };
  }
  async runAsUser(
    username: string,
    command: string,
    options?: ExecOptions,
  ): Promise<IProcessResult> {
    return this.run('su', ['-', username, '-c', command], options);
  }
  spawn(_file: string, _args: string[], _options?: ExecOptions): ISubprocess {
    return {
      pid: 1234,
      exited: Promise.resolve(0),
      kill: (_signal?: string) => {},
    };
  }
  async ensureSudo(): Promise<void> {
    return;
  }
}

export const createMockOS = (): IOS & { proc: MockProcessRunner; fs: MockFileSystem } => {
  const fs = new MockFileSystem();
  const proc = new MockProcessRunner();
  const env = new MockEnv();
  return {
    fs,
    proc,
    env,
  };
};
