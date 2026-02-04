# Final API Verification Status

This document tracks the verification of the `sbx` API and Sandbox features.

## ✅ Verified Features

| Feature | Status | Note |
| :--- | :--- | :--- |
| **Identity & Persistence** | PASS | `raw-exec` correctly identifies `sbx_...` user. |
| **State Persistence** | PASS | Files created in sandbox home persist across calls. |
| **LLM Execution** | PASS | `execute` endpoint correctly triggers OpenCode. |
| **Secret Isolation** | PASS | `SBX_PROXY_ACTIVE` is visible; host keys are hidden. |
| **Multi-turn Context** | PASS | `sessionId` correctly maintains LLM context. |
| **GitHub CLI Proxy** | PASS | `gh` authenticated via host bridge. |

## ⚠️ Issues Found (To be addressed in Phase B)

### 1. Bridge CWD Leak
*   **Observation**: Running `git init` in a sandbox subdirectory reinitialized the *host* repository.
*   **Cause**: Host Bridge cannot access sandbox home directory due to permissions, falling back to host root.
*   **Impact**: Bridged commands (`git`, `gh`) can accidentally modify host files.
*   **Fix**: Tracked in `WORK_CHUNK_B_1.md`.

### 2. Shared /tmp Namespace
*   **Observation**: Instance `beta` could not write to `/tmp/id` because `alpha` owned it.
*   **Cause**: macOS `/tmp` is shared across all local users.
*   **Impact**: Potential collision for tools using global temp dirs.
*   **Fix**: Tracked in `WORK_CHUNK_B_2.md`.
