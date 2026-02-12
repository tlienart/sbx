import { type AgentMode, getAgentManager } from '../agents/index.ts';
import type { BridgeBox } from '../bridge/index.ts';
import { getOS } from '../common/os/index.ts';
import { getSandboxPort } from '../common/utils/port.ts';
import { splitMessage } from '../formatting.ts';
import { getIdentity } from '../identity/index.ts';
import type { IncomingMessage, MessagingPlatform } from '../messaging/types.ts';
import { getPersistence } from '../persistence/index.ts';
import { Provisioner } from '../provision/index.ts';
import { getSandboxManager } from '../sandbox/index.ts';

export class BotDispatcher {
  private platform: MessagingPlatform;
  private bridge: BridgeBox;
  private provider: string;
  private os = getOS();

  constructor(platform: MessagingPlatform, bridge: BridgeBox, provider = 'google') {
    this.platform = platform;
    this.bridge = bridge;
    this.provider = provider;
  }

  async init() {
    this.platform.onMessage(async (msg) => this.handleMessage(msg));
    this.platform.onChannelDeleted(async (channelId) => this.handleChannelDeleted(channelId));
    await this.platform.connect();
    console.log(`Bot Dispatcher initialized for platform: ${this.platform.name}`);

    await this.recoverSessions();
    await this.reconcileSessions();

    // Periodic reconciliation every 30 minutes
    setInterval(() => this.reconcileSessions(), 30 * 60 * 1000);
  }

  private async reconcileSessions() {
    console.log('[Bot] Reconciling sessions with platform channels...');
    try {
      const activeChannels = await this.platform.listChannels();
      const channelSet = new Set(activeChannels);

      const persistence = getPersistence();
      const activeSandboxes = persistence.sandboxes.findActive();
      const sandboxManager = getSandboxManager();

      for (const sb of activeSandboxes) {
        const sessions = persistence.sessions.findBySandboxId(sb.id);
        const platformSessions = sessions.filter((s) => s.platform === this.platform.name);

        for (const session of platformSessions) {
          if (!channelSet.has(session.external_id)) {
            console.log(
              `[Bot] Channel ${session.external_id} no longer exists. Self-destructing sandbox ${sb.id}...`,
            );
            await sandboxManager.removeSandbox(sb.id);
            persistence.sessions.deleteSession(this.platform.name, session.external_id);
          }
        }
      }
      console.log('[Bot] Reconciliation complete.');
    } catch (err) {
      console.error(`[Bot] Reconciliation failed: ${err}`);
    }
  }

  private async recoverSessions() {
    console.log('Recovering sessions...');
    const persistence = getPersistence();
    const activeSandboxes = persistence.sandboxes.findActive();
    console.log(`Found ${activeSandboxes.length} active sandboxes in database.`);
    for (const sb of activeSandboxes) {
      const sessions = persistence.sessions.findBySandboxId(sb.id);
      console.log(`- Sandbox ${sb.id} (${sb.name || 'unnamed'}) has ${sessions.length} sessions.`);
    }
  }

  private async handleMessage(msg: IncomingMessage) {
    const content = msg.content?.trim();
    console.log(
      `[Bot] Received message from ${msg.userName} (${msg.userId}) in ${msg.channelId}: "${content}"`,
    );

    if (!content) return;

    if (content.startsWith('/')) {
      await this.handleCommand(msg);
      return;
    }

    // Regular message - relay to sandbox agent
    const persistence = getPersistence();
    let sandboxId = persistence.sessions.getSandboxId(msg.platform, msg.channelId);
    if (!sandboxId) {
      // Not in a sandbox channel, ignore or notify
      return;
    }

    const sandboxManager = getSandboxManager();
    const agentManager = getAgentManager();
    const identity = getIdentity();

    // Check if sandbox is still alive
    if (!(await sandboxManager.isSandboxAlive(sandboxId))) {
      await this.platform.sendMessage(
        msg.channelId,
        '⚠️ This sandbox was wiped from the host. Recreating a fresh one...',
      );

      // Clean up stale sandbox (if any DB record remains)
      await sandboxManager.removeSandbox(sandboxId);

      // Recreate using the topic name as title if possible
      const topicName = msg.channelId.split(':')[1] || 'recovered';
      const newSandbox = await sandboxManager.createSandbox(topicName);
      sandboxId = newSandbox.id;

      // Map existing channel to new sandbox
      persistence.sessions.saveSession(msg.platform, msg.channelId, sandboxId);

      // Provision toolchain and bridge (matching cmdNew logic)
      const instanceName = sandboxId.split('-')[0] as string;
      const username = await identity.users.getSessionUsername(instanceName);
      const apiPort = getSandboxPort(instanceName);

      await agentManager.startAgent(sandboxId, 'plan');
      await this.bridge.attachToSandbox(username, apiPort);

      await this.platform.sendMessage(
        msg.channelId,
        `✅ Sandbox recovered (ID: \`${sandboxId}\`). Mode: **plan**.`,
      );
    }

    await this.relayToAgent(sandboxId, msg);
  }

