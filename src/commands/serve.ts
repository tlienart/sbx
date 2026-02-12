import { serve } from 'bun';
import { BridgeBox } from '../lib/bridge/index.ts';
import { getOS } from '../lib/common/os/index.ts';
import { getSandboxPort } from '../lib/common/utils/port.ts';
import { getIdentity } from '../lib/identity/index.ts';
import { logger } from '../lib/logger.ts';
import { getSandboxManager } from '../lib/sandbox/index.ts';

interface ServeOptions {
  port: string;
}

export async function serveCommand(options: ServeOptions) {
  const port = Number.parseInt(options.port, 10);
  const os = getOS();
  const sandboxManager = getSandboxManager();
  const identity = getIdentity().users;
  const hostUser = await identity.getHostUser();
  const bridge = new BridgeBox(hostUser);
  const isMock = process.env.SBX_MOCK === '1';

  logger.info(`Starting SBX API server on port ${port}${isMock ? ' (MOCK MODE)' : ''}...`);

  try {
    if (!isMock) {
      await os.proc.ensureSudo();
    }
    await bridge.start();
    logger.success('Host bridge started.');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to start bridge: ${msg}`);
    process.exit(1);
  }

  const server = serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      // --- /status ---
      if (req.method === 'GET' && url.pathname === '/status') {
        const sandboxes = await sandboxManager.listSandboxes();
        const results = await Promise.all(
          sandboxes.map(async (s) => {
            const instanceName = s.id.split('-')[0] as string;
            const username = await identity.getSessionUsername(instanceName);
            const apiPort = getSandboxPort(instanceName);
            let bridgeActive = false;
            try {
              const check = await os.proc.runAsUser(username, `nc -z 127.0.0.1 ${apiPort}`, {
                timeoutMs: 1000,
              });
              bridgeActive = check.exitCode === 0;
            } catch {
              /* ignore */
            }
            return {
              instance: instanceName,
              id: s.id,
              username,
              bridgePort: apiPort,
              bridgeActive,
            };
          }),
        );
        return Response.json({ status: 'ok', instances: results });
      }

      // --- /create ---
      if (req.method === 'POST' && url.pathname === '/create') {
        try {
          const body = (await req.json()) as {
            instance?: string;
            tools?: string;
            provider?: string;
          };
          const { instance, tools, provider = 'google' } = body;

          logger.info(`[API] Creating session: ${instance || 'unnamed'}`);

          const sandbox = await sandboxManager.createSandbox(instance, tools, provider);
          const instanceName = sandbox.id.split('-')[0] as string;
          const username = await identity.getSessionUsername(instanceName);
          const apiPort = getSandboxPort(instanceName);

          if (!isMock) {
            await bridge.attachToSandbox(username, apiPort);
          }

          return Response.json({
            status: 'created',
            instance: instanceName,
            id: sandbox.id,
            username,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(`[API] Error creating session: ${msg}`);
          return Response.json({ error: msg }, { status: 500 });
        }
      }

      // --- /raw-exec ---
      if (req.method === 'POST' && url.pathname === '/raw-exec') {
        try {
          const body = (await req.json()) as { instance?: string; command?: string };
          const { instance, command } = body;

          if (!instance || !command) {
            return Response.json({ error: 'Missing instance or command' }, { status: 400 });
          }

          const sandboxes = await sandboxManager.listSandboxes();
          let sandbox = sandboxes.find(
            (s) => s.id === instance || s.id.startsWith(instance) || s.name === instance,
          );

          if (!sandbox) {
            logger.info(`[API] Sandbox not found, auto-creating: ${instance}`);
            sandbox = await sandboxManager.createSandbox(instance);
          }

          const instanceName = sandbox.id.split('-')[0] as string;
          const username = await identity.getSessionUsername(instanceName);
          const apiPort = getSandboxPort(instanceName);

          if (!isMock) {
            if (!(await sandboxManager.isSandboxAlive(sandbox.id))) {
              await sandboxManager.createSandbox(sandbox.name, undefined, undefined);
            }
            await bridge.attachToSandbox(username, apiPort);
          }

          logger.info(`[API] Executing in ${instanceName}: ${command}`);

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
            : await os.proc.runAsUser(username, command, {
                env: {
                  BRIDGE_SOCK: bridge.getSocketPaths().command,
                  PROXY_SOCK: bridge.getSocketPaths().proxy,
                },
                reject: false,
              });

          return Response.json({
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(`[API] Error: ${msg}`);
          return Response.json({ error: msg }, { status: 500 });
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

          const sandboxes = await sandboxManager.listSandboxes();
          let sandbox = sandboxes.find(
            (s) => s.id === instance || s.id.startsWith(instance) || s.name === instance,
          );

          if (!sandbox) {
            logger.info(`[API] Sandbox not found, auto-creating: ${instance}`);
            sandbox = await sandboxManager.createSandbox(instance, undefined, provider);
          }

          const instanceName = sandbox.id.split('-')[0] as string;
          const username = await identity.getSessionUsername(instanceName);
          const apiPort = getSandboxPort(instanceName);

          if (!isMock) {
            if (!(await sandboxManager.isSandboxAlive(sandbox.id))) {
              await sandboxManager.createSandbox(sandbox.name, undefined, provider);
            }
            await bridge.attachToSandbox(username, apiPort);
          }

          logger.info(
            `[API] OpenCode executing in ${instanceName} (mode: ${mode}, session: ${sessionId || 'new'}): ${prompt}`,
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
            : await os.proc.runAsUser(username, `${opencodeCmd} < /dev/null`, {
                env: {
                  BRIDGE_SOCK: bridge.getSocketPaths().command,
                  PROXY_SOCK: bridge.getSocketPaths().proxy,
                },
                timeoutMs: 60000,
              });

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
              /* ignore */
            }
          }

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
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(`[API] Error: ${msg}`);
          return Response.json({ error: msg }, { status: 500 });
        }
      }

      return new Response('Not Found', { status: 404 });
    },
  });

  logger.success(`Server listening at http://localhost:${server.port}`);

  const cleanup = () => {
    logger.info('Shutting down server and bridges...');
    try {
      os.proc.run('pkill', ['-f', 'api_bridge.py'], { reject: false });
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
