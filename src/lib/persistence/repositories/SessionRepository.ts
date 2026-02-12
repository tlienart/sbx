import type { Database } from 'bun:sqlite';
import type { Session } from '../types.ts';

export class SessionRepository {
  constructor(private db: Database) {}

  getSandboxId(platform: string, externalId: string): string | undefined {
    const row = this.db
      .prepare('SELECT sandbox_id FROM sessions WHERE platform = ? AND external_id = ?')
      .get(platform, externalId) as { sandbox_id: string } | null;
    return row?.sandbox_id;
  }

  saveSession(platform: string, externalId: string, sandboxId: string): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO sessions (platform, external_id, sandbox_id) VALUES (?, ?, ?)',
      )
      .run(platform, externalId, sandboxId);
  }

  deleteSession(platform: string, externalId: string): void {
    this.db
      .prepare('DELETE FROM sessions WHERE platform = ? AND external_id = ?')
      .run(platform, externalId);
  }

  findBySandboxId(sandboxId: string): Session[] {
    return this.db
      .prepare('SELECT * FROM sessions WHERE sandbox_id = ?')
      .all(sandboxId) as Session[];
  }
}
