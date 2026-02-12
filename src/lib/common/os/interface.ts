export interface IFileSystem {
  exists(path: string): boolean;
  mkdir(path: string, options?: { recursive?: boolean }): void;
  read(path: string): string;
  write(path: string, content: string): void;
  append(path: string, content: string): void;
  remove(path: string, options?: { recursive?: boolean }): void;
  stat(path: string): { uid: number; gid: number; mode: number };
}

export interface IProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
}

export interface IProcessRunner {
  run(file: string, args: string[], options?: any): Promise<IProcessResult>;
  sudo(file: string, args: string[], options?: any): Promise<IProcessResult>;
  runAsUser(username: string, command: string, options?: any): Promise<IProcessResult>;
  spawn(file: string, args: string[], options?: any): any;
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
