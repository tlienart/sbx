import { getOS } from '../common/os/index.ts';

export class SudoersManager {
  private os = getOS();

  getFilePath(username: string): string {
    return `/etc/sudoers.d/${username}`;
  }

  getContent(hostUser: string, sessionUser: string): string {
    return `${hostUser} ALL=(root) NOPASSWD: /usr/bin/su - ${sessionUser} *\n`;
  }

  async setup(_instanceName: string, hostUser: string, sessionUser: string): Promise<void> {
    const content = this.getContent(hostUser, sessionUser);
    const filePath = this.getFilePath(sessionUser);

    const tmpFile = `/tmp/sbx_sudo_${sessionUser}`;
    this.os.fs.write(tmpFile, content);

    try {
      await this.os.proc.sudo('mv', [tmpFile, filePath]);
      await this.os.proc.sudo('chmod', ['440', filePath]);
      await this.os.proc.sudo('chown', ['root:wheel', filePath]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to setup sudoers: ${msg}`);
    }
  }

  async remove(sessionUser: string): Promise<void> {
    const filePath = this.getFilePath(sessionUser);
    try {
      await this.os.proc.sudo('rm', ['-f', filePath]);
    } catch {
      // Ignore if it doesn't exist
    }
  }
}
