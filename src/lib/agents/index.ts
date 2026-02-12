import { getIdentity } from '../identity/index.ts';
import { getPersistence } from '../persistence/index.ts';
import { getSandboxManager } from '../sandbox/index.ts';
import { AgentManager } from './AgentManager.ts';

let agentManager: AgentManager | undefined;

export function getAgentManager(): AgentManager {
  if (!agentManager) {
    const identity = getIdentity();
    const persistence = getPersistence();
    const sandboxManager = getSandboxManager();

    agentManager = new AgentManager(persistence.agents, identity.users, sandboxManager);
  }
  return agentManager;
}

export * from './AgentManager.ts';
