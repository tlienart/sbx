import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { createMockOS, setOS } from '../common/os/index.ts';
import { IdentityBox } from '../identity/index.ts';
import { PersistenceBox } from '../persistence/index.ts';
import { DefaultSandboxManager } from './SandboxManager.ts';

// Mock TrafficProxy to avoid port conflicts and actual server starts in tests
mock.module('../bridge/TrafficProxy.ts', () => {
  return {
    TrafficProxy: class {
      start() {
        return Promise.resolve();
      }
      stop() {}
      getPort() {
        return 15678;
      }
    },
  };
});

describe('SandboxManager', () => {
  let mockOs: ReturnType<typeof createMockOS>;
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
      () => 15678,
    );
  });

  test('should create a sandbox and record it in DB', async () => {
    mockOs.env.set('SKIP_PROVISION', '1');
    const sb = await sandboxManager.createSandbox({ name: 'test-sb' });

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

    const sb = await sandboxManager.createSandbox({ name: 'test-sb' });

    expect(setupSpy).toHaveBeenCalled();
    expect(provisionCalled).toBe(true);
    expect(persistence.sandboxes.findById(sb.id)).toBeDefined();
  });

  test('should list sandboxes', async () => {
    mockOs.env.set('SKIP_PROVISION', '1');
    await sandboxManager.createSandbox({ name: 'sb1' });
    await sandboxManager.createSandbox({ name: 'sb2' });

    const list = await sandboxManager.listSandboxes();
    expect(list.length).toBe(2);
  });

  test('should find sandbox by name or prefix', async () => {
    mockOs.env.set('SKIP_PROVISION', '1');
    const sb = await sandboxManager.createSandbox({ name: 'my-special-name' });

    const foundByName = await sandboxManager.findSandbox('my-special-name');
    expect(foundByName?.id).toBe(sb.id);

    const foundById = await sandboxManager.findSandbox(sb.id);
    expect(foundById?.id).toBe(sb.id);

    const foundByPrefix = await sandboxManager.findSandbox(sb.id.slice(0, 8));
    expect(foundByPrefix?.id).toBe(sb.id);

    const notFound = await sandboxManager.findSandbox('non-existent');
    expect(notFound).toBeUndefined();
  });

  test('should enable restricted network if requested', async () => {
    mockOs.env.set('SKIP_PROVISION', '');

    const setupSpy = mock(() => Promise.resolve('sbx_host_test'));
    identity.setupSessionUser = setupSpy;

    const getUidSpy = mock(() => Promise.resolve('701'));
    identity.users.getNumericUid = getUidSpy;

    const enableNetSpy = mock(() => Promise.resolve());
    identity.network.enableRestrictedNetwork = enableNetSpy;

    await sandboxManager.createSandbox({ name: 'test-sb', restrictedNetwork: true });

    expect(enableNetSpy).toHaveBeenCalledWith('701', [12345, 15678]);
  });

  test('should disable restricted network on removal', async () => {
    mockOs.env.set('SKIP_PROVISION', '');

    // Mock identity methods to avoid real system calls and waits
    identity.setupSessionUser = mock(() => Promise.resolve('sbx_host_test'));
    identity.cleanupSessionUser = mock(() => Promise.resolve());

    const sb = await sandboxManager.createSandbox({ name: 'to-remove', restrictedNetwork: true });

    const getUidSpy = mock(() => Promise.resolve('701'));
    identity.users.getNumericUid = getUidSpy;

    const disableNetSpy = mock(() => Promise.resolve());
    identity.network.disableRestrictedNetwork = disableNetSpy;

    await sandboxManager.removeSandbox(sb.id);

    expect(disableNetSpy).toHaveBeenCalledWith('701');
  });
});
