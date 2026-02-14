import { Database } from 'bun:sqlite';
import path from 'node:path';
import { getOS } from '../common/os/index.ts';
import { AgentStateRepository } from './repositories/AgentStateRepository.ts';
import { SandboxRepository } from './repositories/SandboxRepository.ts';
import { SessionRepository } from './repositories/SessionRepository.ts';

export class PersistenceBox {
  public readonly db: Database;
  public sandboxes: SandboxRepository;
  public sessions: SessionRepository;
  public agents: AgentStateRepository;

  constructor(dbPath?: string) {
    const os = getOS();
    const finalDbPath = dbPath || this.getDefaultDbPath();

    // Ensure directory exists
    const dbDir = path.dirname(finalDbPath);
    if (!os.fs.exists(dbDir)) {
      os.fs.mkdir(dbDir, { recursive: true });
    }

    this.db = new Database(finalDbPath);
    this.db.run('PRAGMA foreign_keys = ON;');

    // Ensure DB file is readable/writable by everyone so sudo and non-sudo can share it
    // We do this via the OS abstraction
    os.proc.run('chmod', ['666', finalDbPath], { sudo: true, reject: false }).catch(() => {});
    os.proc.run('chmod', ['777', dbDir], { sudo: true, reject: false }).catch(() => {});

    this.initializeSchema();

    this.sandboxes = new SandboxRepository(this.db);
    this.sessions = new SessionRepository(this.db);
    this.agents = new AgentStateRepository(this.db);
  }

  private getDefaultDbPath(): string {
    return path.join(process.cwd(), 'data', 'sbx.db');
  }

  private initializeSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sandboxes (
        id TEXT PRIMARY KEY,
        name TEXT,
        status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
        restricted_network INTEGER DEFAULT 0,
        whitelist TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sessions (
        platform TEXT NOT NULL,
        external_id TEXT NOT NULL,
        sandbox_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (platform, external_id),
        FOREIGN KEY (sandbox_id) REFERENCES sandboxes(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS agent_states (
        sandbox_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('idle', 'thinking', 'writing')),
        opencode_session_id TEXT,
        last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sandbox_id) REFERENCES sandboxes(id) ON DELETE CASCADE
      );
    `);

    // Migration: add opencode_session_id if it doesn't exist
    try {
      this.db.run('ALTER TABLE agent_states ADD COLUMN opencode_session_id TEXT');
    } catch (err) {
      // Column already exists
    }

    // Migration: add restricted_network and whitelist to sandboxes
    try {
      this.db.run('ALTER TABLE sandboxes ADD COLUMN restricted_network INTEGER DEFAULT 0');
    } catch (err) {
      // Column already exists
    }
    try {
      this.db.run('ALTER TABLE sandboxes ADD COLUMN whitelist TEXT');
    } catch (err) {
      // Column already exists
    }
  }

  close(): void {
    this.db.close();
  }
}

// Singleton instance for the app
let instance: PersistenceBox | null = null;

export function getPersistence(): PersistenceBox {
  if (!instance) {
    instance = new PersistenceBox();
  }
  return instance;
}

export * from './types.ts';
