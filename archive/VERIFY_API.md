# Systematic API Verification

Follow these steps to verify that the `sbx` API server is working correctly.

## 1. Setup
Ensure your environment variables are set on the host:
```bash
export SBX_GOOGLE_API_KEY="your_key"
export SBX_GITHUB_TOKEN="your_token"
```

Start the server:
```bash
./bin/sbx serve
```

## 2. Test Chunk 1: Raw Execution
Verify that the sandbox can run basic commands.

```bash
curl -X POST http://localhost:3000/raw-exec \
  -H "Content-Type: application/json" \
  -d '{"instance": "verify", "command": "whoami && uptime"}'
```
**Expected:** `stdout` contains `sbx_..._verify` and `exitCode: 0`.

## 3. Test Chunk 2: OpenCode Integration
Verify that OpenCode can be called and creates files.

```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{"instance": "verify", "prompt": "write a one line hello world python script to hello.py", "mode": "build"}'
```
**Expected:** JSON response with `output` and `sessionId`.

## 4. Test Chunk 3: Multi-turn Persistence
Verify that the LLM maintains context using the `sessionId`.

*Note: Replace `SESSION_ID_FROM_STEP_3` with the actual ID returned in the previous step.*

```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "instance": "verify", 
    "prompt": "now change that script to say hi instead of hello", 
    "sessionId": "SESSION_ID_FROM_STEP_3"
  }'
```
**Expected:** The response should acknowledge the change. Verify with:
```bash
curl -X POST http://localhost:3000/raw-exec \
  -H "Content-Type: application/json" \
  -d '{"instance": "verify", "command": "cat hello.py"}'
```

## 5. Test GitHub Interception
Verify that `gh` is proxied correctly.

```bash
curl -X POST http://localhost:3000/raw-exec \
  -H "Content-Type: application/json" \
  -d '{"instance": "verify", "command": "gh auth status"}'
```
**Expected:** `stdout` shows authentication status using the host's token.
