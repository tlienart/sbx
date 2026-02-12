import type { Database } from 'bun:sqlite';
import type { Sandbox } from '../types.ts';

export class SandboxRepository {
  constructor(private db: Database) {}

  create(sandbox: Sandbox): void {
    this.db
      .prepare('INSERT INTO sandboxes (id, name, status, created_at) VALUES (?, ?, ?, ?)')
      .run(sandbox.id, sandbox.name, sandbox.status, sandbox.created_at);
  }

  findById(id: string): Sandbox | undefined {
    return this.db.prepare('SELECT * FROM sandboxes WHERE id = ?').get(id) as Sandbox | undefined;
  }

  findAll(): Sandbox[] {
    return this.db.prepare('SELECT * FROM sandboxes').all() as Sandbox[];
  }

  findActive(): Sandbox[] {
    return this.db.prepare("SELECT * FROM sandboxes WHERE status = 'active'").all() as Sandbox[];
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM sandboxes WHERE id = ?').run(id);
  }

  deleteAll(): void {
    this.db.prepare('DELETE FROM sandboxes').run();
  }
}
