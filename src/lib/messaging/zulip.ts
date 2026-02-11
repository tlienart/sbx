import zulipInit from 'zulip-js';
import type {
  ChannelDeleteHandler,
  IncomingMessage,
  MessageHandler,
  MessagingPlatform,
} from './types';

export interface ZulipConfig {
  site: string;
  username: string;
  apiKey: string;
  defaultStream: string;
}

interface ZulipEvent {
  id: number;
  type: string;
  message?: {
    type: string;
    sender_email: string;
    sender_full_name: string;
    content: string;
    display_recipient: string;
    subject: string;
    id: number;
  };
}

interface ZulipClient {
  queues: {
    register(params: { event_types: string[] }): Promise<{
      queue_id: string;
      last_event_id: number;
    }>;
  };
  events: {
    retrieve(params: {
      queue_id: string | null;
      last_event_id: number;
      dont_block: boolean;
    }): Promise<{ events: ZulipEvent[] }>;
  };
}

export class ZulipMessaging implements MessagingPlatform {
  readonly name = 'zulip';
  private client: ZulipClient | null = null;
  private messageHandlers: MessageHandler[] = [];
  private deleteHandlers: ChannelDeleteHandler[] = [];
  private config: ZulipConfig;
  private eventQueueId: string | null = null;
  private lastEventId = -1;
  private isRunning = false;

  constructor(config: ZulipConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    this.client = await zulipInit({
      username: this.config.username,
      apiKey: this.config.apiKey,
      realm: this.config.site,
    });

    this.isRunning = true;
    this.startEventLoop();
    console.log('Zulip platform connected');
  }

  async sendMessage(channelId: string, content: string): Promise<void> {
    const [stream, topic] = this.parseChannelId(channelId);

    console.log(
      `[Zulip] Sending message to ${stream} > ${topic}: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`,
    );

    const auth = Buffer.from(`${this.config.username}:${this.config.apiKey}`).toString('base64');
    const params = new URLSearchParams();
    params.append('type', 'stream');
    params.append('to', stream);
    params.append('topic', topic);
    params.append('content', content);

    const response = await fetch(`${this.config.site}/api/v1/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const result = (await response.json()) as { result: string; msg?: string };
    if (result.result !== 'success') {
      console.error(`[Zulip] Failed to send message: ${result.msg}`);
      throw new Error(`Zulip API error: ${result.msg}`);
    }
  }

  async addReaction(_channelId: string, messageId: string, emoji: string): Promise<void> {
    const mid = Number.parseInt(messageId, 10);
    if (Number.isNaN(mid)) return;

    const auth = Buffer.from(`${this.config.username}:${this.config.apiKey}`).toString('base64');
    const params = new URLSearchParams();
    const zulipEmoji = emoji === 'working' ? 'gear' : emoji === 'thought' ? 'thinking' : emoji;
    params.append('emoji_name', zulipEmoji);

    const response = await fetch(`${this.config.site}/api/v1/messages/${mid}/reactions`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const result = (await response.json()) as { result: string; msg?: string };
    if (result.result !== 'success' && result.msg !== 'Reaction already exists') {
      console.warn(`[Zulip] Failed to add reaction: ${result.msg}`);
    }
  }

  async createChannel(name: string): Promise<string> {
    const topic = `sbx-${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
    return `${this.config.defaultStream}:${topic}`;
  }

  async listChannels(): Promise<string[]> {
    if (!this.client) throw new Error('Zulip client not connected');

    const auth = Buffer.from(`${this.config.username}:${this.config.apiKey}`).toString('base64');
    const headers = { Authorization: `Basic ${auth}` };

    // 1. Get subscriptions (streams)
    const subRes = await fetch(`${this.config.site}/api/v1/users/me/subscriptions`, { headers });
    const subData = (await subRes.json()) as {
      result: string;
      subscriptions: { stream_id: number; name: string }[];
    };

    if (subData.result !== 'success') {
      console.error(`[Zulip] Failed to fetch subscriptions: ${JSON.stringify(subData)}`);
      return [];
    }

    const allChannelIds: string[] = [];

    // 2. For each stream, get topics
    for (const sub of subData.subscriptions) {
      const topicRes = await fetch(`${this.config.site}/api/v1/users/me/${sub.stream_id}/topics`, {
        headers,
      });
      const topicData = (await topicRes.json()) as {
        result: string;
        topics: { name: string }[];
      };

      if (topicData.result === 'success') {
        for (const topic of topicData.topics) {
          allChannelIds.push(`${sub.name}:${topic.name}`);
        }
      }
    }

    return allChannelIds;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  onChannelDeleted(handler: ChannelDeleteHandler): void {
    this.deleteHandlers.push(handler);
  }

  async disconnect(): Promise<void> {
    this.isRunning = false;
    console.log('Zulip platform disconnected');
  }

  private parseChannelId(channelId: string): [string, string] {
    const parts = channelId.split(':');
    if (parts.length >= 2) {
      return [parts[0] as string, parts.slice(1).join(':')];
    }
    return [this.config.defaultStream, channelId];
  }

  private async startEventLoop() {
    if (!this.client) return;
    const response = await this.client.queues.register({
      event_types: ['message', 'subscription'],
    });
    this.eventQueueId = response.queue_id;
    this.lastEventId = response.last_event_id;

    while (this.isRunning) {
      if (!this.client) break;
      try {
        const eventsResponse = await this.client.events.retrieve({
          queue_id: this.eventQueueId,
          last_event_id: this.lastEventId,
          dont_block: false,
        });

        if (!this.isRunning) break;

        for (const event of eventsResponse.events) {
          this.lastEventId = event.id;
          if (event.type === 'message' && event.message && event.message.type === 'stream') {
            const message = event.message;
            if (message.sender_email === this.config.username) continue;

            const cleanContent = (message.content || '').replace(/<[^>]*>?/gm, '').trim();

            const incoming: IncomingMessage = {
              platform: this.name,
              channelId: `${message.display_recipient}:${message.subject}`,
              messageId: String(message.id),
              userId: message.sender_email || 'unknown',
              userName: message.sender_full_name || 'unknown',
              content: cleanContent,
              raw: event,
            };

            for (const handler of this.messageHandlers) {
              await handler(incoming);
            }
          }
        }
      } catch (error) {
        console.error('Error in Zulip event loop:', error);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }
}
