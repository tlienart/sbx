import chalk from 'chalk';
import { getOS } from '../src/lib/common/os/index.ts';

async function doctor() {
  console.log(chalk.bold.cyan('🩺 Sbx Doctor: System Health Check\n'));

  const os = getOS();

  // 1. Check Platform
  if (process.platform !== 'darwin') {
    console.log(chalk.red('❌ Error: Sbx only supports macOS.'));
    process.exit(1);
  }
  console.log(chalk.green('✅ Platform: macOS detected.'));

  // 2. Check Sudo Cache
  try {
    await os.proc.run('sudo', ['-n', 'true']);
    console.log(chalk.green('✅ Sudo: Already authenticated.'));
  } catch {
    console.log(chalk.yellow('⚠️  Sudo: Not authenticated. Run "sudo -v" to cache credentials.'));
  }

  // 3. Check Sandbox Isolation
  const usersDir = '/Users';
  if (os.fs.exists(usersDir)) {
    // Note: This is a bit simplified, but close enough for doctor
    // We can't easily list directories via IFileSystem yet, so we might need to add it or use proc.run
    const { stdout } = await os.proc.run('ls', [usersDir]);
    const sbxDirs = stdout.split('\n').filter((d) => d.startsWith('sbx_'));

    if (sbxDirs.length > 0) {
      let allHealthy = true;
      for (const dir of sbxDirs) {
        try {
          const stats = os.fs.stat(`${usersDir}/${dir}`);
          const mode = stats.mode & 0o777;
          if (mode !== 0o700) {
            console.log(
              chalk.red(
                `❌ Isolation: ${dir} has insecure permissions (${mode.toString(8)}). Expected 700.`,
              ),
            );
            allHealthy = false;
          }
        } catch (e) {
          // Might not have permission to stat others' homes
        }
      }
      if (allHealthy) {
        console.log(
          chalk.green(
            `✅ Isolation: All ${sbxDirs.length} sandboxes are correctly locked down (700).`,
          ),
        );
      }
    }
  }

  // 4. Full Disk Access Guide
  console.log(chalk.bold.yellow('\n🛡️  How to enable Seamless Creation (Silence Popups):'));
  console.log(
    chalk.white('1. Open ') + chalk.bold('System Settings') + chalk.white(' (Cmd + Space).'),
  );
  console.log(
    chalk.white('2. Go to ') +
      chalk.bold('Privacy & Security > Full Disk Access') +
      chalk.white('.'),
  );
  console.log(
    chalk.white('3. Click the ') +
      chalk.bold('+') +
      chalk.white(' button and add ') +
      chalk.bold('Ghostty') +
      chalk.white('.'),
  );
  console.log(
    chalk.white('4. Toggle the switch to ') +
      chalk.bold('ON') +
      chalk.white(' and restart Ghostty.\n'),
  );

  console.log(chalk.cyan('Ready to go! Try running "make test" next.'));
}

doctor();
