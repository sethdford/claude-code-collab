#!/bin/bash
# End-to-End Test for Claude Code Collab Server
#
# Tests:
# 1. Server health check
# 2. Agent registration (lead + worker)
# 3. Task creation and assignment
# 4. Worker spawning
# 5. Message broadcast
# 6. MCP tool execution

set +e  # Don't exit on first error - we want to run all tests

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${TEAM_SERVER_PORT:-3847}"
BASE_URL="http://localhost:$PORT"
TEAM_NAME="test-team-$$"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

passed=0
failed=0

test_result() {
    local name="$1"
    local success="$2"
    local details="$3"

    if [ "$success" = "true" ]; then
        echo -e "${GREEN}✅ PASS${NC}: $name"
        passed=$((passed + 1))
    else
        echo -e "${RED}❌ FAIL${NC}: $name"
        echo "   Details: $details"
        failed=$((failed + 1))
    fi
}

echo "======================================================"
echo "  Claude Code Collab - End-to-End Test Suite"
echo "======================================================"
echo "  Server: $BASE_URL"
echo "  Team:   $TEAM_NAME"
echo "======================================================"
echo ""

# Test 1: Health Check
echo -e "${YELLOW}Test 1: Health Check${NC}"
HEALTH=$(curl -s "$BASE_URL/health")
if echo "$HEALTH" | grep -q '"status"'; then
    test_result "Health endpoint responds" "true"
else
    test_result "Health endpoint responds" "false" "$HEALTH"
fi

# Test 2: Register Lead Agent
echo -e "\n${YELLOW}Test 2: Register Lead Agent${NC}"
LEAD_AUTH=$(curl -s -X POST "$BASE_URL/auth" \
    -H "Content-Type: application/json" \
    -d "{\"handle\": \"lead-agent\", \"teamName\": \"$TEAM_NAME\", \"agentType\": \"team-lead\"}")
LEAD_UID=$(echo "$LEAD_AUTH" | python3 -c "import sys, json; print(json.load(sys.stdin).get('uid', ''))" 2>/dev/null)
if [ -n "$LEAD_UID" ]; then
    test_result "Lead agent registered" "true"
    echo "   UID: $LEAD_UID"
else
    test_result "Lead agent registered" "false" "$LEAD_AUTH"
fi

# Test 3: Register Worker Agent
echo -e "\n${YELLOW}Test 3: Register Worker Agent${NC}"
WORKER_AUTH=$(curl -s -X POST "$BASE_URL/auth" \
    -H "Content-Type: application/json" \
    -d "{\"handle\": \"worker-1\", \"teamName\": \"$TEAM_NAME\", \"agentType\": \"worker\"}")
WORKER_UID=$(echo "$WORKER_AUTH" | python3 -c "import sys, json; print(json.load(sys.stdin).get('uid', ''))" 2>/dev/null)
if [ -n "$WORKER_UID" ]; then
    test_result "Worker agent registered" "true"
    echo "   UID: $WORKER_UID"
else
    test_result "Worker agent registered" "false" "$WORKER_AUTH"
fi

