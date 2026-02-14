import { v4 as uuidv4 } from 'uuid';
import { TrafficProxy } from '../bridge/TrafficProxy.ts';
import { getOS } from '../common/os/index.ts';
import type { IdentityBox } from '../identity/index.ts';
import { logger } from '../logger.ts';
import type { SandboxRepository } from '../persistence/repositories/SandboxRepository.ts';
import type { CreateSandboxOptions, Sandbox, SandboxManager } from './types.ts';

const SYSTEM_WHITELIST = [
  'pkgx.sh',
  'get.pkgx.sh',
  'inventory.pkgx.sh',
  'data.pkgx.sh',
  'github.com',
  'objects.githubusercontent.com',
  'pypi.org',
  'files.pythonhosted.org',
  'registry.npmjs.org',
];

export class DefaultSandboxManager implements SandboxManager {
  private os = getOS();
  private proxies: Map<string, TrafficProxy> = new Map();
  private uidToSandboxId: Map<number, string> = new Map();
  private blockedCallbacks: ((
    sandboxId: string,
    domain: string,
    method: string,
    url: string,
  ) => void)[] = [];

  constructor(
    private identity: IdentityBox,
    private sandboxRepo: SandboxRepository,
    private provisionSession: (
      instanceName: string,
      tools?: string,
      provider?: string,
      apiPort?: number,
      proxyPort?: number,
    ) => Promise<void>,
    private getSandboxPort: (instanceName: string) => number,
    private getTrafficProxyPort: (instanceName: string) => number,
  ) {}

  async initNetwork() {
    await this.identity.network.init();
    await this.identity.monitor.start();
    this.identity.monitor.onBlock((event) => {
      const sandboxId = this.uidToSandboxId.get(event.uid);
      if (sandboxId) {
        logger.warn(
          `[SandboxManager] Sandbox ${sandboxId} blocked RAW ${event.protocol} to ${event.destination}`,
        );
        for (const cb of this.blockedCallbacks) {
          cb(sandboxId, event.destination, event.protocol, event.destination);
        }
      }
    });
  }

  async isSandboxAlive(id: string): Promise<boolean> {
    if (this.os.env.get('SKIP_PROVISION')) return true;
    const instanceName = id.split('-')[0] as string;
    const username = await this.identity.users.getSessionUsername(instanceName);
    return this.identity.users.userExists(username);
  }

  async createSandbox(options: CreateSandboxOptions): Promise<Sandbox> {
    const id = uuidv4();
    const instanceName = id.split('-')[0] as string;
    const apiPort = this.getSandboxPort(instanceName);
    const proxyPort = this.getTrafficProxyPort(instanceName);

    const sandbox: Sandbox = {
      id,
      name: options.name,
      createdAt: new Date(),
      status: 'active',
      restrictedNetwork: options.restrictedNetwork,
      whitelist: options.whitelist,
    };

    if (!this.os.env.get('SKIP_PROVISION')) {
      logger.info(`Creating sandbox ${instanceName}...`);
      const username = await this.identity.setupSessionUser(instanceName);

      if (options.restrictedNetwork) {
        await this.initNetwork();
        const uidStr = await this.identity.users.getNumericUid(username);
        const uid = Number.parseInt(uidStr, 10);
        this.uidToSandboxId.set(uid, id);
        await this.identity.network.enableRestrictedNetwork(uidStr, [apiPort, proxyPort]);

        const whitelist = [...new Set([...SYSTEM_WHITELIST, ...(options.whitelist || [])])];
        const proxy = new TrafficProxy({
          port: proxyPort,
          whitelist,
          onBlocked: async (domain, method, url) => {
            logger.warn(
              `[SandboxManager] Sandbox ${instanceName} blocked: ${method} ${domain}${url}`,
            );
            for (const cb of this.blockedCallbacks) {
              cb(id, domain, method, url);
            }
          },
        });
        await proxy.start();
        this.proxies.set(id, proxy);
      }

      await this.provisionSession(
        instanceName,
        options.tools,
        options.provider,
        apiPort,
        options.restrictedNetwork ? proxyPort : undefined,
      );
    } else {
      logger.info(`[Mock] Skipping provisioning for ${instanceName}`);
    }

    this.sandboxRepo.create(sandbox);

    return sandbox;
  }

  async getSandbox(id: string): Promise<Sandbox> {
    const sandbox = this.sandboxRepo.findById(id);
    if (!sandbox) throw new Error(`Sandbox ${id} not found`);
    return sandbox;
  }

  async findSandbox(identifier: string): Promise<Sandbox | undefined> {
    const sandboxes = await this.listSandboxes();
    return sandboxes.find(
      (s) => s.id === identifier || s.id.startsWith(identifier) || s.name === identifier,
    );
  }

  async listSandboxes(): Promise<Sandbox[]> {
    return this.sandboxRepo.findAll();
  }

  async removeSandbox(id: string): Promise<void> {
    const instanceName = id.split('-')[0] as string;
    try {
      const sandbox = await this.getSandbox(id);

      const proxy = this.proxies.get(id);
      if (proxy) {
        proxy.stop();
        this.proxies.delete(id);
      }

      if (sandbox.restrictedNetwork && !this.os.env.get('SKIP_PROVISION')) {
        const username = await this.identity.users.getSessionUsername(instanceName);
        try {
          const uidStr = await this.identity.users.getNumericUid(username);
          const uid = Number.parseInt(uidStr, 10);
          this.uidToSandboxId.delete(uid);
          await this.identity.network.disableRestrictedNetwork(uidStr);
        } catch (err) {
          logger.debug(`Could not get UID for ${username} to disable network: ${err}`);
        }
      }
      await this.identity.cleanupSessionUser(instanceName);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to cleanup session user for ${id}: ${msg}`);
    }

    // Foreign key ON DELETE CASCADE will handle sessions and agent_states in the real DB
    this.sandboxRepo.delete(id);
  }

  onNetworkBlocked(
    callback: (sandboxId: string, domain: string, method: string, url: string) => void,
  ): void {
    this.blockedCallbacks.push(callback);
  }

  async updateWhitelist(sandboxId: string, whitelist: string[]): Promise<void> {
    const sandbox = await this.getSandbox(sandboxId);
    sandbox.whitelist = whitelist;
    this.sandboxRepo.updateWhitelist(sandboxId, whitelist);

    const proxy = this.proxies.get(sandboxId);
    if (proxy) {
      const fullWhitelist = [...new Set([...SYSTEM_WHITELIST, ...whitelist])];
      proxy.updateWhitelist(fullWhitelist);
    }
  }

  async getNetworkStatus(sandboxId: string) {
    const sandbox = await this.getSandbox(sandboxId);
    const pfStatus = await this.identity.network.checkStatus();

    return {
      restricted: sandbox.restrictedNetwork,
      whitelist: [...new Set([...SYSTEM_WHITELIST, ...(sandbox.whitelist || [])])],
      pf: pfStatus,
    };
  }
}
