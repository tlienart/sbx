# Analysis: Issue 6 - Timeout Mismatch between Client and Server

## Symptoms
`make test_e2e` fails during parallel session testing with `error: script "test:api" exited with code 28` (CURL timeout).
Server logs show it was still in the middle of provisioning `e2e-beta`.

## Root Cause
1. **Client Timeout**: `scripts/test_e2e.sh` uses `curl -m 60`, limiting requests to 60 seconds.
2. **Server Latency**: Sandbox provisioning on macOS can take up to 150-180s under load due to `opendirectoryd` propagation delays.
3. **Implicit Creation**: The parallel tests trigger sandbox creation implicitly on the first `raw-exec` command. If two creations happen nearly simultaneously, system load increases, and at least one is likely to exceed the 60s client timeout.

## Solution Plan
1. **Increase Client Timeout**: Set `curl -m 180` in the E2E script.
2. **Explicit Pre-creation**: Call `/create` for `e2e-alpha` and `e2e-beta` explicitly at the start of the parallel section.
3. **Optimize Server Polling**: Reduce polling interval for Stage 1 (Unix record) from 1000ms to 250ms to speed up the happy path.
4. **Critical Visibility**: Promote "Stage" logs in `waitForUserReady` from `debug` to `info` for better failure analysis.

## Verification
- Run `make test_full`.
- Verify that `e2e-alpha` and `e2e-beta` creation logs appear BEFORE their first usage in tests.
