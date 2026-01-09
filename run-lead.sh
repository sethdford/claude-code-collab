#!/bin/bash
# Run Claude Code as Team Lead

export CLAUDE_CODE_TEAM_NAME="dev-team"
export CLAUDE_CODE_AGENT_TYPE="team-lead"
export CLAUDE_CODE_AGENT_NAME="lead"
export CLAUDE_CODE_COLLAB_URL="http://localhost:3847"

echo "Starting Claude Code as TEAM LEAD..."
echo "  Team: $CLAUDE_CODE_TEAM_NAME"
echo "  Agent: $CLAUDE_CODE_AGENT_NAME ($CLAUDE_CODE_AGENT_TYPE)"
echo ""

node /tmp/claude-code-analysis/package/cli.js "$@"