# Test 4: Get Team Agents
echo -e "\n${YELLOW}Test 4: Get Team Agents${NC}"
AGENTS=$(curl -s "$BASE_URL/teams/$TEAM_NAME/agents")
AGENT_COUNT=$(echo "$AGENTS" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
if [ "$AGENT_COUNT" -ge 2 ]; then
    test_result "Team has 2+ agents" "true"
    echo "   Count: $AGENT_COUNT"
else
    test_result "Team has 2+ agents" "false" "Count: $AGENT_COUNT"
fi

# Test 5: Create Task
echo -e "\n${YELLOW}Test 5: Create Task${NC}"
TASK_RESULT=$(curl -s -X POST "$BASE_URL/tasks" \
    -H "Content-Type: application/json" \
    -d "{\"fromUid\": \"$LEAD_UID\", \"toHandle\": \"worker-1\", \"teamName\": \"$TEAM_NAME\", \"subject\": \"Test task\", \"description\": \"This is a test task\"}")
TASK_ID=$(echo "$TASK_RESULT" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id', ''))" 2>/dev/null)
if [ -n "$TASK_ID" ]; then
    test_result "Task created" "true"
    echo "   Task ID: $TASK_ID"
else
    test_result "Task created" "false" "$TASK_RESULT"
fi

# Test 6: Get Team Tasks
echo -e "\n${YELLOW}Test 6: Get Team Tasks${NC}"
TASKS=$(curl -s "$BASE_URL/teams/$TEAM_NAME/tasks")
TASK_COUNT=$(echo "$TASKS" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
if [ "$TASK_COUNT" -ge 1 ]; then
    test_result "Tasks retrieved" "true"
    echo "   Count: $TASK_COUNT"
else
    test_result "Tasks retrieved" "false" "Count: $TASK_COUNT"
fi

# Test 7: Update Task Status
echo -e "\n${YELLOW}Test 7: Update Task Status${NC}"
if [ -n "$TASK_ID" ]; then
    UPDATE_RESULT=$(curl -s -X PATCH "$BASE_URL/tasks/$TASK_ID" \
        -H "Content-Type: application/json" \
        -d '{"status": "in_progress"}')
    NEW_STATUS=$(echo "$UPDATE_RESULT" | python3 -c "import sys, json; print(json.load(sys.stdin).get('status', ''))" 2>/dev/null)
    if [ "$NEW_STATUS" = "in_progress" ]; then
        test_result "Task status updated" "true"
    else
        test_result "Task status updated" "false" "$UPDATE_RESULT"
    fi
else
    test_result "Task status updated" "false" "No task ID"
fi

# Test 8: Broadcast Message
echo -e "\n${YELLOW}Test 8: Broadcast Message${NC}"
BROADCAST_RESULT=$(curl -s -X POST "$BASE_URL/teams/$TEAM_NAME/broadcast" \
    -H "Content-Type: application/json" \
    -d "{\"from\": \"$LEAD_UID\", \"text\": \"Hello team! This is a test broadcast.\"}")
if echo "$BROADCAST_RESULT" | python3 -c "import sys, json; d=json.load(sys.stdin); exit(0 if 'text' in d else 1)" 2>/dev/null; then
    test_result "Broadcast sent" "true"
else
    test_result "Broadcast sent" "false" "$BROADCAST_RESULT"
fi

# Test 9: MCP Tools List
echo -e "\n${YELLOW}Test 9: MCP Tools List${NC}"
MCP_RESULT=$(echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
    npx --yes tsx "$SCRIPT_DIR/src/mcp/server.ts" 2>/dev/null)
TOOL_COUNT=$(echo "$MCP_RESULT" | python3 -c "import sys, json; print(len(json.load(sys.stdin).get('result', {}).get('tools', [])))" 2>/dev/null || echo "0")
if [ "$TOOL_COUNT" -ge 5 ]; then
    test_result "MCP tools available" "true"
    echo "   Tools: $TOOL_COUNT"
else
    test_result "MCP tools available" "false" "Count: $TOOL_COUNT"
fi

# Test 10: MCP team_status Tool
echo -e "\n${YELLOW}Test 10: MCP team_status Tool${NC}"
export CLAUDE_CODE_TEAM_NAME="$TEAM_NAME"
MCP_STATUS=$(echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"team_status","arguments":{}}}' | \
    npx --yes tsx "$SCRIPT_DIR/src/mcp/server.ts" 2>/dev/null)
if echo "$MCP_STATUS" | grep -q '"result"'; then
    test_result "MCP team_status works" "true"
else
    test_result "MCP team_status works" "false" "$(echo "$MCP_STATUS" | head -c 200)"
fi

# Test 11: Orchestration - List Workers
echo -e "\n${YELLOW}Test 11: List Workers (Orchestration)${NC}"
WORKERS=$(curl -s "$BASE_URL/orchestrate/workers")
if echo "$WORKERS" | python3 -c "import sys, json; json.load(sys.stdin)" 2>/dev/null; then
    test_result "Workers endpoint responds" "true"
    echo "   Workers: $(echo "$WORKERS" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null)"
else
    test_result "Workers endpoint responds" "false" "$WORKERS"
fi

# Summary
echo ""
echo "======================================================"
echo "  Test Results"
echo "======================================================"
echo -e "  ${GREEN}Passed${NC}: $passed"
echo -e "  ${RED}Failed${NC}: $failed"
echo "======================================================"

if [ $failed -eq 0 ]; then
    echo -e "\n${GREEN}All tests passed! 🎉${NC}"
    exit 0
else
    echo -e "\n${RED}Some tests failed.${NC}"
    exit 1
fi
