import chalk from 'chalk';
import { getOS } from '../src/lib/common/os/index.ts';
import { getIdentity } from '../src/lib/identity/index.ts';
import { logger } from '../src/lib/logger.ts';
import { Provisioner } from '../src/lib/provision/index.ts';

async function stage5() {
  const TEST_NAME = 'stage-test';
  const identity = getIdentity();
  const username = await identity.users.getSessionUsername(TEST_NAME);
  const os = getOS();
  const provisioner = new Provisioner(identity.users);

  console.log(chalk.bold.cyan('\n🛠️ Stage 5: Toolchain Guarantee (pkgx)\n'));

  try {
    logger.info(`Provisioning pkgx toolchain for ${username}...`);
    // We pre-cache standard tools for the test to ensure they work
    await provisioner.provisionSession(TEST_NAME, 'jq,gh,uv,bun');
    logger.success('Toolchain provisioned successfully.');

    logger.info('Verifying pkgx and tools via login shell...');
    // We use a login shell to ensure profile files are sourced
    const verify = await os.proc.run(
      'su',
      [
        '-',
        username,
        '-c',
        'zsh -l -c "pkgx --version && pkgx jq --version && pkgx gh --version && pkgx uv --version && pkgx bun --version"',
      ],
      { sudo: true },
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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Stage 5 Failed: ${msg}`);
    process.exit(1);
  }
}

stage5();
