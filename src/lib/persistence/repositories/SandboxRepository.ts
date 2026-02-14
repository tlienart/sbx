import type { Database } from 'bun:sqlite';
import type { Sandbox } from '../../sandbox/types.ts';

interface SandboxRow {
  id: string;
  name: string | null;
  status: string;
  restricted_network: number;
  whitelist: string | null;
  created_at: string;
}

export class SandboxRepository {
  constructor(private db: Database) {}

  private mapRowToSandbox(row: SandboxRow): Sandbox {
    return {
      id: row.id,
      name: row.name || undefined,
      status: row.status as 'active' | 'archived',
      restrictedNetwork: row.restricted_network === 1,
      whitelist: row.whitelist ? JSON.parse(row.whitelist) : undefined,
      createdAt: new Date(row.created_at),
    };
  }

  create(sandbox: Sandbox): void {
    this.db
      .prepare(
        'INSERT INTO sandboxes (id, name, status, restricted_network, whitelist, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        sandbox.id,
        sandbox.name || null,
        sandbox.status,
        sandbox.restrictedNetwork ? 1 : 0,
        sandbox.whitelist ? JSON.stringify(sandbox.whitelist) : null,
        sandbox.createdAt.toISOString(),
      );
  }

  findById(id: string): Sandbox | undefined {
    const row = this.db.prepare('SELECT * FROM sandboxes WHERE id = ?').get(id) as
      | SandboxRow
      | undefined;
    return row ? this.mapRowToSandbox(row) : undefined;
  }

  findAll(): Sandbox[] {
    const rows = this.db.prepare('SELECT * FROM sandboxes').all() as SandboxRow[];
    return rows.map((row) => this.mapRowToSandbox(row));
  }

  findActive(): Sandbox[] {
    const rows = this.db
      .prepare("SELECT * FROM sandboxes WHERE status = 'active'")
      .all() as SandboxRow[];
    return rows.map((row) => this.mapRowToSandbox(row));
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM sandboxes WHERE id = ?').run(id);
  }

  deleteAll(): void {
    this.db.prepare('DELETE FROM sandboxes').run();
  }

  updateWhitelist(id: string, whitelist: string[]): void {
    this.db
      .prepare('UPDATE sandboxes SET whitelist = ? WHERE id = ?')
      .run(JSON.stringify(whitelist), id);
  }
}
