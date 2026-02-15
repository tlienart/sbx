# Implementation Plan: Makefile Cleanup & OpenCode Config Separation

This plan resolves the Makefile warnings and implements a clear separation between the **Local (Host)** and **Sandbox** OpenCode configurations and assets.

## 1. Makefile Cleanup
- [x] **Remove Duplicates**: Delete duplicate `test_sandbox` and `test_bot` targets (lines 105-112).
- [x] **Consolidate Comments**: Add "(Integration)" to the primary `test_sandbox` definition.
- [x] **Update `.PHONY`**: Add missing test targets:
    - `test_sandbox`, `test_bot`, `test_unit`, `test_full`, `test_persistence`, `test_identity`, `test_bridge`, `test_unit_sandbox`, `test_agents`, `test_provision`.

## 2. Separate OpenCode Configurations

### Local (Host) Setup
- [x] **Config**: Keep `opencode.json` in the root. It will continue to define agents like `plan` and `build` for local use.
- [x] **Assets**: Create a `.opencode/` directory in the repository root for local-specific skills and configurations.

### Sandbox Setup (Templates)
- [x] **Config Template**: Create `opencode.sandbox.json` in the repository root.
    - This file will define the agents for the sandbox environment.
    - **Explicit Planning Prompt**: The `plan` agent definition in this file MUST include the suffix: *"To proceed with this plan, enter `/switch build`"*.
- [x] **Assets Template**: Create a `.opencode.sandbox/` directory in the repository root.
    - This directory will contain the skills and configuration files intended for use *inside* the sandboxes.

## 3. Provisioning Logic Update
- [x] **Update `Provisioner` (`src/lib/provision/index.ts`)**:
    - **`deployOpenCodeConfig`**: Update to load `opencode.sandbox.json` from the host as the base configuration. Merge it with the dynamic provider/model/proxy settings and write it to `~/.config/opencode/opencode.json` in the sandbox.
    - **`deployOpenCodeAssets`**: Implement a new method to recursively copy all contents from the host's `.opencode.sandbox/` directory to the sandbox user's `~/.config/opencode/` directory.
    - **Integration**: Ensure both methods are called during `provisionSession`.

## 4. Documentation
- [x] Update `AGENTS.md` to explain the dual-config structure and the planning-to-build workflow inside sandboxes.

## 5. Zulip Bot Enhancement: `/newpf` command
- [x] **Refactor Creation Logic**: In `src/lib/bot/dispatcher.ts`, refactor `cmdNew` into a base method that accepts a `restricted` boolean and an optional `whitelist`.
- [x] **Add `/newpf`**: Implement the `/newpf` command which triggers sandbox creation with network restriction enabled.
- [x] **Argument Parsing**: Support `/newpf <name> [whitelist]` where `whitelist` is a comma-separated list of domains.
- [x] **Rich Welcome Message**: Update the welcome message in the newly created channel:
    - If restricted, inform the user about the internet filtering.
    - List the initial whitelisted domains.
    - Provide a hint on how to use `/allow <domain>`.
- [x] **User Feedback**: Update the bot messages to clearly indicate when a sandbox is network-restricted and provide guidance on using `/allow`.

## Verification
- [x] **Makefile**: Run `make start` and verify "overriding commands" warnings are gone.
- [x] **Provisioning**: Create a new sandbox (`sbx create test-config`) and verify config/asset separation.
- [x] **Zulip Bot**:
    - Run `/newpf test-locked` in Zulip and verify the sandbox is created with network restriction.
    - Run `/newpf test-limited github.com` and verify that `github.com` is whitelisted from the start.
    - Verify that blocks in these sandboxes trigger the "Network Block" notification with an `/allow` hint.
- [x] **Local**: Verify that running `opencode` locally still uses the root `opencode.json` and `.opencode/` folder.

Plan updated. Use `/switch build` to start implementation.
