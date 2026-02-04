import { expect, test } from 'bun:test';
import { connect } from 'node:net';
import { SbxBridge } from '../lib/bridge.ts';
import { getHostUser } from '../lib/user.ts';

test('SbxBridge enforces sandbox-only CWD', async () => {
  const hostUser = await getHostUser();
  const bridge = new SbxBridge(hostUser);
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
  })) as any;

  expect(result.type).toBe('error');
  expect(result.message).toContain('Invalid or missing CWD');

  bridge.stop();
});

test('SbxBridge fails if CWD does not exist', async () => {
  const hostUser = await getHostUser();
  const bridge = new SbxBridge(hostUser);
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
  })) as any;

  expect(result.type).toBe('error');
  expect(result.message).toContain('CWD does not exist');

  bridge.stop();
});
