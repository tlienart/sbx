# Security Improvements Deep Dive (v1)

This document outlines the security model of `sbx` and identifies areas for reinforcement.

## 1. Current Security Model

`sbx` relies on two main pillars for isolation:
1.  **macOS User Accounts**: Leverages `sysadminctl` to create standard macOS user accounts. This provides native process and file isolation.
2.  **Host-Bridge Architecture**: Instead of passing secrets (GitHub tokens, LLM API keys) into the sandbox, a bridge running on the host intercepts calls to sensitive tools and executes them in an isolated environment on the host, returning only the result.

## 2. Identified Vulnerabilities & Weaknesses

### A. Bridge CWD Traversal
The bridge checks if the `cwd` starts with `/Users/sbx_`. However, it does not normalize the path.
**Risk**: A malicious process in the sandbox could pass a `cwd` like `/Users/sbx_demo/../../../etc`. Since this starts with `/Users/sbx_`, it passes the check, but `spawn()` will resolve it to `/etc`.
**Impact**: The host user (bridge owner) could be tricked into running `git` or `gh` in host-sensitive directories.

### B. Over-broad Socket Permissions
Unix sockets in `/tmp/.sbx_${hostUser}` are currently created with `777` permissions.
**Risk**: While the parent directory is `711`, any user who can guess the path can technically connect to the socket.
**Impact**: Potential unauthorized access to the host bridge from other users on the same machine.

### C. Network Isolation
Sandboxes have full internet access.
**Risk**: Compromised agents can be used for outbound malicious activity (DDoS, mining, exfiltration).
**Impact**: High. Sbx does not currently provide network-level sandboxing.

### D. Resource Exhaustion
There are no limits on CPU, Memory, or Disk usage for sandbox users.
**Risk**: Rogue processes can hang the host machine.
**Impact**: Medium. Standard macOS process management applies, but no specific quotas are enforced.

## 3. Proposed Improvements (Roadmap)

### Priority 1: Bridge Hardening
- [x] **CWD Normalization**: Implement `path.resolve` and verify that the resulting path is strictly within the sandbox home directory. (Completed in v0.1.1+)
- [x] **Socket Permissions**:
    - Use ACLs (`chmod +a`) to grant only the specific sandbox user access to the Unix sockets. (Completed in v0.1.1+)
- [x] **Command Sanitization**: Strictly validate arguments passed to the bridge. (Completed: Blocked dangerous flags for git and gh)

### Priority 2: Style & Type Reinforcement
- [x] **Strict Typing**: Eliminate `any` in catch blocks. Use `unknown` and type guards. (Completed)
- [x] **TSC Integration**: Ensure `tsc --noEmit` is part of the core CI/CD and `make check`. (Completed)
- [x] **Linting**: Enable Biome's `noExplicitAny` rule. (Completed)

### Priority 3: Isolation & Resource Control
- [ ] **Resource Limits**: Explore using `ulimit` or `launchctl` to set memory and CPU caps for sandbox users.
- [ ] **Network Egress**: Document or implement `pfctl` rules to restrict sandbox user networking (e.g., block all but specific ports/domains).

## 4. Security Recommendations for Users

- **Restrict Home Permissions**: Ensure your host home directory is set to `700` (`chmod 700 ~`) to prevent the sandbox user from reading your files.
- **Fine-grained Tokens**: Always use GitHub Fine-grained PATs with minimal repository access.
- **Monitor Processes**: Regularly use `sbx list` and `sbx cleanup` to manage active sessions.
