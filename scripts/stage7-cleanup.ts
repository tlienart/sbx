import chalk from 'chalk';
import { getIdentity } from '../src/lib/identity/index.ts';
import { logger } from '../src/lib/logger.ts';

async function stage7() {
  const TEST_NAME = 'stage-test';
  const identity = getIdentity();

  console.log(chalk.bold.cyan('\n🧹 Stage 7: Cleanup Guarantee\n'));

  try {
    logger.info(`Deleting test instance: ${TEST_NAME}...`);

    await identity.cleanupSessionUser(TEST_NAME);

    logger.success('Test instance deleted successfully.');
    console.log(chalk.bold.green('\n✅ Stage 7 Passed: System is clean.'));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Stage 7 Failed: ${msg}`);
    process.exit(1);
  }
}

stage7();
