import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Subprocess, spawn } from 'bun';
import { getIdentity } from '../lib/identity/index.ts';

let serverProcess: Subprocess;
const PORT = 3005;
const MOCK_BIN_DIR = join(process.cwd(), '.tmp_api_test_bin');

beforeAll(async () => {
  mkdirSync(MOCK_BIN_DIR, { recursive: true });
  const mockOpencodePath = join(MOCK_BIN_DIR, 'opencode');

  const mockScript = `#!/bin/bash
SESSION_ID="ses_mock_123"
if [[ "$*" == *"--session "* ]]; then
  SESSION_ID=$(echo "$*" | sed -n 's/.*--session \\([^ ]*\\).*/\\1/p')
fi

if [[ "$*" == *"--format json"* ]]; then
  echo "{\\"type\\":\\"step_start\\",\\"sessionID\\":\\"$SESSION_ID\\"}"
  echo "{\\"type\\":\\"text\\",\\"sessionID\\":\\"$SESSION_ID\\",\\"part\\":{\\"text\\":\\"MOCK RESPONSE FOR: $*\\"}}"
  echo "{\\"type\\":\\"step_finish\\",\\"sessionID\\":\\"$SESSION_ID\\"}"
else
  echo "MOCK OPENCODE CALLED WITH: $*"
fi
`;
  writeFileSync(mockOpencodePath, mockScript);
  chmodSync(mockOpencodePath, 0o755);

  serverProcess = spawn(['bun', 'src/index.ts', 'serve', '-p', PORT.toString()], {
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      SBX_MOCK: '1',
      PATH: `${MOCK_BIN_DIR}:${process.env.PATH}`,
    },
  });

  // Wait for server
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/raw-exec`, {
        method: 'POST',
        body: JSON.stringify({ instance: 'ping', command: 'echo pong' }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.status === 200) break;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
});

afterAll(() => {
  serverProcess.kill();
  if (existsSync(MOCK_BIN_DIR)) {
    rmSync(MOCK_BIN_DIR, { recursive: true, force: true });
  }
});

describe('SBX API Server', () => {
  test('POST /raw-exec executes command', async () => {
    const res = await fetch(`http://localhost:${PORT}/raw-exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance: 'test', command: 'whoami' }),
    });
    const data = (await res.json()) as { stdout: string };
    const user = await getIdentity().users.getHostUser();
    expect(data.stdout.trim()).toBe(user);
  });

  test('POST /execute runs opencode with JSON parsing', async () => {
    const res = await fetch(`http://localhost:${PORT}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance: 'test', prompt: 'hello', mode: 'explore' }),
    });
    const data = (await res.json()) as { output: string; sessionId: string };
    expect(data.sessionId).toBe('ses_mock_123');
    expect(data.output).toContain('MOCK RESPONSE FOR: run --agent explore --format json hello');
  });

  test('POST /execute maintains session ID', async () => {
    const res = await fetch(`http://localhost:${PORT}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance: 'test', prompt: 'continue', sessionId: 'ses_custom_456' }),
    });
    const data = (await res.json()) as { sessionId: string; output: string };
    expect(data.sessionId).toBe('ses_custom_456');
    expect(data.output).toContain('--session ses_custom_456');
  });
});
