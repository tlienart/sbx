import { expect, test } from 'bun:test';
import { connect } from 'node:net';
import { BridgeBox } from '../lib/bridge/index.ts';
import { getIdentity } from '../lib/identity/index.ts';

interface BridgeResponse {
  type: string;
  message?: string;
}

test('SbxBridge enforces sandbox-only CWD', async () => {
  const hostUser = await getIdentity().users.getHostUser();
  const bridge = new BridgeBox(hostUser);
  await bridge.start();

  const socketPath = bridge.getSocketPaths().command;

  const result = (await new Promise((resolve, reject) => {
    const client = connect(socketPath);
    let response = '';
    client.on('data', (data) => {
      response += data.toString();
    });
    client.on('end', () => {
      try {
        resolve(JSON.parse(response));
      } catch (e) {
        reject(new Error(`Failed to parse response: ${response}`));
      }
    });
    client.on('error', reject);
    const request = {
      command: 'ls',
      args: [],
      cwd: '/etc', // Outside sandbox
    };
    client.write(JSON.stringify(request));
  })) as BridgeResponse;

  expect(result.type).toBe('error');
  expect(result.message).toContain('Invalid CWD');

  bridge.stop();
});

test('SbxBridge prevents path traversal', async () => {
  const hostUser = await getIdentity().users.getHostUser();
  const bridge = new BridgeBox(hostUser);
  await bridge.start();

  const socketPath = bridge.getSocketPaths().command;

  const result = (await new Promise((resolve, reject) => {
    const client = connect(socketPath);
    let response = '';
    client.on('data', (data) => {
      response += data.toString();
    });
    client.on('end', () => {
      try {
        resolve(JSON.parse(response));
      } catch (e) {
        reject(new Error(`Failed to parse response: ${response}`));
      }
    });
    client.on('error', reject);
    const request = {
      command: 'ls',
      args: [],
      cwd: '/Users/sbx_demo/../../../etc', // Traversal
    };
    client.write(JSON.stringify(request));
  })) as BridgeResponse;

  expect(result.type).toBe('error');
  expect(result.message).toContain('Invalid CWD');
  // It should be resolved to /etc and thus fail the startsWith('/Users/sbx_') check
  expect(result.message).toContain('/etc');

  bridge.stop();
});

test('SbxBridge fails if CWD does not exist', async () => {
  const hostUser = await getIdentity().users.getHostUser();
  const bridge = new BridgeBox(hostUser);
  await bridge.start();

  const socketPath = bridge.getSocketPaths().command;

  const result = (await new Promise((resolve, reject) => {
    const client = connect(socketPath);
    let response = '';
    client.on('data', (data) => {
      response += data.toString();
    });
    client.on('end', () => {
      try {
        resolve(JSON.parse(response));
      } catch (e) {
        reject(new Error(`Failed to parse response: ${response}`));
      }
    });
    client.on('error', reject);
    const request = {
      command: 'ls',
      args: [],
      cwd: '/Users/sbx_nonexistent_user', // Inside /Users/sbx_ but doesn't exist
    };
    client.write(JSON.stringify(request));
  })) as BridgeResponse;

  expect(result.type).toBe('error');
  expect(result.message).toContain('CWD does not exist');

  bridge.stop();
});
