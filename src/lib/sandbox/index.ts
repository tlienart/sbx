import { getSandboxPort } from '../common/utils/port.ts';
import { getIdentity } from '../identity/index.ts';
import { getPersistence } from '../persistence/index.ts';
import { Provisioner } from '../provision/index.ts';
import { DefaultSandboxManager } from './SandboxManager.ts';
import type { SandboxManager } from './types.ts';

let sandboxManager: SandboxManager | undefined;

export function getSandboxManager(): SandboxManager {
  if (!sandboxManager) {
    const identity = getIdentity();
    const persistence = getPersistence();
    const provisioner = new Provisioner(identity.users);

    sandboxManager = new DefaultSandboxManager(
      identity,
      persistence.sandboxes,
      (instanceName, tools, provider, apiPort) =>
        provisioner.provisionSession(instanceName, tools, provider, apiPort),
      getSandboxPort,
    );
  }
  return sandboxManager;
}

export * from './types.ts';
