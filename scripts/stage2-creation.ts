import chalk from 'chalk';
import { getIdentity } from '../src/lib/identity/index.ts';
import { logger } from '../src/lib/logger.ts';

async function stage2() {
  const TEST_NAME = 'stage-test';
  const identity = getIdentity();
  const username = await identity.users.getSessionUsername(TEST_NAME);

  console.log(chalk.bold.cyan('\n👤 Stage 2: Record Guarantee\n'));

  try {
    logger.info(`Attempting to create user: ${username}...`);

    // We run the creation logic
    await identity.setupSessionUser(TEST_NAME);

    logger.info('Verifying record in Directory Service (dscl)...');
    const exists = await identity.users.userExists(username);

    if (exists) {
      logger.success(`Directory Service record found for ${username}.`);
    } else {
      throw new Error(
        `User creation reported success but record not found in dscl for ${username}.`,
      );
    }

    console.log(chalk.bold.green('\n✅ Stage 2 Passed: User record created and verified.'));
  } catch (err: unknown) {
    logger.error(`Stage 2 Failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

stage2();
