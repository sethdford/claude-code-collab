# Claude Code Team Mode - Local Collaboration Server

A local implementation that enables hidden "team mode" features in Claude Code, allowing multiple Claude Code instances to collaborate on tasks.

## What This Does

Claude Code has hidden beta features for multi-agent collaboration that require Firebase. This project:

1. **Patches Claude Code** to enable hidden feature flags
2. **Provides a local server** that replaces Firebase with Express + WebSocket + SQLite
3. **Enables team mode** where a "team lead" can delegate tasks to "worker" agents

## Hidden Features Enabled

| Feature | Function | Description |
|---------|----------|-------------|
| Task Tools | `$q()` | Enables `TaskCreate`, `TaskGet`, `TaskUpdate`, `TaskList` tools |
| Team Collaboration | `NW1()` | Real-time messaging between Claude Code instances |
| Discover Command | `SQ1()` | `/discover` command for feature discovery |

## Quick Start

### 1. Install Dependencies

```bash
cd claude-collab-local
npm install
```

### 2. Run the Patch

```bash
npm run patch
```

This will:
- Download the latest Claude Code if needed
- Enable hidden feature flags
- Inject local collaboration client

### 3. Start the Server

```bash
npm start
```

Server runs on `http://localhost:3847`

### 4. Run Claude Code Instances

**Terminal 1 - Team Lead:**
```bash
./run-lead.sh
```

**Terminal 2 - Worker:**
```bash
./run-worker.sh
```

## How It Works

### Architecture

```
┌─────────────────┐     ┌─────────────────┐
│  Claude Code    │     │  Claude Code    │
│  (Team Lead)    │     │  (Worker)       │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │   WebSocket/HTTP      │
         └───────────┬───────────┘
                     │
              ┌──────┴──────┐
              │   Local     │
              │   Server    │
              │  (Express)  │
              └──────┬──────┘
                     │
              ┌──────┴──────┐
              │   SQLite    │
              │   Database  │
              └─────────────┘
```

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `CLAUDE_CODE_TEAM_NAME` | Team identifier | `dev-team` |
| `CLAUDE_CODE_AGENT_TYPE` | Role: `team-lead` or `worker` | `team-lead` |
| `CLAUDE_CODE_AGENT_NAME` | Agent display name | `lead` |
| `CLAUDE_CODE_COLLAB_URL` | Server URL | `http://localhost:3847` |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth` | POST | Register/authenticate agent |
| `/chats` | GET | List agent's chats |
| `/chats` | POST | Create new chat |
| `/chats/:id/messages` | GET | Get messages in chat |
| `/chats/:id/messages` | POST | Send message |
| `/teams/:name/broadcast` | POST | Broadcast to team |
| `/tasks` | GET/POST | Task management |
| `/tasks/:id` | GET/PATCH | Individual task ops |

### Database Schema

```sql
-- Users/Agents
CREATE TABLE users (
  uid TEXT PRIMARY KEY,
  handle TEXT UNIQUE,
  display_name TEXT,
  agent_type TEXT,
  team_name TEXT,
  created_at INTEGER
);

-- Chats between agents
CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  participants TEXT,  -- JSON array
  created_at INTEGER,
  updated_at INTEGER
);

-- Messages
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT,
  from_uid TEXT,
  text TEXT,
  timestamp INTEGER,
  status TEXT DEFAULT 'sent'
);

-- Tasks for delegation
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT,
  description TEXT,
  status TEXT DEFAULT 'pending',
  assigned_to TEXT,
  created_by TEXT,
  team_name TEXT,
  created_at INTEGER,
  updated_at INTEGER
);
```

## Example: Multi-Agent Workflow

1. **Team Lead creates a task:**
   ```
   You: Create a task for the worker to implement user authentication
   Lead: [Uses TaskCreate tool to create task]
   ```

2. **Worker receives and works on task:**
   ```
   Worker: [Polls for new tasks, sees authentication task]
   Worker: [Implements the feature]
   Worker: [Updates task status to completed]
   ```

3. **Real-time communication:**
   ```
   Lead: [Broadcasts message to team]
   Worker: [Receives message via WebSocket]
   ```

## Files

| File | Description |
|------|-------------|
| `server.js` | Express + WebSocket server with SQLite |
| `patch-cli.js` | Patches Claude Code CLI to enable features |
| `run-lead.sh` | Script to run Claude Code as team lead |
| `run-worker.sh` | Script to run Claude Code as worker |
| `package.json` | Dependencies |

## Firebase Emulator (Alternative)

If you prefer full Firebase compatibility:

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Start emulators
firebase emulators:start
```

## Troubleshooting

### "Cannot find Claude Code CLI"
Run `npm pack @anthropic-ai/claude-code` first, or install Claude Code globally.

### WebSocket connection fails
Ensure the server is running (`npm start`) before launching Claude Code instances.

### Database locked
Only one server instance should run at a time. Check for existing processes on port 3847.

## Disclaimer

This project reverse-engineers hidden features in Claude Code for educational purposes. These features are disabled by default for a reason - they may be unstable, incomplete, or change without notice. Use at your own risk.

## License

MIT
