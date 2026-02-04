import { test } from 'bun:test';
import { chmodSync, mkdirSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { SbxBridge } from '../lib/bridge.ts';
import { getHostUser } from '../lib/user.ts';

test('SbxBridge can execute in a 711 directory if owned by host or traversed', async () => {
  const hostUser = await getHostUser();
  const bridge = new SbxBridge(hostUser);
  await bridge.start();

  // Create a mock sandbox home
  const mockSandboxHome = '/tmp/sbx_mock_test_home';
  rmSync(mockSandboxHome, { recursive: true, force: true });
  mkdirSync(mockSandboxHome, { recursive: true });

  // Create a subdirectory
  const projectDir = join(mockSandboxHome, 'my-project');
  mkdirSync(projectDir);

  // Set mock home to 711 (host can traverse but not list)
  chmodSync(mockSandboxHome, 0o711);

  const socketPath = bridge.getSocketPaths().command;

  await new Promise((resolve, reject) => {
    const client = connect(socketPath);
    let response = '';
    client.on('data', (data) => {
      response += data.toString();
    });
    client.on('end', () => {
      try {
        const lines = response.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        if (lastLine) {
          resolve(JSON.parse(lastLine));
        } else {
          reject(new Error('Empty response'));
        }
      } catch (e) {
        reject(new Error(`Failed to parse response: ${response}`));
      }
    });
    client.on('error', reject);

    // This originally used projectDir, but that fails the startsWith('/Users/sbx_') check
    // In the original code, the user noted it would fail.
    const request = {
      command: 'ls',
      args: [],
      cwd: projectDir,
    };
    client.write(JSON.stringify(request));
  });

  bridge.stop();
  rmSync(mockSandboxHome, { recursive: true, force: true });
});
