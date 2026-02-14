# SBX Architecture

SBX is a secure, isolated development environment for autonomous agents on macOS. It leverages native macOS isolation mechanisms to provide a "guest" environment that feels like a full machine while protecting the host and its secrets.

## High-Level Overview

SBX follows a "Host-Guest" model where the guest is a dedicated macOS user account. Communication between the host and guest is strictly controlled through a set of shims and proxies.

```ascii
+-------------------------------------------------------------+
|                        Host (macOS)                         |
|                                                             |
|  +------------------+       +----------------------------+  |
|  |   SBX Controller | <---> | Persistence (SQLite)       |  |
|  |   (Bun)          |       +----------------------------+  |
|  +------------------+                                       |
|          |                                                  |
|          | (1) Create Guest User                            |
|          v                                                  |
|  +-------------------------------------------------------+  |
|  |               Guest (Sandboxed User Account)           |  |
|  |               sbx_<host_user>_<instance_id>           |  |
|  |                                                       |  |
|  |  +----------------+       +-----------------------+   |  |
|  |  |  Agent Logic   | <---> |  Tools (pkgx)         |   |  |
|  |  |  (OpenCode)    |       |  (git, python, etc.)  |   |  |
|  |  +----------------+       +-----------------------+   |  |
|  |          |                      ^                     |  |
|  |          | (2) Exec Shim        | (4) Exec Command    |  |
|  +----------|----------------------|---------------------+  |
|             |                      |                        |
|  +----------v----------------------|---------------------+  |
|  |           (3) Host Bridge (Secrets & API)             |  |
|  |  - Validates command & arguments                      |  |
|  |  - Injects host-side secrets (GH_TOKEN, etc.)         |  |
|  |  - Executes command on host (but in guest context)    |  |
|  +-------------------------------------------------------+  |
+-------------------------------------------------------------+
```

---

## Core Subsystems

### 1. Identity Engine (macOS Isolation)

The Identity Engine (`MacOSIdentityManager`) manages the lifecycle of native macOS user accounts. This is the foundation of SBX's security, relying on OS-level boundaries to separate the agent's environment from the host.

```ascii
      [ HOST SPACE ]                        [ GUEST SPACE ]
   (User: thibaut, 501)                  (User: sbx_thibaut_a1, 701)
          |                                      |
          |          /Users/ Directory           |
          |                  |                   |
   /Users/thibaut/ <---------+---------> /Users/sbx_thibaut_a1/
      (mode: 700)                         (mode: 700 + ACLs)
          |                                      |
          | <--- (A) NO ACCESS (POSIX 700) ----- |
          |                                      |
          | ---- (B) READ/WRITE ACCESS --------> |
          |      (via Host Bridge & ACLs)        |
```

The diagram above illustrates the strict cryptographic and POSIX-level boundary between the host and guest.
- **(A) Privacy Enforcement**: Standard POSIX permissions (`700`) on the host's home directory ensure that the sandbox user, even if it discovers the host's username, cannot list, read, or traverse any of the host's files.
- **(B) Managed Orchestration**: The host user (or the SBX controller running as the host user) retains the ability to inspect and manage the sandbox. This is achieved via the `AclManager`, which applies specific macOS Access Control Lists (ACLs) to the sandbox directory, allowing the host to monitor progress and perform cleanup without granting reciprocal rights to the guest.

**How it works:**
- **`sysadminctl`**: A macOS system utility used to programmatically create and delete standard user accounts. SBX creates "Standard" (non-admin) accounts that lack the ability to modify system settings.
- **`dscl` (Directory Service Command Line)**: SBX uses this utility to interact with the Open Directory service. It allows the system to verify user existence, read metadata (like `UniqueID`), and ensure that the sandbox identity is properly registered in the system's database.
- **`chmod 700`**: By setting the home directory of both host and guest to `700`, the macOS kernel prevents any cross-user file access. This is a battle-tested primitive of Unix security.
- **`AclManager`**: Beyond simple POSIX bits, SBX uses ACLs to grant the host user unidirectional access. This allows the host to "reach into" the sandbox to read logs or write configurations while the guest remains trapped within its own directory tree.

**Allows:**
- Execution of any binary available on the system as a non-privileged user.
- Full access to the dedicated guest home directory (`/Users/sbx_...`).
- Standard network access (originating from the host IP).

