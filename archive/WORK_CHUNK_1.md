# WORK_CHUNK_1: API Server & Basic Sandbox Execution

## 1. Scope
*   Add `sbx serve` command to the CLI.
*   Implement a Bun HTTP server (default port 3000).
*   Implement `POST /raw-exec` endpoint:
    *   Input: `{ "instance": "name", "command": "..." }`
    *   Logic: Auto-create/provision instance if missing, run command, return output.
*   Ensure `SbxBridge` is initialized and managed by the server.

## 2. Automated Tests
A new test file `tests/api_basic.test.ts` will:
1.  Start the server.
2.  Send a `POST /raw-exec` with `whoami`.
3.  Verify the response contains the expected `sbx_...` username.
4.  Verify that running a command that creates a file actually creates it in the sandbox.

## 3. Manual Verification Steps
1.  Run `sbx serve`.
2.  In another terminal, run:
    ```bash
    curl -X POST http://localhost:3000/raw-exec \
      -H "Content-Type: application/json" \
      -d '{"instance": "testapi", "command": "uptime"}'
    ```
3.  Check that the output returns the system uptime.
4.  Run `sbx list` to confirm `testapi` was automatically created.
