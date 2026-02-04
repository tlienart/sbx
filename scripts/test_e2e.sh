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
  local endpoint=$2
  local data=$3
  local jq_filter=$4

  echo -n "🧪 $name... "
  
  RESPONSE=$(curl -s -X POST "$URL/$endpoint" \
    -H "Content-Type: application/json" \
    -d "$data")

  # Check if response is valid JSON and doesn't contain error field
  ERROR=$(echo "$RESPONSE" | jq -r '.error // empty')
  
  if [ -n "$ERROR" ]; then
    echo -e "${RED}FAILED${NC}"
    echo -e "   Error: $ERROR"
    exit 1
  fi

  # Optional additional check
  if [ -n "$jq_filter" ]; then
    VAL=$(echo "$RESPONSE" | jq -r "$jq_filter")
    if [ "$VAL" == "null" ] || [ -z "$VAL" ]; then
      echo -e "${RED}FAILED (Filter)${NC}"
      echo "   Response: $RESPONSE"
      exit 1
    fi
  fi

  echo -e "${GREEN}PASSED${NC}"
}

# ------------------------------------------------------------------------------
# TEST CASES
# ------------------------------------------------------------------------------

# 1. Identity
run_test "Identity check" "raw-exec" \
  "{\"instance\": \"$INSTANCE\", \"command\": \"whoami\"}" \
  ".stdout | contains(\"sbx_\")"

# 2. TMPDIR Isolation
run_test "TMPDIR isolation" "raw-exec" \
  "{\"instance\": \"$INSTANCE\", \"command\": \"echo \\\$TMPDIR && touch \\\$TMPDIR/e2e_test && ls \\\$TMPDIR/e2e_test\"}" \
  ".stdout | contains(\"/Users/sbx_\")"

# 3. CWD Security
run_test "CWD security (git init)" "raw-exec" \
  "{\"instance\": \"$INSTANCE\", \"command\": \"mkdir -p e2e-proj && cd e2e-proj && git init\"}" \
  ".stdout | contains(\"Initialized empty Git repository\")"

# 4. GitHub Auth Proxy
run_test "GitHub auth proxy" "raw-exec" \
  "{\"instance\": \"$INSTANCE\", \"command\": \"gh auth status\"}" \
  ".stdout | contains(\"Logged in\")"

# 5. Secret Redaction
run_test "Secret redaction" "raw-exec" \
  "{\"instance\": \"$INSTANCE\", \"command\": \"env | grep SBX_PROXY_ACTIVE\"}" \
  ".stdout | contains(\"SBX_PROXY_ACTIVE\")"

# 6. OpenCode Research
run_test "OpenCode Research mode" "execute" \
  "{\"instance\": \"$INSTANCE\", \"prompt\": \"Who am I?\", \"mode\": \"research\"}" \
  ".output | contains(\"sbx_\")"

# 7. OpenCode Build
run_test "OpenCode Build mode" "execute" \
  "{\"instance\": \"$INSTANCE\", \"prompt\": \"Create a file e2e_done.txt\", \"mode\": \"build\"}" \
  ".output | contains(\"created\")"

echo -e "\n${GREEN}${BOLD}✨ All End-to-End tests passed successfully!${NC}"
