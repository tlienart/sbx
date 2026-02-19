# Plan: Fix E2E Test Failure in OpenCode Explore Mode

The E2E test "OpenCode Explore mode" is failing because the `explore` agent is not defined in the `opencode.sandbox.json` configuration, causing it to fall back to the `plan` agent (which doesn't execute commands) or fail. Additionally, the `whoami` command used in the test is not in the allowed bash commands list.

## Proposed Changes

### 1. Update `opencode.sandbox.json`
- **Add `explore` agent**: Define the `explore` agent with a prompt focused on codebase exploration and permission to use bash tools.
- **Add `research` agent**: Add as an alias or similar to `explore` to match `AgentManager` types.
- **Expand Bash Permissions**: Add `whoami`, `cat*`, `grep*`, and `touch*` to the allowed bash commands to support common exploration tasks and E2E tests.
- **Add Fallback Permission**: Consider adding a default "ask" or "allow" for other bash commands to make the agent more robust in a sandbox environment.

### 2. Update `opencode.json` (Local)
- Synchronize local config with the sandbox config to ensure consistency when testing locally.

### 3. Verification
- Run the E2E tests specifically:
  ```bash
  bash scripts/test_e2e.sh
  ```
- Or run the full suite:
  ```bash
  make test_full
  ```

## Tasks

- [x] Modify `opencode.sandbox.json` to include `explore` and `research` agents.
- [x] Update `bash` permissions in `opencode.sandbox.json`.
- [x] Synchronize `opencode.json` with these updates.
- [x] Verify fix by running `make test_e2e`.

Plan updated. To proceed with this plan, enter `/switch build`
