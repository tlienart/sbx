export interface Sandbox {
  id: string;
  name?: string;
  createdAt: Date;
  status: 'active' | 'archived';
}

export interface SandboxManager {
  createSandbox(name?: string, tools?: string, provider?: string): Promise<Sandbox>;
  getSandbox(id: string): Promise<Sandbox>;
  listSandboxes(): Promise<Sandbox[]>;
  removeSandbox(id: string): Promise<void>;
  isSandboxAlive(id: string): Promise<boolean>;
}