**Doesn't Allow:**
- **Host Data Access**: Reading or writing to the host user's home directory is blocked by the kernel.
- **Privilege Escalation**: The guest is a "Standard" user. Commands like `sudo` are effectively useless because the guest account has no password and is not in the `sudoers` file, preventing the agent from gaining root access.
- **System-Wide Persistence**: While the sandbox home persists during the session, it is not part of the host's backup or permanent identity. Once a sandbox is deleted via `sysadminctl`, all guest-specific system metadata is purged.

---

### 2. Provisioning System

The Provisioner (`Provisioner`) transforms a raw macOS user into a ready-to-use agent environment by "baking" in shims and toolchains.

```ascii
[Guest Shell] --> [.zshrc / .bashrc] --> [Path: ~/bin:...]
                                             |
                                             +-- [git] (Shim)
                                             +-- [gh]  (Shim)
                                             +-- [pkgx] (Tool Manager)
```

**How it works:**
- **Shim Deployment**: SBX places Python-based scripts in `~/bin` and modifies the shell `PATH`. When an agent runs `git push`, it is actually calling the SBX shim.
- **Authentication Gap**: This is a critical security feature. While the agent *could* theoretically find and call the real `/usr/bin/git`, doing so would fail for any operation requiring authentication (like pushing to a private repo). The real binary has no access to the host's credentials. The SBX shim, however, forwards the request to the Host Bridge which *does* have access to the secrets.

**Allows:**
- Transparent use of `git` and `gh` as if the agent were the host, provided they use the provided shims.
- Dynamic installation of compilers, runtimes, and CLI tools via `pkgx`.

**Doesn't Allow:**
- **Unauthenticated Binary Usage**: Direct calls to system binaries (e.g., `/usr/bin/git`) for sensitive operations will fail due to a lack of credentials within the sandbox environment.
- **Shim Modification**: Shims are deployed to a location the guest is configured to treat as its toolchain, and any attempt to modify them is logged and visible to the host.

---

### 3. Host-Guest Bridge

The Bridge (`CommandBridge`) is a Unix socket server running on the host that handles "privileged" operations for the guest.

```ascii
 [Guest]                         [Host]
  Shim (git push) ----------> Bridge (Unix Socket)
                                 |
                                 +-- 1. Validate Args
                                 +-- 2. Inject Secrets (GITHUB_TOKEN)
                                 +-- 3. Run real /usr/bin/git
  Result <-----------------------+
```

**How it works:**
- **Unix Sockets**: Communication happens over a local file-based socket. The socket itself is protected by macOS ACLs so that only the specific sandbox user can connect to it.
- **Command Validation**: The bridge acts as a firewall for CLI commands. It parses arguments and rejects dangerous patterns (e.g., `git config` modifications or `git --exec-path`).

**Allows:**
- Securely pushing to GitHub without ever exposing the `GH_TOKEN` to the guest's environment.
- Centralized auditing of all "outbound" or sensitive commands.

**Doesn't Allow:**
- **Arbitrary Execution**: Only a predefined whitelist of commands (`git`, `gh`, etc.) are permitted through the bridge.
- **Secret Leaks**: Because the bridge injects secrets into the *process environment* of the command it runs on the host, the guest never sees the raw token strings.

---

### 4. API Proxy

The `ApiProxy` provides a secure way for agents to call LLM providers (OpenAI, Anthropic, Google) without seeing the API keys.

```ascii
 [Guest Agent]                    [Host Proxy]                   [LLM Provider]
  POST localhost:proxy/openai --> Bridge Socket --> Inject Key --> api.openai.com
```

