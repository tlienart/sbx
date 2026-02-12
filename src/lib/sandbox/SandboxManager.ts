import { v4 as uuidv4 } from 'uuid';
import { getOS } from '../common/os/index.ts';
import type { IdentityBox } from '../identity/index.ts';
import { logger } from '../logger.ts';
import type { SandboxRepository } from '../persistence/repositories/SandboxRepository.ts';
import type { Sandbox, SandboxManager } from './types.ts';

export class DefaultSandboxManager implements SandboxManager {
  private os = getOS();

  constructor(
    private identity: IdentityBox,
    private sandboxRepo: SandboxRepository,
    private provisionSession: (
      instanceName: string,
      tools?: string,
      provider?: string,
      apiPort?: number,
    ) => Promise<void>,
    private getSandboxPort: (instanceName: string) => number,
  ) {}

  async isSandboxAlive(id: string): Promise<boolean> {
    if (this.os.env.get('SKIP_PROVISION')) return true;
    const instanceName = id.split('-')[0] as string;
    const username = await this.identity.users.getSessionUsername(instanceName);
    return this.identity.users.userExists(username);
  }

  async createSandbox(name?: string, tools?: string, provider?: string): Promise<Sandbox> {
    const id = uuidv4();
    const instanceName = id.split('-')[0] as string;
    const apiPort = this.getSandboxPort(instanceName);

    const sandbox: Sandbox = {
      id,
      name,
      createdAt: new Date(),
      status: 'active',
    };

    if (!this.os.env.get('SKIP_PROVISION')) {
      logger.info(`Creating sandbox ${instanceName}...`);
      await this.identity.setupSessionUser(instanceName);
      await this.provisionSession(instanceName, tools, provider, apiPort);
    } else {
      logger.info(`[Mock] Skipping provisioning for ${instanceName}`);
    }

    this.sandboxRepo.create({
      id: sandbox.id,
      name: sandbox.name || '',
      status: sandbox.status,
      created_at: sandbox.createdAt.toISOString(),
    });

    return sandbox;
  }

  async getSandbox(id: string): Promise<Sandbox> {
    const row = this.sandboxRepo.findById(id);
    if (!row) throw new Error(`Sandbox ${id} not found`);

    return {
      id: row.id,
      name: row.name || undefined,
      status: row.status as 'active' | 'archived',
      createdAt: new Date(row.created_at),
    };
  }

  async findSandbox(identifier: string): Promise<Sandbox | undefined> {
    const sandboxes = await this.listSandboxes();
    return sandboxes.find(
      (s) => s.id === identifier || s.id.startsWith(identifier) || s.name === identifier,
    );
  }

  async listSandboxes(): Promise<Sandbox[]> {
    const rows = this.sandboxRepo.findAll();
    return rows.map((row) => ({
      id: row.id,
      name: row.name || undefined,
      status: row.status as 'active' | 'archived',
      createdAt: new Date(row.created_at),
    }));
  }

  async removeSandbox(id: string): Promise<void> {
    const instanceName = id.split('-')[0] as string;
    try {
      await this.identity.cleanupSessionUser(instanceName);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to cleanup session user for ${id}: ${msg}`);
    }

    // Foreign key ON DELETE CASCADE will handle sessions and agent_states in the real DB
    this.sandboxRepo.delete(id);
  }
}
