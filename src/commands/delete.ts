import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { MultiBar, Presets } from 'cli-progress';
import pLimit from 'p-limit';
import { ensureSudo } from '../lib/exec.ts';
import { logger } from '../lib/logger.ts';
import { sudoers } from '../lib/sudo.ts';
import { deleteSessionUser, getSandboxPort } from '../lib/user.ts';

export async function deleteCommand(instances: string[], options: { concurrency?: string }) {
  if (instances.length === 0) {
    logger.error('Please specify at least one instance name.');
    process.exit(1);
  }

  // Pre-flight sudo check
  await ensureSudo();

  const concurrency = Number.parseInt(options.concurrency || '4', 10);
  const limit = pLimit(concurrency);

  console.log(chalk.bold(`🗑️ Deleting ${instances.length} session(s)...`));

  const multibar = new MultiBar(
    {
      clearOnComplete: false,
      hideCursor: true,
      format: '{bar} | {percentage}% | {instance} | {step}',
    },
    Presets.shades_grey,
  );

  const tasks = instances.map((instance) =>
    limit(async () => {
      const bar = multibar.create(100, 0, { instance, step: 'Deleting...' });

      try {
        bar.update(10, { step: 'Stopping bridge...' });
        const port = getSandboxPort(instance);
        try {
          execSync(`sudo lsof -ti:${port} | xargs sudo kill -9 || true`);
        } catch {
          /* ignore */
        }

        bar.update(30, { step: 'Removing sudoers...' });
        await sudoers.remove(instance);

        bar.update(60, { step: 'Deleting user...' });
        await deleteSessionUser(instance);

        bar.update(100, { step: 'Done' });
      } catch (err: any) {
        bar.update(0, { step: chalk.red('Failed!') });
        multibar.stop();
        logger.error(`Error deleting instance "${instance}": ${err.message}`);
      }
    }),
  );

  await Promise.all(tasks);
  multibar.stop();
  console.log(chalk.bold.green('\n✅ Sessions deleted.'));
}
