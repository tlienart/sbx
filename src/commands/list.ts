import chalk from 'chalk';
import { getIdentity } from '../lib/identity/index.ts';
import { logger } from '../lib/logger.ts';
import { getSandboxManager } from '../lib/sandbox/index.ts';

export async function listCommand() {
  try {
    const identity = getIdentity();
    const sandboxManager = getSandboxManager();
    const sandboxes = await sandboxManager.listSandboxes();

    if (sandboxes.length === 0) {
      console.log(chalk.yellow('No active sbx sessions found.'));
      return;
    }

    console.log(chalk.bold(`📋 Active Sessions (${sandboxes.length}):`));
    console.log(
      chalk.gray(
        '--------------------------------------------------------------------------------',
      ),
    );
    console.log(
      `${chalk.bold('NAME'.padEnd(20))} ${chalk.bold('ID'.padEnd(10))} ${chalk.bold('STATUS'.padEnd(12))} ${chalk.bold('USER')}`,
    );
    console.log(
      chalk.gray(
        '--------------------------------------------------------------------------------',
      ),
    );

    for (const sb of sandboxes) {
      const instanceName = sb.id.split('-')[0] as string;
      const username = await identity.users.getSessionUsername(instanceName);
      const active = await identity.users.isUserActive(username);
      const status = active ? chalk.green('● active') : chalk.red('○ inactive');
      const name = (sb.name || 'unnamed').padEnd(20);
      const shortId = sb.id.split('-')[0]?.padEnd(10);

      console.log(
        `${chalk.cyan(name)} ${shortId} ${status.padEnd(12 + 10)} ${chalk.gray(`(${username})`)}`,
      );
    }

    console.log(
      chalk.gray(
        '--------------------------------------------------------------------------------',
      ),
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Error listing sessions: ${msg}`);
    process.exit(1);
  }
}
