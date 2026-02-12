import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Mock } from 'bun:test';
import { createMockOS, setOS } from '../common/os/index.ts';
import { CommandBridge } from './CommandBridge.ts';
import { SecretManager } from './SecretManager.ts';

interface MockSocket {
  write: Mock<(data: string) => void>;
  end: Mock<() => void>;
}

describe('CommandBridge', () => {
  let mockOs: ReturnType<typeof createMockOS>;
  let secretManager: SecretManager;

  beforeEach(() => {
    mockOs = createMockOS();
    setOS(mockOs);
    secretManager = new SecretManager();
  });

  test('should resolve binary paths correctly', () => {
    mockOs.fs.write('/usr/bin/git', 'binary');
    const bridge = new CommandBridge('host-user', secretManager);
    expect(bridge).toBeDefined();
  });

  test('should validate git arguments correctly', () => {
    const bridge = new CommandBridge('host-user', secretManager);
    // biome-ignore lint/suspicious/noExplicitAny: access private for testing
    const validate = (bridge as any).validateArgs.bind(bridge);

    expect(validate('git', ['status'])).toBeNull();
    expect(validate('git', ['config', '--global', 'user.email'])).not.toBeNull();
  });

  test('should handle valid request', async () => {
    const bridge = new CommandBridge('host-user', secretManager);
    const socket: MockSocket = {
      write: mock(() => {}),
      end: mock(() => {}),
    };

    const request = {
      command: 'git',
      args: ['status'],
      cwd: '/Users/sbx_test_inst',
    };

    // Ensure CWD exists in mock FS
    mockOs.fs.mkdir('/Users/sbx_test_inst', { recursive: true });

    // Mock spawn
    mockOs.proc.spawn = mock(() => ({
      stdout: new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from('On branch main'));
          controller.close();
        },
      }),
      stderr: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      exited: Promise.resolve(0),
      kill: () => {},
    }));

    // biome-ignore lint/suspicious/noExplicitAny: access private for testing
    await (bridge as any).handleRequest(socket, request);

    expect(socket.write).toHaveBeenCalled();
    const calls = socket.write.mock.calls;
    // Expected calls: stdout data, exit code
    expect(calls.some((c) => (c[0] as string).includes('stdout'))).toBe(true);
    expect(calls.some((c) => (c[0] as string).includes('"code":0'))).toBe(true);
    expect(socket.end).toHaveBeenCalled();
  });

  test('should reject invalid CWD', async () => {
    const bridge = new CommandBridge('host-user', secretManager);
    const socket: MockSocket = {
      write: mock(() => {}),
      end: mock(() => {}),
    };

    const request = {
      command: 'git',
      args: ['status'],
      cwd: '/etc',
    };

    // biome-ignore lint/suspicious/noExplicitAny: access private for testing
    await (bridge as any).handleRequest(socket, request);

    expect(socket.write).toHaveBeenCalled();
    const calls = socket.write.mock.calls;
    if (calls.length > 0 && calls[0]) {
      expect(calls[0][0] as string).toContain('Invalid CWD');
    } else {
      throw new Error('Expected socket.write to be called');
    }
    expect(socket.end).toHaveBeenCalled();
  });

  test('should reject blocked commands', async () => {
    const bridge = new CommandBridge('host-user', secretManager);
    const socket: MockSocket = {
      write: mock(() => {}),
      end: mock(() => {}),
    };

    const request = {
      command: 'rm',
      args: ['-rf', '/'],
      cwd: '/Users/sbx_test_inst',
    };

    // Ensure CWD exists in mock FS
    mockOs.fs.mkdir('/Users/sbx_test_inst', { recursive: true });

    // biome-ignore lint/suspicious/noExplicitAny: access private for testing
    await (bridge as any).handleRequest(socket, request);

    expect(socket.write).toHaveBeenCalled();
    const calls = socket.write.mock.calls;
    if (calls.length > 0 && calls[0]) {
      expect(calls[0][0] as string).toContain('not allowed');
    } else {
      throw new Error('Expected socket.write to be called');
    }
    expect(socket.end).toHaveBeenCalled();
  });
});
