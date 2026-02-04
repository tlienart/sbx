import chalk from 'chalk';
import { ensureSudo, run } from '../src/lib/exec.ts';
import { logger } from '../src/lib/logger.ts';

async function stage1() {
  console.log(chalk.bold.cyan('\n🛡️ Stage 1: Auth Guarantee\n'));

  try {
    logger.info('Verifying sudo access...');
    await ensureSudo();
    console.log(); // Ensure newline after potential password prompt
    logger.success('Sudo is cached and active.');

    logger.info('Checking sysadminctl availability...');
    const check = await run('which', ['sysadminctl']);
    logger.success(`sysadminctl found at: ${check.stdout.trim()}`);

    console.log(chalk.bold.green('\n✅ Stage 1 Passed: Authentication is ready.'));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Stage 1 Failed: ${msg}`);
    process.exit(1);
  }
}

stage1();
