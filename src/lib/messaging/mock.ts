import type {
  ChannelDeleteHandler,
  IncomingMessage,
  MessageHandler,
  MessagingPlatform,
} from './types';

export class MockMessaging implements MessagingPlatform {
  readonly name = 'mock';
  private messageHandlers: MessageHandler[] = [];
  private deleteHandlers: ChannelDeleteHandler[] = [];
  private channels: Map<string, string> = new Map();

  async connect(): Promise<void> {
    console.log('Mock platform connected');
  }

  async sendMessage(channelId: string, content: string): Promise<void> {
    console.log(`[Mock Send] Channel: ${channelId}, Content: ${content}`);
  }

  async createChannel(name: string): Promise<string> {
    const id = `mock:sbx-${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
    this.channels.set(id, name);
    console.log(`[Mock Create] Name: ${name}, ID: ${id}`);
    return id;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  onChannelDeleted(handler: ChannelDeleteHandler): void {
    this.deleteHandlers.push(handler);
  }

  async disconnect(): Promise<void> {
    console.log('Mock platform disconnected');
  }

  // Helper methods for testing
  async simulateIncomingMessage(
    channelId: string,
    content: string,
    userId = 'user-1',
    userName = 'Test User',
  ): Promise<void> {
    const msg: IncomingMessage = {
      platform: this.name,
      channelId,
      userId,
      userName,
      content,
    };
    for (const handler of this.messageHandlers) {
      await handler(msg);
    }
  }

  async simulateChannelDeletion(channelId: string): Promise<void> {
    for (const handler of this.deleteHandlers) {
      await handler(channelId);
    }
    this.channels.delete(channelId);
  }
}
