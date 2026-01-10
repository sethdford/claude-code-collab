# Claude Code Collab

[![CI](https://github.com/sethdford/claude-code-collab/actions/workflows/ci.yml/badge.svg)](https://github.com/sethdford/claude-code-collab/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)

**Enterprise-ready multi-agent orchestration for Claude Code.**

A TypeScript server that enables team collaboration, task management, and **worker orchestration** across multiple Claude Code instances. Features MCP (Model Context Protocol) integration and support for Wave orchestration continuation loops.

![Demo](demo.gif)

---

## What's New in v2.0

- **Full TypeScript rewrite** - Type-safe server with better error handling
- **Worker Orchestration** - Spawn and control Claude Code worker instances programmatically
- **MCP Integration** - 10 tools accessible via Model Context Protocol
- **Wave Support** - Enables "Ralph Wiggum" continuation loops for iterative agent swarms
- **NDJSON Streaming** - Bidirectional communication with worker processes

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/sethdford/claude-code-collab.git
cd claude-code-collab
npm install

# Start the server
./start.sh --background

# Validate everything works
./test-e2e.sh
# Should show: All 11 tests passed!
```

### Server Management

```bash
./start.sh              # Start in foreground (see logs)
./start.sh --background # Start as daemon
./start.sh --status     # Check if running
./start.sh --stop       # Stop daemon
```

---

## Features

### 1. Worker Orchestration

Spawn and control Claude Code instances programmatically:

```bash
# Spawn a worker
curl -X POST http://localhost:3847/orchestrate/spawn \
  -H "Content-Type: application/json" \
  -d '{"handle":"worker-1","teamName":"my-team","workingDir":"/path/to/project"}'

# Send a task
curl -X POST http://localhost:3847/orchestrate/send/worker-1 \
  -H "Content-Type: application/json" \
  -d '{"message":"Create a hello world TypeScript file"}'

# Check output
curl http://localhost:3847/orchestrate/output/worker-1

# Dismiss worker
curl -X POST http://localhost:3847/orchestrate/dismiss/worker-1
```

### 2. MCP Tools (10 Available)

| Tool | Description |
|------|-------------|
| `team_status` | Get team health and online agents |
| `team_tasks` | List tasks for the team |
| `team_assign` | Assign a task to a team member |
| `team_complete` | Mark a task as complete |
| `team_broadcast` | Send message to all team members |
| `team_claim` | Claim a file to prevent conflicts |
| `team_spawn` | Spawn a new worker agent (lead only) |
| `team_dismiss` | Dismiss a worker (lead only) |
| `team_workers` | List all active workers |
| `team_send` | Send message to specific worker |

### 3. Wave Orchestration (Continuation Loops)

Supports iterative agent swarms with automatic continuation:

```
┌─────────────────────────────────────────────────────────────────┐
│  Wave Iteration 1                                                │
│  ├── Spawn agent: "design-auth"                                  │
│  ├── Spawn agent: "implement-jwt"                                │
│  └── Claude tries to exit...                                     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Stop Hook Intercepts                                            │
│  ├── Check: <wave-complete>? NO                                  │
│  ├── Action: Feed same prompt back                               │
│  └── Continue to next iteration                                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Wave Iteration 2                                                │
│  ├── Read previous agent outputs                                 │
│  ├── Synthesize results                                          │
│  └── Output: <wave-complete>Done</wave-complete>                 │
└─────────────────────────────────────────────────────────────────┘
```

Workers output `<wave-complete>PROMISE</wave-complete>` when done.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Your Machine                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐ │
│   │  Claude Code    │    │  Claude Code    │    │  Claude Code    │ │
│   │  (Team Lead)    │    │  (Worker 1)     │    │  (Worker N)     │ │
│   └────────┬────────┘    └────────┬────────┘    └────────┬────────┘ │
│            │                      │                      │          │
│            │      NDJSON Stream   │                      │          │
│            └──────────────────────┼──────────────────────┘          │
│                                   │                                  │
│                                   ▼                                  │
│              ┌─────────────────────────────────────┐                │
│              │   TypeScript Server (v2.0)          │                │
│              │   ├── Express REST API              │                │
│              │   ├── WebSocket notifications       │                │
│              │   ├── Worker Manager                │                │
│              │   └── MCP Bridge (10 tools)         │                │
│              │                                     │                │
│              │   http://localhost:3847             │                │
│              └──────────────┬──────────────────────┘                │
│                             │                                        │
│                             ▼                                        │
│              ┌─────────────────────────────────────┐                │
│              │   SQLite Database                   │                │
│              │   ├── Agents & Teams                │                │
│              │   ├── Tasks & Dependencies          │                │
│              │   ├── Chats & Messages              │                │
│              │   └── File Claims                   │                │
│              └─────────────────────────────────────┘                │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
claude-code-collab/
├── src/
│   ├── index.ts           # Entry point with graceful shutdown
│   ├── server.ts          # Express + WebSocket server (600+ lines)
│   ├── types.ts           # TypeScript interfaces
│   ├── storage/
│   │   └── sqlite.ts      # SQLite persistence layer
│   ├── workers/
│   │   └── manager.ts     # Worker spawning & NDJSON streaming
│   ├── mcp/
│   │   └── server.ts      # MCP bridge server (10 tools)
│   └── utils/
│       └── logger.ts      # Structured logging
├── start.sh               # Server management script
├── test-e2e.sh            # E2E test suite (11 tests)
├── run-lead.sh            # Run as team lead
├── run-worker.sh          # Run as worker
├── patch-cli.js           # CLI patcher (enables hidden features)
├── tsconfig.json          # TypeScript configuration
└── package.json           # Dependencies
```

---

## API Reference

### Health & Status

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Server health + stats |
| `/debug` | GET | Debug information |

### Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth` | POST | Register/authenticate agent |

### Teams

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/teams/:name/agents` | GET | List team members |
| `/teams/:name/tasks` | GET | List team tasks |
| `/teams/:name/broadcast` | POST | Broadcast to team |

### Tasks

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/tasks` | POST | Create task |
| `/tasks/:id` | GET | Get task details |
| `/tasks/:id` | PATCH | Update task status |

### Worker Orchestration

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/orchestrate/spawn` | POST | Spawn worker |
| `/orchestrate/workers` | GET | List workers |
| `/orchestrate/send/:handle` | POST | Send message |
| `/orchestrate/output/:handle` | GET | Get output |
| `/orchestrate/dismiss/:handle` | POST | Dismiss worker |

---

## E2E Test Coverage

```bash
./test-e2e.sh
```

| Test | What It Validates |
|------|-------------------|
| Health Check | Server responds to `/health` |
| Register Lead Agent | Lead can authenticate |
| Register Worker Agent | Worker can authenticate |
| Get Team Agents | Team membership tracking |
| Create Task | Task creation via API |
| Get Team Tasks | Task retrieval |
| Update Task Status | Task state machine |
| Broadcast Message | Team-wide notifications |
| MCP Tools List | All 10 MCP tools available |
| MCP team_status | MCP tool execution |
| List Workers | Worker orchestration endpoint |

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TEAM_SERVER_PORT` | Server port | `3847` |
| `CLAUDE_CODE_TEAM_NAME` | Team identifier | `dev-team` |
| `CLAUDE_CODE_AGENT_TYPE` | `team-lead` or `worker` | `worker` |
| `CLAUDE_CODE_AGENT_NAME` | Agent display name | `worker-1` |
| `CLAUDE_CODE_COLLAB_URL` | Server URL | `http://localhost:3847` |
| `JWT_SECRET` | Auth token secret | Auto-generated |
| `JWT_EXPIRES_IN` | Token expiry | `24h` |
| `LOG_LEVEL` | Logging level | `info` |

---

## Troubleshooting

### Server won't start

```bash
# Check if port is in use
lsof -i :3847

# Kill existing process
kill <PID>

# Or use the management script
./start.sh --stop
./start.sh --background
```

### Worker not responding

```bash
# Check worker status
curl http://localhost:3847/orchestrate/workers

# Check worker output for errors
curl http://localhost:3847/orchestrate/output/<handle>

# Dismiss and respawn
curl -X POST http://localhost:3847/orchestrate/dismiss/<handle>
```

### MCP tools not working

```bash
# Test MCP server directly
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  npx tsx src/mcp/server.ts

# Should return 10 tools
```

---

## Development

```bash
# Install dependencies
npm install

# Run in development mode (auto-reload)
npm run dev

# Type check
npx tsc --noEmit

# Run tests
./test-e2e.sh
```

---

## License

MIT - See [LICENSE](LICENSE)

---

## Disclaimer

This project enables experimental features in Claude Code for educational and development purposes. These features may be unstable or change without notice. Not affiliated with or endorsed by Anthropic.

---

**Questions?** Open an issue on [GitHub](https://github.com/sethdford/claude-code-collab/issues).
