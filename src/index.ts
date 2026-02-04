#!/usr/bin/env bun
import { Command } from 'commander';
import { cleanupCommand } from './commands/cleanup.ts';
import { createCommand } from './commands/create.ts';
import { deleteCommand } from './commands/delete.ts';
import { execCommand } from './commands/exec.ts';
import { listCommand } from './commands/list.ts';
import { serveCommand } from './commands/serve.ts';

const program = new Command();

program.name('sbx').description('Manage isolated macOS user sessions with Bun').version('1.0.0');

program
  .command('create')
  .description('Create one or more user sessions')
  .argument('<names...>', 'names of the instances')
  .option('-t, --tools <tools>', 'additional tools to install (comma separated)')
  .option('-p, --provider <provider>', 'LLM provider (google, openai, anthropic)', 'google')
  .option('-c, --concurrency <number>', 'number of parallel setups', '2')
  .action(createCommand);

program.command('list').description('List all active user sessions').action(listCommand);

program
  .command('cleanup')
  .description('Deep cleanup of all SBX processes and sockets')
  .action(cleanupCommand);

program
  .command('delete')
  .description('Delete one or more user sessions')
  .argument('<names...>', 'names of the instances')
  .option('-c, --concurrency <number>', 'number of parallel deletions', '4')
  .action(deleteCommand);

program
  .command('exec')
  .description('Run a command or open a shell in a session')
  .argument('<name>', 'name of the instance')
  .argument('[command...]', 'command to run')
  .action(execCommand);

program
  .command('serve')
  .description('Start the SBX API server')
  .option('-p, --port <number>', 'port to listen on', '3000')
  .action(serveCommand);

program.parse();
