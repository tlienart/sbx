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

export class ZulipMessaging implements MessagingPlatform {
  readonly name = 'zulip';
  private client: {
    messages: {
      send: (params: { type: string; to: string; topic: string; content: string }) => Promise<void>;
    };
    queues: {
      register: (params: { event_types: string[] }) => Promise<{
        queue_id: string;
        last_event_id: number;
      }>;
    };
    events: {
      retrieve: (params: {
        queue_id: string | null;
        last_event_id: number;
        dont_block: boolean;
      }) => Promise<{
        events: {
          id: number;
          type: string;
          message?: {
            type: string;
            sender_email: string;
            display_recipient: string;
            subject: string;
            content: string;
            sender_full_name: string;
          };
        }[];
      }>;
    };
  } | null = null;
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
    if (!this.client) throw new Error('Zulip client not connected');
    // channelId for Zulip will be "stream:topic"
    const [stream, topic] = this.parseChannelId(channelId);

    await this.client.messages.send({
      type: 'stream',
      to: stream,
      topic: topic,
      content: content,
    });
  }

  async createChannel(name: string): Promise<string> {
    // In Zulip, "creating" a channel just means starting a topic
    // We use the default stream and the provided name as topic
    const topic = `sbx-${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
    return `${this.config.defaultStream}:${topic}`;
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
            // Ignore own messages
            if (message.sender_email === this.config.username) continue;

            const incoming: IncomingMessage = {
              platform: this.name,
              channelId: `${message.display_recipient}:${message.subject}`,
              userId: message.sender_email || 'unknown',
              userName: message.sender_full_name || 'unknown',
              content: message.content || '',
              raw: event,
            };

            for (const handler of this.messageHandlers) {
              await handler(incoming);
            }
          }
          // Topic deletion isn't easily captured in Zulip via events like this
          // But we can check for other event types if needed.
          // For now, focus on messages.
        }
      } catch (error) {
        console.error('Error in Zulip event loop:', error);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }
}
