import { afterAll, beforeAll, expect, test } from 'bun:test';
import { type Subprocess, spawn } from 'bun';
import { getIdentity } from '../lib/identity/index.ts';

let serverProcess: Subprocess;
const PORT = 3001;

beforeAll(async () => {
  // Start the server in the background
  serverProcess = spawn(['bun', 'src/index.ts', 'serve', '-p', PORT.toString()], {
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, SBX_MOCK: '1' },
  });

  // Wait for server to be ready
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/raw-exec`, {
        method: 'POST',
        body: JSON.stringify({ instance: 'ping', command: 'echo pong' }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.status === 200) break;
    } catch (e: unknown) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
});

afterAll(() => {
  serverProcess.kill();
});

test('POST /raw-exec executes command in sandbox', async () => {
  const instance = 'testapi';
  const command = 'whoami';

  const response = await fetch(`http://localhost:${PORT}/raw-exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instance, command }),
  });

  expect(response.status).toBe(200);
  const data = (await response.json()) as { stdout: string; exitCode: number };

  // In mock mode (which we are using in beforeAll), it returns the host user
  const expectedUser = await getIdentity().users.getHostUser();
  expect(data.stdout.trim()).toBe(expectedUser);
  expect(data.exitCode).toBe(0);
});

test('POST /raw-exec auto-provisions and maintains state', async () => {
  const instance = 'testapi-state';
  const file = '/tmp/api_test_state.txt';
  const content = 'hello-from-api';

  // 1. Write file
  const writeRes = await fetch(`http://localhost:${PORT}/raw-exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instance, command: `echo ${content} > ${file}` }),
  });
  expect(writeRes.status).toBe(200);

  // 2. Read file
  const readRes = await fetch(`http://localhost:${PORT}/raw-exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instance, command: `cat ${file}` }),
  });

  expect(readRes.status).toBe(200);
  const data = (await readRes.json()) as { stdout: string };
  expect(data.stdout.trim()).toBe(content);
});
