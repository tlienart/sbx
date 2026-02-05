# Master Plan: Zulip/Discord Sandbox Bot

This document outlines the plan for connecting sandboxed coding sessions (Opencode) to messaging platforms like Zulip and Discord.

## Architecture Overview

The system consists of three main layers:
1. **Messaging Layer**: Handles communication with Zulip/Discord APIs.
2. **Bridge Service**: The core logic that maps chat channels to sandboxes and manages session state.
3. **Sandbox Layer**: The existing (to be enhanced) system for running isolated agents.

```text
[ Remote Platform ] <--> [ Bot Service ] <--> [ Persistence (SQLite) ]
                                |
                                v
                       [ Sandbox Manager ]
                                |
                                v
                       [ Isolated Agents ]
```

## Robustness & Reliability
- **Persistence**: All mappings and states are stored in SQLite to survive bot restarts.
- **Session Recovery**: Bot checks for orphaned but active sandboxes on startup.
- **Health Checks**: `/ping` monitors both the bridge and the sandbox agent.
- **Cleanup**: Sandboxes are automatically wiped when their associated chat channel or thread is closed/deleted.

## Execution Phases

1. **Phase 1: Foundation (Persistence & API)**
   - Implement SQLite storage for session mapping.
2. **Phase 2: Messaging Core**
   - Create a generic `MessagingPlatform` abstraction with event support (message, channel deletion).
   - Implement Zulip provider.
3. **Phase 3: Integration & Commands**
   - Implement `/new`, `/ping`, `/mode`, `/switch`, `/interrupt`, `/restart`.
   - Implement event listener for channel/thread closure to trigger sandbox cleanup.
4. **Phase 4: Advanced Formatting**
   - Message splitting and auto-summarization fallback.
5. **Phase 5: Recovery & Robustness**
   - Auto-recovery of sessions.
   - Monitoring and error reporting.

## Subtasks

- [Subtask 1: Persistence Layer](subtask-1-persistence.md)
- [Subtask 2: Messaging Abstraction & Zulip implementation](subtask-2-bot-interface.md)
- [Subtask 3: Enhanced Sandbox API](subtask-3-sandbox-integration.md)
- [Subtask 4: Message Processing & Long Content](subtask-4-message-processing.md)
- [Subtask 5: Command Handlers, Events & Recovery Logic](subtask-5-commands-recovery.md)
- [Subtask 6: Testing & Validation Strategy](subtask-6-testing.md)
