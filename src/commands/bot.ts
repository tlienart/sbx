import { BotDispatcher } from '../lib/bot/dispatcher.ts';
import { BridgeBox } from '../lib/bridge/index.ts';
import { getOS } from '../lib/common/os/index.ts';
import { getIdentity } from '../lib/identity/index.ts';
import { logger } from '../lib/logger.ts';
import { ZulipMessaging } from '../lib/messaging/zulip.ts';
import 'dotenv/config';

export async function botCommand() {
  const site = process.env.SBX_ZULIP_SITE;
  const username = process.env.SBX_ZULIP_USERNAME;
  const apiKey = process.env.SBX_ZULIP_API_KEY;
  const defaultStream = process.env.SBX_ZULIP_DEFAULT_STREAM || 'general';
  const provider = process.env.SBX_PROVIDER || 'google';

  if (!site || !username || !apiKey) {
    logger.error(
      'Missing Zulip configuration. Please set SBX_ZULIP_SITE, SBX_ZULIP_USERNAME, and SBX_ZULIP_API_KEY.',
    );
    process.exit(1);
  }

  logger.info('Starting SBX Bot...');

  try {
    const os = getOS();
    // Proactively ask for sudo password
    await os.proc.ensureSudo();
    logger.success('Sudo authentication verified.');

    const identity = getIdentity();
    const hostUser = await identity.users.getHostUser();
    const bridge = new BridgeBox(hostUser);

    await bridge.start();

    logger.success('Host bridge started.');

    const zulip = new ZulipMessaging({
      site,
      username,
      apiKey,
      defaultStream,
    });

    const dispatcher = new BotDispatcher(zulip, bridge, provider);
    await dispatcher.init();

    logger.success('SBX Bot is running and connected to Zulip.');

    const cleanup = () => {
      logger.info('Shutting down bot and bridge...');
      bridge.stop();
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to start bot: ${msg}`);
    process.exit(1);
  }
}
