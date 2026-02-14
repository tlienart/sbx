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

    await networkManager.enableRestrictedNetwork('701');

    // Should enable pfctl, then load anchor
    expect(sudoSpy).toHaveBeenCalledWith('pfctl', ['-e'], expect.any(Object));
    expect(sudoSpy).toHaveBeenCalledWith('pfctl', [
      '-a',
      'com.apple/sbx/uid_701',
      '-f',
      expect.stringContaining('/tmp/sbx_pf_701.conf'),
    ]);
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
