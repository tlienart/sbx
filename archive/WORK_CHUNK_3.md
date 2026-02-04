# WORK_CHUNK_3: Session Management & Multi-turn

## 1. Scope
*   Enhance `/execute` endpoint:
    *   Use `opencode run ... --format json`.
    *   Parse the JSON stream from opencode.
    *   Extract the `sessionID` and the response text.
    *   Return `{ "output": "...", "sessionId": "...", ... }`.
*   Support `continue` logic: if `sessionId` is passed, it correctly continues that session.

## 2. Automated Tests
A new test file `tests/api_multiturn.test.ts` will:
1.  Turn 1: Send "Create a file named `hello.txt` with content `world`".
2.  Capture the `sessionId` from the response.
3.  Turn 2: Send "What is in `hello.txt`?" using the captured `sessionId`.
4.  Verify the response contains "world".

## 3. Manual Verification Steps
1.  Run `sbx serve`.
2.  Run two consecutive curls, using the `sessionId` from the first one in the second one.