**How it works:**
- **Key Injection**: The proxy listens on a local socket. When it receives a request destined for an LLM provider, it injects the appropriate API key (from the host's environment) into the request headers before forwarding it to the internet.
- **Instant Secret Updates**: Because the keys are managed entirely on the host side by the proxy, you can update an API key in the host configuration and all subsequent requests from the sandbox will use the new key immediately. There is no need to restart or re-provision the guest environment to "rotate" secrets.

**Allows:**
- Agents to use standard LLM SDKs (like `openai` or `anthropic` python libs) by simply pointing the `base_url` to the local proxy.

**Doesn't Allow:**
- **Credential Theft**: Even if the agent's code is compromised or malicious, it cannot "print" the API key because the key never exists in the guest's memory space.

---

### 5. Network Security (Dual-Layer)

SBX employs a dual-layer network security model to prevent unauthorized data exfiltration and restrict the agent to a "whitelist-only" internet access.

```ascii
 [Guest Agent]
      |
      +-- (A) Kernel Firewall (PF) -- [BLOCKS ALL EXCEPT 127.0.0.1]
      |
      +-- (B) Traffic Proxy (Node) -- [DOMAIN WHITELIST]
```

**How it works:**

1.  **Layer 1: Kernel Firewall (PF)**:
    - SBX uses macOS `pfctl` to create a dedicated anchor (`com.apple/sbx`) for the sandbox user.
    - A "block all" rule is applied to the specific UID of the sandbox guest.
    - Exceptions are only made for `127.0.0.1` on specific ports (API Bridge and Traffic Proxy).
    - **Logging**: The block rule uses the `log` keyword, and SBX monitors the `pflog0` interface via a background `NetworkMonitor` service. This allows the system to alert the user when "raw" (non-proxy) network traffic (like a direct TCP connection or UDP packet) is blocked.

2.  **Layer 2: Interactive Traffic Proxy**:
    - The guest environment is provisioned with `HTTP_PROXY` and `HTTPS_PROXY` environment variables pointing to a local proxy running on the host.
    - The proxy enforces a **Domain Whitelist** (stored in SQLite and configurable per sandbox).
    - **Interactive Approval**: When the agent attempts to access a non-whitelisted domain, the proxy blocks the request and notifies the user (e.g., via Zulip). The user can then grant access in real-time using the `/allow <domain>` command.
    - **Wildcard Support**: The whitelist supports wildcard domains (e.g., `*.google.com`).

**Allows:**
- Full internet access to trusted domains (GitHub, NPM, PyPI, etc.) out of the box.
- Dynamic expansion of the "permitted" internet as the agent discovers new requirements.
- Real-time visibility into all network attempts.

**Doesn't Allow:**
- **Stealth Exfiltration**: Direct connections to IP addresses or non-whitelisted domains are blocked at the kernel level.
- **Protocol Tunneling**: Even if the agent tries to use a non-HTTP protocol, the PF firewall will catch and log it.

---

### 6. Sandbox Runtime

The `SandboxManager` orchestrates the lifecycle and state of all sandboxes, ensuring that the ephemeral nature of the guests is managed correctly.

**Persistence vs. Ephemerality:**
- **Guest Data (Ephemeral)**: The files, installed tools, and shell history within the `/Users/sbx_...` directory are temporary. They persist as long as the sandbox exists but are purged upon deletion.
- **Session Metadata (Persistent)**: SBX maintains a SQLite database on the host. This database tracks the existence of sandboxes, their associated host users, and their current state (active, archived, or deleted). This allows SBX to "resume" or "reconnect" to an existing sandbox across restarts of the SBX controller.

---

## Security Model

SBX is built on the principle of **Defense in Depth**. While no sandbox is perfect, SBX layers multiple protections.

### Data Leakage & Shim Risks
The core risk in any autonomous agent environment is **Data Exfiltration**.

> **Warning:** Anything the sandbox can see, it can leak.

If you add a shim for a powerful tool like `gcloud` or `aws`, you create a potential bridge for data leakage:
1. The agent uses the shim to download sensitive data from a private bucket/database (permitted because the bridge injects credentials).
2. The agent then uses its general internet access (via `curl` or `python`) to upload that data to an attacker-controlled server.

### Mitigations & Best Practices

1. **Principle of Least Privilege**: Do not give the sandbox your primary "Owner" or "Admin" tokens. Create a dedicated GitHub PAT with minimal scopes (e.g., just `repo` access for specific repositories) or a specific Cloud Service Account with "Read Only" access.
2. **Restricted Shims**: Only add shims for tools the agent *must* use. Every shim is a potential window into your private data.
3. **Assume Exposure**: Treat the sandbox as a public environment. Never place highly sensitive files (like `.env` files with production keys) in the guest's home directory.
4. **Unidirectional Access**: Leverage the fact that the host can see the guest but not vice-versa. Monitor the sandbox's home directory from the host to audit what the agent is doing.

---

## Testing & Verification

The system is tested across multiple layers:
- **Unit Tests**: Test individual components like `SecretManager`, `AclManager`, and `IdentityManager`.
- **Integration Tests**: Verify the bridge communication, CWD handling, and multi-turn API interactions.
- **Subsystem Tests**: Validate identity creation/deletion and provisioning logic.
