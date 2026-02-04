# WORK_CHUNK_B_1: Bridge Path Mapping & Workspace Isolation

## 1. Scope
*   **Grant Bridge Access**: Update sandbox home permissions so the host user (and thus the bridge) can enter sandbox directories.
*   **Strict CWD Enforcement**:
    *   Modify the bridge to explicitly `cd` into the requested sandbox directory.
    *   Fail the command immediately if the directory is inaccessible or outside the sandbox home.
    *   Remove the fallback to the host's current directory.

## 2. Implementation Strategy
*   **Permissions**: In `src/lib/provision.ts`, update the `createSessionUser` logic to ensure the home directory is reachable by the host user (e.g., `chmod 711` or ACL).
*   **Bridge Logic**: In `src/lib/bridge.ts`, update `handleRequest` to validate and `chdir` into the sandbox path before spawning the command.

## 3. Verification Steps
1. Create a directory inside the sandbox (e.g., `mkdir my-project`).
2. Run `curl ... /raw-exec -d '{"instance": "alpha", "command": "cd my-project && git init"}'`.
3. **Verify**: Check that `.git` exists in the sandbox: `/Users/sbx_..._alpha/my-project/.git`.
4. **Verify**: Ensure **no** `.git` was created or modified in your host project root.
