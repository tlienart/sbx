# Sandbox Permissions & Isolation Patterns

This document outlines the current filesystem permission architecture for SBX sandboxes and the trade-offs involved in balancing security, host-bridge functionality, and system performance.

## Current Architecture: `755` (Open Homes)

As of the current implementation, sandbox home directories (`/Users/sbx_...`) are set to `755` (`drwxr-xr-x`).

### Why `755`?
*   **Host Bridge Access**: The SBX Host Bridge runs as the host user. To perform operations like `git push` or `gh pr create` inside a sandbox, the bridge must be able to "enter" and read files within the sandbox home directory.
*   **Simplicity**: Standard macOS permissions are easier to manage than complex ACL (Access Control List) stacks, which can sometimes behave inconsistently during user creation or home directory migration.

### Trade-offs & Risks
*   **Leakage**: Since the directories are world-readable, any sandbox user can `ls` and `read` files in another sandbox's home directory (including `$HOME/tmp`).
*   **Isolation Level**: This provides **Process Isolation** (users cannot kill each other's processes) and **Write Isolation** (users cannot modify each other's files), but NOT **Read Isolation**.

## Proposed Architecture: `700` + ACLs (Private Homes)

To achieve full read isolation, we can transition to a "Locked-Down" pattern.

### The Pattern
1.  **Restrict Bits**: Set home directory to `700` (`drwx------`).
2.  **Host ACL**: Explicitly grant the host user full access using macOS ACLs:
    ```bash
    chmod +a "user:<host_user> allow list,add_file,search,read,write,delete,file_inherit,directory_inherit" /Users/sbx_...
    ```

### Pros
*   **True Isolation**: Sandbox A gets "Permission denied" when attempting to look at Sandbox B.
*   **Security**: Protects sensitive artifacts (e.g., `.git` metadata, local caches) from other potentially untrusted agents.

### Cons/Challenges
*   **ACL Fragility**: macOS `sysadminctl` and Directory Services sometimes strip or ignore ACLs during certain phases of user lifecycle.
*   **Complexity**: Requires precise application of inheritance flags to ensure the host bridge can still see *newly* created files inside the sandbox.

## Handling `$TMPDIR`

SBX currently maps `$TMPDIR` to `$HOME/tmp` within each sandbox.

*   **Current State**: Inherits the `755` (or `700`) of the home directory.
*   **Shared Patterns**: If we want to allow sandboxes to share data via a common folder while keeping their homes private, we would need to move `tmp` outside of the home directory or apply specific "Relaxation ACLs" to that subfolder.

## Summary of Decisions

| Feature | Current (`755`) | Proposed (`700` + ACL) |
| :--- | :--- | :--- |
| **Host User Access** | Via standard bits | Via specific ACL |
| **Sandbox Cross-Read** | Allowed | Blocked |
| **Sandbox Cross-Write** | Blocked | Blocked |
| **Performance** | High | Medium (ACL evaluation) |
| **Implementation Complexity** | Low | High |
