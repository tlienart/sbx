#!/bin/bash
set -e

# Configuration
PORT=3000
URL="http://localhost:$PORT"
INSTANCE="verify"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color
BOLD='\033[1m'

echo -e "${BOLD}🚀 Starting SBX End-to-End Verification Suite${NC}"

# Cleanup on exit
cleanup() {
  echo -e "\n${BOLD}🧹 Cleaning up...${NC}"
  if [ -n "$SERVER_PID" ]; then
    kill $SERVER_PID 2>/dev/null || true
  fi
  # Give it a moment to stop
  sleep 1
  
  # Delete test instances explicitly
  ./bin/sbx delete verify e2e-alpha e2e-beta > /dev/null 2>&1 || true
  
  ./bin/sbx cleanup > /dev/null 2>&1
}
trap cleanup EXIT

# Start server
echo -n "📡 Starting SBX server on port $PORT... "
./bin/sbx serve --port $PORT > .sbx/logs/e2e_server.log 2>&1 &
SERVER_PID=$!

# Wait for server
READY=0
for i in {1..20}; do
  if curl -s "$URL/status" > /dev/null; then
    READY=1
    break
  fi
  sleep 0.5
done

if [ $READY -eq 1 ]; then
  echo -e "${GREEN}Ready!${NC}"
else
  echo -e "${RED}Failed!${NC}"
  cat .sbx/logs/e2e_server.log
  exit 1
fi

# Test runner
run_test() {
  local name=$1
  local inst=$2
  local endpoint=$3
  local payload=$4
  local jq_filter=$5

  echo -n "🧪 [$inst] $name... "
  
  # Ensure the instance is in the payload if not already
  local data
  if [[ "$payload" == *'"instance":'* ]]; then
    data="$payload"
  else
    data=$(echo "$payload" | jq --arg inst "$inst" '. + {instance: $inst}')
  fi

  RESPONSE=$(curl -s -X POST "$URL/$endpoint" \
    -H "Content-Type: application/json" \
    -d "$data")

  # Check if response is valid JSON
  if ! echo "$RESPONSE" | jq . > /dev/null 2>&1; then
    echo -e "${RED}FAILED${NC}"
    echo "   Error: Invalid JSON response from server"
    echo "   Raw Response: $RESPONSE"
    exit 1
  fi

  ERROR=$(echo "$RESPONSE" | jq -r '.error // empty')
  
  if [ -n "$ERROR" ]; then
    echo -e "${RED}FAILED${NC}"
    echo "   Error: $ERROR"
    exit 1
  fi

  # Optional additional check
  if [ -n "$jq_filter" ]; then
    VAL=$(echo "$RESPONSE" | jq -r "$jq_filter")
    if [ "$VAL" == "null" ] || [ -z "$VAL" ] || [ "$VAL" == "false" ]; then
      echo -e "${RED}FAILED (Filter)${NC}"
      echo "   JQ Filter: $jq_filter"
      echo "   Response: $RESPONSE"
      exit 1
    fi
  fi

  echo -e "${GREEN}PASSED${NC}"
}

# ------------------------------------------------------------------------------
# TEST CASES
# ------------------------------------------------------------------------------

# 0. Pre-test Sandbox Cleanup
run_test "Pre-test cleanup" "$INSTANCE" "raw-exec" \
  '{"command": "rm -rf e2e-proj e2e_done.txt && rm -f $TMPDIR/e2e_test"}'

# 1. Identity
run_test "Identity check" "$INSTANCE" "raw-exec" \
  '{"command": "whoami"}' \
  ".stdout | contains(\"sbx_\")"

# 2. TMPDIR Isolation
run_test "TMPDIR isolation" "$INSTANCE" "raw-exec" \
  '{"command": "echo $TMPDIR && touch $TMPDIR/e2e_test && ls $TMPDIR/e2e_test"}' \
  ".stdout | contains(\"/Users/sbx_\")"

# 3. CWD Security
run_test "CWD security (git init)" "$INSTANCE" "raw-exec" \
  '{"command": "mkdir -p e2e-proj && cd e2e-proj && git init"}' \
  ".stdout | contains(\"Git repository\")"

# 4. GitHub Auth Proxy
run_test "GitHub auth proxy" "$INSTANCE" "raw-exec" \
  '{"command": "gh auth status"}' \
  ".stdout | contains(\"Logged in\")"

