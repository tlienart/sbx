import chalk from 'chalk';
import { runAsUser } from '../src/lib/exec.ts';
import { logger } from '../src/lib/logger.ts';
import { provisionSession } from '../src/lib/provision.ts';
import { getSessionUsername } from '../src/lib/user.ts';

async function stage5() {
  const TEST_NAME = 'stage-test';
  const username = await getSessionUsername(TEST_NAME);

  console.log(chalk.bold.cyan('\n🛠️ Stage 5: Toolchain Guarantee (pkgx)\n'));

  try {
    logger.info(`Provisioning pkgx toolchain for ${username}...`);
    // We pre-cache jq and gh for the test to ensure they work
    await provisionSession(TEST_NAME, 'jq,gh');
    logger.success('Toolchain provisioned successfully.');

    logger.info('Verifying pkgx and tools via login shell...');
    // We use a login shell to ensure profile files are sourced
    const verify = await runAsUser(
      username,
      'zsh -l -c "pkgx --version && jq --version && gh --version"',
    );

    logger.success(
      `Tools verified:\n${verify.stdout
        .trim()
        .split('\n')
        .filter((line) => line.length > 0)
        .slice(0, 5)
        .map((s) => `  ${s}`)
        .join('\n')}`,
    );

    console.log(
      chalk.bold.green('\n✅ Stage 5 Passed: pkgx toolchain is provisioned and functional.'),
    );
  } catch (err: any) {
    logger.error(`Stage 5 Failed: ${err.message}`);
    process.exit(1);
  }
}

stage5();
