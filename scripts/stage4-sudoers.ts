import chalk from 'chalk';
import { getOS } from '../src/lib/common/os/index.ts';
import { getIdentity } from '../src/lib/identity/index.ts';
import { logger } from '../src/lib/logger.ts';

async function stage4() {
  const TEST_NAME = 'stage-test';
  const identity = getIdentity();
  const username = await identity.users.getSessionUsername(TEST_NAME);
  const os = getOS();

  console.log(chalk.bold.cyan('\n🔑 Stage 4: Access Guarantee\n'));

  try {
    logger.info(`Setting up sudoers for ${username}...`);
    const hostUser = await identity.users.getHostUser();
    await identity.sudoers.setup(TEST_NAME, hostUser, username);

    const filePath = identity.sudoers.getFilePath(username);
    logger.info(`Verifying sudoers file at ${filePath}...`);

    if (os.fs.exists(filePath)) {
      logger.success('Sudoers fragment found.');
    } else {
      throw new Error(`Sudoers fragment NOT found at ${filePath}`);
    }

    logger.info('Validating sudoers syntax...');
    // Note: visudo -c usually requires root, but we've used sudo in setup
    await os.proc.run('sudo', ['visudo', '-c', '-f', filePath]);
    logger.success('Sudoers syntax is valid.');

    logger.info(`Testing no-password jump to ${username}...`);
    // Use the OS abstraction to run as user
    const whoami = await os.proc.run('su', ['-', username, '-c', 'whoami'], { sudo: true });

    if (whoami.stdout.trim() === username) {
      logger.success(`Successfully entered session as ${username} without password.`);
    } else {
      throw new Error(`Jump failed: Expected ${username}, got ${whoami.stdout.trim()}`);
    }

    console.log(chalk.bold.green('\n✅ Stage 4 Passed: No-password access is guaranteed.'));
  } catch (err: unknown) {
    logger.error(`Stage 4 Failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

stage4();
