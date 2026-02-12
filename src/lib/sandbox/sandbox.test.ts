import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { createMockOS, setOS } from '../common/os/index.ts';
import { IdentityBox } from '../identity/index.ts';
import { PersistenceBox } from '../persistence/index.ts';
import { DefaultSandboxManager } from './SandboxManager.ts';

describe('SandboxManager', () => {
  let mockOs: any;
  let persistence: PersistenceBox;
  let identity: IdentityBox;
  let sandboxManager: DefaultSandboxManager;
  let provisionCalled = false;

  beforeEach(() => {
    mockOs = createMockOS();
    setOS(mockOs);
    persistence = new PersistenceBox(':memory:');
    identity = new IdentityBox();
    provisionCalled = false;

    sandboxManager = new DefaultSandboxManager(
      identity,
      persistence.sandboxes,
      async () => {
        provisionCalled = true;
      },
      () => 12345,
    );
  });

  test('should create a sandbox and record it in DB', async () => {
    mockOs.env.set('SKIP_PROVISION', '1');
    const sb = await sandboxManager.createSandbox('test-sb');

    expect(sb.id).toBeDefined();
    expect(sb.name).toBe('test-sb');

    const inDb = persistence.sandboxes.findById(sb.id);
    expect(inDb).toBeDefined();
    expect(inDb?.name).toBe('test-sb');
    expect(provisionCalled).toBe(false);
  });

  test('should call identity and provision when not skipping', async () => {
    mockOs.env.set('SKIP_PROVISION', '');

    // Mock identity setup
    const setupSpy = mock(() => Promise.resolve('sbx_host_test'));
    identity.setupSessionUser = setupSpy;

    const sb = await sandboxManager.createSandbox('test-sb');

    expect(setupSpy).toHaveBeenCalled();
    expect(provisionCalled).toBe(true);
    expect(persistence.sandboxes.findById(sb.id)).toBeDefined();
  });

  test('should list sandboxes', async () => {
    mockOs.env.set('SKIP_PROVISION', '1');
    await sandboxManager.createSandbox('sb1');
    await sandboxManager.createSandbox('sb2');

    const list = await sandboxManager.listSandboxes();
    expect(list.length).toBe(2);
  });

  test('should remove sandbox and cleanup identity', async () => {
    mockOs.env.set('SKIP_PROVISION', '1');
    const sb = await sandboxManager.createSandbox('to-remove');

    const cleanupSpy = mock(() => Promise.resolve());
    identity.cleanupSessionUser = cleanupSpy;

    await sandboxManager.removeSandbox(sb.id);

    expect(cleanupSpy).toHaveBeenCalled();
    expect(persistence.sandboxes.findById(sb.id)).toBeFalsy();
  });
});