  private async handleCommand(msg: IncomingMessage) {
    const parts = msg.content?.split(' ') || [];
    const command = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    if (msg.messageId) {
      await this.platform.addReaction(msg.channelId, msg.messageId, 'working');
    }

    switch (command) {
      case '/new':
        await this.cmdNew(msg, args);
        break;
      case '/status':
        await this.cmdStatus(msg);
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

    // Immediate acknowledgment
    await this.platform.sendMessage(msg.channelId, `🚀 Creating new sandbox: **${title}**...`);

    try {
      const sandboxManager = getSandboxManager();
      const agentManager = getAgentManager();
      const persistence = getPersistence();
      const identity = getIdentity();

      // Step 1: Identity & Toolchain
      await this.platform.sendMessage(msg.channelId, '👤 Creating sandbox identity...');
      const sandbox = await sandboxManager.createSandbox(title);
      const instanceName = sandbox.id.split('-')[0] as string;
      const username = await identity.users.getSessionUsername(instanceName);

      // Step 2: Channel/Topic
      const newChannelId = await this.platform.createChannel(title);
      persistence.sessions.saveSession(msg.platform, newChannelId, sandbox.id);

      // Step 3: Toolchain
      await this.platform.sendMessage(
        msg.channelId,
        '📦 Provisioning toolchain (python, opencode)...',
      );
      await agentManager.startAgent(sandbox.id, 'plan');

      // Step 4: Bridge
      await this.platform.sendMessage(msg.channelId, '🔌 Attaching API bridge sidecar...');
      const apiPort = getSandboxPort(instanceName);
      await this.bridge.attachToSandbox(username, apiPort);

      await this.platform.sendMessage(
        msg.channelId,
        `✅ Sandbox created! Join topic: **${newChannelId.split(':')[1]}**`,
      );
      await this.platform.sendMessage(
        newChannelId,
        `Welcome! I'm ready in sandbox \`${sandbox.id}\`. Mode: **plan**.`,
      );
    } catch (error) {
      console.error(`Error creating sandbox: ${error}`);
      await this.platform.sendMessage(
        msg.channelId,
        `❌ Error creating sandbox: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async cmdStatus(msg: IncomingMessage) {
    const persistence = getPersistence();
    const sandboxId = persistence.sessions.getSandboxId(msg.platform, msg.channelId);
    if (!sandboxId) {
      await this.platform.sendMessage(
        msg.channelId,
        '✅ SBX Bot is operational. (Not in a sandbox channel)',
      );
      return;
    }

    const sandboxManager = getSandboxManager();
    const agentManager = getAgentManager();

    if (!(await sandboxManager.isSandboxAlive(sandboxId))) {
      await this.platform.sendMessage(
        msg.channelId,
        '⚠️ This sandbox is unavailable (missing from host). Send any message to recover it.',
      );
      return;
    }

    const state = agentManager.getAgentState(sandboxId);
    const emoji = state?.status === 'thinking' || state?.status === 'writing' ? '⚙️' : '✅';
    const statusMsg = state ? `Status: ${state.status}, Mode: ${state.mode}` : 'Agent not started';

    await this.platform.sendMessage(msg.channelId, `${emoji} Status: ${statusMsg}`);
  }

  private async cmdMode(msg: IncomingMessage) {
    const persistence = getPersistence();
    const sandboxId = persistence.sessions.getSandboxId(msg.platform, msg.channelId);
    if (!sandboxId) return;

    const agentManager = getAgentManager();
    const state = agentManager.getAgentState(sandboxId);
    const modes: AgentMode[] = ['plan', 'build', 'research'];
    const modeList = modes
      .map((m, i) => `${i + 1}. ${m === state?.mode ? `**${m}**` : m}`)
      .join('\n');

    await this.platform.sendMessage(msg.channelId, `Current modes:\n${modeList}`);
  }

  private async cmdSwitch(msg: IncomingMessage, args: string[]) {
    const persistence = getPersistence();
    const sandboxId = persistence.sessions.getSandboxId(msg.platform, msg.channelId);
    if (!sandboxId) return;

    const modeInput = args[0]?.toLowerCase();
    let targetMode: AgentMode | undefined;

    if (modeInput === '1' || modeInput === 'plan') targetMode = 'plan';
    else if (modeInput === '2' || modeInput === 'build') targetMode = 'build';
    else if (modeInput === '3' || modeInput === 'research') targetMode = 'research';

    if (targetMode) {
      const agentManager = getAgentManager();
      agentManager.updateAgentState(sandboxId, { mode: targetMode });
      await this.platform.sendMessage(msg.channelId, `🔄 Switched to mode: **${targetMode}**`);

      // Auto-trigger the agent with an "ok" message to start working in the new mode
      const syntheticMsg: IncomingMessage = {
        ...msg,
        content: 'ok',
        // Preserve original message ID so reactions work if needed,
        // though we've already reacted to the /switch command.
      };
      await this.relayToAgent(sandboxId, syntheticMsg);
    } else {
      await this.platform.sendMessage(
        msg.channelId,
        '❌ Invalid mode. Use 1 (plan), 2 (build), or 3 (research).',
      );
    }
  }

  private async cmdInterrupt(msg: IncomingMessage) {
    const persistence = getPersistence();
    const sandboxId = persistence.sessions.getSandboxId(msg.platform, msg.channelId);
    if (!sandboxId) return;

    await this.platform.sendMessage(msg.channelId, '🛑 Interrupting current task...');
    const agentManager = getAgentManager();
    await agentManager.interruptAgent(sandboxId);

    // Also kill sandbox processes
    try {
      const instanceName = sandboxId.split('-')[0] as string;
      const identity = getIdentity();
      const username = await identity.users.getSessionUsername(instanceName);
      await this.os.proc.sudo('pkill', ['-9', '-u', username, '-v', '-f', 'api_bridge.py']);
    } catch {
      // ignore
    }

    await this.platform.sendMessage(msg.channelId, '✅ Agent interrupted and idle.');
  }

  private async cmdRestart(msg: IncomingMessage) {
    const persistence = getPersistence();
    const sandboxId = persistence.sessions.getSandboxId(msg.platform, msg.channelId);
    if (!sandboxId) return;

    await this.platform.sendMessage(msg.channelId, '♻️ Restarting session (clearing context)...');
    const agentManager = getAgentManager();
    await agentManager.resetAgentSession(sandboxId);
    await this.platform.sendMessage(
      msg.channelId,
      '✅ Session reset. Files are preserved but history is cleared.',
    );
  }

  private async relayToAgent(sandboxId: string, msg: IncomingMessage) {
    const agentManager = getAgentManager();
    agentManager.updateAgentState(sandboxId, { status: 'thinking' });

    if (msg.messageId) {
      await this.platform.addReaction(msg.channelId, msg.messageId, 'thought');
    }

    const state = agentManager.getAgentState(sandboxId);
    const mode = state?.mode || 'plan';

    // Explicit acknowledgment in the topic
    await this.platform.sendMessage(msg.channelId, `⚙️ Thinking [${mode}]...`);

    console.log(`Relaying message to sandbox ${sandboxId}: ${msg.content}`);

    const instanceName = sandboxId.split('-')[0] as string;
    const identity = getIdentity();
    const username = await identity.users.getSessionUsername(instanceName);

    let heartbeatInterval: ReturnType<typeof setInterval> | undefined;

    // Ensure bridge is attached before executing
    try {
      const apiPort = getSandboxPort(instanceName);

      // Health check: sockets and port
      const socketPaths = this.bridge.getSocketPaths();
      const socketsExist =
        this.os.fs.exists(socketPaths.command) && this.os.fs.exists(socketPaths.proxy);

      let portOpen = false;
      try {
        const check = await this.os.proc.runAsUser(username, `nc -z 127.0.0.1 ${apiPort}`, {
          timeoutMs: 2000,
        });
        portOpen = check.exitCode === 0;
      } catch {
        portOpen = false;
      }

      if (!socketsExist || !portOpen) {
        console.log(
          `[Bot] Bridge unhealthy for ${username} (sockets: ${socketsExist}, port: ${portOpen}). Restarting...`,
        );
        // Force correct opencode config for this sandbox/port
        const provisioner = new Provisioner(identity.users);
        await provisioner.deployOpenCodeConfig(username, this.provider, apiPort);
        await this.bridge.attachToSandbox(username, apiPort);
      }
    } catch (err) {
      console.warn(`[Bot] Failed to ensure bridge for ${username}: ${err}`);
    }

    try {
      // Use < /dev/null to prevent hanging on stdin
      let command = `opencode run --agent ${mode} --format json ${JSON.stringify(msg.content)} < /dev/null`;

      if (state?.opencodeSessionId) {
        command = `opencode run --agent ${mode} --session ${state.opencodeSessionId} --format json ${JSON.stringify(msg.content)} < /dev/null`;
      }

      console.log(`[Bot] Executing in sandbox: ${command}`);
      const startTime = Date.now();

      let finalOutput = '';
      let newSessionId = '';
      let lineBuffer = '';
      let lastOutputTime = Date.now();

      heartbeatInterval = setInterval(async () => {
        if (Date.now() - lastOutputTime > 60000) {
          await this.platform.sendMessage(msg.channelId, '⏳ Still working on your request...');
          lastOutputTime = Date.now(); // Reset to avoid spam
        }
      }, 60000);

      const processLine = async (line: string) => {
        if (!line.trim()) return;
        lastOutputTime = Date.now();
        try {
          const json = JSON.parse(line);
          if (json.sessionID) {
            newSessionId = json.sessionID;
            agentManager.updateAgentState(sandboxId, { opencodeSessionId: newSessionId });
          }
          if (json.type === 'text' && json.part?.text) {
            const text = json.part.text;
            finalOutput += text;
            const chunks = splitMessage(text);
            for (const chunk of chunks) {
              await this.platform.sendMessage(msg.channelId, chunk);
            }
          }
          if (json.type === 'tool_use' || json.type === 'call') {
            const toolName = json.name || json.tool;
            if (toolName) {
              await this.platform.sendMessage(
                msg.channelId,
                `🔧 Agent is using tool: \`${toolName}\`...`,
              );
            }
          }
        } catch {
          // Ignore non-json lines
        }
      };

      const result = await this.os.proc.runAsUser(username, command, {
        env: {
          BRIDGE_SOCK: this.bridge.getSocketPaths().command,
          PROXY_SOCK: this.bridge.getSocketPaths().proxy,
        },
        timeoutMs: 900000, // Increased to 15 minutes
        onStdout: (data: string) => {
          lineBuffer += data;
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() || '';
          for (const line of lines) {
            processLine(line);
          }
        },
      });

      clearInterval(heartbeatInterval);

      // Process any remaining buffer
      if (lineBuffer) {
        await processLine(lineBuffer);
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[Bot] Command finished in ${duration}s (exit: ${result.exitCode})`);

      if (!finalOutput && result.stdout && !result.stdout.trim().startsWith('{')) {
        finalOutput = result.stdout;
        const chunks = splitMessage(finalOutput);
        for (const chunk of chunks) {
          await this.platform.sendMessage(msg.channelId, chunk);
        }
      }

      if (result.exitCode !== 0 && result.stderr) {
        await this.platform.sendMessage(
          msg.channelId,
          `❌ Error (exit ${result.exitCode}): ${result.stderr.substring(0, 500)}`,
        );
      }
    } catch (error) {
      if (heartbeatInterval) clearInterval(heartbeatInterval);

      console.error(`Error relaying to agent: ${error}`);

      await this.platform.sendMessage(
        msg.channelId,
        `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
      );

      // Robust cleanup on error/timeout: kill all processes of the sandbox user
      try {
        const instanceName = sandboxId.split('-')[0] as string;
        const username = await identity.users.getSessionUsername(instanceName);
        console.log(`[Bot] Cleaning up sandbox processes for ${username}...`);
        // Kill everything except the API bridge
        await this.os.proc.sudo('pkill', ['-9', '-u', username, '-v', '-f', 'api_bridge.py']);
      } catch (cleanupErr) {
        console.warn(`[Bot] Cleanup failed (likely no processes left): ${cleanupErr}`);
      }
    } finally {
      agentManager.updateAgentState(sandboxId, { status: 'idle' });
    }
  }

  private async handleChannelDeleted(channelId: string) {
    const persistence = getPersistence();
    const sandboxId = persistence.sessions.getSandboxId(this.platform.name, channelId);
    if (sandboxId) {
      console.log(`Channel ${channelId} deleted. Wiping sandbox ${sandboxId}...`);
      const sandboxManager = getSandboxManager();
      await sandboxManager.removeSandbox(sandboxId);
      persistence.sessions.deleteSession(this.platform.name, channelId);
    }
  }
}
