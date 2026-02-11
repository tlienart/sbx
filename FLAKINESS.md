# Flakiness and Test Failure Resolution Plan

This document tracks identified flakiness and consistent test failures in the SBX project and provides a step-by-step plan to resolve them.

## Identified Issues

1. **`make clean` noise**: `pkill` reports "Operation not permitted" on certain PIDs, cluttering the output even though errors are ignored.
2. **Bridge Security vs E2E Tests**: The `SbxBridge` blocks `gh auth` for security, but E2E tests (`scripts/test_e2e.sh`) use `gh auth status` to verify the GitHub token proxy.
3. **Bot Logic Test vs Identity Provisioning**: `make test_bot` (running `scripts/test-bot.ts`) uses `SKIP_PROVISION=1` to avoid expensive user creation, but the dispatcher and bridge still attempt to `su` to these non-existent users, causing "unknown login" errors.

---

## Implementation Tasks

### 1. Refine `make clean` noise
- [x] Update `Makefile` to redirect `pkill` stderr to `/dev/null`.
- [x] (Optional) Use a more specific pattern for `pkill` to avoid matching unintended system processes.

### 2. Allow `gh auth status` in Bridge
- [x] Update `src/lib/bridge.ts` in `validateArgs` to allow the `status` subcommand for `gh auth`. This is a read-only check that verifies authentication state without allowing credential manipulation.
- [x] Update `scripts/stage6-bridge-git.ts` to expect `gh auth status` to succeed instead of being blocked.

### 3. Support `SKIP_PROVISION` in Execution Layer
- [x] Update `src/lib/exec.ts`'s `runAsUser` and `sudoRun` to detect `process.env.SKIP_PROVISION`.
- [x] In skip mode, return a successful mock result instead of attempting real `su` or `sudo` calls that would fail for missing users.
- [x] Update `src/lib/bridge.ts`'s `attachToSandbox` to also honor `SKIP_PROVISION` to avoid unnecessary waits for the API bridge port in mock tests.

---

## Verification Steps

1. **Test `make clean`**:
   - Run `make clean`.
   - **Success criteria**: No "Operation not permitted" messages.

2. **Test `make test_bot`**:
   - Run `make test_bot`.
   - **Success criteria**: All bot logic tests pass without `su: unknown login` errors.

3. **Test `make test_e2e`**:
   - Run `make test_e2e`.
   - **Success criteria**: `GitHub auth proxy` test case passes.

4. **Full Suite**:
   - Run `make test_full`.
   - **Success criteria**: Entire suite is green 🟢.
