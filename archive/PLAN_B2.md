# Implementation Plan: Work Chunk B.2 (Hardening & Lifecycle)

This plan completes the remaining tasks for Work Chunk B.2.

## 1. Per-Instance Temp Directories
Isolate `/tmp` usage by redirecting it to a directory within each sandbox's home.

- **File**: `src/lib/provision.ts`
- **Changes**:
    - Update `setupScript` to include `export TMPDIR="$HOME/tmp"`.
    - In `provisionSession`, ensure `~/tmp` exists and has `700` permissions.
    - Update `deployShims` to ensure any python/scripted parts also respect this if possible.

## 2. Bridge Lifecycle & Termination
Ensure that sandbox-side `api_bridge.py` processes do not leak when the server stops.

- **File**: `src/commands/serve.ts`
- **Changes**:
    - Enhance the `cleanup` function in `serveCommand` to:
        1. List all active sessions using `listSessions()`.
        2. Calculate their respective bridge ports using `getSandboxPort(instanceName)`.
        3. Terminate any process listening on those ports.
        4. Alternatively, use `pkill -f api_bridge.py` to be more thorough.

## 3. `sbx cleanup` Command
Add a dedicated command for manual cleanup of all SBX-related artifacts.

- **File**: `src/commands/cleanup.ts` (New)
- **File**: `src/index.ts` (Register command)
- **Logic**:
    1. Terminate all `api_bridge.py` processes.
    2. Remove all host-side bridge socket directories (`/tmp/.sbx_*`).
    3. Remove any stale setup files (`/tmp/sbx_setup_*`).

## 4. Health Check Endpoint
Provide a way to inspect the state of the API server and its managed bridges.

- **File**: `src/commands/serve.ts`
- **Changes**:
    - Add `GET /status` endpoint.
    - Response schema:
      ```json
      {
        "status": "ok",
        "instances": [
          {
            "name": "alpha",
            "user": "sbx_host_alpha",
            "bridgePort": 14918,
            "bridgeActive": true
          }
        ]
      }
      ```

## Verification Steps
1. **Temp Isolation**: 
   - Start `alpha`. Run `touch /tmp/test-alpha` inside it.
   - Verify `/Users/sbx_..._alpha/tmp/test-alpha` exists.
   - Verify `/tmp/test-alpha` on host does **NOT** exist.
2. **Cleanup**:
   - Start server, trigger bridge for an instance.
   - Stop server.
   - Verify `ps aux | grep api_bridge.py` returns nothing.
3. **Manual Cleanup**:
   - Run `sbx cleanup`.
   - Verify `/tmp/.sbx_*` are gone.
4. **Status**:
   - `curl http://localhost:3000/status` and verify output.
