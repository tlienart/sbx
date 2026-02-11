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

## Regression Fix: `test-bot.ts` failure [x]

The `test-bot.ts` script uses `SKIP_PROVISION=1`, which causes `isSandboxAlive` to return `false` (since no user is created), triggering an unwanted recovery cycle during tests.

### 4. `src/lib/sandbox.ts` (Correction) [x]
- Update `isSandboxAlive` to return `true` immediately if `process.env.SKIP_PROVISION` is set. This avoids "Recovery loops" in testing/mock environments.

### 5. Verification [x]
- Run `make test_bot` and ensure it passes. [x]

### Manual Verification Cycle [x]
1. Create a sandbox: `/new demo-fix`. [x]
2. Send a message to verify. [x]
3. Stop bot and run `make clean`. [x]
4. Start bot and send another message in the same topic. [x]
5. **Expected**: Bot notifies about recovery and continues the session in a new identity. [x]
