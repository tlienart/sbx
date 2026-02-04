# WORK_CHUNK_2: OpenCode Integration (Single Turn)

## 1. Scope
*   Implement `POST /execute` endpoint.
*   Input: `{ "instance": "name", "prompt": "...", "mode": "build", "provider": "google" }`
*   Logic:
    *   Construct `opencode run --prompt "<prompt>" --agent <mode>` command.
    *   Run it in the sandbox.
    *   Return stdout/stderr and exit code.
*   Ensure LLM provider config is respected if passed.

## 2. Automated Tests
A new test file `tests/api_opencode.test.ts` will:
1.  Send a `POST /execute` with a simple prompt like "echo 'test' > opencode_test.txt".
2.  Verify the output reflects opencode running.
3.  Check that the file `opencode_test.txt` was created in the sandbox.

## 3. Manual Verification Steps
1.  Run `sbx serve`.
2.  Run:
    ```bash
    curl -X POST http://localhost:3000/execute \
      -H "Content-Type: application/json" \
      -d '{"instance": "testopencode", "prompt": "say hi", "mode": "build"}'
    ```
3.  Verify the response contains "hi" or similar from the LLM.
