import { getOS } from '../common/os/index.ts';
import type { IIdentityManager } from '../identity/IdentityManager.ts';
import { logger } from '../logger.ts';
import type { AgentStateRepository } from '../persistence/repositories/AgentStateRepository.ts';
import type { SandboxManager } from '../sandbox/types.ts';

export type AgentMode = 'plan' | 'build' | 'research';

export interface AgentState {
  mode: AgentMode;
  status: 'idle' | 'thinking' | 'writing';
  opencodeSessionId?: string;
  lastActivity: Date;
}

export class AgentManager {
  private os = getOS();

  constructor(
    private agentRepo: AgentStateRepository,
    private identity: IIdentityManager,
    private sandboxManager: SandboxManager,
  ) {}

  async startAgent(sandboxId: string, mode: AgentMode = 'plan'): Promise<AgentState> {
    await this.sandboxManager.getSandbox(sandboxId);

    const state: AgentState = {
      mode,
      status: 'idle',
      lastActivity: new Date(),
    };

    this.agentRepo.save({
      sandbox_id: sandboxId,
      mode: state.mode,
      status: state.status,
      last_activity: state.lastActivity.toISOString(),
    });

    logger.info(`Starting agent in sandbox ${sandboxId} with mode ${mode}`);

    return state;
  }

  getAgentState(sandboxId: string): AgentState | undefined {
    const row = this.agentRepo.findBySandboxId(sandboxId);
    if (!row) return undefined;

    return {
      mode: row.mode as AgentMode,
      status: row.status as 'idle' | 'thinking' | 'writing',
      opencodeSessionId: row.opencode_session_id || undefined,
      lastActivity: new Date(row.last_activity),
    };
  }

  updateAgentState(sandboxId: string, updates: Partial<AgentState>) {
    const current = this.getAgentState(sandboxId);
    if (!current) return;

    const newState = { ...current, ...updates, lastActivity: new Date() };

    this.agentRepo.save({
      sandbox_id: sandboxId,
      mode: newState.mode,
      status: newState.status,
      opencode_session_id: newState.opencodeSessionId || undefined,
      last_activity: newState.lastActivity.toISOString(),
    });
  }

  async interruptAgent(sandboxId: string): Promise<void> {
    const instanceName = sandboxId.split('-')[0] as string;
    const username = await this.identity.getSessionUsername(instanceName);

    logger.info(`Interrupting agent in sandbox ${sandboxId}...`);

    if (this.os.env.get('SKIP_PROVISION')) {
      logger.info(`[Mock] Skipping interrupt for ${username}`);
      this.updateAgentState(sandboxId, { status: 'idle' });
      return;
    }

    try {
      // Use the OS abstraction to run as user
      await this.os.proc.runAsUser(username, 'pkill -u $(whoami) -f opencode || true');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to interrupt agent for ${sandboxId}: ${msg}`);
    }

    this.updateAgentState(sandboxId, { status: 'idle' });
  }

  async resetAgentSession(sandboxId: string): Promise<void> {
    await this.interruptAgent(sandboxId);

    logger.info(`Resetting agent session in sandbox ${sandboxId}...`);
    const instanceName = sandboxId.split('-')[0] as string;
    const username = await this.identity.getSessionUsername(instanceName);

    // Clear session ID from DB
    this.updateAgentState(sandboxId, { opencodeSessionId: undefined });

    if (this.os.env.get('SKIP_PROVISION')) {
      logger.info(`[Mock] Skipping session reset for ${username}`);
      return;
    }

    try {
      await this.os.proc.runAsUser(username, 'rm -rf ~/.config/opencode/history.json || true');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to reset session for ${sandboxId}: ${msg}`);
    }
  }
}
