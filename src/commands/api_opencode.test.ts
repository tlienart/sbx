import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Subprocess, spawn } from 'bun';

let serverProcess: Subprocess;
const PORT = 3002;
const MOCK_BIN_DIR = join(process.cwd(), '.tmp_mock_bin');

beforeAll(async () => {
  // Create a mock opencode binary
  mkdirSync(MOCK_BIN_DIR, { recursive: true });
  const mockOpencodePath = join(MOCK_BIN_DIR, 'opencode');
  writeFileSync(mockOpencodePath, `#!/bin/bash\necho "MOCK OPENCODE CALLED WITH: $@"`);
  chmodSync(mockOpencodePath, 0o755);

  // Start the server with the mock bin in PATH
  serverProcess = spawn(['bun', 'src/index.ts', 'serve', '-p', PORT.toString()], {
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      SBX_MOCK: '1',
      SKIP_PROVISION: '1',
      PATH: `${MOCK_BIN_DIR}:${process.env.PATH}`,
    },
  });

  // Wait for server to be ready
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

test('POST /execute constructs and runs opencode command', async () => {
  const instance = 'testopencode';
  const prompt = 'create a file named foo.txt';
  const mode = 'build';

  const response = await fetch(`http://localhost:${PORT}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instance, prompt, mode }),
  });

  expect(response.status).toBe(200);
  const data = (await response.json()) as { stdout: string; exitCode: number };

  // Verify our mock opencode was called correctly
  expect(data.stdout).toContain(
    'MOCK OPENCODE CALLED WITH: run --agent build --format json create a file named foo.txt',
  );
  expect(data.exitCode).toBe(0);
});

test('POST /execute supports session persistence', async () => {
  const instance = 'testsession';
  const prompt = 'continue work';
  const sessionId = 'ses_12345';

  const response = await fetch(`http://localhost:${PORT}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instance, prompt, sessionId }),
  });

  expect(response.status).toBe(200);
  const data = (await response.json()) as { stdout: string };

  expect(data.stdout).toContain('--session ses_12345');
});
