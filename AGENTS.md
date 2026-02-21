# Sbx Agent Architecture & Guidelines

This document provides guidance for developing and maintaining the Sbx codebase.

## Project Overview

SBX is a secure sandbox environment for autonomous coding agents on macOS. It creates isolated macOS user accounts, provisions them with toolchains, and exposes a Zulip-based chat interface to interact with agents running inside sandboxes.

**Runtime**: Bun (TypeScript). **Package manager**: bun. **Linter/formatter**: Biome (`biome.json`).

## Repo Structure

```
src/
├── commands/          # CLI entry points (bot.ts, create.ts, exec.ts, etc.)
├── lib/
│   ├── agents/        # AgentManager – tracks agent mode/state per sandbox
│   ├── bot/           # BotDispatcher – routes Zulip messages to sandboxes
│   ├── bridge/        # BridgeBox, CommandBridge, ApiProxy, TrafficProxy
│   ├── common/os/     # OS abstraction layer (proc, fs, env)
│   ├── identity/      # MacOSIdentityManager, NetworkManager, AclManager, SudoersManager
│   ├── messaging/     # MessagingPlatform interface, ZulipMessaging, MockMessaging
│   ├── persistence/   # SQLite DB, repositories (sandbox, session, agent_state)
│   ├── provision/     # Provisioner – deploys shims, opencode config, toolchains
│   └── sandbox/       # SandboxManager – lifecycle orchestration
├── types/             # Type declarations (zulip-js.d.ts)
└── index.ts           # CLI root (commander)
```

## Key Flows

1. **`sbx bot`** → `botCommand()` → starts BridgeBox + ZulipMessaging + BotDispatcher
2. **Zulip `/new <name>`** → `BotDispatcher.cmdNew()` → `SandboxManager.createSandbox()` → identity + provision + bridge attach
3. **Zulip prompt** → `BotDispatcher.handleMessage()` → `relayToAgent()` → runs `opencode run` as sandbox user, streams JSON output back to Zulip
4. **`/newpf <name>`** → same as `/new` but with `restrictedNetwork: true` → `NetworkManager.enableRestrictedNetwork()` loads PF rules + starts TrafficProxy

## Architecture

Agents run as a standard macOS user within an isolated session. They interact with the host and the outside world through:

1.  **Isolated Shell**: Agents execute commands via `sbx exec` or the API server's `/raw-exec` and `/execute` endpoints.
2.  **Host Bridge**: Sensitive commands (like `git push`) are intercepted by shims and forwarded to a bridge running on the host. Secrets stay on the host.
3.  **API Proxy**: LLM requests are proxied through the host bridge, which injects API keys.
4.  **Toolchain (pkgx)**: On-demand toolchain available to all sandboxes.
5.  **Network (PF + TrafficProxy)**: Optional restricted mode blocks all outbound traffic except whitelisted domains via kernel firewall (pfctl) + HTTP proxy.

## Development Guidelines

### Running & Testing
- **Start bot**: `sbx bot` (or `bun src/index.ts bot`)
- **Unit tests**: `bun test src/lib/**/*.test.ts`
- **Sandbox integration tests**: `make test` (requires sudo, creates real macOS users)
- **E2E tests**: `bun scripts/verify-e2e.ts`
- **Type check**: `bun run typecheck`
- **Lint/format**: `bun run check` (biome)

### Code Conventions
- Use the OS abstraction (`getOS()`) for all process execution, file system, and env access — never call `child_process` directly.
- Sandbox IDs are UUIDs. The `instanceName` is `id.split('-')[0]` (first segment).
- Channel IDs in the messaging layer are `"stream:topic"` strings.
- PF rules go in anchor `com.apple/sbx/uid_<uid>`.

### Planning to Implementation Flow (Sandbox Only)
*   **Planning Agent**: When a plan is ready and saved to `PLAN.md`, always end your message with: "To proceed with this plan, enter `/switch build`".
*   **Build Agent**: Always read `PLAN.md` before starting work. Mark items as completed once implemented.

### Configuration & Assets
*   **Local Setup**: `opencode.json` and `.opencode/` in repo root.
*   **Sandbox Setup**: `opencode.sandbox.json` and `.opencode.sandbox/` — deployed to `~/.config/opencode/` inside the sandbox during provisioning.

## Developing Shims

To add a new intercepted command:
1.  Add the command to `allowedCommands` in `src/lib/bridge/CommandBridge.ts`.
2.  Create a python shim in `src/lib/provision/` (inside `deployShims`).
3.  Ensure the shim correctly handles input/output streaming via the bridge socket.

## Safety Boundaries

*   **Filesystem**: Isolated (Sandbox home).
*   **Processes**: Isolated (Sandbox user).
*   **Secrets**: Isolated (Host side).
*   **Network**: Shared (Host IP). Optionally restricted via PF + TrafficProxy.
*   **Kernel**: Shared (No protection).
