import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { createMockOS, setOS } from '../common/os/index.ts';
import { NetworkManager } from './NetworkManager.ts';

describe('NetworkManager', () => {
  let mockOs: ReturnType<typeof createMockOS>;
  let networkManager: NetworkManager;

  beforeEach(() => {
    mockOs = createMockOS();
    setOS(mockOs);
    networkManager = new NetworkManager();
  });

  test('should enable restricted network', async () => {
    const sudoSpy = mock(() =>
      Promise.resolve({ stdout: '', stderr: '', exitCode: 0, command: '' }),
    );
    mockOs.proc.sudo = sudoSpy;

    await networkManager.enableRestrictedNetwork('701', [8080, 9090]);

    // Should enable pfctl, then load anchor
    expect(sudoSpy).toHaveBeenCalledWith('pfctl', ['-e'], expect.any(Object));
    expect(sudoSpy).toHaveBeenCalledWith('pfctl', [
      '-a',
      'com.apple/sbx/uid_701',
      '-f',
      expect.stringContaining('/tmp/sbx_pf_701.conf'),
    ]);

    // Validate generated rule content
    const confPath = '/tmp/sbx_pf_701.conf';
    const confFile = Bun.file(confPath);
    const content = await confFile.text();

    expect(content).toContain('pass out quick proto tcp from any to 127.0.0.1 port 8080 user 701');
    expect(content).toContain('pass out quick proto tcp from any to 127.0.0.1 port 9090 user 701');
    expect(content).toContain('block out log quick proto tcp all user 701');
    expect(content).toContain('block out log quick proto udp all user 701');
    // Must not contain problematic syntax
    expect(content).not.toContain('{tcp');
    expect(content).not.toContain('log (');
    // Must end with a newline
    expect(content.endsWith('\n')).toBe(true);
  });

  test('should disable restricted network', async () => {
    const sudoSpy = mock(() =>
      Promise.resolve({ stdout: '', stderr: '', exitCode: 0, command: '' }),
    );
    mockOs.proc.sudo = sudoSpy;

    await networkManager.disableRestrictedNetwork('701');

    // Should flush the anchor
    expect(sudoSpy).toHaveBeenCalledWith(
      'pfctl',
      ['-a', 'com.apple/sbx/uid_701', '-F', 'all'],
      expect.any(Object),
    );
  });
});
