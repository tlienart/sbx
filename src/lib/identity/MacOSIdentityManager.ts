import { randomBytes } from 'node:crypto';
import { getOS } from '../common/os/index.ts';
import { logger } from '../logger.ts';
import type { IIdentityManager } from './IdentityManager.ts';
import type { UserInfo } from './types.ts';

export class MacOSIdentityManager implements IIdentityManager {
  private os = getOS();

  async getHostUser(): Promise<string> {
    const sudoUser = this.os.env.get('SUDO_USER');
    if (sudoUser && sudoUser !== 'root') {
      return sudoUser;
    }

    const envUser = this.os.env.get('USER');
    if (envUser && envUser !== 'root') {
      return envUser;
    }

    const { stdout } = await this.os.proc.run('whoami', []);
    return stdout.trim();
  }

  async getSessionUsername(instanceName: string): Promise<string> {
    const hostUser = await this.getHostUser();
    return `sbx_${hostUser}_${instanceName}`;
  }

  async userExists(username: string): Promise<boolean> {
    try {
      await this.os.proc.run('dscl', ['.', '-read', `/Users/${username}`], { timeoutMs: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async isUserActive(username: string): Promise<boolean> {
    try {
      await this.os.proc.run('id', ['-u', username], { timeoutMs: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async getNumericUid(username: string): Promise<string> {
    const { stdout } = await this.os.proc.run(
      'dscl',
      ['.', '-read', `/Users/${username}`, 'UniqueID'],
      {
        timeoutMs: 5000,
      },
    );
    return stdout.replace('UniqueID:', '').trim();
  }

  async listUsers(): Promise<UserInfo[]> {
    const hostUser = await this.getHostUser();
    const prefix = `sbx_${hostUser}_`;

    try {
      const { stdout } = await this.os.proc.run('dscl', ['.', '-list', '/Users']);
      return stdout
        .split('\n')
        .filter((u) => u.startsWith(prefix))
        .map((username) => ({
          username,
          instanceName: username.substring(prefix.length),
        }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to list users: ${msg}`);
      return [];
    }
  }

  async createUser(instanceName: string): Promise<string> {
    const username = await this.getSessionUsername(instanceName);

    const existsInDscl = await this.userExists(username);
    const active = await this.isUserActive(username);

    if (existsInDscl && active) {
      logger.debug(`User ${username} already exists and is active.`);
    } else if (!existsInDscl) {
      logger.info(`Provisioning macOS user account: ${username}...`);
      const pw = randomBytes(64).toString('base64').slice(0, 64);

      // Launch sysadminctl with piped stdio to avoid terminal drift.
      const subprocess = this.os.proc.spawn(
        'sudo',
        ['sysadminctl', '-addUser', username, '-password', pw],
        {
          stdio: 'pipe',
        },
      );

      subprocess.catch((err: any) => {
        logger.debug(`sysadminctl subprocess ended: ${err.message}`);
      });

      // Race: Wait for the user record to appear in Directory Service
      let resolved = false;
      for (let i = 0; i < 60; i++) {
        if (await this.userExists(username)) {
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
      await this.os.proc.sudo('dscacheutil', ['-flushcache']);
      try {
        await this.os.proc.sudo('killall', ['-HUP', 'opendirectoryd']);
      } catch {
        /* ignore */
      }

      logger.success(`User identity ${username} captured.`);
    }

    return username;
  }

  async deleteUser(instanceName: string): Promise<void> {
    const username = await this.getSessionUsername(instanceName);

    if (!(await this.userExists(username))) {
      logger.debug(`User ${username} does not exist.`);
      return;
    }

    logger.info(`Deleting user session: ${username}...`);
    await this.os.proc.sudo('sysadminctl', ['-deleteUser', username]);

    for (let i = 0; i < 20; i++) {
      if (!(await this.userExists(username))) {
        logger.debug(`User ${username} record removed.`);
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
