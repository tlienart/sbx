import type { Database } from 'bun:sqlite';
import type { AgentState } from '../types.ts';

export class AgentStateRepository {
  constructor(private db: Database) {}

  save(state: AgentState): void {
    this.db
      .prepare(
        `INSERT INTO agent_states (sandbox_id, mode, status, last_activity, opencode_session_id)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(sandbox_id) DO UPDATE SET
         mode = excluded.mode,
         status = excluded.status,
         last_activity = excluded.last_activity,
         opencode_session_id = excluded.opencode_session_id`,
      )
      .run(
        state.sandbox_id,
        state.mode,
        state.status,
        state.last_activity,
        state.opencode_session_id ?? null,
      );
  }

  findBySandboxId(sandboxId: string): AgentState | undefined {
    return this.db.prepare('SELECT * FROM agent_states WHERE sandbox_id = ?').get(sandboxId) as
      | AgentState
      | undefined;
  }

  updateStatus(sandboxId: string, status: AgentState['status']): void {
    this.db
      .prepare(
        'UPDATE agent_states SET status = ?, last_activity = CURRENT_TIMESTAMP WHERE sandbox_id = ?',
      )
      .run(status, sandboxId);
  }
}
