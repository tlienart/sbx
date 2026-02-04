import { execSync } from 'node:child_process';
import { serve } from 'bun';
import { SbxBridge } from '../lib/bridge.ts';
import { ensureSudo, runAsUser } from '../lib/exec.ts';
import { logger } from '../lib/logger.ts';
import { provisionSession } from '../lib/provision.ts';
import {
  createSessionUser,
  getHostUser,
  getSandboxPort,
  getSessionUsername,
  isUserActive,
  listSessions,
} from '../lib/user.ts';

interface ServeOptions {
  port: string;
}

async function ensureBridge(username: string, bridge: SbxBridge, port: number) {
  const sandboxLogDir = `/Users/${username}/.sbx/logs`;
  const env = {
    BRIDGE_SOCK: bridge.getSocketPaths().command,
    PROXY_SOCK: bridge.getSocketPaths().proxy,
  };

  // Check if already running on this port
  try {
    const check = await runAsUser(username, `nc -z 127.0.0.1 ${port}`);
    if (check.exitCode === 0) {
      logger.debug(`[API] Bridge already running for ${username} on port ${port}`);
      return;
    }
  } catch {
    /* ignore */
  }

  logger.info(`[API] Starting API bridge for ${username} on port ${port}...`);

  // Try to clean up any dead process on this port just in case
  try {
    execSync(`sudo lsof -ti:${port} | xargs sudo kill -9 || true`);
  } catch {
    /* ignore */
  }

  await runAsUser(
    username,
    `mkdir -p ${sandboxLogDir} && nohup python3 -u /Users/${username}/.sbx/bin/api_bridge.py ${port} >${sandboxLogDir}/api_bridge.log 2>&1 &`,
    { env },
  );

  // Wait for the port to be open
  for (let i = 0; i < 15; i++) {
    try {
      const check = await runAsUser(username, `nc -z 127.0.0.1 ${port}`);
      if (check.exitCode === 0) return;
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for API bridge to start on port ${port}`);
}

export async function serveCommand(options: ServeOptions) {
  const port = Number.parseInt(options.port, 10);
  const hostUser = await getHostUser();
  const bridge = new SbxBridge(hostUser);
  const isMock = process.env.SBX_MOCK === '1';

  logger.info(`Starting SBX API server on port ${port}${isMock ? ' (MOCK MODE)' : ''}...`);

  try {
    if (!isMock) {
      await ensureSudo();
    }
    await bridge.start();
    logger.success('Host bridge started.');
  } catch (err: any) {
    logger.error(`Failed to start bridge: ${err.message}`);
    process.exit(1);
  }

  const server = serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      // --- /status ---
      if (req.method === 'GET' && url.pathname === '/status') {
        const sessions = await listSessions();
        const results = await Promise.all(
          sessions.map(async (s) => {
            const port = getSandboxPort(s.instanceName);
            let bridgeActive = false;
            try {
              const check = await runAsUser(s.username, `nc -z 127.0.0.1 ${port}`);
              bridgeActive = check.exitCode === 0;
            } catch {
              /* ignore */
            }
            return {
              instance: s.instanceName,
              username: s.username,
              bridgePort: port,
              bridgeActive,
            };
          }),
        );
        return Response.json({ status: 'ok', instances: results });
      }

      // --- /raw-exec ---
      if (req.method === 'POST' && url.pathname === '/raw-exec') {
        try {
          const body = (await req.json()) as { instance?: string; command?: string };
          const { instance, command } = body;

          if (!instance || !command) {
            return Response.json({ error: 'Missing instance or command' }, { status: 400 });
          }

          const username = await getSessionUsername(instance);
          const apiPort = getSandboxPort(instance);

          if (!isMock) {
            if (!(await isUserActive(username))) {
              await createSessionUser(instance);
            }
            await provisionSession(instance, undefined, undefined, apiPort);
            await ensureBridge(username, bridge, apiPort);
          }

          logger.info(`[API] Executing in ${instance}: ${command}`);

          const result = isMock
            ? await (async () => {
                const { execa } = await import('execa');
                const proc = await execa('bash', ['-c', command], {
                  env: {
                    ...process.env,
                    BRIDGE_SOCK: bridge.getSocketPaths().command,
                    PROXY_SOCK: bridge.getSocketPaths().proxy,
                  },
                  all: true,
                  reject: false,
                });
                return { stdout: proc.stdout, stderr: proc.stderr, exitCode: proc.exitCode ?? 0 };
              })()
            : await runAsUser(username, command, {
                env: {
                  BRIDGE_SOCK: bridge.getSocketPaths().command,
                  PROXY_SOCK: bridge.getSocketPaths().proxy,
                },
              });

          return Response.json({
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
          });
        } catch (err: any) {
          logger.error(`[API] Error: ${err.message}`);
          return Response.json({ error: err.message }, { status: 500 });
        }
      }

      // --- /execute ---
      if (req.method === 'POST' && url.pathname === '/execute') {
        try {
          const body = (await req.json()) as {
            instance?: string;
            prompt?: string;
            mode?: string;
            provider?: string;
            sessionId?: string;
          };
          const { instance, prompt, mode = 'build', provider = 'google', sessionId } = body;

          if (!instance || !prompt) {
            return Response.json({ error: 'Missing instance or prompt' }, { status: 400 });
          }

          const username = await getSessionUsername(instance);
          const apiPort = getSandboxPort(instance);

          if (!isMock) {
            if (!(await isUserActive(username))) {
              await createSessionUser(instance);
            }
            await provisionSession(instance, undefined, provider, apiPort);
            await ensureBridge(username, bridge, apiPort);
          }

          logger.info(
            `[API] OpenCode executing in ${instance} (mode: ${mode}, session: ${sessionId || 'new'}): ${prompt}`,
          );

          let opencodeCmd = `opencode run --agent ${mode} --format json ${JSON.stringify(prompt)}`;
          if (sessionId) {
            opencodeCmd += ` --session ${sessionId}`;
          }

          const result = isMock
            ? await (async () => {
                const { execa } = await import('execa');
                const proc = await execa('bash', ['-c', opencodeCmd], {
                  env: {
                    ...process.env,
                    BRIDGE_SOCK: bridge.getSocketPaths().command,
                    PROXY_SOCK: bridge.getSocketPaths().proxy,
                  },
                  all: true,
                  reject: false,
                });
                return { stdout: proc.stdout, stderr: proc.stderr, exitCode: proc.exitCode ?? 0 };
              })()
            : await runAsUser(username, `${opencodeCmd} < /dev/null`, {
                env: {
                  BRIDGE_SOCK: bridge.getSocketPaths().command,
                  PROXY_SOCK: bridge.getSocketPaths().proxy,
                },
                timeoutMs: 60000, // 1 minute timeout
              });

          // Parse JSON output from OpenCode
          let finalOutput = '';
          let finalSessionId = sessionId;
          const lines = result.stdout.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const json = JSON.parse(line);
              if (json.sessionID) finalSessionId = json.sessionID;
              if (json.type === 'text' && json.part?.text) {
                finalOutput += json.part.text;
              }
            } catch {
              // Not a JSON line, maybe some other output
            }
          }

          // If finalOutput is still empty (e.g. not in JSON format or error), fallback to raw stdout
          if (!finalOutput && result.stdout) {
            finalOutput = result.stdout;
          }

          return Response.json({
            output: finalOutput,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            sessionId: finalSessionId,
          });
        } catch (err: any) {
          logger.error(`[API] Error: ${err.message}`);
          return Response.json({ error: err.message }, { status: 500 });
        }
      }

      return new Response('Not Found', { status: 404 });
    },
  });

  logger.success(`Server listening at http://localhost:${server.port}`);

  const cleanup = () => {
    logger.info('Shutting down server and bridges...');
    try {
      // Kill all api_bridge.py processes
      execSync('pkill -f api_bridge.py || true');
    } catch {
      /* ignore */
    }
    bridge.stop();
    server.stop();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}
