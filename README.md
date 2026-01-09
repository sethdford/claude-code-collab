# Claude Code Collab

[![CI](https://github.com/sethdford/claude-code-collab/actions/workflows/ci.yml/badge.svg)](https://github.com/sethdford/claude-code-collab/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)

**Unlock hidden task management and multi-agent collaboration features in Claude Code.**

Claude Code has unreleased beta features for task management and team collaboration that are disabled by default. This project enables them locally - no cloud services required.

---

## What You Get

### Task Tools (Works Standalone)

Create, track, and manage tasks directly in Claude Code:

```
You: Create a task to refactor the authentication module

Claude: I'll create that task for you.
        [Uses TaskCreate tool]

        Created task: "Refactor authentication module"
        ID: task-7f3a2b
        Status: open

You: Show me all my tasks

Claude: [Uses TaskList tool]

        Tasks:
        1. Refactor authentication module [open]
        2. Write unit tests for API [in_progress]
        3. Update documentation [resolved]
```

### Multi-Agent Collaboration (Requires Server)

Run multiple Claude Code instances as a team:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  TERMINAL 1: Team Lead                                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  $ ./run-lead.sh                                                            │
│                                                                             │
│  > Assign a task to worker-1 to implement the login API                     │
│                                                                             │
│  Created task "Implement login API" assigned to worker-1                    │
│                                                                             │
│  > Broadcast: "Sprint started - check your tasks!"                          │
│                                                                             │
│  Broadcast sent to dev-team (2 agents online)                               │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  TERMINAL 2: Worker                                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│  $ ./run-worker.sh                                                          │
│                                                                             │
│  [Received broadcast]: "Sprint started - check your tasks!"                 │
│                                                                             │
│  [New task assigned]: "Implement login API"                                 │
│                                                                             │
│  > Working on task... [implements feature] ... Done!                        │
│                                                                             │
│  Task "Implement login API" marked as completed                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Option A: Task Tools Only (Recommended for Most Users)

Just want task management? No server needed:

```bash
git clone https://github.com/sethdford/claude-code-collab.git
cd claude-code-collab
npm install
npm run patch:tasks
```

That's it! Now run `claude` and try:
- "Create a task to review the API code"
- "List all my tasks"
- "Mark task-xyz as completed"

### Option B: Full Team Collaboration

Want multiple Claude instances working together? You'll need the server:

```bash
git clone https://github.com/sethdford/claude-code-collab.git
cd claude-code-collab
npm install
npm run patch          # Full patch with collaboration features
npm start              # Start the local server
```

Then in separate terminals:

```bash
# Terminal 1: Team Lead
./run-lead.sh

# Terminal 2: Worker
./run-worker.sh
```

---

## Task Tools Reference

| Tool | What It Does | Example Prompt |
|------|--------------|----------------|
| **TaskCreate** | Create a new task with title and description | "Create a task to fix the login bug" |
| **TaskList** | Show all tasks with their status | "Show me all open tasks" |
| **TaskGet** | Get details of a specific task | "What's the status of task-abc123?" |
| **TaskUpdate** | Change task status or details | "Mark task-abc123 as resolved" |

### Task Statuses

```
open ──────► in_progress ──────► resolved
                │
                └──────► blocked (by other tasks)
```

### Task Dependencies

Tasks can block other tasks:

```
You: Create a task "Write tests" that's blocked by task-abc123

Claude: Created task "Write tests"
        Status: blocked
        Blocked by: task-abc123 (must be resolved first)
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Your Machine                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌─────────────────┐              ┌─────────────────┐              │
│   │  Claude Code    │              │  Claude Code    │              │
│   │  (Team Lead)    │              │  (Worker)       │              │
│   │                 │              │                 │              │
│   │  - Create tasks │              │  - Receive tasks│              │
│   │  - Broadcast    │              │  - Update status│              │
│   │  - Monitor      │              │  - Send messages│              │
│   └────────┬────────┘              └────────┬────────┘              │
│            │                                │                       │
│            │         WebSocket              │                       │
│            │      ◄──────────────►          │                       │
│            │                                │                       │
│            └────────────┬───────────────────┘                       │
│                         │                                           │
│                         ▼                                           │
│              ┌─────────────────────┐                                │
│              │   Local Server      │                                │
│              │   (Express + WS)    │                                │
│              │                     │                                │
│              │   localhost:3847    │                                │
│              └──────────┬──────────┘                                │
│                         │                                           │
│                         ▼                                           │
│              ┌─────────────────────┐                                │
│              │   SQLite Database   │                                │
│              │                     │                                │
│              │   - Users/Agents    │                                │
│              │   - Chats           │                                │
│              │   - Messages        │                                │
│              │   - Tasks           │                                │
│              └─────────────────────┘                                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Hidden Features Enabled

This project patches Claude Code to enable these hidden feature flags:

| Flag | Feature | What It Enables |
|------|---------|-----------------|
| `$q()` | Task Tools | TaskCreate, TaskGet, TaskUpdate, TaskList |
| `NW1()` | Team Collaboration | Multi-agent messaging, broadcasts, team management |
| `SQ1()` | Discover Command | `/discover` command for feature discovery |

---

## Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run patch:tasks` | Enable task tools only (no server needed) |
| `npm run patch` | Enable all features (requires server) |
| `npm start` | Start the collaboration server |
| `npm run dev` | Start server with auto-reload |
| `npm run test` | Run test suite (32 tests) |
| `npm run e2e` | Run end-to-end integration test |
| `npm run preflight` | Check environment readiness |

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CLAUDE_CODE_TEAM_NAME` | Team identifier | `dev-team` |
| `CLAUDE_CODE_AGENT_TYPE` | `team-lead` or `worker` | `worker` |
| `CLAUDE_CODE_AGENT_NAME` | Display name | `worker-1` |
| `CLAUDE_CODE_COLLAB_URL` | Server URL | `http://localhost:3847` |
| `JWT_SECRET` | Auth token secret | Auto-generated |
| `JWT_EXPIRES_IN` | Token expiry | `24h` |

---

## API Documentation

Full OpenAPI spec available at `docs/openapi.yaml`.

### Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Server health check |
| `/auth` | POST | Register/authenticate agent (returns JWT) |
| `/users/:uid` | GET | Get user details |
| `/teams/:name/agents` | GET | List team members |
| `/teams/:name/broadcast` | POST | Send message to entire team |
| `/chats` | POST | Create chat between two users |
| `/chats/:id/messages` | GET/POST | Get/send messages |
| `/tasks` | POST | Create a task |
| `/tasks/:id` | GET/PATCH | Get/update task |
| `/teams/:name/tasks` | GET | List team tasks |

---

## Troubleshooting

### "Cannot find Claude Code CLI"

**Cause:** The patch script can't locate your Claude Code installation.

**Fix:**
```bash
# Option 1: Install Claude Code globally
npm install -g @anthropic-ai/claude-code

# Option 2: Run via npx first (creates local cache)
npx @anthropic-ai/claude-code --version

# Option 3: Set path manually
export CLAUDE_CODE_CLI_PATH=/path/to/cli.js
npm run patch
```

### "Server not running" when using run-lead.sh or run-worker.sh

**Cause:** The collaboration server isn't started.

**Fix:**
```bash
# Start the server first
npm start

# Then in another terminal
./run-lead.sh
```

### WebSocket connection fails

**Cause:** Server not running or wrong URL.

**Fix:**
```bash
# Check server is running
curl http://localhost:3847/health

# Should return: {"status":"ok","persistence":"sqlite",...}
```

### "Database locked" error

**Cause:** Multiple server instances trying to access the same database.

**Fix:**
```bash
# Find and kill existing processes
lsof -i :3847
kill <PID>

# Or just restart
pkill -f "node.*server.js"
npm start
```

### Patch says "already enabled"

**Cause:** You've already patched this Claude Code installation.

**Fix:** This is fine! The features are enabled. Just run `claude`.

### Tasks not persisting

**Cause:** Using task-tools-only mode (no server).

**Note:** In task-tools-only mode, tasks are managed by Claude Code internally. For persistent, shared tasks across sessions, use full team mode with the server.

### Windows: Scripts don't work

**Cause:** Shell scripts are Unix-only.

**Fix:** Use the Windows batch files:
```cmd
run-lead.bat
run-worker.bat
```

### "Invalid or expired token" error

**Cause:** JWT token expired (default: 24 hours).

**Fix:** Re-authenticate by restarting your Claude Code instance.

---

## Testing

Run the full test suite:

```bash
npm run test
```

**Coverage: 32 tests**
- Health checks (2)
- Authentication (5)
- User management (3)
- Chat operations (2)
- Message handling (4)
- Mark as read validation (2)
- Task management (7)
- Task dependencies (5)
- Broadcast (1)
- WebSocket (2, requires websocat)
- Rate limiting (1)

Run end-to-end integration test:

```bash
npm run e2e
```

---

## Project Files

| File | Description |
|------|-------------|
| `server.js` | Express + WebSocket server (v1.2) |
| `patch-cli.js` | Full patch (all features) |
| `patch-tasks-only.js` | Lightweight patch (task tools only) |
| `run-lead.sh` / `.bat` | Run as team lead |
| `run-worker.sh` / `.bat` | Run as worker |
| `docs/openapi.yaml` | API specification |
| `scripts/test-suite.sh` | Comprehensive tests |
| `scripts/e2e-test.sh` | End-to-end test |

---

## How It Works

1. **Patch Phase:** The patch script finds your Claude Code CLI, enables hidden feature flags (`$q`, `NW1`, `SQ1`), and injects code that redirects Firebase calls to your local server.

2. **Server Phase:** The local Express server provides REST APIs and WebSocket connections that mimic Firebase's behavior, storing data in SQLite.

3. **Runtime Phase:** When Claude Code runs, it thinks it's talking to Firebase but actually communicates with your local server.

---

## Disclaimer

This project reverse-engineers hidden features in Claude Code for educational and experimental purposes. These features are disabled by default because they may be:

- Unstable or incomplete
- Subject to change without notice
- Not officially supported

**Use at your own risk.** This is not affiliated with or endorsed by Anthropic.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT - See [LICENSE](LICENSE)

---

**Questions?** Open an issue on [GitHub](https://github.com/sethdford/claude-code-collab/issues).
