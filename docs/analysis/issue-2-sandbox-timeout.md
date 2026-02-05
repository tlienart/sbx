# Analysis: Issue 2 - Sandbox Stage 2 Timeout

## Symptoms
`make test_sandbox` fails at Stage 2:
```text
✖ Stage 2 Failed: User sbx_thibaut_stage-test setup timed out (active: true, identity: false, network: false).
```

## Root Cause Analysis
Propagation delay in macOS `opendirectoryd`.
The user record exists but `su -` fails.

## Solution Plan
1. **Harden `waitForUserReady`**: Flush directory cache if identity check fails.
2. **Relax `sysadminctl` Lifecycle**: Increased grace period before SIGKILL.

## Verification Logic
1. Run `make test_sandbox`.
