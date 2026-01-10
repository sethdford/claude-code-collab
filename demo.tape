# VHS Demo for Claude Code Collab v2.0
Output demo.gif
Set FontSize 14
Set Width 1200
Set Height 700
Set Theme "Catppuccin Mocha"
Set Padding 20
Set Shell bash

# Header
Type "echo '=== Claude Code Collab v2.0 ==='"
Enter
Sleep 1s

# Server status
Type "echo '1. Server Status' && ./start.sh --status"
Enter
Sleep 3s

# E2E tests
Type "echo '2. E2E Tests' && ./test-e2e.sh 2>&1 | tail -15"
Enter
Sleep 8s

# Health
Type "echo '3. Health Check' && curl -s localhost:3847/health | python3 -m json.tool"
Enter
Sleep 2s

# Workers
Type "echo '4. Workers Ready' && curl -s localhost:3847/orchestrate/workers"
Enter
Sleep 2s

# Done
Type "echo '=== Multi-Agent Orchestration Ready! ==='"
Enter
Sleep 2s
