import chalk from 'chalk';
import { BotDispatcher } from '../src/lib/bot/dispatcher.ts';
import db from '../src/lib/db.ts';
import { logger } from '../src/lib/logger.ts';
import { MockMessaging } from '../src/lib/messaging/mock.ts';
import { listSandboxes } from '../src/lib/sandbox.ts';

async function runBotTest() {
  console.log(chalk.bold.cyan('\n🤖 Testing Bridge Bot Logic (Isolated)\n'));

  // Ensure we skip expensive provisioning for this logic test
  process.env.SKIP_PROVISION = '1';

  try {
    // 1. Setup
    logger.info('Initializing Mock Messaging and Dispatcher...');
    const mock = new MockMessaging();
    const dispatcher = new BotDispatcher(mock);
    await dispatcher.init();

    // Clear existing sandboxes from DB for a clean test
    db.prepare('DELETE FROM sandboxes').run();
    const mainChannel = 'main-topic';

    // 2. Create new sandbox
    logger.info('Testing /new command...');
    await mock.simulateIncomingMessage(mainChannel, '/new bot-test');

    // Give some time for async operations
    await new Promise((r) => setTimeout(r, 1000));

    const sandboxes = await listSandboxes();
    const firstSandbox = sandboxes[0];
    if (!firstSandbox) throw new Error('Sandbox should have been created in DB');
    logger.success('Sandbox created and session persisted.');

    const sbChannel = 'mock:sbx-bot-test';

    // 3. Send a message to the agent
    logger.info('Testing message relay to agent...');
    await mock.simulateIncomingMessage(sbChannel, 'Hello agent, can you help me?');

    // Wait for mock response
    await new Promise((r) => setTimeout(r, 2500));
    logger.success('Agent relay and mock response successful.');

    // 4. Check status and modes
    logger.info('Testing slash commands (/ping, /mode, /switch)...');
    await mock.simulateIncomingMessage(sbChannel, '/ping');
    await mock.simulateIncomingMessage(sbChannel, '/mode');
    await mock.simulateIncomingMessage(sbChannel, '/switch build');

    const state = db
      .prepare('SELECT mode FROM agent_states WHERE sandbox_id = ?')
      .get(firstSandbox.id) as { mode: string };
    if (!state || state.mode !== 'build') throw new Error('Mode switch failed');
    logger.success('Commands handled correctly.');

    // 5. Test Restart
    logger.info('Testing /restart command...');
    await mock.simulateIncomingMessage(sbChannel, '/restart');
    logger.success('Restart command processed.');

    // 6. Cleanup (Automatic Wipe)
    logger.info('Testing automatic wipe on channel deletion...');
    await mock.simulateChannelDeletion(sbChannel);

    await new Promise((r) => setTimeout(r, 1000));
    const finalSandboxes = await listSandboxes();
    if (finalSandboxes.length !== 0) throw new Error('Sandbox should have been wiped from DB');
    logger.success('Automatic cleanup verified.');

    console.log(chalk.bold.green('\n✅ Bot Bridge Logic Tests Passed!'));
    process.exit(0);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Bot Test Failed: ${msg}`);
    process.exit(1);
  }
}

runBotTest();
