import chalk from 'chalk';
import { getOS } from '../src/lib/common/os/index.ts';
import { getIdentity } from '../src/lib/identity/index.ts';
import { logger } from '../src/lib/logger.ts';

async function stage3() {
  const TEST_NAME = 'stage-test';
  const identity = getIdentity();
  const username = await identity.users.getSessionUsername(TEST_NAME);
  const os = getOS();

  console.log(chalk.bold.cyan('\n🔄 Stage 3: Propagation Guarantee\n'));

  try {
    logger.info(`Checking if ${username} is recognized by the Unix layer (id)...`);

    let active = false;
    for (let i = 0; i < 5; i++) {
      if (await identity.users.isUserActive(username)) {
        active = true;
        break;
      }
      logger.warn(`User ${username} not recognized yet, flushing cache... (Attempt ${i + 1}/5)`);
      await os.proc.sudo('dscacheutil', ['-flushcache']);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    if (active) {
      logger.success(`${username} is live and recognized by the system.`);
    } else {
      throw new Error(
        `Propagation Timeout: ${username} exists in dscl but is NOT recognized by the 'id' command.`,
      );
    }

    console.log(chalk.bold.green('\n✅ Stage 3 Passed: Identity has propagated to the system.'));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Stage 3 Failed: ${msg}`);
    process.exit(1);
  }
}

stage3();
