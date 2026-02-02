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

  const profileFiles = ['.zprofile', '.zshenv', '.bash_profile', '.bashrc'];

  for (const file of profileFiles) {
    try {
      // Use a single quoted HEREDOC to avoid expansion issues
      const setupScript = `
export PATH="/usr/local/bin:$PATH"
eval "$(pkgx --setup)"
export PKGX_YES=1
`.trim();

      // We use a temporary script file to avoid quoting issues with su -c
      const tmpFile = `/tmp/sbx_setup_${instanceName}_${file.replace('.', '')}.sh`;
      await run('bash', ['-c', `cat <<'EOF' > ${tmpFile}\n${setupScript}\nEOF`]);
      await run('chmod', ['644', tmpFile]);

      // Append to profile if not already there
      await runAsUser(
        sessionUser,
        `grep -q "pkgx --setup" ~/${file} 2>/dev/null || cat ${tmpFile} >> ~/${file}`,
      );

      // Clean up
      await run('rm', [tmpFile]);
    } catch (err: any) {
      logger.debug(`Failed to configure ${file}: ${err.message}`);
    }
  }

  // If specific tools are requested, we pre-cache them to make first use instant.
  if (tools) {
    const toolsList = tools
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (toolsList.length > 0) {
      logger.info(`Pre-caching tools for ${sessionUser}: ${toolsList.join(', ')}...`);
      // pkgx +tool -- true downloads the tool without executing anything significant.
      for (const tool of toolsList) {
        await runAsUser(sessionUser, `pkgx +${tool} -- true`);
      }
    }
  }
}
