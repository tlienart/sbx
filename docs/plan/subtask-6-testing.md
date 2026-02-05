# Subtask 6: Testing, Hardening & Cleanup

## Goal
Ensure the system is robust, isolated, and type-safe.

## Hardening
- **Database Isolation**: The shared SQLite database is the Bot's private registry. It must be inaccessible to sandboxes.
- **Action**: Set `data/` directory to `700` and `sbx.db` to `600`.
- **Logic**: Ensure all DB access happens in the host-side `BotDispatcher` and `agents` logic.

## Logic Test Cleanup
- **Silence Mock Noise**: Update `interruptAgent` and `resetAgentSession` to detect `SKIP_PROVISION=1`. In mock mode, they will skip `runAsUser` calls to avoid "unknown login" errors in test output.
- **Type Safety**: Refactor internal APIs to replace `any` with explicit interfaces for SQLite row results.

## Source Tree Sanitization
- Remove all temporary test files from `src/`:
  - `src/test-persistence.ts`
  - `src/test-messaging.ts`
  - `src/test-formatting.ts`
  - `src/test-roundtrip.ts` (Superseded by `scripts/test-bot.ts`)

## Verification
- `make test_bot`: Should be fast, green, and silent (no sudo/su errors).
- `make check`: Should pass both `tsc --noEmit` and `biome lint`.
