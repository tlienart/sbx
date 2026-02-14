# Plan: Fix Blocked/Suspicious CI and Network Issues

The recent CI failure in PR #18 was caused by background processes preventing the CLI from exiting and misconfigured proxy environment variables.

## Problem Analysis
1.  **Background Process Hang**: The `DefaultSandboxManager` constructor proactively starts a `tcpdump` process (via `NetworkMonitor`) and initializes PF. Because `tcpdump`'s stdout is piped and being read in an infinite loop, the Bun process never reaches an idle state and fails to exit after a CLI command (like `sbx create` or `sbx list`) finishes.
2.  **Proxy Configuration Bug**: `sbx create` (without `--restrict-network`) was still configuring the sandbox user's profile with `HTTP_PROXY` environment variables. However, the `TrafficProxy` itself was only started if `restrictedNetwork` was true. This caused `pkgx` to attempt connecting to a non-existent proxy, resulting in "Connection refused" errors during provisioning.
3.  **Global PF Side Effects**: Proactively enabling PF globally (`pfctl -e`) in the constructor is risky and can lead to unexpected network behavior in shared environments like CI.

## Proposed Changes

### 1. Lazy Network Initialization
- [x] Remove `setupNetworkMonitor()` call from `DefaultSandboxManager` constructor.
- [x] Add an explicit `initNetwork()` method to `SandboxManager` that enables PF and starts the monitor.
- [x] Call `initNetwork()` only when necessary:
    - In `serveCommand` and `botCommand` during startup.
    - In `createSandbox` IF `options.restrictedNetwork` is true.

### 2. Fix Proxy Environment Variables
- [x] In `DefaultSandboxManager.createSandbox`, only pass the `proxyPort` to `provisionSession` if `options.restrictedNetwork` is true.
- [x] Ensure `provisionSession` handles the missing `proxyPort` gracefully (it already does, but verify).

### 3. Graceful Exit for CLI
- [x] Update `NetworkMonitor.ts` to call `.unref()` on the `tcpdump` subprocess. This ensures it doesn't prevent the parent process from exiting if it's the only thing keeping it alive.

### 4. Safety in `NetworkManager`
- [x] Update `NetworkManager.init()` to be more cautious.
- [x] Consider only creating `pflog0` if it doesn't exist.

## Verification Steps
- [ ] **CLI Exit Check**: Run `sbx list` and `sbx create` (without `--restrict-network`) and verify they exit immediately after printing their output.
- [ ] **Provisioning Check**: Run `sbx create test-pkgx` and verify that `pkgx` can successfully fetch tools during provisioning (no "Connection refused").
- [ ] **Network Restriction Check**: Run `sbx create test-locked --restrict-network` and verify that:
    - Networking is actually restricted in the sandbox.
    - `tcpdump` captures and logs blocks as expected.
- [ ] **CI Run**: Push the changes and verify the GHA run completes successfully.

Plan updated. Use `/switch build` to start implementation.
