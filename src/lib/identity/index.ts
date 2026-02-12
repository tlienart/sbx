import { getOS } from '../common/os/index.ts';
import { logger } from '../logger.ts';
import { AclManager } from './AclManager.ts';
import { MacOSIdentityManager } from './MacOSIdentityManager.ts';
import { SudoersManager } from './SudoersManager.ts';

export class IdentityBox {
  public users: MacOSIdentityManager;
  public acls: AclManager;
  public sudoers: SudoersManager;

  constructor() {
    this.users = new MacOSIdentityManager();
    this.acls = new AclManager();
    this.sudoers = new SudoersManager();
  }

  async setupSessionUser(instanceName: string): Promise<string> {
    const os = getOS();
    const username = await this.users.createUser(instanceName);
    const hostUser = await this.users.getHostUser();
    const homeDir = `/Users/${username}`;

    // Ground truth UID resolution
    await os.proc.sudo('dscacheutil', ['-flushcache']);
    const currentUid = await this.users.getNumericUid(username);

    if (os.fs.exists(homeDir)) {
      // Check for UID mismatch
      try {
        const { stdout: dirUidStr } = await os.proc.sudo('stat', ['-f', '%u', homeDir]);
        const dirUid = dirUidStr.trim();
        if (dirUid !== currentUid) {
          logger.info(
            `UID mismatch for ${homeDir} (Dir: ${dirUid}, User: ${currentUid}). Resetting home...`,
          );
          await os.proc.sudo('rm', ['-rf', homeDir]);
        }
      } catch (err) {
        logger.warn(`Failed to stat ${homeDir}, forcing reset: ${err}`);
        await os.proc.sudo('rm', ['-rf', homeDir]);
      }
    }

    if (!os.fs.exists(homeDir)) {
      logger.info(`Home directory missing for ${username}, creating...`);
      await os.proc.sudo('mkdir', ['-p', homeDir]);
    }

    logger.info(`Fixing home directory permissions for ${username}...`);
    await os.proc.sudo('chown', [`${currentUid}:20`, homeDir]); // 20 is 'staff' GID
    await os.proc.sudo('chmod', ['700', homeDir]);

    logger.info(`Configuring host access (sudoers & ACLs) for ${username}...`);
    await this.sudoers.setup(instanceName, hostUser, username);
    await this.acls.grantHostAccessToSandbox(username, hostUser);

    // Wait for the system to recognize the new user and network to be ready
    await this.waitForUserReady(username);

    return username;
  }

  async cleanupSessionUser(instanceName: string): Promise<void> {
    const username = await this.users.getSessionUsername(instanceName);
    await this.sudoers.remove(username);
    await this.users.deleteUser(instanceName);
  }

  private async waitForUserReady(username: string): Promise<void> {
    const os = getOS();

    // Stage 1: Unix Identity propagation (30s)
    let stage1Ok = false;
    for (let i = 0; i < 120; i++) {
      if (await this.users.isUserActive(username)) {
        stage1Ok = true;
        break;
      }
      if (i % 4 === 0) {
        logger.info(`[Stage 1] Waiting for ${username} record to propagate...`);
        await os.proc.sudo('dscacheutil', ['-flushcache']);
        try {
          await os.proc.sudo('killall', ['-HUP', 'opendirectoryd']);
        } catch {}
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!stage1Ok) throw new Error(`User ${username} record failed to propagate within 30s.`);

    // Stage 2: Shell/Sudoers Identity readiness (60s)
    let stage2Ok = false;
    for (let i = 0; i < 60; i++) {
      try {
        const res = await os.proc.sudo('su', ['-', username, '-c', 'echo ready'], {
          timeoutMs: 5000,
        });
        if (res.stdout.includes('ready')) {
          stage2Ok = true;
          break;
        }
      } catch {}

      logger.info(`[Stage 2] Waiting for ${username} shell to accept commands...`);
      await os.proc.sudo('dscacheutil', ['-flushcache']);
      try {
        await os.proc.sudo('killall', ['-HUP', 'opendirectoryd']);
      } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!stage2Ok) throw new Error(`User ${username} shell failed to become ready within 60s.`);

    // Stage 3: Network Connectivity (60s)
    let stage3Ok = false;
    for (let i = 0; i < 60; i++) {
      try {
        // We use su - directly for network check to be sure
        const res = await os.proc.sudo(
          'su',
          [
            '-',
            username,
            '-c',
            'ping -c 1 -t 1 8.8.8.8 >/dev/null || ping -c 1 -t 1 github.com >/dev/null',
          ],
          { timeoutMs: 2000 },
        );
        if (res.exitCode === 0) {
          stage3Ok = true;
          break;
        }
      } catch {}

      if (i % 5 === 0) logger.info(`[Stage 3] Waiting for network connectivity for ${username}...`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!stage3Ok) throw new Error(`User ${username} network failed to initialize within 60s.`);

    logger.success(`User ${username} is fully operational.`);
  }
}

let instance: IdentityBox | null = null;

export function getIdentity(): IdentityBox {
  if (!instance) {
    instance = new IdentityBox();
  }
  return instance;
}

export * from './types.ts';
