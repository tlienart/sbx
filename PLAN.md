# Plan - Firewall & Network Whitelisting Improvements

This plan addresses the findings from the in-depth review of the SBX firewall implementation, with a focus on leveraging Bun's native performance.

## 1. Security Hardening
- [x] **Restrict Localhost Access**: Update `NetworkManager.ts` to only allow the sandbox UID to connect to specific ports (API and Proxy) on `127.0.0.1`.
- [x] **Use `quick` rules**: Ensure PF rules use the `quick` keyword to prevent accidental overrides by subsequent rules.
- [x] **IPv6 Support**: Ensure PF rules also cover IPv6 if enabled on the host.

## 2. Visibility & Alerting (Non-Proxy Traffic)
- [x] **Enable PF Logging**: Add the `log` keyword to the "block all" rule in `NetworkManager.ts`.
- [x] **PF log interface**: Create the `pflog0` interface during initialization (`ifconfig pflog0 create`).
- [x] **Network Monitor Service**: 
    - Implement a service using `Bun.spawn` to capture blocked packets via `tcpdump -ni pflog0`.
    - Parse the output to identify packets belonging to sandbox UIDs.
    - Emit an event when a raw network block occurs.
- [x] **User Notification**: Update `BotDispatcher` to handle "Raw Network Blocks" and alert the user that a non-HTTP request was blocked.

## 3. Bun Modernization
- [ ] **`Bun.serve` Migration**: Refactor `TrafficProxy.ts` to use `Bun.serve` instead of `node:http`. (Skipped: node:http is more reliable for CONNECT/forward proxy logic in Bun currently).
- [x] **Native File I/O**: Use `Bun.write` and `Bun.file` in `NetworkManager.ts` for temporary PF configuration files.

## 4. Reliability & Diagnostics
- [x] **Health Checks**: 
    - Check if PF is enabled (`pfctl -s info`).
    - Verify the SBX anchor is correctly referenced in `/etc/pf.conf`.
- [x] **Diagnostic Command**: Add a `/network` command to the bot to show current whitelist and PF status.

## 5. Documentation
- [x] **Architecture Update**: Document the dual-layer (PF + Proxy) approach in `ARCHITECTURE.md`.
- [x] **Troubleshooting Guide**: Provide clear steps for users if PF is disabled or blocked by third-party software.

## Discussion on Risk
The primary risk remains PF's dependency on system-level configuration. While SBX attempts to automate this, it may require user intervention on some systems. The logging mechanism and Bun-powered monitoring will help diagnose these issues with minimal overhead.
