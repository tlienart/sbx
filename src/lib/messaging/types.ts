export interface IncomingMessage {
  platform: string;
  channelId: string; // Generic identifier (e.g., Discord channel ID or Zulip stream/topic)
  userId: string;
  userName: string;
  content: string;
  raw?: unknown;
}

export interface ChannelInfo {
  id: string;
  name: string;
}

export type MessageHandler = (message: IncomingMessage) => Promise<void>;
export type ChannelDeleteHandler = (channelId: string) => Promise<void>;

export interface MessagingPlatform {
  readonly name: string;

  /**
   * Connect to the platform and start listening for events
   */
  connect(): Promise<void>;

  /**
   * Send a message to a specific channel
   */
  sendMessage(channelId: string, content: string): Promise<void>;

  /**
   * Create a new channel or thread/topic
   * @param name The name of the channel/thread
   * @returns The ID of the created channel
   */
  createChannel(name: string): Promise<string>;

  /**
   * Register a callback for incoming messages
   */
  onMessage(handler: MessageHandler): void;

  /**
   * Register a callback for when a channel/thread is deleted
   */
  onChannelDeleted(handler: ChannelDeleteHandler): void;

  /**
   * Close the connection
   */
  disconnect(): Promise<void>;
}
