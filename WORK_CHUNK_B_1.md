# WORK_CHUNK_B_1: Bridge Path Mapping & Workspace Isolation

## 1. Scope
*   **Fix Bridge CWD**: Prevent the bridge from falling back to the host root if the sandbox directory is inaccessible.
*   **Workspace Mapping**:
    *   Introduce a "Shared Workspace" concept.
    *   Commands run via the bridge should only be allowed to operate within specifically mapped paths or return an error if the path is inaccessible.
*   **Security**: Ensure `git` and `gh` calls from the sandbox cannot modify the `sbx` project itself or other sensitive host directories.

## 2. Implementation Strategy
*   Modify `SbxBridge.handleRequest` in `src/lib/bridge.ts`.
*   Validate the `request.cwd` against an allowed list or a specific "sandbox mount" point.
*   Implement a "Sandbox Root" on the host that maps to the sandbox home.

## 3. Verification Steps
1. Create a file in `sandbox-alpha`.
2. Run `git status` inside that directory from the sandbox.
3. The bridge must either correctly report the status of that isolated directory or fail safely, but **NEVER** return the status of the host's `sbx` repository.
