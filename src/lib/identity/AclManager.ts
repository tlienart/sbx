import { getOS } from '../common/os/index.ts';
import { logger } from '../logger.ts';

export class AclManager {
  private os = getOS();

  async grantHostAccessToSandbox(sessionUser: string, hostUser: string): Promise<void> {
    const homeDir = `/Users/${sessionUser}`;

    logger.info(`Granting host user "${hostUser}" access to ${homeDir}...`);

    try {
      // 1. Ensure the directory itself is locked down (700)
      await this.os.proc.sudo('chmod', ['700', homeDir]);

      // 2. Apply ACLs for inheritance
      const acl = `user:${hostUser} allow list,add_file,search,add_subdirectory,delete_child,readsecurity,file_inherit,directory_inherit`;

      // Clear existing ACLs first to avoid duplicates/conflicts
      await this.os.proc.sudo('chmod', ['-N', homeDir]);
      // Apply new ACL to the home directory
      await this.os.proc.sudo('chmod', ['+a', acl, homeDir]);

      // 3. Ensure critical subdirectories also have the ACL if they already exist
      const subDirs = ['.sbx', '.config', 'tmp'];
      for (const sub of subDirs) {
        const subPath = `${homeDir}/${sub}`;
        if (this.os.fs.exists(subPath)) {
          await this.os.proc.sudo('chmod', ['+a', acl, subPath]);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Failed to set ACLs on ${homeDir}: ${msg}. Bridged commands might fail.`);
    }
  }
}
