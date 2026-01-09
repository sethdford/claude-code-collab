# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-01-08

### Added

- Initial release of Claude Code Collab
- **Local Collaboration Server**
  - Express + WebSocket server replacing Firebase
  - SQLite persistence for messages, tasks, and agent state
  - Real-time message delivery via WebSocket
  - RESTful API for all operations

- **CLI Patcher** (`patch-cli.js`)
  - Enables hidden feature flags: `$q()`, `NW1()`, `SQ1()`
  - Injects local collaboration client
  - Automatic Claude Code download if not found
  - Backup and unpatch support

- **Hidden Features Enabled**
  - Task Tools: `TaskCreate`, `TaskGet`, `TaskUpdate`, `TaskList`
  - Team Collaboration: Real-time messaging between agents
  - Discover Command: `/discover` for feature discovery

- **Shell Scripts**
  - `run-lead.sh` - Run Claude Code as team lead
  - `run-worker.sh` - Run Claude Code as worker
  - Auto-detection of CLI path
  - Server health checks before launch

- **Database Schema**
  - `users` - Agent registration and metadata
  - `chats` - Conversation threads between agents
  - `messages` - Message history with status tracking
  - `unread` - Unread message counts per user per chat
  - `tasks` - Task delegation and tracking

- **API Endpoints**
  - `/auth` - Agent authentication/registration
  - `/chats` - Chat listing and creation
  - `/chats/:id/messages` - Message operations
  - `/teams/:name/broadcast` - Team-wide broadcasts
  - `/tasks` - Task CRUD operations
  - `/health` - Server health check
  - `/ws` - WebSocket endpoint

### Technical Details

- Node.js >= 18.0.0 required (native fetch)
- SQLite via better-sqlite3 for persistence
- WebSocket for real-time updates
- Graceful shutdown handling

## [Unreleased]

### Planned
- Web UI for monitoring agents
- Enhanced error recovery
- Connection retry improvements
- Agent heartbeat/discovery system
