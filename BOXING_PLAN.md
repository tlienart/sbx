# SBX Boxing Plan: Separation of Concerns & Modularization

This document outlines the architectural criticism of the current SBX codebase and provides a roadmap for "boxing" components into well-defined, testable units.

## 1. Architectural Criticisms

### 1.1. Massive Coupling (The "God Object" Problem)
- **`BotDispatcher`**: Handles Zulip messaging, session reconciliation, sandbox lifecycle, agent state management, and command execution. It's too big and depends on almost every other module.
- **`SbxBridge`**: Manages host binary resolution, secret harvesting, Unix sockets, HTTP proxying, and process spawning. It mixes security logic with network transport and OS orchestration.
- **`user.ts`**: Contains low-level macOS user management (`dscl`, `sysadminctl`) mixed with high-level readiness checks (pinging 8.8.8.8).

### 1.2. Leaky Abstractions
- **Database**: The raw `db` object is exported and used directly in `sandbox.ts`, `agents.ts`, and `dispatcher.ts`, leading to SQL queries scattered across the codebase.
- **Paths & IDs**: UUID-to-instance-name logic (`id.split('-')[0]`) is repeated in multiple files. Hardcoded paths like `/tmp/.sbx_${hostUser}` are pervasive.
- **Shell Commands**: String-interpolated shell commands are used everywhere, making it hard to track side effects or mock behavior.

### 1.3. Hardcoded Logic
- **Python Shims**: Large blocks of Python code are embedded as strings in `provision.ts`.
- **Agent Modes**: Agent modes (`plan`, `build`, `research`) and command parsing are hardcoded in the dispatcher.

### 1.4. Testability
- Most core logic is currently untestable without a macOS environment, specific system permissions (sudo), and a running SQLite database.

---

## 2. The "Boxing" Strategy

We will organize the codebase into the following "boxes," each with a clear spec and individual test suite.

### Box A: The Identity Box (`src/lib/identity/`)
- **Spec**: Manage macOS users, groups, ACLs, and sudoers.
- **Goal**: Provide a clean interface like `IdentityManager.createUser(name)` and `IdentityManager.grantAccess(path, user)`.
- **Testing**: Use an `OSAdapter` interface that can be swapped with a mock during tests.

### Box B: The Persistence Box (`src/lib/persistence/`)
- **Spec**: Handle all SQLite operations.
- **Goal**: No SQL should exist outside this box. Use Repositories (e.g., `SandboxRepository`, `SessionRepository`, `AgentStateRepository`).
- **Testing**: Use an in-memory SQLite database for fast unit tests.

### Box C: The Bridge Box (`src/lib/bridge/`)
- **Spec**: Provide secure communication between host and sandbox.
- **Goal**: Split `SbxBridge` into:
    - `CommandBridge`: Handles the Unix socket for git/gh.
    - `ApiProxy`: Handles the HTTP proxy for LLM providers.
    - `SecretProvider`: Securely manages API keys and tokens.
    - `ProcessManager`: Spawns and tracks host processes.

### Box D: The Provisioning Box (`src/lib/provision/`)
- **Spec**: Prepare the sandbox environment.
- **Goal**: Move Python shims to `src/resources/shims/`. Use a template engine (or simple replacement) to inject variables.
- **Testing**: Verify generated configuration files and scripts without executing them.

### Box E: The Agent Box (`src/lib/agents/`)
- **Spec**: Manage agent state and lifecycle.
- **Goal**: Decouple agent logic from shell execution. Introduce an `ExecutionEngine` interface.

### Box F: The Messaging Box (`src/lib/messaging/`)
- **Spec**: Interface with external platforms (Zulip, etc.).
- **Goal**: Ensure the bot logic only knows about `IncomingMessage` and `OutgoingMessage` types.

---

## 3. Detailed Task Checklist

### Phase 1: Persistence & Identity (The Foundation) [COMPLETED]
- [x] Create `src/lib/persistence/` and move all SQL logic into repositories.
- [x] Create `src/lib/identity/` and encapsulate `dscl`, `sysadminctl`, and ACL logic.
- [x] Introduce an `OS` abstraction to allow mocking `exec`, `fs`, etc.

### Phase 2: Bridge & Proxy Refactoring [COMPLETED]
- [x] Split `SbxBridge` into `CommandBridge` and `ApiProxy`.
- [x] Create a `SecretManager` to handle `SBX_*` environment variables.
- [x] Extract Python shims from `provision.ts` into external files in `src/resources/shims/`.
- [x] Add independent subsystem testing to `Makefile`.

### Phase 3: Sandbox & Agent Orchestration [COMPLETED]
- [x] Refactor `SandboxManager` to use the new Identity and Persistence boxes.
- [x] Decouple `AgentState` management from database implementation.
- [x] Standardize Sandbox ID and Instance Name handling (use a value object or helper).

### Phase 4: Bot & Dispatcher Cleanup [COMPLETED]
- [x] Refactor `BotDispatcher` to use a "Command Pattern" for `/new`, `/status`, etc.
- [x] Move session reconciliation logic into a dedicated `SessionManager`.
- [x] Ensure `BotDispatcher` only depends on high-level interfaces.

### Phase 5: Test Coverage & Unit Test Suite [COMPLETED]
- [x] Add unit tests for each box using mocks for OS and Database dependencies.
- [x] Implement a "Dry Run" mode for provisioning to verify it without affecting the system.
- [x] Integrate all unit tests into a single `make test_unit` command.

---

## 4. Final Status (February 2026) [COMPLETED]

The SBX codebase has been successfully "boxed" into independent, testable modules. 

### Key Achievements:
1. **Full Isolation**: All 7 subsystems (Identity, Persistence, Bridge, Provisioning, Agent, Messaging, Sandbox) are now logically isolated with clean interfaces.
2. **Comprehensive Testing**: 
    - **Unit Tests**: 29 unit tests covering all boxes, running in <1s using the `OS` abstraction.
    - **E2E Validation**: A full green E2E suite (`make test_e2e`) verifying the real macOS integration.
3. **Decoupled Business Logic**: CLI commands and the Bot Dispatcher no longer touch low-level OS or SQL logic directly.
4. **Improved UX**: Standardized `sudo` authentication and robust bridge attachment logic.

### Directory Structure:
```text
src/
  commands/       # CLI command definitions (Commander)
  lib/
    identity/     # Box A: macOS user/ACL management
    persistence/  # Box B: Repositories and DB schema
    bridge/       # Box C: Command bridge and API proxy
    provision/    # Box D: Environment setup and shim deployment
    agents/       # Box E: Agent state and lifecycle
    messaging/    # Box F: Messaging platform interfaces
    sandbox/      # Box G: High-level sandbox orchestration
    common/       # Shared types, OS abstraction, and utilities
  resources/
    shims/        # Python/Bash shim sources
```
