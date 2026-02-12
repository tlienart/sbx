import chalk from 'chalk';
import { MultiBar, Presets } from 'cli-progress';
import pLimit from 'p-limit';
import { getOS } from '../lib/common/os/index.ts';
import { logger } from '../lib/logger.ts';
import { getSandboxManager } from '../lib/sandbox/index.ts';

export async function createCommand(
  instances: string[],
  options: { tools?: string; concurrency?: string; provider?: string },
) {
  if (instances.length === 0) {
    logger.error('Please specify at least one instance name.');
    process.exit(1);
  }

  const os = getOS();
  // Pre-flight sudo check
  await os.proc.ensureSudo();

  console.log(
    chalk.bold.cyan('💡 Pro Tip: ') +
      chalk.white('To avoid macOS permission popups, grant Ghostty ') +
      chalk.bold.yellow('"Full Disk Access"') +
      chalk.white(' in System Settings.\n'),
  );

  const concurrency = Number.parseInt(options.concurrency || '2', 10);
  const limit = pLimit(concurrency);

  console.log(
    chalk.bold(`🚀 Creating ${instances.length} session(s) (concurrency: ${concurrency})...`),
  );

  const multibar = new MultiBar(
    {
      clearOnComplete: false,
      hideCursor: true,
      format: '{bar} | {percentage}% | {instance} | {step}',
    },
    Presets.shades_grey,
  );

  const sandboxManager = getSandboxManager();

  const tasks = instances.map((instance) =>
    limit(async () => {
      const bar = multibar.create(100, 0, { instance, step: 'Initializing...' });

      try {
        bar.update(10, { step: 'Creating sandbox...' });
        await sandboxManager.createSandbox(instance, options.tools, options.provider);

        bar.update(100, { step: 'Finished!' });
      } catch (err: unknown) {
        bar.update(0, { step: chalk.red('Failed!') });
        multibar.stop();
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`Error creating instance "${instance}": ${msg}`);
        process.exit(1);
      }
    }),
  );

  await Promise.all(tasks);
  multibar.stop();
  console.log(chalk.bold.green('\n✅ All sessions created successfully.'));
}
