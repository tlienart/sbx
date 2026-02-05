import {
  type AgentMode,
  getAgentState,
  interruptAgent,
  resetAgentSession,
  startAgent,
  updateAgentState,
} from '../agents.ts';
import db, { sessionRepo } from '../db.ts';
import { extractSummary, splitMessage } from '../formatting.ts';
import type { IncomingMessage, MessagingPlatform } from '../messaging/types.ts';
import { createSandbox, removeSandbox } from '../sandbox.ts';

export class BotDispatcher {
  private platform: MessagingPlatform;

  constructor(platform: MessagingPlatform) {
    this.platform = platform;
  }

  async init() {
    this.platform.onMessage(async (msg) => this.handleMessage(msg));
    this.platform.onChannelDeleted(async (channelId) => this.handleChannelDeleted(channelId));
    await this.platform.connect();
    console.log(`Bot Dispatcher initialized for platform: ${this.platform.name}`);

    await this.recoverSessions();
  }

  private async recoverSessions() {
    console.log('Recovering sessions...');
    const activeSandboxes = db.prepare("SELECT * FROM sandboxes WHERE status = 'active'").all() as {
      id: string;
      name: string | null;
    }[];
    console.log(`Found ${activeSandboxes.length} active sandboxes in database.`);
    for (const sb of activeSandboxes) {
      const sessions = sessionRepo.findBySandboxId(sb.id);
      console.log(`- Sandbox ${sb.id} (${sb.name || 'unnamed'}) has ${sessions.length} sessions.`);
    }
  }

  private async handleMessage(msg: IncomingMessage) {
    const content = msg.content?.trim();
    if (!content) return;

    if (content.startsWith('/')) {
      await this.handleCommand(msg);
      return;
    }

    // Regular message - relay to sandbox agent
    const sandboxId = sessionRepo.getSandboxId(msg.platform, msg.channelId);
    if (!sandboxId) {
      // Not in a sandbox channel, ignore or notify
      return;
    }

    await this.relayToAgent(sandboxId, msg);
  }

  private async handleCommand(msg: IncomingMessage) {
    const parts = msg.content?.split(' ') || [];
    const command = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    switch (command) {
      case '/new':
        await this.cmdNew(msg, args);
        break;
      case '/ping':
        await this.cmdPing(msg);
        break;
      case '/mode':
        await this.cmdMode(msg);
        break;
      case '/switch':
        await this.cmdSwitch(msg, args);
        break;
      case '/interrupt':
        await this.cmdInterrupt(msg);
        break;
      case '/restart':
        await this.cmdRestart(msg);
        break;
      default:
        await this.platform.sendMessage(msg.channelId, `Unknown command: ${command}`);
    }
  }

  private async cmdNew(msg: IncomingMessage, args: string[]) {
    const title = args.join('-') || 'default';
    await this.platform.sendMessage(msg.channelId, `🚀 Creating new sandbox: **${title}**...`);

    try {
      const sandbox = await createSandbox(title);
      const newChannelId = await this.platform.createChannel(title);

      sessionRepo.saveSession(msg.platform, newChannelId, sandbox.id);
      await startAgent(sandbox.id, 'plan');

      await this.platform.sendMessage(
        msg.channelId,
        `✅ Sandbox created! Join topic: **${newChannelId.split(':')[1]}**`,
      );
      await this.platform.sendMessage(
        newChannelId,
        `Welcome! I'm ready in sandbox \`${sandbox.id}\`. Mode: **plan**.`,
      );
    } catch (error) {
      await this.platform.sendMessage(
        msg.channelId,
        `❌ Error creating sandbox: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async cmdPing(msg: IncomingMessage) {
    const sandboxId = sessionRepo.getSandboxId(msg.platform, msg.channelId);
    if (!sandboxId) {
      await this.platform.sendMessage(msg.channelId, '🏓 Pong! (Not in a sandbox channel)');
      return;
    }

    const state = getAgentState(sandboxId);
    const emoji = state?.status === 'thinking' || state?.status === 'writing' ? '⚙️' : '✅';
    const statusMsg = state ? `Status: ${state.status}, Mode: ${state.mode}` : 'Agent not started';

    await this.platform.sendMessage(msg.channelId, `${emoji} Pong! ${statusMsg}`);
  }

  private async cmdMode(msg: IncomingMessage) {
    const sandboxId = sessionRepo.getSandboxId(msg.platform, msg.channelId);
    if (!sandboxId) return;

    const state = getAgentState(sandboxId);
    const modes: AgentMode[] = ['plan', 'build', 'research'];
    const modeList = modes
      .map((m, i) => `${i + 1}. ${m === state?.mode ? `**${m}**` : m}`)
      .join('\n');

    await this.platform.sendMessage(msg.channelId, `Current modes:\n${modeList}`);
  }

  private async cmdSwitch(msg: IncomingMessage, args: string[]) {
    const sandboxId = sessionRepo.getSandboxId(msg.platform, msg.channelId);
    if (!sandboxId) return;

    const modeInput = args[0]?.toLowerCase();
    let targetMode: AgentMode | undefined;

    if (modeInput === '1' || modeInput === 'plan') targetMode = 'plan';
    else if (modeInput === '2' || modeInput === 'build') targetMode = 'build';
    else if (modeInput === '3' || modeInput === 'research') targetMode = 'research';

    if (targetMode) {
      updateAgentState(sandboxId, { mode: targetMode });
      await this.platform.sendMessage(msg.channelId, `🔄 Switched to mode: **${targetMode}**`);
    } else {
      await this.platform.sendMessage(
        msg.channelId,
        '❌ Invalid mode. Use 1 (plan), 2 (build), or 3 (research).',
      );
    }
  }

  private async cmdInterrupt(msg: IncomingMessage) {
    const sandboxId = sessionRepo.getSandboxId(msg.platform, msg.channelId);
    if (!sandboxId) return;

    await this.platform.sendMessage(msg.channelId, '🛑 Interrupting current task...');
    await interruptAgent(sandboxId);
    await this.platform.sendMessage(msg.channelId, '✅ Agent interrupted and idle.');
  }

  private async cmdRestart(msg: IncomingMessage) {
    const sandboxId = sessionRepo.getSandboxId(msg.platform, msg.channelId);
    if (!sandboxId) return;

    await this.platform.sendMessage(msg.channelId, '♻️ Restarting session (clearing context)...');
    await resetAgentSession(sandboxId);
    await this.platform.sendMessage(
      msg.channelId,
      '✅ Session reset. Files are preserved but history is cleared.',
    );
  }

  private async relayToAgent(sandboxId: string, msg: IncomingMessage) {
    updateAgentState(sandboxId, { status: 'thinking' });

    console.log(`Relaying message to sandbox ${sandboxId}: ${msg.content}`);

    // Simulate long output
    setTimeout(async () => {
      const mockResponse = `## Summary\nI've processed your request: "${msg.content}".\nThis is a mock response from the agent.\n\n${'Detail '.repeat(5)}`;

      const summary = extractSummary(mockResponse);
      const chunks = splitMessage(summary);

      for (const chunk of chunks) {
        await this.platform.sendMessage(msg.channelId, chunk);
      }

      updateAgentState(sandboxId, { status: 'idle' });
    }, 2000);
  }

  private async handleChannelDeleted(channelId: string) {
    const sandboxId = sessionRepo.getSandboxId(this.platform.name, channelId);
    if (sandboxId) {
      console.log(`Channel ${channelId} deleted. Wiping sandbox ${sandboxId}...`);
      await removeSandbox(sandboxId);
      sessionRepo.deleteSession(this.platform.name, channelId);
    }
  }
}
