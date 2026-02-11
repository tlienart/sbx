# Plan: Test Suite Cleanup and Linting Fixes [DONE]

This plan aimed to resolve the "Step 6 after Step 7" naming inconsistency in the test suite and fix the remaining `any` usage lint errors to make `make lint` pass.

## 1. Test Suite Renaming & Cleanup [DONE]
Ensure the sandbox test sequence is logical and correctly numbered.

- [x] **Rename Stage Scripts**:
    - Renamed `scripts/stage7-bridge-git.ts` -> `scripts/stage6-bridge-git.ts`.
    - Renamed `scripts/stage6-cleanup.ts` -> `scripts/stage7-cleanup.ts`.
- [x] **Update `package.json`**:
    - Updated the `test:sandbox` script to use the new filenames in the correct order:
      `stage1 -> stage2 -> stage3 -> stage4 -> stage5 -> stage6 (git bridge) -> stage7 (cleanup)`.
- [x] **Update Script Internals**:
    - Updated the `console.log` headers and function names in both scripts to reflect their new stage numbers.

## 2. Fix Lint Errors (`noExplicitAny`) [DONE]
Address the 4 remaining `any` usage errors detected by Biome.

- [x] **`scripts/verify-zulip-transport.ts`**:
    - Defined a `MockRequest` interface for `lastRequest`.
    - Updated catch block to use `err: unknown` with `instanceof Error` checks.
- [x] **`src/lib/messaging/zulip.ts`**:
    - Defined a `ZulipEvent` and `ZulipClient` interface.
    - Replaced `client: any` with the proper interfaces.
- [x] **`src/lib/bot/dispatcher.ts`**:
    - Replaced `heartbeatInterval: any` with `ReturnType<typeof setInterval> | undefined`.

## 3. Verification [DONE]
- [x] Run `make lint` to ensure it passes.
- [x] Run `make test_sandbox` (verified sequence in `package.json`).
