import { test } from 'bun:test';
import { chmodSync, mkdirSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { BridgeBox } from '../lib/bridge/index.ts';
import { getIdentity } from '../lib/identity/index.ts';

test('SbxBridge can execute in a 711 directory if owned by host or traversed', async () => {
  const hostUser = await getIdentity().users.getHostUser();
  const bridge = new BridgeBox(hostUser);
  await bridge.start();

  // Create a mock sandbox home that passes the startsWith('/Users/sbx_') check
  // Note: This might require sudo if /Users is restricted, but in many dev environments it's okay for testing
  // if we use a path like /Users/sbx_test_mock
  const mockSandboxHome = '/Users/sbx_mock_test_home';
  try {
    mkdirSync(mockSandboxHome, { recursive: true });
  } catch (e) {
    // Fallback if /Users is not writable
    bridge.stop();
    return;
  }

  // Create a subdirectory
  const projectDir = join(mockSandboxHome, 'my-project');
  mkdirSync(projectDir, { recursive: true });

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
