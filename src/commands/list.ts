import chalk from 'chalk';
import { getIdentity } from '../lib/identity/index.ts';
import { logger } from '../lib/logger.ts';

export async function listCommand() {
  try {
    const identity = getIdentity();
    const sessions = await identity.users.listUsers();

    if (sessions.length === 0) {
      console.log(chalk.yellow('No active sbx sessions found.'));
      return;
    }

    console.log(chalk.bold(`📋 Active Sessions (${sessions.length}):`));
    console.log(chalk.gray('----------------------------------------'));

    for (const session of sessions) {
      const active = await identity.users.isUserActive(session.username);
      const status = active ? chalk.green('● active') : chalk.red('○ inactive');
      console.log(
        `${chalk.cyan(session.instanceName.padEnd(20))} ${status} ${chalk.gray(`(${session.username})`)}`,
      );
    }

    console.log(chalk.gray('----------------------------------------'));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Error listing sessions: ${msg}`);
    process.exit(1);
  }
}
