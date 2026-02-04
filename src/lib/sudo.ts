import { sudoRun } from './exec.ts';
import { getHostUser, getSessionUsername } from './user.ts';

/**
 * Manages sudoers entries for sbx sessions.
 */
export const sudoers = {
  /**
   * Path to the sudoers fragment for a specific session.
   */
  getFilePath: (username: string) => `/etc/sudoers.d/${username}`,

  /**
   * Generates the sudoers content.
   * Allows hostUser to su to sessionUser without a password.
   */
  getContent: (hostUser: string, sessionUser: string) => {
    // This allows the host user to su to the session user without a password.
    // We allow any arguments after 'su - sessionUser' to support -c and environment injections.
    return `${hostUser} ALL=(root) NOPASSWD: /usr/bin/su - ${sessionUser} *\n`;
  },

  /**
   * Adds the sudoers fragment.
   */
  setup: async (instanceName: string): Promise<void> => {
    const hostUser = await getHostUser();
    const sessionUser = await getSessionUsername(instanceName);
    const content = sudoers.getContent(hostUser, sessionUser);
    const filePath = sudoers.getFilePath(sessionUser);

    // We need to write this file as root.
    // Since we can't easily pipe with sudoRun in this wrapper,
    // we'll use a temporary file.
    const tmpFile = `/tmp/sbx_sudo_${sessionUser}`;
    await Bun.write(tmpFile, content);

    try {
      await sudoRun('mv', [tmpFile, filePath]);
      await sudoRun('chmod', ['440', filePath]);
      await sudoRun('chown', ['root:wheel', filePath]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to setup sudoers: ${msg}`);
    }
  },

  /**
   * Removes the sudoers fragment.
   */
  remove: async (instanceName: string): Promise<void> => {
    const sessionUser = await getSessionUsername(instanceName);
    const filePath = sudoers.getFilePath(sessionUser);

    try {
      await sudoRun('rm', ['-f', filePath]);
    } catch {
      // Ignore if it doesn't exist
    }
  },
};
