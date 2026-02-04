# Sbx Agent Architecture & Guidelines

This document provides guidance for developing and running autonomous agents within the Sbx environment.

## Architecture

Agents run as a standard macOS user within an isolated session. They interact with the host and the outside world through the following mechanisms:

1.  **Isolated Shell**: Agents execute commands via `sbx exec` or the API server's `/raw-exec` and `/execute` endpoints.
2.  **Host Bridge**: Sensitive commands (like `git push` or `gh pr create`) are intercepted by shims in the sandbox and forwarded to a bridge running on the host. This keeps secrets on the host.
3.  **API Proxy**: Requests to LLM providers are proxied through the host bridge, which injects API keys. The sandbox only sees `SBX_PROXY_ACTIVE`.
4.  **Toolchain (pkgx)**: Agents have access to a vast, on-demand toolchain. They should prefer using `pkgx` to install and run tools.

## Guidelines for Agents

### 1. File System Access
*   **Stay in Home**: Always operate within your home directory (`/Users/sbx_...`).
*   **Temporary Files**: Use `$TMPDIR` (usually `~/tmp`) for temporary files.
*   **Host Isolation**: Do not attempt to access `/Users/<host_user>`. It is protected by OS-level permissions.

### 2. Network Usage
*   **Full Access**: You have full internet access.
*   **Be Responsible**: Avoid excessive bandwidth usage or malicious activity, as it will be traced back to the host IP.

### 3. Security & Ethics
*   **No Secret Leakage**: Never attempt to exfiltrate tokens or keys. The bridge is designed to prevent this.
*   **Resource Management**: Be mindful of CPU and Memory usage. High-intensity tasks may impact the host machine.
*   **Sudo Usage**: While you may have `sudo` access if configured, prefer running as a standard user.

## Developing Shims for Agents

If you need to add a new intercepted command:
1.  Add the command to `allowedCommands` in `src/lib/bridge.ts`.
2.  Create a python shim in `src/lib/provision.ts` (inside `deployShims`).
3.  Ensure the shim correctly handles input/output streaming via the bridge socket.

## Safety Boundaries

*   **Filesystem**: Isolated (Sandbox home).
*   **Processes**: Isolated (Sandbox user).
*   **Secrets**: Isolated (Host side).
*   **Network**: Shared (Host IP).
*   **Kernel**: Shared (No protection).
