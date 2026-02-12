# Boxing Implementation Review & E2E Validation Plan

This plan outlines the steps to verify that the "boxing" refactoring (separation of concerns into Identity, Persistence, Bridge, Provisioning, Agent, and Sandbox boxes) is complete, working correctly, and covered by tests.

## 1. Quality & Environment Sanity
- [ ] **Linting**: Run `make lint` to ensure adherence to style guidelines (Biome).
- [ ] **Type Checking**: Run `make typecheck` to ensure no TypeScript regressions.
- [ ] **System Check**: Run `make doctor` to verify host permissions (sudo, pkgx, etc.).

## 2. Subsystem Validation (Unit Tests)
Verify each "Box" works in isolation using its dedicated test suite.
- [ ] **Persistence Box**: `make test_persistence` (Repositories, SQLite schema, Foreign Keys).
- [ ] **Identity Box**: `make test_identity` (macOS User management, Sudoers, ACLs).
- [ ] **Bridge Box**: `make test_bridge` (CommandBridge, ApiProxy, SecretManager).
- [ ] **Provisioning Box**: `make test_provision` (Shim deployment, pkgx configuration).
- [ ] **Agent Box**: `make test_agents` (AgentManager, State persistence, Lifecycle).
- [ ] **Sandbox Box**: `make test_unit_sandbox` (SandboxManager orchestration).

## 3. Integration & Live E2E Validation
Verify the full system lifecycle and inter-box communication.
- [ ] **Sandbox Stages**: `make test_sandbox` (Exercises the stage-by-stage creation/provisioning logic).
- [ ] **Bot Logic**: `make test_bot` (Exercises Zulip messaging and dispatcher routing).
- [ ] **Full E2E Suite**: `make test_e2e` (Runs `scripts/test_e2e.sh`).
    - [ ] Verify **Identity** (Box A): `Identity check`, `TMPDIR isolation`, `Cross-sandbox isolation`.
    - [ ] Verify **Bridge** (Box C): `GitHub auth proxy`, `Secret redaction`, `Concurrent execution`.
    - [ ] Verify **Provisioning & Agents** (Boxes D/E): `OpenCode Explore/Build` modes.
    - [ ] Verify **Persistence** (Box B): Sequential creation and deletion without state leakage.

## 4. Architectural "Boxing" Audit
Manual/Grep inspection to ensure no legacy bypasses remain.
- [ ] **CLI Refactoring**: Check if `src/commands/create.ts` and others should be updated to use `getSandboxManager()` and `Provisioner` class instead of legacy `lib/provision.ts`.
- [ ] **Legacy Cleanup**: Verify if root `lib/*.ts` files (e.g., `provision.ts`, `user.ts`) are now purely shims or can be removed.
- [ ] **SQL Leakage**: Ensure no SQL queries exist outside of `src/lib/persistence/`.
- [ ] **System Leakage**: Ensure no direct `dscl`/`sysadminctl` calls exist outside of `src/lib/identity/`.

## 5. Final Report & Cleanup
- [ ] Update `BOXING_PLAN.md` with final verification status.
- [ ] Document any remaining technical debt or suggested next steps.
- [ ] Final `make clean` to ensure the system is left in a pristine state.
