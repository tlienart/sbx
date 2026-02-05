import { v4 as uuidv4 } from 'uuid';
import db from './db.ts';
import { provisionSession } from './provision.ts';
import { deleteSessionUser } from './user.ts';

export interface Sandbox {
  id: string;
  name?: string;
  createdAt: Date;
  status: 'active' | 'archived';
}

export async function createSandbox(name?: string): Promise<Sandbox> {
  const id = uuidv4();
  // We use the first part of the UUID as the instance name
  const instanceName = id.split('-')[0] as string;

  const sandbox: Sandbox = {
    id,
    name,
    createdAt: new Date(),
    status: 'active',
  };

  if (!process.env.SKIP_PROVISION) {
    await provisionSession(instanceName);
  } else {
    console.log(`[Mock] Skipping provisioning for ${instanceName}`);
  }

  db.prepare('INSERT INTO sandboxes (id, name, status, created_at) VALUES (?, ?, ?, ?)').run(
    sandbox.id,
    sandbox.name || null,
    sandbox.status,
    sandbox.createdAt.toISOString(),
  );

  return sandbox;
}

export async function getSandbox(id: string): Promise<Sandbox> {
  const row = db.prepare('SELECT * FROM sandboxes WHERE id = ?').get(id) as
    | { id: string; name: string | null; status: string; created_at: string }
    | undefined;
  if (!row) throw new Error(`Sandbox ${id} not found`);

  return {
    id: row.id,
    name: row.name || undefined,
    status: row.status as 'active' | 'archived',
    createdAt: new Date(row.created_at),
  };
}

export async function listSandboxes(): Promise<Sandbox[]> {
  const rows = db.prepare('SELECT * FROM sandboxes').all() as {
    id: string;
    name: string | null;
    status: string;
    created_at: string;
  }[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name || undefined,
    status: row.status as 'active' | 'archived',
    createdAt: new Date(row.created_at),
  }));
}

export async function removeSandbox(id: string): Promise<void> {
  const instanceName = id.split('-')[0] as string;
  try {
    await deleteSessionUser(instanceName);
  } catch (err) {
    console.error(`Failed to delete session user for ${id}:`, err);
  }

  // Foreign key ON DELETE CASCADE will handle sessions and agent_states
  db.prepare('DELETE FROM sandboxes WHERE id = ?').run(id);
}

export async function wipeSandbox(id: string): Promise<void> {
  return removeSandbox(id);
}
