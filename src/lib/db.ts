import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DB_DIR = join(process.cwd(), 'data');
if (!existsSync(DB_DIR)) {
  mkdirSync(DB_DIR);
}

const dbPath = join(DB_DIR, 'sbx.db');
const db = new Database(dbPath);

// Initialize schema
db.run(`
  CREATE TABLE IF NOT EXISTS sandboxes (
    id TEXT PRIMARY KEY,
    name TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
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
  db.run('ALTER TABLE agent_states ADD COLUMN opencode_session_id TEXT');
} catch (err) {
  // Column already exists or table doesn't exist yet (handled by CREATE TABLE)
}

export const sessionRepo = {
  getSandboxId: (platform: string, externalId: string): string | undefined => {
    const row = db
      .prepare('SELECT sandbox_id FROM sessions WHERE platform = ? AND external_id = ?')
      .get(platform, externalId) as { sandbox_id: string } | null;
    return row?.sandbox_id;
  },
  saveSession: (platform: string, externalId: string, sandboxId: string) => {
    db.prepare(
      'INSERT OR REPLACE INTO sessions (platform, external_id, sandbox_id) VALUES (?, ?, ?)',
    ).run(platform, externalId, sandboxId);
  },
  deleteSession: (platform: string, externalId: string) => {
    db.prepare('DELETE FROM sessions WHERE platform = ? AND external_id = ?').run(
      platform,
      externalId,
    );
  },
  findBySandboxId: (sandboxId: string) => {
    return db.prepare('SELECT * FROM sessions WHERE sandbox_id = ?').all(sandboxId) as {
      platform: string;
      external_id: string;
      sandbox_id: string;
      created_at: string;
      last_activity: string;
    }[];
  },
};

export default db;
