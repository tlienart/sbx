export interface Sandbox {
  id: string;
  name?: string;
  createdAt: Date;
  status: 'active' | 'archived';
  restrictedNetwork?: boolean;
  whitelist?: string[];
}

export interface CreateSandboxOptions {
  name?: string;
  tools?: string;
  provider?: string;
  restrictedNetwork?: boolean;
  whitelist?: string[];
}

export interface NetworkStatus {
  restricted?: boolean;
  whitelist: string[];
  pf: {
    enabled: boolean;
    anchorReferenced: boolean;
  };
}

export interface SandboxManager {
  createSandbox(options: CreateSandboxOptions): Promise<Sandbox>;
  getSandbox(id: string): Promise<Sandbox>;
  findSandbox(identifier: string): Promise<Sandbox | undefined>;
  listSandboxes(): Promise<Sandbox[]>;
  removeSandbox(id: string): Promise<void>;
  isSandboxAlive(id: string): Promise<boolean>;
  onNetworkBlocked(
    callback: (sandboxId: string, domain: string, method: string, url: string) => void,
  ): void;
  updateWhitelist(sandboxId: string, whitelist: string[]): Promise<void>;
  getNetworkStatus(sandboxId: string): Promise<NetworkStatus>;
}
