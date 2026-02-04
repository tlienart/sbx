# Comprehensive SBX Verification Suite

This document provides a sequence of commands to verify the health, isolation, and authentication of the SBX system.

## 1. Setup
Ensure the server is running with secrets:
```bash
export SBX_GITHUB_TOKEN="ghp_..."
export SBX_GOOGLE_API_KEY="AIza..."
./bin/sbx serve --port 3000
```

## 2. Connectivity & Health
```bash
# Check if server is up and see existing sessions
curl -s http://localhost:3000/status | jq
```

## 3. Hermeticity & Environment
```bash
# Step A: Verify Identity and User Space
curl -X POST http://localhost:3000/raw-exec \
     -H "Content-Type: application/json" \
     -d '{"instance": "verify", "command": "whoami && pwd"}'

# Step B: Verify TMPDIR Isolation
# We expect this to return a path inside /Users/sbx_.../tmp
# Note: the \$ evaluated inside single quotes in the shell will be sent literally to the API
curl -X POST http://localhost:3000/raw-exec \
     -H "Content-Type: application/json" \
     -d '{"instance": "verify", "command": "echo $TMPDIR && touch $TMPDIR/isolation_test && ls -l $TMPDIR/isolation_test"}'

# Step C: Verify CWD Security
# Ensures bridged commands don't leak into the host filesystem
curl -X POST http://localhost:3000/raw-exec \
     -H "Content-Type: application/json" \
     -d '{"instance": "verify", "command": "mkdir -p my-project && cd my-project && git init"}'
```

## 4. Bridged Authentication
```bash
# Step D: Verify GitHub Auth (Host Proxy)
curl -X POST http://localhost:3000/raw-exec \
     -H "Content-Type: application/json" \
     -d '{"instance": "verify", "command": "gh auth status"}'

# Step E: Verify Secret Redaction
# Ensure NO real keys are printed, only "SBX_PROXY_ACTIVE"
curl -X POST http://localhost:3000/raw-exec \
     -H "Content-Type: application/json" \
     -d '{"instance": "verify", "command": "env | grep -E \"GITHUB|GOOGLE|SBX\""}'
```

## 5. OpenCode (LLM) Integration
```bash
# Step F: Mode Switching (Research)
curl -X POST http://localhost:3000/execute \
     -H "Content-Type: application/json" \
     -d '{"instance": "verify", "prompt": "Identify the current user", "mode": "research"}'

# Step G: Mode Switching (Build / Action)
curl -X POST http://localhost:3000/execute \
     -H "Content-Type: application/json" \
     -d '{"instance": "verify", "prompt": "Create a file named PROOF.md with the current date", "mode": "build"}'
```

## 6. Cleanup
```bash
# Stop the server (Ctrl+C) then run:
./bin/sbx cleanup
```
