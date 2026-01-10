#!/bin/bash
# Claude Code Collab Service Manager
# Manages the launchd service for the collaboration server

PLIST="$HOME/Library/LaunchAgents/com.claude-code-collab.server.plist"
LABEL="com.claude-code-collab.server"
HEALTH_URL="http://localhost:3847/health"

case "$1" in
    start)
        echo "Starting Claude Code Collab server..."
        launchctl load "$PLIST" 2>/dev/null || echo "Already loaded"
        sleep 2
        if curl -s "$HEALTH_URL" > /dev/null; then
            echo "✅ Server started"
            curl -s "$HEALTH_URL" | python3 -m json.tool
        else
            echo "❌ Failed to start - check logs"
        fi
        ;;
    stop)
        echo "Stopping Claude Code Collab server..."
        launchctl unload "$PLIST" 2>/dev/null || echo "Already unloaded"
        echo "✅ Server stopped"
        ;;
    restart)
        $0 stop
        sleep 1
        $0 start
        ;;
    status)
        if curl -s "$HEALTH_URL" > /dev/null 2>&1; then
            echo "✅ Server running"
            curl -s "$HEALTH_URL" | python3 -m json.tool
        else
            echo "❌ Server not running"
        fi
        ;;
    logs)
        echo "=== Server logs ==="
        tail -50 "$HOME/Documents/claude-code-collab/logs/server.log" 2>/dev/null || echo "No logs yet"
        ;;
    errors)
        echo "=== Error logs ==="
        tail -50 "$HOME/Documents/claude-code-collab/logs/server.error.log" 2>/dev/null || echo "No errors"
        ;;
    test)
        echo "Running E2E tests..."
        cd "$HOME/Documents/claude-code-collab" && ./test-e2e.sh
        ;;
    *)
        echo "Claude Code Collab Service Manager"
        echo ""
        echo "Usage: $0 {start|stop|restart|status|logs|errors|test}"
        echo ""
        echo "Commands:"
        echo "  start   - Start the server (via launchd)"
        echo "  stop    - Stop the server"
        echo "  restart - Restart the server"
        echo "  status  - Check server health"
        echo "  logs    - View recent server logs"
        echo "  errors  - View recent error logs"
        echo "  test    - Run E2E test suite"
        ;;
esac
