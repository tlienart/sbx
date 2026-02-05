# Subtask 3: Enhanced Sandbox API

## Goal
Extend the sandbox and agent logic for interactivity.

## Requirements
- **Interrupts**: Stop a running agent.
- **Status Polling**: Detect "thinking", "writing", or "hanging".
- **Restart/Reset**: Ability to clear the current session context and start fresh without wiping the entire sandbox (preserving files but clearing agent memory).
- **Cleanup**: Explicit `wipe()` method to remove all files and processes associated with a sandbox.

## Design
- Add `interrupt()`, `resetSession()`, and `wipe()` methods.
- `resetSession()` should terminate the agent and clear its internal state/history.
- Ensure `wipe()` is idempotent and handles partial failures.
