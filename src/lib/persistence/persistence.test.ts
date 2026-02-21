import { beforeEach, describe, expect, test } from 'bun:test';
import { createMockOS, setOS } from '../common/os/index.ts';
import type { Sandbox } from '../sandbox/types.ts';
import { PersistenceBox } from './index.ts';

describe('Persistence Box', () => {
  let persistence: PersistenceBox;
  let mockOs: ReturnType<typeof createMockOS>;

  beforeEach(() => {
    mockOs = createMockOS();
    setOS(mockOs);
    // Use in-memory database for tests
    persistence = new PersistenceBox(':memory:');
  });

  test('should create and find sandboxes', () => {
    const sb: Sandbox = {
      id: 'test-id',
      name: 'test-name',
      status: 'active',
      createdAt: new Date(),
      restrictedNetwork: false,
    };

    persistence.sandboxes.create(sb);
    const found = persistence.sandboxes.findById('test-id');
    expect(found?.id).toBe(sb.id);
    expect(found?.name).toBe(sb.name);
    expect(found?.status).toBe(sb.status);
    expect(found?.restrictedNetwork).toBe(false);
  });

  test('should find active sandboxes', () => {
    persistence.sandboxes.create({
      id: 'active-1',
      name: 'active',
      status: 'active',
      createdAt: new Date(),
    });
    persistence.sandboxes.create({
      id: 'archived-1',
      name: 'archived',
      status: 'archived',
      createdAt: new Date(),
    });

    const active = persistence.sandboxes.findActive();
    expect(active.length).toBe(1);
    expect(active[0]?.id).toBe('active-1');
  });

  test('should manage sessions', () => {
    persistence.sandboxes.create({
      id: 'sb-id',
      name: 'test',
      status: 'active',
      createdAt: new Date(),
    });
    persistence.sessions.saveSession('platform', 'ext-id', 'sb-id');
    const sbId = persistence.sessions.getSandboxId('platform', 'ext-id');
    expect(sbId).toBe('sb-id');

    persistence.sessions.deleteSession('platform', 'ext-id');
    const deleted = persistence.sessions.getSandboxId('platform', 'ext-id');
    expect(deleted).toBeUndefined();
  });

  test('should manage agent states', () => {
    persistence.sandboxes.create({
      id: 'sb-1',
      name: 'test',
      status: 'active',
      createdAt: new Date(),
    });
    const state = {
      sandbox_id: 'sb-1',
      mode: 'plan',
      status: 'idle' as const,
      opencode_session_id: null,
      last_activity: new Date().toISOString(),
    };

    persistence.agents.save(state);
    const found = persistence.agents.findBySandboxId('sb-1');
    expect(found).toEqual(state);

    persistence.agents.updateStatus('sb-1', 'thinking');
    const updated = persistence.agents.findBySandboxId('sb-1');
    expect(updated?.status).toBe('thinking');
  });
});
