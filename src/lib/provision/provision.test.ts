import { beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createMockOS, setOS } from '../common/os/index.ts';
import { MacOSIdentityManager } from '../identity/MacOSIdentityManager.ts';
import { Provisioner } from './index.ts';

describe('Provisioner', () => {
  let mockOs: ReturnType<typeof createMockOS>;
  let identity: MacOSIdentityManager;
  let provisioner: Provisioner;

  beforeEach(() => {
    mockOs = createMockOS();
    setOS(mockOs);
    identity = new MacOSIdentityManager();
    provisioner = new Provisioner(identity);

    mockOs.env.set('USER', 'host-user');
    mockOs.env.set('SUDO_USER', 'host-user');

    // Populate mock shims
    const shimsDir = join(process.cwd(), 'src/resources/shims');
    mockOs.fs.mkdir(shimsDir, { recursive: true });
    mockOs.fs.write(join(shimsDir, 'git.py'), 'print("git")');
    mockOs.fs.write(join(shimsDir, 'gh.py'), 'print("gh")');
    mockOs.fs.write(join(shimsDir, 'api_bridge.py'), 'print("bridge")');
  });

  test('should ensure pkgx on host', async () => {
    let installerCalled = false;
    mockOs.proc.setHandler('bash', (args: string[]) => {
      const cmd = args.join(' ');
      if (cmd.includes('command -v pkgx')) {
        throw new Error('Not found');
      }
      if (cmd.includes('pkgx.sh')) {
        installerCalled = true;
      }
      return { stdout: '', stderr: '', exitCode: 0, command: '' };
    });

    await provisioner.ensurePkgxOnHost();
    expect(installerCalled).toBe(true);
  });

  test('should provision a session', async () => {
    // Mock user info
    mockOs.proc.setHandler('dscl', (args: string[]) => {
      if (args.includes('/Users/sbx_host-user_inst')) {
        return { stdout: 'UniqueID: 1001', stderr: '', exitCode: 0, command: '' };
      }
      return { stdout: 'sbx_host-user_inst', stderr: '', exitCode: 0, command: '' };
    });

    // Capture files written
    const filesWritten: string[] = [];
    const originalWrite = mockOs.fs.write.bind(mockOs.fs);
    mockOs.fs.write = (path: string, content: string) => {
      filesWritten.push(path);
      return originalWrite(path, content);
    };

    await provisioner.provisionSession('inst', 'jq,gh', 'google', 12345);

    // Check if opencode config was created (using the tmp file written before mv)
    expect(filesWritten.some((f) => f.includes('sbx_opencode_config'))).toBe(true);

    // Check if shims were deployed (they are written to /tmp then mv'd via sudo)
    expect(filesWritten.some((f) => f.includes('sbx_shim_sbx_host-user_inst_git'))).toBe(true);
  });
});
