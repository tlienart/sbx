# Subtask 5: Command Handlers, Events & Recovery Logic

## Goal
Implement slash commands, event listeners for cleanup, and system recovery.

## Requirements
- **Commands**:
  - `/new <title>`: Create sandbox + topic/channel.
  - `/ping`: Health check.
  - `/mode`: List modes.
  - `/switch <mode>`: Change mode.
  - `/interrupt`: Stop current agent.
  - `/restart`: Kill current session and start a fresh one (clear context).
- **Cleanup Event**: Listen for `onChannelDeleted` and call `sandbox.wipe()`.
- **Recovery**: On startup, reconcile DB sessions with active sandboxes.

## Design
- `CommandDispatcher` for user input.
- `CleanupService` to handle channel deletion events.
- `RecoveryService` for startup consistency checks.

## Implementation Tasks
1. Implement command routing.
2. Connect `onChannelDeleted` to sandbox removal logic.
3. Implement startup recovery.
