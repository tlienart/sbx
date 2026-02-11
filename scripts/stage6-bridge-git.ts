import fs from 'node:fs';
import chalk from 'chalk';
import { SbxBridge } from '../src/lib/bridge.ts';
import { runAsUser } from '../src/lib/exec.ts';
import { logger } from '../src/lib/logger.ts';
import { provisionSession } from '../src/lib/provision.ts';
import { getHostUser, getSessionUsername } from '../src/lib/user.ts';

async function stage6() {
  const hostUser = await getHostUser();
  const TEST_NAME = 'stage-test';

  // First try the standard stage-test user
  let username = await getSessionUsername(TEST_NAME);
  let instanceName = TEST_NAME;

  // Verify user exists, if not find an existing one
  const users = fs.readdirSync('/Users');
  if (!users.includes(username)) {
    const found = users.find((u) => u.startsWith(`sbx_${hostUser}_`));
    if (found) {
      username = found;
      const prefix = `sbx_${hostUser}_`;
      instanceName = username.substring(prefix.length);
    } else {
      logger.error(
        'No existing sandbox found for testing. Please create one first (e.g., make create name=test)',
      );
      process.exit(1);
    }
  }

  console.log(
    chalk.bold.cyan(`\n🛠️ Stage 6: Bridge Git Auth & Security Guarantee (using ${username})\n`),
  );

  const bridge = new SbxBridge(hostUser, username);

  try {
    logger.info('Starting bridge for testing...');
    await bridge.start();
    logger.success('Bridge started.');

    logger.info('Ensuring sandbox is provisioned with shims...');
    await provisionSession(instanceName);

    // Test Case 1: Successful Bridge Auth (Git & GH)
    logger.info('Testing git ls-remote via bridge...');
    const gitTest = await runAsUser(
      username,
      'zsh -l -c "git ls-remote https://github.com/google/googletest.git HEAD"',
    );
    if (gitTest.exitCode === 0 && gitTest.stdout.includes('HEAD')) {
      logger.success('Git ls-remote succeeded via bridge.');
    } else {
      throw new Error(`Git test failed: ${gitTest.stderr || gitTest.stdout}`);
    }

    logger.info('Testing gh auth status via bridge...');
    const ghTest = await runAsUser(username, 'zsh -l -c "gh auth status"');
    if (ghTest.exitCode === 0 && ghTest.stdout.includes('Logged in')) {
      logger.success('gh auth status succeeded via bridge.');
    } else {
      throw new Error(`GH auth test failed: ${ghTest.stderr || ghTest.stdout}`);
    }

    // Test Case 2: Blocked Subcommands (Security)
    const blockedCommands = [
      'git config --list',
      'git credential fill',
      'gh config get git_protocol',
      'gh auth logout',
    ];

    for (const cmd of blockedCommands) {
      logger.info(`Testing blocked command: ${cmd}`);
      try {
        const blocked = await runAsUser(username, `zsh -l -c "${cmd}"`);
        // If it succeeds, it's a failure (should have been blocked)
        throw new Error(
          `Security block FAILED for: ${cmd}. Command exited with code 0. Output: ${blocked.stdout}`,
        );
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('not allowed for security reasons')) {
          logger.success(`Security block confirmed for: ${cmd}`);
        } else {
          throw err;
        }
      }
    }

    // Test Case 3: Zero-Leak Guarantee
    logger.info('Verifying no secrets leaked to sandbox filesystem...');
    const homeFiles = await runAsUser(username, 'ls -la ~/');
    if (homeFiles.stdout.includes('.gitconfig')) {
      throw new Error('LEAK DETECTED: .gitconfig found in sandbox home!');
    }

    try {
      await runAsUser(username, 'ls -la ~/.gitconfig', { silent: true });
      throw new Error('LEAK DETECTED: .gitconfig accessible in sandbox home!');
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('No such file or directory')) {
        logger.success('Confirmed: .gitconfig is not in sandbox home.');
      } else {
        throw err;
      }
    }
    logger.success('No leaks detected in sandbox filesystem.');

    console.log(chalk.bold.green('\n✅ Stage 6 Passed: Git auth is functional and secure.'));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Stage 6 Failed: ${msg}`);
    process.exit(1);
  } finally {
    bridge.stop();
  }
}

stage6();
