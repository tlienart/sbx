import { run, runAsUser, sudoRun } from './exec.ts';
import { logger } from './logger.ts';
import { getSessionUsername } from './user.ts';

/**
 * Ensures pkgx is installed on the host system.
 */
async function ensurePkgxOnHost(): Promise<void> {
  try {
    // Check if in PATH or at common absolute path
    await run('bash', ['-c', 'command -v pkgx || ls /usr/local/bin/pkgx']);
    return;
  } catch {
    logger.info('pkgx not found. Installing pkgx host-wide...');
    // We install pkgx to /usr/local/bin so it's available to all users.
    // The installer from pkgx.sh handles this.
    await sudoRun('bash', ['-c', 'curl -Ssf https://pkgx.sh | sh']);
  }
}

/**
 * Provisions the session with the pkgx toolchain.
 */
export async function provisionSession(instanceName: string, tools?: string): Promise<void> {
  await ensurePkgxOnHost();
  const sessionUser = await getSessionUsername(instanceName);

  // Configure pkgx in session profiles.
  // PKGX_YES=1 allows non-interactive tool installation on first use.
  // We explicitly add /usr/local/bin to PATH to ensure pkgx is found.
  const pathCmd = 'export PATH="/usr/local/bin:$PATH"';
  const setupCmd = 'eval "$(pkgx --setup)"';
  const yesCmd = 'export PKGX_YES=1';

  const profileCmds = [
    // zsh
    `grep -q "pkgx --setup" ~/.zprofile 2>/dev/null || (echo '${pathCmd}' >> ~/.zprofile && echo '${setupCmd}' >> ~/.zprofile)`,
    `grep -q "PKGX_YES" ~/.zprofile 2>/dev/null || echo '${yesCmd}' >> ~/.zprofile`,
    `grep -q "pkgx --setup" ~/.zshenv 2>/dev/null || (echo '${pathCmd}' >> ~/.zshenv && echo '${setupCmd}' >> ~/.zshenv)`,

    // bash
    `grep -q "pkgx --setup" ~/.bash_profile 2>/dev/null || (echo '${pathCmd}' >> ~/.bash_profile && echo '${setupCmd}' >> ~/.bash_profile)`,
    `grep -q "PKGX_YES" ~/.bash_profile 2>/dev/null || echo '${yesCmd}' >> ~/.bash_profile`,
    `grep -q "pkgx --setup" ~/.bashrc 2>/dev/null || (echo '${pathCmd}' >> ~/.bashrc && echo '${setupCmd}' >> ~/.bashrc)`,
  ].join(' && ');

  await runAsUser(sessionUser, `bash -c '${profileCmds}'`);

  // If specific tools are requested, we pre-cache them to make first use instant.
  if (tools) {
    const toolsList = tools
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (toolsList.length > 0) {
      logger.info(`Pre-caching tools for ${sessionUser}: ${toolsList.join(', ')}...`);
      // pkgx +tool -- true downloads the tool without executing anything significant.
      const cacheCmd = toolsList.map((t) => `pkgx +${t} -- true`).join(' && ');
      await runAsUser(sessionUser, `bash -c '${cacheCmd}'`);
    }
  }
}
