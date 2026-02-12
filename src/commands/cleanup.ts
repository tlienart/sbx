import { execSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { getIdentity } from '../lib/identity/index.ts';
import { logger } from '../lib/logger.ts';

export async function cleanupCommand() {
  logger.info('Performing deep cleanup of SBX artifacts...');

  try {
    const identity = getIdentity();
    // 1. Kill all bridge processes
    logger.info('Terminating all bridge processes...');
    try {
      execSync('sudo pkill -f api_bridge.py || true');
    } catch {
      /* ignore */
    }

    // 2. Remove bridge sockets (host side)
    const hostUser = await identity.users.getHostUser();
    const bridgeDir = `/tmp/.sbx_${hostUser}`;
    if (existsSync(bridgeDir)) {
      logger.info(`Removing host bridge directory: ${bridgeDir}`);
      rmSync(bridgeDir, { recursive: true, force: true });
    }

    // 3. Remove any other sbx-related tmp files
    const tmpFiles = readdirSync('/tmp').filter(
      (f) =>
        f.startsWith('sbx_setup_') ||
        f.startsWith('sbx_shim_') ||
        f.startsWith('sbx_opencode_config_'),
    );

    if (tmpFiles.length > 0) {
      logger.info(`Removing ${tmpFiles.length} temporary setup files...`);
      for (const f of tmpFiles) {
        rmSync(`/tmp/${f}`, { force: true });
      }
    }

    logger.success('Cleanup complete.');
  } catch (err: unknown) {
    logger.error(`Cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
