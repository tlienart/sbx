import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Subprocess, spawn } from 'bun';

let serverProcess: Subprocess;
const PORT = 3003;
const MOCK_BIN_DIR = join(process.cwd(), '.tmp_mock_bin_mt');

beforeAll(async () => {
  mkdirSync(MOCK_BIN_DIR, { recursive: true });
  const mockOpencodePath = join(MOCK_BIN_DIR, 'opencode');

  // Mock that outputs JSON lines like the real opencode
  const mockScript = `#!/bin/bash
SESSION_ID="ses_mock_123"
# Check if session was passed
if [[ "$*" == *"--session "* ]]; then
  SESSION_ID=$(echo "$*" | sed -n 's/.*--session \\([^ ]*\\).*/\\1/p')
fi

echo "{\\"type\\":\\"step_start\\",\\"sessionID\\":\\"$SESSION_ID\\"}"
echo "{\\"type\\":\\"text\\",\\"sessionID\\":\\"$SESSION_ID\\",\\"part\\":{\\"text\\":\\"MOCK RESPONSE FOR: $*\\"}}"
echo "{\\"type\\":\\"step_finish\\",\\"sessionID\\":\\"$SESSION_ID\\"}"
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

  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/execute`, {
        method: 'POST',
        body: JSON.stringify({ instance: 'ping', prompt: 'hi' }),
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
  rmSync(MOCK_BIN_DIR, { recursive: true, force: true });
});

test('POST /execute supports multi-turn with sessionId', async () => {
  // 1. First turn
  const res1 = await fetch(`http://localhost:${PORT}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instance: 'mt', prompt: 'hello' }),
  });
  const data1 = (await res1.json()) as { output: string; sessionId: string };
  expect(data1.sessionId).toBeDefined();
  const firstSessionId = data1.sessionId;

  // 2. Second turn with session ID
  const res2 = await fetch(`http://localhost:${PORT}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instance: 'mt', prompt: 'how are you', sessionId: firstSessionId }),
  });
  const data2 = (await res2.json()) as { output: string; sessionId: string };

  expect(data2.sessionId).toBe(firstSessionId);
  expect(data2.output).toContain(
    'MOCK RESPONSE FOR: run --agent build --format json "how are you" --session ' + firstSessionId,
  );
});
