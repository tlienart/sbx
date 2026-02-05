# Analysis: Issue 3 - E2E Shell Compatibility

## Symptoms
`make test_e2e` fails with Bun shell error.

## Root Cause
Bun's internal shell runner doesn't support subshells with redirections.

## Solution Plan
Execute the script using native `bash`.

## Verification Logic
1. Run `make test_e2e`.
