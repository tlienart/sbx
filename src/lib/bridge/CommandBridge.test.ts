import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { createMockOS, setOS } from '../common/os/index.ts';
import { CommandBridge } from './CommandBridge.ts';
import { SecretManager } from './SecretManager.ts';

describe('CommandBridge', () => {
  let mockOs: any;
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
    const validate = (bridge as any).validateArgs.bind(bridge);

    expect(validate('git', ['status'])).toBeNull();
    expect(validate('git', ['config', '--global', 'user.email'])).not.toBeNull();
  });

  test('should handle valid request', async () => {
    const bridge = new CommandBridge('host-user', secretManager);
    const socket = {
      write: mock(() => {}),
      end: mock(() => {}),
    } as any;

    const request = {
      command: 'git',
      args: ['status'],
      cwd: '/Users/sbx_test_inst',
    };

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
    }));

    await (bridge as any).handleRequest(socket, request);

    expect(socket.write).toHaveBeenCalled();
    const calls = socket.write.mock.calls;
    // Expected calls: stdout data, exit code
    expect(calls.some((c: any) => c[0].includes('stdout'))).toBe(true);
    expect(calls.some((c: any) => c[0].includes('"code":0'))).toBe(true);
    expect(socket.end).toHaveBeenCalled();
  });

  test('should reject invalid CWD', async () => {
    const bridge = new CommandBridge('host-user', secretManager);
    const socket = {
      write: mock(() => {}),
      end: mock(() => {}),
    } as any;

    const request = {
      command: 'git',
      args: ['status'],
      cwd: '/etc',
    };

    await (bridge as any).handleRequest(socket, request);

    expect(socket.write).toHaveBeenCalled();
    expect(socket.write.mock.calls[0][0]).toContain('Invalid CWD');
    expect(socket.end).toHaveBeenCalled();
  });

  test('should reject blocked commands', async () => {
    const bridge = new CommandBridge('host-user', secretManager);
    const socket = {
      write: mock(() => {}),
      end: mock(() => {}),
    } as any;

    const request = {
      command: 'rm',
      args: ['-rf', '/'],
      cwd: '/Users/sbx_test_inst',
    };

    await (bridge as any).handleRequest(socket, request);

    expect(socket.write).toHaveBeenCalled();
    expect(socket.write.mock.calls[0][0]).toContain('not allowed');
    expect(socket.end).toHaveBeenCalled();
  });
});
