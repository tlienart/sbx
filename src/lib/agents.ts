import db from './db.ts';
import { runAsUser } from './exec.ts';
import { getSandbox } from './sandbox.ts';
import { getSessionUsername } from './user.ts';

export type AgentMode = 'plan' | 'build' | 'research';

export interface AgentState {
  mode: AgentMode;
  status: 'idle' | 'thinking' | 'writing';
  lastActivity: Date;
}

export async function startAgent(sandboxId: string, mode: AgentMode = 'plan') {
  await getSandbox(sandboxId);

  const state: AgentState = {
    mode,
    status: 'idle',
    lastActivity: new Date(),
  };

  db.prepare(`
    INSERT INTO agent_states (sandbox_id, mode, status, last_activity)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(sandbox_id) DO UPDATE SET
      mode = excluded.mode,
      status = excluded.status,
      last_activity = excluded.last_activity
  `).run(sandboxId, state.mode, state.status, state.lastActivity.toISOString());

  console.log(`Starting agent in sandbox ${sandboxId} with mode ${mode}`);

  return state;
}

export function getAgentState(sandboxId: string): AgentState | undefined {
  const row = db.prepare('SELECT * FROM agent_states WHERE sandbox_id = ?').get(sandboxId) as
    | { mode: string; status: string; last_activity: string }
    | undefined;
  if (!row) return undefined;

  return {
    mode: row.mode as AgentMode,
    status: row.status as 'idle' | 'thinking' | 'writing',
    lastActivity: new Date(row.last_activity),
  };
}

export function updateAgentState(sandboxId: string, updates: Partial<AgentState>) {
  const current = getAgentState(sandboxId);
  if (!current) return;

  const newState = { ...current, ...updates, lastActivity: new Date() };

  db.prepare(`
    UPDATE agent_states 
    SET mode = ?, status = ?, last_activity = ?
    WHERE sandbox_id = ?
  `).run(newState.mode, newState.status, newState.lastActivity.toISOString(), sandboxId);
}

export async function interruptAgent(sandboxId: string): Promise<void> {
  const instanceName = sandboxId.split('-')[0] as string;
  const username = await getSessionUsername(instanceName);

  console.log(`Interrupting agent in sandbox ${sandboxId}...`);

  if (process.env.SKIP_PROVISION) {
    console.log(`[Mock] Skipping interrupt for ${username}`);
    updateAgentState(sandboxId, { status: 'idle' });
    return;
  }

  // Kill all processes owned by the sandbox user except the shell/system ones
  // In a real scenario, we'd find the specific opencode process
  try {
    await runAsUser(username, 'pkill -u $(whoami) -f opencode || true');
  } catch (err) {
    console.error(`Failed to interrupt agent for ${sandboxId}:`, err);
  }

  updateAgentState(sandboxId, { status: 'idle' });
}

export async function resetAgentSession(sandboxId: string): Promise<void> {
  await interruptAgent(sandboxId);

  console.log(`Resetting agent session in sandbox ${sandboxId}...`);
  const instanceName = sandboxId.split('-')[0] as string;
  const username = await getSessionUsername(instanceName);

  if (process.env.SKIP_PROVISION) {
    console.log(`[Mock] Skipping session reset for ${username}`);
    return;
  }

  // In a real scenario, this would delete some internal agent history files
  // For now, we just ensure it starts fresh next time
  try {
    // Example: remove agent history file
    await runAsUser(username, 'rm -rf ~/.config/opencode/history.json || true');
  } catch (err) {
    console.error(`Failed to reset session for ${sandboxId}:`, err);
  }
}
