import { beforeEach, describe, expect, test } from 'bun:test';
import { createMockOS, setOS } from '../common/os/index.ts';
import { IdentityBox } from './index.ts';

describe('Identity Box', () => {
  let identity: IdentityBox;
  let mockOs: ReturnType<typeof createMockOS>;

  beforeEach(() => {
    mockOs = createMockOS();
    setOS(mockOs);
    identity = new IdentityBox();
  });

  test('should get host user from env', async () => {
    mockOs.env.set('USER', 'test-user');
    const user = await identity.users.getHostUser();
    expect(user).toBe('test-user');
  });

  test('should generate session username', async () => {
    mockOs.env.set('USER', 'host');
    const username = await identity.users.getSessionUsername('inst');
    expect(username).toBe('sbx_host_inst');
  });

  test('should handle user creation (mocked)', async () => {
    mockOs.env.set('USER', 'host');

    // Mock userExists to return false initially, then true after create
    let exists = false;
    mockOs.proc.setHandler('dscl', (args: string[]) => {
      if (args.includes('-read')) {
        if (exists) return { stdout: 'UniqueID: 1001', stderr: '', exitCode: 0, command: '' };
        throw new Error('Not found');
      }
      return { stdout: 'sbx_host_inst', stderr: '', exitCode: 0, command: '' };
    });

    // Simulate user appearing after some time
    setTimeout(() => {
      exists = true;
    }, 100);

    const username = await identity.users.createUser('inst');
    expect(username).toBe('sbx_host_inst');
  });

  test('should delete user', async () => {
    mockOs.env.set('USER', 'host');
    let exists = true;
    mockOs.proc.setHandler('dscl', (args: string[]) => {
      if (args.includes('-read')) {
        if (exists) return { stdout: 'UniqueID: 1001', stderr: '', exitCode: 0, command: '' };
        throw new Error('Not found');
      }
      return { stdout: '', stderr: '', exitCode: 0, command: '' };
    });

    mockOs.proc.setHandler('sysadminctl', () => {
      exists = false;
      return { stdout: '', stderr: '', exitCode: 0, command: '' };
    });

    await identity.users.deleteUser('inst');
    expect(exists).toBe(false);
  });
});
