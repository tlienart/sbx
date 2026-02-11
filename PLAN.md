# Plan - Fix Orpaned Zulip Sessions Recovery

The SBX bot should gracefully handle cases where a sandbox's macOS user has been deleted (e.g., after `make clean`) but the database still tracks the session. 

## Current Implementation (Self-Healing)

### 1. `src/lib/sandbox.ts` [x]
- Added `isSandboxAlive(id: string): Promise<boolean>` to check if the underlying macOS user exists.

### 2. `src/lib/bot/dispatcher.ts` [x]
- **Reactive Recovery**: `handleMessage` now checks `isSandboxAlive(sandboxId)`.
    - If a sandbox is missing from the host, the bot notifies the user and automatically recreates a fresh sandbox identity, provisions the toolchain, and re-attaches the bridge.
- **Smart Reconciliation**: `reconcileSessions` only prunes sandboxes if their Zulip topic/channel has been deleted. It **no longer** prunes sandboxes just because the host user is missing (avoiding data loss during host wipes).
- **Status Reporting**: `/status` now identifies "Orphaned" sandboxes and invites recovery.

### 3. `src/lib/db.ts` [x]
- Enabled SQLite Foreign Keys (`PRAGMA foreign_keys = ON`) to ensure metadata is cleaned up when a sandbox is explicitly removed.

## Verification

### Mock Test [x]
- Verified via `scripts/test-recovery.ts` that:
    1. A message to a missing sandbox triggers notification and recreation.
    2. A bot restart does NOT wipe existing session mappings even if users are missing.

### Manual Verification Cycle
1. Create a sandbox: `/new demo-fix`.
2. Send a message to verify.
3. Stop bot and run `make clean`.
4. Start bot and send another message in the same topic.
5. **Expected**: Bot notifies about recovery and continues the session in a new identity.
