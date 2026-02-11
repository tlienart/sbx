import chalk from 'chalk';
import { logger } from '../src/lib/logger.ts';
import { sudoers } from '../src/lib/sudo.ts';
import { deleteSessionUser } from '../src/lib/user.ts';

async function stage7() {
  const TEST_NAME = 'stage-test';

  console.log(chalk.bold.cyan('\n🧹 Stage 7: Cleanup Guarantee\n'));

  try {
    logger.info(`Deleting test instance: ${TEST_NAME}...`);

    await sudoers.remove(TEST_NAME);
    await deleteSessionUser(TEST_NAME);

    logger.success('Test instance deleted successfully.');
    console.log(chalk.bold.green('\n✅ Stage 7 Passed: System is clean.'));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Stage 7 Failed: ${msg}`);
    process.exit(1);
  }
}

stage7();
