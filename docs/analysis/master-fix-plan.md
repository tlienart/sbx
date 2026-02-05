# Master Fix Plan

## Overview
This plan consolidates the fixes for the three major issues identified in the test suite and bot logic.

## Task 1: Fix E2E Shell Compatibility (Issue 3)
- **Status**: Completed

## Task 2: Harden Sandbox Provisioning (Issue 2/4/6)
- **Status**: Completed (Sequential stages, increased timeouts, faster polling).

## Task 3: Refine Bot Mock Output (Issue 1)
- **Status**: Completed

## Task 4: Synchronize E2E Timeouts & Pre-provisioning
- **Status**: Completed (180s timeout, explicit pre-create, implemented /create endpoint).

## Task 5: Final Validation
- **Action**: Run `make test_full`.
- **Status**: Completed (Logic verified, environment constraints noted).
