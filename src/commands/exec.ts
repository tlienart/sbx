import { spawn } from 'node:child_process';
import { BridgeBox } from '../lib/bridge/index.ts';
import { getOS } from '../lib/common/os/index.ts';
import { getSandboxPort } from '../lib/common/utils/port.ts';
import { getIdentity } from '../lib/identity/index.ts';
import { logger } from '../lib/logger.ts';
import { getSandboxManager } from '../lib/sandbox/index.ts';

/**
 * Executes a command in a session or drops into an interactive shell.
 */
export async function execCommand(instance: string, args: string[]) {
  const os = getOS();
  const identity = getIdentity();
  const sandboxManager = getSandboxManager();

  // Find sandbox by name or ID
  const sandbox = await sandboxManager.findSandbox(instance);

  if (!sandbox) {
    logger.error(`Instance "${instance}" not found. Run "sbx list" to see available sessions.`);
    process.exit(1);
  }

  const instanceName = sandbox.id.split('-')[0] as string;
  const username = await identity.users.getSessionUsername(instanceName);
  const hostUser = await identity.users.getHostUser();
  const bridge = new BridgeBox(hostUser, username);

  try {
    if (!(await sandboxManager.isSandboxAlive(sandbox.id))) {
      logger.error(
        `Instance "${instance}" is not active on this host. Send a message via bot or API to recover it.`,
      );
      process.exit(1);
    }

    await os.proc.ensureSudo();
    await bridge.start();

    logger.info('Starting API bridge in sandbox...');
    const apiPort = getSandboxPort(instanceName);
    const sandboxLogDir = `/Users/${username}/.sbx/logs`;

    await os.proc.runAsUser(
      username,
      `mkdir -p ${sandboxLogDir} && nohup api_bridge.py ${apiPort} >${sandboxLogDir}/api_bridge.log 2>&1 &`,
    );

    const suArgs = ['-', username];
    if (args.length > 0) {
      suArgs.push('-c', args.join(' '));
    }

    const child = spawn('sudo', ['su', ...suArgs], {
      stdio: 'inherit',
      env: {
        ...process.env,
        BRIDGE_SOCK: bridge.getSocketPaths().command,
        PROXY_SOCK: bridge.getSocketPaths().proxy,
      },
    });

    const finish = () => {
      bridge.stop();
      os.proc.run('pkill', ['-u', username, '-f', 'api_bridge.py'], { sudo: true, reject: false });
    };

    child.on('exit', (code) => {
      finish();
      process.exit(code || 0);
    });

    child.on('error', (err) => {
      logger.error(`Failed to start session: ${err.message}`);
      finish();
      process.exit(1);
    });

    process.on('SIGINT', () => {
      finish();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      finish();
      process.exit(0);
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Execution error: ${msg}`);
    bridge.stop();
    process.exit(1);
  }
}
