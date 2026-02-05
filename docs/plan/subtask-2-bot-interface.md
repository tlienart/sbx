# Subtask 2: Messaging Abstraction & Zulip Implementation

## Goal
Create a generic interface for messaging platforms and provide a Zulip implementation.

## Requirements
- Abstract class `MessagingPlatform` with:
  - `sendMessage(channelId, content)`
  - `onMessage(callback)`
  - `onChannelDeleted(callback)`: NEW requirement to trigger cleanup.
  - `createChannel/Thread(name)`
- Zulip implementation handling topics/streams.

## Design
- Use a plugin-based architecture.
- Zulip implementation will track topic deletion if possible, or provide a way to mark sessions as closed.

## Implementation Tasks
1. Define interfaces in `src/lib/messaging/types.ts`.
2. Implement Zulip client in `src/lib/messaging/zulip.ts`.
