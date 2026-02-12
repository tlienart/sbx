import fs from 'node:fs';
import { execa } from 'execa';
import { ensureSudo, run, runAsUser, sudoRun } from './exec.ts';
import type {
  ExecOptions,
  IEnv,
  IFileSystem,
  IOS,
  IProcessResult,
  IProcessRunner,
  ISubprocess,
} from './interface.ts';

class RealFileSystem implements IFileSystem {
  exists(path: string): boolean {
    return fs.existsSync(path);
  }
  mkdir(path: string, options?: { recursive?: boolean }): void {
    fs.mkdirSync(path, options);
  }
  read(path: string): string {
    return fs.readFileSync(path, 'utf-8');
  }
  write(path: string, content: string): void {
    fs.writeFileSync(path, content);
  }
  append(path: string, content: string): void {
    fs.appendFileSync(path, content);
  }
  remove(path: string, options?: { recursive?: boolean }): void {
    fs.rmSync(path, options);
  }
  stat(path: string): { uid: number; gid: number; mode: number } {
    const s = fs.statSync(path);
    return { uid: s.uid, gid: s.gid, mode: s.mode };
  }
}

class RealEnv implements IEnv {
  get(key: string): string | undefined {
    return process.env[key];
  }
  set(key: string, value: string): void {
    process.env[key] = value;
  }
}

class RealProcessRunner implements IProcessRunner {
  async run(file: string, args: string[], options?: ExecOptions): Promise<IProcessResult> {
    if (options?.sudo) {
      return this.sudo(file, args, options);
    }
    return run(file, args, options);
  }
  async sudo(file: string, args: string[], options?: ExecOptions): Promise<IProcessResult> {
    return sudoRun(file, args, options);
  }
  async runAsUser(
    username: string,
    command: string,
    options?: ExecOptions,
  ): Promise<IProcessResult> {
    return runAsUser(username, command, options);
  }
  spawn(file: string, args: string[], options?: ExecOptions): ISubprocess {
    const child = execa(file, args, options);
    return {
      pid: child.pid,
      stdout: child.stdout as unknown as AsyncIterable<Uint8Array | string>,
      stderr: child.stderr as unknown as AsyncIterable<Uint8Array | string>,
      exited: child.then((r) => r.exitCode ?? 0),
      kill: (signal?: string) => child.kill(signal),
    };
  }
  async ensureSudo(): Promise<void> {
    return ensureSudo();
  }
}

export const RealOS: IOS = {
  fs: new RealFileSystem(),
  proc: new RealProcessRunner(),
  env: new RealEnv(),
};
