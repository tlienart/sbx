# Testing & Verification Plan

This document outlines the tasks required to restore and verify the SBX system after the "boxing" refactoring.

## 1. Regression Fixes (Fixing Broken Imports)
The following tasks address the `make test_bot`, `make test_e2e`, and `make check` failures caused by the removal of legacy files.

- [x] **Refactor `src/commands/list.ts`**: Replace `isUserActive` and `listSessions` from legacy `lib/user.ts` with calls to `SandboxManager` and `IdentityBox`.
- [x] **Refactor `src/commands/cleanup.ts`**: Replace `getHostUser` with `getIdentity().users.getHostUser()`.
- [x] **Refactor `scripts/test-bot.ts`**: 
    - Replace `db` import from `../src/lib/db.ts` with `getPersistence()`.
    - Replace `listSandboxes` import from `../src/lib/sandbox.ts` with `getSandboxManager().listSandboxes()`.
    - Replace `SbxBridge` with `BridgeBox` from `../src/lib/bridge/index.ts`.
- [x] **Refactor Integration Scripts**: Update the following scripts in `scripts/` to use the new Box-based architecture instead of legacy `lib/` files:
    - [x] `stage1-auth.ts`
    - [x] `stage2-creation.ts`
    - [x] `stage3-propagation.ts`
    - [x] `stage4-sudoers.ts`
    - [x] `stage5-provision.ts`
    - [x] `stage6-bridge-git.ts`
    - [x] `stage7-cleanup.ts`
    - [x] `verify-e2e.ts`
    - [x] `doctor.ts`
- [x] **Refactor CLI Tests**: Update the following test files in `src/commands/` to use the new Box-based architecture:
    - [x] `api.test.ts`
    - [x] `api_basic.test.ts`
    - [x] `bridge_cwd.test.ts`
    - [x] `bridge_traversal.test.ts`
- [x] **Fix `src/lib/common/os/real.ts`**: Moved `exec.ts` logic into `common/os/exec.ts` and added to `IProcessRunner` interface.

## 2. Subsystem Responsibilities & Testing Targets

### Identity Box
- **Responsibility**: Manage macOS standard user accounts, group memberships, and file-level permissions (ACLs/Sudoers).
- **Subsystem Name**: `IdentityBox` (`src/lib/identity/`)
- **Testing Target**: `make test_identity`
    - **Unit**: Verify `IdentityManager` correctly formats `dscl` and `sysadminctl` commands via mock OS.
    - **Integration**: `scripts/stage1-auth.ts`, `stage2-creation.ts`, `stage3-propagation.ts`.

### Persistence Box
- **Responsibility**: Abstract all SQLite database operations, ensuring data integrity through schemas and foreign keys.
- **Subsystem Name**: `PersistenceBox` (`src/lib/persistence/`)
- **Testing Target**: `make test_persistence`
    - **Unit**: Verify Repositories (`Sandbox`, `Session`, `AgentState`) using an in-memory SQLite provider.

### Bridge Box
- **Responsibility**: Provide secure transport for host-to-sandbox communication, including command shimming (git/gh) and API proxying for LLMs.
- **Subsystem Name**: `BridgeBox` (`src/lib/bridge/`)
- **Testing Target**: `make test_bridge`
    - **Unit**: Verify `CommandBridge` argument validation and `SecretManager` harvesting.
    - **E2E (Mocked)**: `scripts/test_e2e.sh` (Exercises socket creation and attachment).

### Provisioning Box
- **Responsibility**: Configure the sandbox user environment, including shell profiles, Python shims, and pkgx tool caching.
- **Subsystem Name**: `ProvisioningBox` (`src/lib/provision/`)
- **Testing Target**: `make test_provision`
    - **Unit**: Verify setup script generation and file path correctness.
    - **Integration**: `scripts/stage5-provision.ts`.

### Agent Box
- **Responsibility**: Manage the state and lifecycle of autonomous agents running within sandboxes.
- **Subsystem Name**: `AgentBox` (`src/lib/agents/`)
- **Testing Target**: `make test_agents`
    - **Unit**: Verify state transitions (idle -> thinking) and task interruption logic.

### Sandbox Box
- **Responsibility**: Orchestrate the high-level lifecycle of a "Box" by coordinating Identity, Persistence, and Provisioning.
- **Subsystem Name**: `SandboxBox` (`src/lib/sandbox/`)
- **Testing Target**: `make test_unit_sandbox`
    - **Unit**: Verify `SandboxManager.createSandbox` correctly triggers all required sub-operations.

### Messaging Box
- **Responsibility**: Handle external communication via Zulip and dispatch commands to the appropriate sandbox.
- **Subsystem Name**: `MessagingBox` (`src/lib/messaging/`, `src/lib/bot/`)
- **Testing Target**: `make test_bot`
    - **Unit**: Verify `BotDispatcher` command routing and session recovery using `MockMessaging`.

## 3. Final Verification Checklist
- [x] `make test_unit` passes all 29 tests.
- [x] `make typecheck` returns no errors (0 files with issues).
- [x] `make lint` returns no errors.
- [x] `make test_bot` passes with `SKIP_PROVISION=1`.
- [x] `SBX_MOCK=1 SKIP_PROVISION=1 make test_e2e` passes functional checks (orchestration verified).
- [x] `make test_e2e` (Real Mode) passes all 12 validation stages.
