# WORK_CHUNK_B_2: Sandbox Hardening & Multi-Instance Verification

## 1. Scope
*   **Per-Instance Temp Dirs**: Configure sandbox sessions to use isolated temp directories (e.g., `~/tmp`) to avoid global `/tmp` collisions.
*   **Bridge Lifecycle**:
    *   Ensure that when the API server stops, all `api_bridge.py` processes in active sandboxes are terminated.
    *   Add a `sbx cleanup` command to purge all bridge processes and temporary sockets.
*   **Health Check Endpoint**: Add `/health` or `/status` to the server to report which instances have active bridges.

## 2. Implementation Strategy
*   Update `provisionSession` in `src/lib/provision.ts` to export `TMPDIR=$HOME/tmp`.
*   Update `serveCommand` in `src/commands/serve.ts` with a more robust cleanup listener.

## 3. Verification Steps
1. Start `alpha` and `beta`.
2. Verify both can write to `/tmp/id` (mapped to their respective homes) simultaneously.
3. Stop the server and verify no `api_bridge.py` processes remain using `ps`.
