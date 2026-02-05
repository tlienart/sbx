import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { execa } from 'execa';
import { run, runAsUser, sudoRun } from './exec.ts';
import { logger } from './logger.ts';
import { sudoers } from './sudo.ts';

export interface UserInfo {
  username: string;
  instanceName: string;
}

/**
 * Ensures the host user has access to the sandbox home directory for bridged commands.
 */
export async function ensureHostAccessToSandbox(sessionUser: string): Promise<void> {
  const hostUser = await getHostUser();
  const homeDir = `/Users/${sessionUser}`;

  logger.info(`Granting host user "${hostUser}" access to ${homeDir}...`);

  try {
    // 1. Ensure the directory itself is locked down (700)
    await sudoRun('chmod', ['700', homeDir]);

    // 2. Apply ACLs for inheritance so the host can access any subdirectories created by the sandbox.
    // 'inherited' flag means it applies to existing items if we were using -R,
    // but here we use 'file_inherit,directory_inherit' for future items.
    // We use a broader set of permissions to ensure the bridge can do everything needed.
    const acl = `user:${hostUser} allow list,add_file,search,add_subdirectory,delete_child,readsecurity,file_inherit,directory_inherit`;

    // Clear existing ACLs first to avoid duplicates/conflicts
    await sudoRun('chmod', ['-N', homeDir]);
    // Apply new ACL to the home directory
    await sudoRun('chmod', ['+a', acl, homeDir]);

    // 3. Ensure critical subdirectories also have the ACL if they already exist
    const subDirs = ['.sbx', '.config', 'tmp'];
    for (const sub of subDirs) {
      const subPath = `${homeDir}/${sub}`;
      if (fs.existsSync(subPath)) {
        await sudoRun('chmod', ['+a', acl, subPath]);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Failed to set ACLs on ${homeDir}: ${msg}. Bridged commands might fail.`);
  }
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
    // Try to reach a reliable IP or resolve a common domain.
    const res = await runAsUser(
      username,
      'ping -c 1 -t 1 8.8.8.8 >/dev/null || ping -c 1 -t 1 github.com >/dev/null || host -W 1 google.com >/dev/null',
      {
        timeoutMs: 2000,
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
    // We MUST use su - to match the sudoers NOPASSWD policy
    const res = await sudoRun('su', ['-', username, '-c', 'echo ready'], { timeoutMs: 5000 });
    return res.stdout.includes('ready');
  } catch {
    return false;
  }
}

/**
 * Linearized check for user readiness.
 * Stage 1: Wait for OS record (id)
 * Stage 2: Wait for Shell Identity (su)
 * Stage 3: Wait for Network Connectivity (ping)
 */
async function waitForUserReady(username: string): Promise<void> {
  // Stage 1: Unix Identity propagation (30s)
  let stage1Ok = false;
  for (let i = 0; i < 30; i++) {
    if (await isUserActive(username)) {
      stage1Ok = true;
      break;
    }
    logger.debug(`[Stage 1] Waiting for ${username} record to propagate...`);
    await sudoRun('dscacheutil', ['-flushcache']);
    try {
      await sudoRun('killall', ['-HUP', 'opendirectoryd']);
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!stage1Ok) throw new Error(`User ${username} record failed to propagate within 30s.`);

  // Stage 2: Shell/Sudoers Identity readiness (60s)
  let stage2Ok = false;
  for (let i = 0; i < 60; i++) {
    if (await isIdentityReady(username)) {
      stage2Ok = true;
      break;
    }
    logger.debug(`[Stage 2] Waiting for ${username} shell to accept commands...`);
    // Aggressive cache flushing for the identity subsystem
    await sudoRun('dscacheutil', ['-flushcache']);
    try {
      await sudoRun('killall', ['-HUP', 'opendirectoryd']);
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!stage2Ok) throw new Error(`User ${username} shell failed to become ready within 60s.`);

  // Give the system a tiny moment to settle before network probe
  await new Promise((r) => setTimeout(r, 1000));

  // Stage 3: Network Connectivity (60s - can be slow on fresh users)
  let stage3Ok = false;
  for (let i = 0; i < 60; i++) {
    if (await isNetworkReady(username)) {
      stage3Ok = true;
      break;
    }
    if (i % 5 === 0) logger.debug(`[Stage 3] Waiting for network connectivity for ${username}...`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!stage3Ok) throw new Error(`User ${username} network failed to initialize within 60s.`);

  logger.success(`User ${username} is fully operational.`);
}

/**
 * Gets the numeric UID of a user from Directory Services (Ground Truth).
 */
export async function getNumericUid(username: string): Promise<string> {
  const { stdout } = await run('dscl', ['.', '-read', `/Users/${username}`, 'UniqueID'], {
    timeoutMs: 5000,
  });
  return stdout.replace('UniqueID:', '').trim();
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
  } else if (!existsInDscl) {
    logger.info(`Provisioning macOS user account: ${username}...`);
    const pw = generateRandomPassword(64);

    // Launch sysadminctl with piped stdio to avoid terminal drift.
    const subprocess = execa('sudo', ['sysadminctl', '-addUser', username, '-password', pw], {
      stdio: 'pipe',
    });

    subprocess.catch((err) => {
      logger.debug(`sysadminctl subprocess ended: ${err.message}`);
    });

    // Race: Wait for the user record to appear in Directory Service
    let resolved = false;
    for (let i = 0; i < 60; i++) {
      if (await userExists(username)) {
        resolved = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!resolved) {
      subprocess.kill('SIGKILL');
      throw new Error(
        `Failed to create user record for ${username} within 30s. Please check for a system popup.`,
      );
    }

    // Kill the hanging sysadminctl process after a grace period
    setTimeout(() => {
      try {
        subprocess.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, 3000);

    // Force system cache update
    await sudoRun('dscacheutil', ['-flushcache']);
    try {
      await sudoRun('killall', ['-HUP', 'opendirectoryd']);
    } catch {
      /* ignore */
    }

    logger.success(`User identity ${username} captured.`);
  }

  const homeDir = `/Users/${username}`;

  // Ground truth UID resolution
  await sudoRun('dscacheutil', ['-flushcache']);
  const currentUid = await getNumericUid(username);

  if (fs.existsSync(homeDir)) {
    // Check for UID mismatch
    try {
      const { stdout: dirUidStr } = await sudoRun('stat', ['-f', '%u', homeDir]);
      const dirUid = dirUidStr.trim();
      if (dirUid !== currentUid) {
        logger.info(
          `UID mismatch for ${homeDir} (Dir: ${dirUid}, User: ${currentUid}). Resetting home...`,
        );
        await sudoRun('rm', ['-rf', homeDir]);
      }
    } catch (err) {
      logger.warn(`Failed to stat ${homeDir}, forcing reset: ${err}`);
      await sudoRun('rm', ['-rf', homeDir]);
    }
  }

  if (!fs.existsSync(homeDir)) {
    logger.info(`Home directory missing for ${username}, creating...`);
    await sudoRun('mkdir', ['-p', homeDir]);
  }

  logger.info(`Fixing home directory permissions for ${username}...`);
  await sudoRun('chown', [`${currentUid}:20`, homeDir]); // 20 is 'staff' GID
  await sudoRun('chmod', ['700', homeDir]);

  logger.info(`Configuring host access (sudoers & ACLs) for ${username}...`);
  await sudoers.setup(instanceName);
  await ensureHostAccessToSandbox(username);

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

  logger.info(`Deleting user session: ${username}...`);
  await sudoRun('sysadminctl', ['-deleteUser', username]);

  for (let i = 0; i < 20; i++) {
    if (!(await userExists(username))) {
      logger.debug(`User ${username} record removed.`);
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
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
