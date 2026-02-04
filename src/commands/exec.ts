import { execSync, spawn } from 'node:child_process';
import { SbxBridge } from '../lib/bridge.ts';
import { ensureSudo } from '../lib/exec.ts';
import { logger } from '../lib/logger.ts';
import { getHostUser, getSessionUsername, isUserActive } from '../lib/user.ts';

/**
 * Executes a command in a session or drops into an interactive shell.
 */
export async function execCommand(instance: string, args: string[]) {
  const hostUser = await getHostUser();
  const bridge = new SbxBridge(hostUser);

  try {
    const username = await getSessionUsername(instance);
    // Check if user is active
    if (!(await isUserActive(username))) {
      logger.error(
        `Instance "${instance}" is not active or does not exist. Run "sbx create ${instance}" first.`,
      );
      process.exit(1);
    }

    // Ensure sudo is warmed up
    await ensureSudo();

    // 1. Start Host Bridge
    await bridge.start();

    // 2. Start API Bridge inside sandbox

    // We run it as a background process owned by the session user
    logger.info('Starting API bridge in sandbox...');
    const sandboxLogDir = `/Users/${username}/.sbx/logs`;
    execSync(
      `sudo su - ${username} -c "mkdir -p ${sandboxLogDir} && nohup api_bridge.py 9999 >${sandboxLogDir}/api_bridge.log 2>&1 &"`,
    );

    // Prepare the command for su
    // If no args, we just use su - username
    // If args, we use su - username -c "args..."
    const suArgs = ['-', username];
    if (args.length > 0) {
      suArgs.push('-c', args.join(' '));
    }

    // Use spawn with inherit for full interactivity (TTY support)
    const child = spawn('sudo', ['su', ...suArgs], {
      stdio: 'inherit',
      env: {
        ...process.env,
        BRIDGE_SOCK: bridge.getSocketPaths().command,
        PROXY_SOCK: bridge.getSocketPaths().proxy,
      },
    });

    child.on('exit', (code) => {
      cleanup(bridge, username);
      process.exit(code || 0);
    });

    child.on('error', (err) => {
      logger.error(`Failed to start session: ${err.message}`);
      cleanup(bridge, username);
      process.exit(1);
    });

    // Handle Ctrl+C etc
    process.on('SIGINT', () => {
      cleanup(bridge, username);
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      cleanup(bridge, username);
      process.exit(0);
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Execution error: ${msg}`);
    cleanup(bridge, await getSessionUsername(instance));
    process.exit(1);
  }
}

function cleanup(bridge: SbxBridge, username: string) {
  logger.debug('Cleaning up bridge and sandbox processes...');
  try {
    bridge.stop();
    // Kill the api_bridge.py and any leftover processes for this user
    execSync(`sudo pkill -u ${username} -f api_bridge.py || true`);
  } catch {
    // ignore
  }
}
