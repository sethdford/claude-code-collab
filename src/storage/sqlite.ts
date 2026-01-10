/**
 * SQLite Storage Implementation
 *
 * Persistent storage for team coordination using better-sqlite3.
 */

import Database from 'better-sqlite3';
import type {
  TeamStorage,
  TeamAgent,
  Chat,
  Message,
  TeamTask,
  TaskStatus,
} from '../types.js';

export class SQLiteStorage implements TeamStorage {
  private db: Database.Database;
  private stmts: {
    insertUser: Database.Statement;
    getUser: Database.Statement;
    getUsersByTeam: Database.Statement;
    insertChat: Database.Statement;
    getChat: Database.Statement;
    getChatsByUser: Database.Statement;
    updateChatTime: Database.Statement;
    insertMessage: Database.Statement;
    getMessages: Database.Statement;
    getMessagesAfter: Database.Statement;
    getUnread: Database.Statement;
    setUnread: Database.Statement;
    incrementUnread: Database.Statement;
    clearUnread: Database.Statement;
    insertTask: Database.Statement;
    getTask: Database.Statement;
    getTasksByTeam: Database.Statement;
    updateTaskStatus: Database.Statement;
  };

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
    this.stmts = this.prepareStatements();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        uid TEXT PRIMARY KEY,
        handle TEXT NOT NULL,
        team_name TEXT NOT NULL,
        agent_type TEXT DEFAULT 'worker',
        created_at TEXT NOT NULL,
        last_seen TEXT
      );

      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        participants TEXT NOT NULL,
        is_team_chat INTEGER DEFAULT 0,
        team_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        from_handle TEXT NOT NULL,
        from_uid TEXT NOT NULL,
        text TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        metadata TEXT,
        FOREIGN KEY (chat_id) REFERENCES chats(id)
      );

      CREATE TABLE IF NOT EXISTS unread (
        chat_id TEXT NOT NULL,
        uid TEXT NOT NULL,
        count INTEGER DEFAULT 0,
        PRIMARY KEY (chat_id, uid)
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        team_name TEXT NOT NULL,
        subject TEXT NOT NULL,
        description TEXT,
        owner_handle TEXT,
        owner_uid TEXT,
        created_by_handle TEXT NOT NULL,
        created_by_uid TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        blocked_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_users_team ON users(team_name);
      CREATE INDEX IF NOT EXISTS idx_tasks_team ON tasks(team_name);
    `);
  }

  private prepareStatements() {
    return {
      insertUser: this.db.prepare(`
        INSERT OR REPLACE INTO users (uid, handle, team_name, agent_type, created_at, last_seen)
        VALUES (?, ?, ?, ?, ?, ?)
      `),
      getUser: this.db.prepare('SELECT * FROM users WHERE uid = ?'),
      getUsersByTeam: this.db.prepare('SELECT * FROM users WHERE team_name = ?'),
      insertChat: this.db.prepare(`
        INSERT OR REPLACE INTO chats (id, participants, is_team_chat, team_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `),
      getChat: this.db.prepare('SELECT * FROM chats WHERE id = ?'),
      getChatsByUser: this.db.prepare('SELECT * FROM chats WHERE participants LIKE ?'),
      updateChatTime: this.db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?'),
      insertMessage: this.db.prepare(`
        INSERT INTO messages (id, chat_id, from_handle, from_uid, text, timestamp, status, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),
      getMessages: this.db.prepare(
        'SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp ASC LIMIT ?'
      ),
      getMessagesAfter: this.db.prepare(
        'SELECT * FROM messages WHERE chat_id = ? AND timestamp > ? ORDER BY timestamp ASC LIMIT ?'
      ),
      getUnread: this.db.prepare('SELECT count FROM unread WHERE chat_id = ? AND uid = ?'),
      setUnread: this.db.prepare(
        'INSERT OR REPLACE INTO unread (chat_id, uid, count) VALUES (?, ?, ?)'
      ),
      incrementUnread: this.db.prepare(
        'INSERT INTO unread (chat_id, uid, count) VALUES (?, ?, 1) ON CONFLICT(chat_id, uid) DO UPDATE SET count = count + 1'
      ),
      clearUnread: this.db.prepare('UPDATE unread SET count = 0 WHERE chat_id = ? AND uid = ?'),
      insertTask: this.db.prepare(`
        INSERT INTO tasks (id, team_name, subject, description, owner_handle, owner_uid,
                           created_by_handle, created_by_uid, status, blocked_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      getTask: this.db.prepare('SELECT * FROM tasks WHERE id = ?'),
      getTasksByTeam: this.db.prepare(
        'SELECT * FROM tasks WHERE team_name = ? ORDER BY created_at DESC'
      ),
      updateTaskStatus: this.db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?'),
    };
  }

  // ============================================================================
  // Users/Agents
  // ============================================================================

  insertUser(user: TeamAgent): void {
    this.stmts.insertUser.run(
      user.uid,
      user.handle,
      user.teamName,
      user.agentType,
      user.createdAt,
      user.lastSeen
    );
  }

  getUser(uid: string): TeamAgent | null {
    const row = this.stmts.getUser.get(uid) as {
      uid: string;
      handle: string;
      team_name: string;
      agent_type: string;
      created_at: string;
      last_seen: string | null;
    } | undefined;

    if (!row) return null;

    return {
      uid: row.uid,
      handle: row.handle,
      teamName: row.team_name,
      agentType: row.agent_type as 'team-lead' | 'worker',
      createdAt: row.created_at,
      lastSeen: row.last_seen,
    };
  }

  getUsersByTeam(teamName: string): TeamAgent[] {
    const rows = this.stmts.getUsersByTeam.all(teamName) as Array<{
      uid: string;
      handle: string;
      team_name: string;
      agent_type: string;
      created_at: string;
      last_seen: string | null;
    }>;

    return rows.map((row) => ({
      uid: row.uid,
      handle: row.handle,
      teamName: row.team_name,
      agentType: row.agent_type as 'team-lead' | 'worker',
      createdAt: row.created_at,
      lastSeen: row.last_seen,
    }));
  }

  // ============================================================================
  // Chats
  // ============================================================================

  insertChat(chat: Chat): void {
    this.stmts.insertChat.run(
      chat.id,
      JSON.stringify(chat.participants),
      chat.isTeamChat ? 1 : 0,
      chat.teamName,
      chat.createdAt,
      chat.updatedAt
    );
  }

  getChat(chatId: string): Chat | null {
    const row = this.stmts.getChat.get(chatId) as {
      id: string;
      participants: string;
      is_team_chat: number;
      team_name: string | null;
      created_at: string;
      updated_at: string;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      participants: JSON.parse(row.participants) as string[],
      isTeamChat: row.is_team_chat === 1,
      teamName: row.team_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getChatsByUser(uid: string): Chat[] {
    const rows = this.stmts.getChatsByUser.all(`%${uid}%`) as Array<{
      id: string;
      participants: string;
      is_team_chat: number;
      team_name: string | null;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      participants: JSON.parse(row.participants) as string[],
      isTeamChat: row.is_team_chat === 1,
      teamName: row.team_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  updateChatTime(chatId: string, timestamp: string): void {
    this.stmts.updateChatTime.run(timestamp, chatId);
  }

  // ============================================================================
  // Messages
  // ============================================================================

  insertMessage(message: Message): void {
    this.stmts.insertMessage.run(
      message.id,
      message.chatId,
      message.fromHandle,
      message.fromUid,
      message.text,
      message.timestamp,
      message.status,
      JSON.stringify(message.metadata)
    );
  }

  getMessages(chatId: string, limit: number): Message[] {
    const rows = this.stmts.getMessages.all(chatId, limit) as Array<{
      id: string;
      chat_id: string;
      from_handle: string;
      from_uid: string;
      text: string;
      timestamp: string;
      status: string;
      metadata: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      fromHandle: row.from_handle,
      fromUid: row.from_uid,
      text: row.text,
      timestamp: row.timestamp,
      status: row.status as 'pending' | 'processed',
      metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {},
    }));
  }

  getMessagesAfter(chatId: string, afterTimestamp: string, limit: number): Message[] {
    const rows = this.stmts.getMessagesAfter.all(chatId, afterTimestamp, limit) as Array<{
      id: string;
      chat_id: string;
      from_handle: string;
      from_uid: string;
      text: string;
      timestamp: string;
      status: string;
      metadata: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      fromHandle: row.from_handle,
      fromUid: row.from_uid,
      text: row.text,
      timestamp: row.timestamp,
      status: row.status as 'pending' | 'processed',
      metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {},
    }));
  }

  // ============================================================================
  // Unread counts
  // ============================================================================

  getUnread(chatId: string, uid: string): number {
    const row = this.stmts.getUnread.get(chatId, uid) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  setUnread(chatId: string, uid: string, count: number): void {
    this.stmts.setUnread.run(chatId, uid, count);
  }

  incrementUnread(chatId: string, uid: string): void {
    this.stmts.incrementUnread.run(chatId, uid);
  }

  clearUnread(chatId: string, uid: string): void {
    this.stmts.clearUnread.run(chatId, uid);
  }

  // ============================================================================
  // Tasks
  // ============================================================================

  insertTask(task: TeamTask): void {
    this.stmts.insertTask.run(
      task.id,
      task.teamName,
      task.subject,
      task.description,
      task.ownerHandle,
      task.ownerUid,
      task.createdByHandle,
      task.createdByUid,
      task.status,
      JSON.stringify(task.blockedBy),
      task.createdAt,
      task.updatedAt
    );
  }

  getTask(taskId: string): TeamTask | null {
    const row = this.stmts.getTask.get(taskId) as {
      id: string;
      team_name: string;
      subject: string;
      description: string | null;
      owner_handle: string | null;
      owner_uid: string | null;
      created_by_handle: string;
      created_by_uid: string;
      status: string;
      blocked_by: string | null;
      created_at: string;
      updated_at: string;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      teamName: row.team_name,
      subject: row.subject,
      description: row.description,
      ownerHandle: row.owner_handle,
      ownerUid: row.owner_uid,
      createdByHandle: row.created_by_handle,
      createdByUid: row.created_by_uid,
      status: row.status as TaskStatus,
      blockedBy: row.blocked_by ? (JSON.parse(row.blocked_by) as string[]) : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getTasksByTeam(teamName: string): TeamTask[] {
    const rows = this.stmts.getTasksByTeam.all(teamName) as Array<{
      id: string;
      team_name: string;
      subject: string;
      description: string | null;
      owner_handle: string | null;
      owner_uid: string | null;
      created_by_handle: string;
      created_by_uid: string;
      status: string;
      blocked_by: string | null;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      teamName: row.team_name,
      subject: row.subject,
      description: row.description,
      ownerHandle: row.owner_handle,
      ownerUid: row.owner_uid,
      createdByHandle: row.created_by_handle,
      createdByUid: row.created_by_uid,
      status: row.status as TaskStatus,
      blockedBy: row.blocked_by ? (JSON.parse(row.blocked_by) as string[]) : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  updateTaskStatus(taskId: string, status: TaskStatus, updatedAt: string): void {
    this.stmts.updateTaskStatus.run(status, updatedAt, taskId);
  }

  // ============================================================================
  // Debug
  // ============================================================================

  getDebugInfo() {
    const users = this.db.prepare('SELECT * FROM users').all() as Array<{
      uid: string;
      handle: string;
      team_name: string;
      agent_type: string;
      created_at: string;
      last_seen: string | null;
    }>;

    const chats = this.db.prepare('SELECT * FROM chats').all() as Array<{
      id: string;
      participants: string;
      is_team_chat: number;
      team_name: string | null;
      created_at: string;
      updated_at: string;
    }>;

    const messageCount = this.db.prepare('SELECT COUNT(*) as count FROM messages').get() as {
      count: number;
    };

    const tasks = this.db.prepare('SELECT * FROM tasks').all() as Array<{
      id: string;
      team_name: string;
      subject: string;
      description: string | null;
      owner_handle: string | null;
      owner_uid: string | null;
      created_by_handle: string;
      created_by_uid: string;
      status: string;
      blocked_by: string | null;
      created_at: string;
      updated_at: string;
    }>;

    return {
      users: users.map((u) => ({
        uid: u.uid,
        handle: u.handle,
        teamName: u.team_name,
        agentType: u.agent_type as 'team-lead' | 'worker',
        createdAt: u.created_at,
        lastSeen: u.last_seen,
      })),
      chats: chats.map((c) => ({
        id: c.id,
        participants: JSON.parse(c.participants) as string[],
        isTeamChat: c.is_team_chat === 1,
        teamName: c.team_name,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      })),
      messageCount: messageCount.count,
      tasks: tasks.map((t) => ({
        id: t.id,
        teamName: t.team_name,
        subject: t.subject,
        description: t.description,
        ownerHandle: t.owner_handle,
        ownerUid: t.owner_uid,
        createdByHandle: t.created_by_handle,
        createdByUid: t.created_by_uid,
        status: t.status as TaskStatus,
        blockedBy: t.blocked_by ? (JSON.parse(t.blocked_by) as string[]) : [],
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      })),
    };
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  close(): void {
    this.db.close();
  }
}
