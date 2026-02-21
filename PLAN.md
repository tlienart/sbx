# Plan: Concurrent Channel Handling + PF Rule Syntax Fix

## Issue 1: Commands queue across channels (no concurrency)

**Root cause**: The Zulip event loop in `zulip.ts` (line 229) calls `await handler(incoming)` sequentially. Since `handleMessage` → `relayToAgent` blocks for the entire duration of an opencode run (up to 15 minutes), *all* incoming messages — even for different channels/sandboxes — are queued behind the running task.

**Goal**: Messages targeting *different* channels/sandboxes should be processed concurrently. Messages for the *same* sandbox should still be serialized (to avoid conflicting opencode sessions).

### Subtask 1.1: Per-sandbox concurrency lock in `BotDispatcher`

- Add a `Map<string, Promise<void>>` (or similar per-sandbox queue) to `BotDispatcher`.
- In `handleMessage`, resolve the `sandboxId` early, then:
  - If the sandbox is already busy, either queue the message for that sandbox or notify the user.
  - If the sandbox is idle, proceed immediately.
- Commands (`/new`, `/newpf`, `/status`, etc.) targeting channels without a running agent should always execute immediately (they don't call `relayToAgent`).
- **Verification**: Start two sandboxes via `/new a` and `/new b`, send a prompt to each. Both should process in parallel.

### Subtask 1.2: Make Zulip event loop non-blocking

- In `zulip.ts` line 229, change `await handler(incoming)` to fire-and-forget (`handler(incoming).catch(...)`) so the event loop doesn't block on one handler call.
- This lets the dispatcher receive new events while a relay is in progress.
- **Verification**: Send a `/status` command while a prompt is being processed in another channel. It should respond immediately.

### Subtask 1.3: Handle commands while a relay is in-flight for the same channel

- In `handleMessage` / `handleCommand`, commands like `/interrupt`, `/status`, `/mode` should bypass the per-sandbox lock so they can be executed even when the sandbox is busy.
- `/switch` and regular prompts for a busy sandbox should either queue or return a "sandbox is busy" message.
- **Verification**: While a prompt is running in a channel, send `/status` in the same channel — it should respond immediately.

---

## Issue 2: `/newpf` fails with PF syntax error

**Root cause**: In `NetworkManager.ts` line 36, the block rule uses `proto {tcp, udp}` with curly braces. When written to the conf file, the space after the comma and the braces can cause a PF syntax error depending on the macOS pfctl version. Line 3 of the generated conf file is:

```
block out log (all, user) quick proto {tcp, udp} all user 519
```

This `{tcp, udp}` syntax may not be accepted by some pfctl versions or needs proper formatting. Additionally, the `log (all, user)` syntax may be problematic — macOS PF doesn't support the `(all, user)` log modifiers in the same way as OpenBSD PF.

### Subtask 2.1: Fix PF rule syntax in `NetworkManager.ts`

- Replace the block rule `{tcp, udp}` with two separate rules (one for TCP, one for UDP), or use the correct PF macro syntax `{ tcp udp }` (space-separated, no comma).
- Fix the `log (all, user)` to just `log` — macOS pfctl doesn't support the extended log options.
- The corrected rules should be:
  ```
  pass out quick proto tcp from any to 127.0.0.1 port <port> user <uid>
  block out log quick proto tcp all user <uid>
  block out log quick proto udp all user <uid>
  ```
  Or with correct macro syntax: `block out log quick proto { tcp udp } all user <uid>`
- **Verification**: Run `/newpf test-pf` via the bot and confirm no `pfctl` syntax error. Verify with `sudo pfctl -a com.apple/sbx/uid_<uid> -s rules` that rules are loaded.

### Subtask 2.2: Update the network test

- Update `network.test.ts` to validate the generated rule content (write a test that checks the temp file content matches valid PF syntax).
- **Verification**: `bun test src/lib/identity/network.test.ts`

### Subtask 2.3: Add a newline at end of PF conf file

- PF conf files should end with a trailing newline. Ensure `Bun.write(tmpFile, rules)` appends `\n` at the end.
- **Verification**: Inspect generated `/tmp/sbx_pf_*.conf` content during a test run.

---

## Status

- [x] **2.1** Fix PF rule syntax (`NetworkManager.ts`) — split `{tcp, udp}` into two rules, removed `log (all, user)`, added trailing newline
- [x] **2.2** Updated `network.test.ts` to validate rule content
- [x] **2.3** Trailing newline included in 2.1
- [x] **1.2** Made Zulip event loop non-blocking (`zulip.ts` — fire-and-forget handler calls)
- [x] **1.1** Added per-sandbox lock (`sandboxLocks` map in `dispatcher.ts`)
- [x] **1.3** Lightweight commands (`/status`, `/interrupt`, `/mode`, `/network`, `/allow`) bypass lock naturally; `/switch` respects the lock

## Files to Modify

| Subtask | File |
|---------|------|
| 1.1 | `src/lib/bot/dispatcher.ts` |
| 1.2 | `src/lib/messaging/zulip.ts` |
| 1.3 | `src/lib/bot/dispatcher.ts` |
| 2.1 | `src/lib/identity/NetworkManager.ts` |
| 2.2 | `src/lib/identity/network.test.ts` |
| 2.3 | `src/lib/identity/NetworkManager.ts` |
