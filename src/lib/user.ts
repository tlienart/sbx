import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { execa } from 'execa';
import { run, runAsUser, sudoRun } from './exec.ts';
import { logger } from './logger.ts';

export interface UserInfo {
  username: string;
  instanceName: string;
}

/**
 * Generates a random secure password of specified length.
 */
function generateRandomPassword(length: number): string {
  return randomBytes(length).toString('base64').slice(0, length);
}

/**
 * Deterministically generates a port number for an instance bridge.
 */
export function getSandboxPort(instanceName: string): number {
  let hash = 0;
  for (let i = 0; i < instanceName.length; i++) {
    hash = (hash << 5) - hash + instanceName.charCodeAt(i);
    hash |= 0;
  }
  return 10000 + (Math.abs(hash) % 5000);
}

/**
 * Gets the current host username.
 * Prioritizes SUDO_USER to ensure consistent session association even when run via sudo.
 */
export async function getHostUser(): Promise<string> {
  const sudoUser = process.env.SUDO_USER;
  if (sudoUser && sudoUser !== 'root') {
    return sudoUser;
  }

  const envUser = process.env.USER;
  if (envUser && envUser !== 'root') {
    return envUser;
  }

  const { stdout } = await run('whoami', []);
  return stdout.trim();
}

/**
 * Generates the sbx username for an instance.
 */
export async function getSessionUsername(instanceName: string): Promise<string> {
  const hostUser = await getHostUser();
  // Using sbx_ to keep it short (macOS limit is 32)
  return `sbx_${hostUser}_${instanceName}`;
}

/**
 * Checks if a user exists on the system.
 */
export async function userExists(username: string): Promise<boolean> {
  try {
    await run('dscl', ['.', '-read', `/Users/${username}`], { timeoutMs: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if a user exists and is recognized by the system identity resolver.
 */
export async function isUserActive(username: string): Promise<boolean> {
  try {
    await run('id', ['-u', username], { timeoutMs: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if the network is available within the user session.
 */
async function isNetworkReady(username: string): Promise<boolean> {
  try {
    // Try to resolve github.com (common dependency)
    // We use a shorter timeout for the command itself, but poll it in waitForUserReady
    const res = await runAsUser(
      username,
      'ping -c 1 -t 2 8.8.8.8 >/dev/null && (host github.com || nslookup github.com || ping -c 1 github.com)',
      {
        timeoutMs: 5000,
      },
    );
    return res.exitCode === 0;
  } catch (err: unknown) {
    return false;
  }
}

/**
 * Checks if the user is recognized and can execute a simple command.
 */
async function isIdentityReady(username: string): Promise<boolean> {
  try {
    const res = await sudoRun('su', [username, '-c', 'echo ready'], { timeoutMs: 5000 });
    return res.stdout.includes('ready');
  } catch {
    return false;
  }
}

/**
 * Polls until the user is recognized by the system and network is ready.
 */
async function waitForUserReady(username: string, maxAttempts = 20): Promise<void> {
  let identityReady = false;

  for (let i = 0; i < maxAttempts; i++) {
    const active = await isUserActive(username);
    if (active) {
      if (!identityReady) {
        if (await isIdentityReady(username)) {
          identityReady = true;
          logger.debug(`User identity confirmed for ${username}.`);
        } else {
          logger.debug(`Waiting for ${username} to accept commands...`);
        }
      }

      if (identityReady) {
        // Give the system a moment to finish plumbing the user session
        await new Promise((r) => setTimeout(r, 1000));

        // Once identity is ready, wait for network to stabilize
        if (await isNetworkReady(username)) return;
        logger.debug(`Waiting for network to stabilize for ${username}...`);
      }
    } else {
      logger.debug(`Waiting for user ${username} to become active...`);
      // Flush directory service cache
      await sudoRun('dscacheutil', ['-flushcache']);
      try {
        await sudoRun('killall', ['-HUP', 'opendirectoryd']);
      } catch {
        /* ignore if fails */
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const finalActive = await isUserActive(username);
  const finalIdentity = await isIdentityReady(username);
  const finalNetwork = await isNetworkReady(username);

  throw new Error(
    `User ${username} setup timed out (active: ${finalActive}, identity: ${finalIdentity}, network: ${finalNetwork}).`,
  );
}

/**
 * Creates a new macOS user session with a random password.
 * Uses a "Fast-Path" logic to bypass hanging sysadminctl finishing steps.
 */
export async function createSessionUser(instanceName: string): Promise<string> {
  const username = await getSessionUsername(instanceName);

  const existsInDscl = await userExists(username);
  const active = await isUserActive(username);

  if (existsInDscl && active) {
    logger.debug(`User ${username} already exists and is active.`);
    return username;
  }

  if (!existsInDscl) {
    logger.info(`Provisioning macOS user account: ${username}...`);
    const pw = generateRandomPassword(64);

    // Launch sysadminctl with piped stdio to avoid terminal drift.
    // We don't await it forever because it hangs on housekeeping.
    const subprocess = execa('sudo', ['sysadminctl', '-addUser', username, '-password', pw], {
      stdio: 'pipe',
    });

    // Handle termination to avoid unhandled promise rejection crashes
    subprocess.catch((err) => {
      logger.debug(`sysadminctl subprocess ended: ${err.message}`);
    });

    // Race: Wait for the user record to appear in Directory Service
    let resolved = false;
    for (let i = 0; i < 40; i++) {
      // 20 seconds max
      if (await userExists(username)) {
        resolved = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!resolved) {
      subprocess.kill('SIGKILL');
      throw new Error(
        `Failed to create user record for ${username} within 20s. Please check for a system popup.`,
      );
    }

    // Kill the hanging sysadminctl process - we have what we need (the record)
    setTimeout(() => {
      try {
        subprocess.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, 1000);

    // Force system cache update
    await sudoRun('dscacheutil', ['-flushcache']);
    try {
      await sudoRun('killall', ['-HUP', 'opendirectoryd']);
    } catch {
      /* ignore */
    }

    logger.success(`User identity ${username} captured.`);
  }

  // Ensure the home directory exists and is correctly owned BEFORE readiness checks
  // (su - depends on a readable home directory)
  const homeDir = `/Users/${username}`;
  if (!fs.existsSync(homeDir)) {
    logger.info(`Home directory missing for ${username}, creating...`);
    await sudoRun('mkdir', ['-p', homeDir]);
  }

  logger.info(`Fixing home directory permissions for ${username}...`);
  await sudoRun('chown', [`${username}:staff`, homeDir]);
  await sudoRun('chmod', ['700', homeDir]);

  // Wait for the system to recognize the new user and network to be ready
  await waitForUserReady(username);

  return username;
}

/**
 * Deletes a macOS user session.
 */
export async function deleteSessionUser(instanceName: string): Promise<void> {
  const username = await getSessionUsername(instanceName);

  if (!(await userExists(username))) {
    logger.debug(`User ${username} does not exist.`);
    return;
  }

  // -deleteUser <name> deletes the user and home directory
  await sudoRun('sysadminctl', ['-deleteUser', username]);
}

/**
 * Lists all sbx sessions for the current host user.
 */
export async function listSessions(): Promise<UserInfo[]> {
  const hostUser = await getHostUser();
  const prefix = `sbx_${hostUser}_`;

  try {
    const { stdout } = await run('dscl', ['.', '-list', '/Users']);
    const users = stdout
      .split('\n')
      .filter((u) => u.startsWith(prefix))
      .map((username) => ({
        username,
        instanceName: username.substring(prefix.length),
      }));

    return users;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to list users: ${msg}`);
    return [];
  }
}