# 5. Secret Redaction
run_test "Secret redaction" "$INSTANCE" "raw-exec" \
  '{"command": "env | grep SBX_PROXY_ACTIVE"}' \
  ".stdout | contains(\"SBX_PROXY_ACTIVE\")"

# 6. OpenCode Research (Explore)
run_test "OpenCode Explore mode" "$INSTANCE" "execute" \
  '{"prompt": "Check the current system username by running whoami", "mode": "explore"}' \
  ".output | contains(\"sbx_\")"

# 7. OpenCode Build
run_test "OpenCode Build mode" "$INSTANCE" "execute" \
  '{"prompt": "Create a file e2e_done.txt with content success", "mode": "build"}' \
  ".output | contains(\"success\")"

# ------------------------------------------------------------------------------
# MULTI-SESSION PARALLEL INDEPENDENCE
# ------------------------------------------------------------------------------
ALPHA="e2e-alpha"
BETA="e2e-beta"

echo -e "\n${BOLD}👯 Testing Parallel Session Independence${NC}"

# 8. Parallel Functional Independence
run_test "Alpha write to its own state" "$ALPHA" "raw-exec" \
  '{"command": "echo alpha-secret > $TMPDIR/alpha_state && cat $TMPDIR/alpha_state"}' \
  ".stdout | contains(\"alpha-secret\")"

run_test "Beta write to its own state" "$BETA" "raw-exec" \
  '{"command": "echo beta-secret > $TMPDIR/beta_state && cat $TMPDIR/beta_state"}' \
  ".stdout | contains(\"beta-secret\")"

# 9. Parallel Bridge Usage
run_test "Alpha bridge check (gh)" "$ALPHA" "raw-exec" \
  '{"command": "gh auth status"}' \
  ".stdout | contains(\"Logged in\")"

run_test "Beta bridge check (gh)" "$BETA" "raw-exec" \
  '{"command": "gh auth status"}' \
  ".stdout | contains(\"Logged in\")"

# 10. Concurrent Execution
echo -n "🧪 Concurrent execution (Alpha sleep, Beta ping)... "
curl -s -X POST "$URL/raw-exec" -H "Content-Type: application/json" -d '{"instance": "'$ALPHA'", "command": "sleep 2 && echo alpha-done"}' > .sbx/logs/alpha_concurrent.log &
ALPHA_PID=$!

sleep 0.5
BETA_START=$(date +%s)
BETA_RES=$(curl -s -X POST "$URL/raw-exec" -H "Content-Type: application/json" -d '{"instance": "'$BETA'", "command": "echo beta-fast"}')
BETA_END=$(date +%s)
BETA_DURATION=$((BETA_END - BETA_START))

if [[ "$BETA_RES" == *"beta-fast"* ]] && [ $BETA_DURATION -lt 2 ]; then
  echo -e "${GREEN}PASSED${NC} (Beta finished in ${BETA_DURATION}s while Alpha was sleeping)"
else
  echo -e "${RED}FAILED${NC}"
  echo "   Beta Response: $BETA_RES"
  echo "   Beta Duration: ${BETA_DURATION}s"
  exit 1
fi
wait $ALPHA_PID

# 11. Selective Deletion
echo -n "🧪 Selective deletion (Delete Alpha, Beta stays)... "
./bin/sbx delete "$ALPHA" > /dev/null 2>&1

BETA_CHECK=$(curl -s -X POST "$URL/raw-exec" -H "Content-Type: application/json" -d '{"instance": "'$BETA'", "command": "echo beta-still-here"}')
if [[ "$BETA_CHECK" == *"beta-still-here"* ]]; then
  # Verify alpha is gone
  ALPHA_CHECK=$(curl -s "$URL/status" | jq -r '.instances[] | select(.instance == "'$ALPHA'")')
  if [ -z "$ALPHA_CHECK" ]; then
    echo -e "${GREEN}PASSED${NC}"
  else
    echo -e "${RED}FAILED${NC} (Alpha still in status)"
    exit 1
  fi
else
  echo -e "${RED}FAILED${NC} (Beta died after Alpha deletion)"
  echo "   Beta Response: $BETA_CHECK"
  exit 1
fi

echo -e "\n${GREEN}${BOLD}✨ All End-to-End tests passed successfully!${NC}"
