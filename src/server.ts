/**
 * Claude Code Collab Server v2.0 (TypeScript)
 *
 * Main server with Express HTTP API, WebSocket real-time updates,
 * and worker orchestration for spawning Claude Code instances.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import { WebSocketServer, type WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';

import { SQLiteStorage } from './storage/sqlite.js';
import { WorkerManager } from './workers/manager.js';
import type {
  ServerConfig,
  ServerMetrics,
  TeamAgent,
  TeamTask,
  Chat,
  Message,
  ExtendedWebSocket,
  WebSocketMessage,
  HealthResponse,
  ErrorResponse,
  AuthResponse,
  AgentRegistration,
  CreateTaskRequest,
  UpdateTaskRequest,
  SendMessageRequest,
  BroadcastRequest,
  SpawnWorkerRequest,
  TaskStatus,
  WorkerState,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// CONFIGURATION
// ============================================================================

export function getConfig(): ServerConfig {
  return {
    port: parseInt(process.env.PORT ?? '3847', 10),
    dbPath: process.env.DB_PATH ?? path.join(__dirname, '..', 'collab.db'),
    jwtSecret: process.env.JWT_SECRET ?? crypto.randomBytes(32).toString('hex'),
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '24h',
    maxWorkers: parseInt(process.env.MAX_WORKERS ?? '5', 10),
    rateLimitWindow: 60000, // 1 minute
    rateLimitMax: 100, // 100 requests per minute per IP
  };
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

function validateRequired(obj: Record<string, unknown>, fields: string[]): { valid: boolean; error?: string } {
  const missing = fields.filter(f => !obj[f] || (typeof obj[f] === 'string' && (obj[f] as string).trim() === ''));
  if (missing.length > 0) {
    return { valid: false, error: `Missing required fields: ${missing.join(', ')}` };
  }
  return { valid: true };
}

function validateString(value: unknown, name: string, minLen = 1, maxLen = 1000): { valid: boolean; error?: string } {
  if (typeof value !== 'string') {
    return { valid: false, error: `${name} must be a string` };
  }
  if (value.length < minLen) {
    return { valid: false, error: `${name} must be at least ${minLen} characters` };
  }
  if (value.length > maxLen) {
    return { valid: false, error: `${name} must be at most ${maxLen} characters` };
  }
  return { valid: true };
}

function validateEnum(value: unknown, name: string, allowed: string[]): { valid: boolean; error?: string } {
  if (!allowed.includes(value as string)) {
    return { valid: false, error: `${name} must be one of: ${allowed.join(', ')}` };
  }
  return { valid: true };
}

// ============================================================================
// HASH HELPERS
// ============================================================================

function generateChatId(uid1: string, uid2: string): string {
  const sorted = [uid1, uid2].sort();
  return crypto.createHash('sha256').update(sorted.join(':')).digest('hex').slice(0, 16);
}

function generateTeamChatId(teamName: string): string {
  return crypto.createHash('sha256').update('team:' + teamName).digest('hex').slice(0, 16);
}

function generateUid(teamName: string, handle: string): string {
  return crypto.createHash('sha256').update(teamName + ':' + handle).digest('hex').slice(0, 24);
}

// ============================================================================
// SERVER CLASS
// ============================================================================

export class CollabServer {
  private app: express.Application;
  private server: http.Server;
  private wss: WebSocketServer;
  private storage: SQLiteStorage;
  private workerManager: WorkerManager;
  private config: ServerConfig;
  private subscriptions = new Map<string, Set<ExtendedWebSocket>>();
  private rateLimits = new Map<string, { count: number; windowStart: number }>();
  private startTime = Date.now();

  constructor(config?: Partial<ServerConfig>) {
    this.config = { ...getConfig(), ...config };
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this.storage = new SQLiteStorage(this.config.dbPath);
    this.workerManager = new WorkerManager({
      maxWorkers: this.config.maxWorkers,
      serverUrl: `http://localhost:${this.config.port}`,
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.setupWorkerEvents();
    this.setupCleanup();
  }

  // ============================================================================
  // MIDDLEWARE
  // ============================================================================

  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(this.rateLimitMiddleware.bind(this));

    // Serve static files (dashboard)
    this.app.use(express.static(path.join(__dirname, '..', 'public')));
  }

  private rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();

    if (!this.rateLimits.has(ip)) {
      this.rateLimits.set(ip, { count: 1, windowStart: now });
      return next();
    }

    const limit = this.rateLimits.get(ip)!;
    if (now - limit.windowStart > this.config.rateLimitWindow) {
      limit.count = 1;
      limit.windowStart = now;
      return next();
    }

    limit.count++;
    if (limit.count > this.config.rateLimitMax) {
      res.status(429).json({ error: 'Too many requests. Try again later.' });
      return;
    }

    next();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _authenticateToken(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1];

    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const decoded = jwt.verify(token, this.config.jwtSecret);
      (req as Request & { user: unknown }).user = decoded;
      next();
    } catch {
      res.status(403).json({ error: 'Invalid or expired token' });
    }
  }

  // ============================================================================
  // ROUTES
  // ============================================================================

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', this.handleHealth.bind(this));

    // Metrics endpoint
    this.app.get('/metrics', this.handleMetrics.bind(this));

    // Authentication
    this.app.post('/auth', this.handleAuth.bind(this));

    // Users
    this.app.get('/users/:uid', this.handleGetUser.bind(this));
    this.app.get('/users/:uid/chats', this.handleGetUserChats.bind(this));

    // Teams
    this.app.get('/teams/:teamName/agents', this.handleGetTeamAgents.bind(this));
    this.app.post('/teams/:teamName/broadcast', this.handleBroadcast.bind(this));
    this.app.get('/teams/:teamName/tasks', this.handleGetTeamTasks.bind(this));

    // Chats
    this.app.post('/chats', this.handleCreateChat.bind(this));
    this.app.get('/chats/:chatId/messages', this.handleGetMessages.bind(this));
    this.app.post('/chats/:chatId/messages', this.handleSendMessage.bind(this));
    this.app.post('/chats/:chatId/read', this.handleMarkRead.bind(this));

    // Tasks
    this.app.post('/tasks', this.handleCreateTask.bind(this));
    this.app.get('/tasks/:taskId', this.handleGetTask.bind(this));
    this.app.patch('/tasks/:taskId', this.handleUpdateTask.bind(this));

    // Orchestration (NEW)
    this.app.post('/orchestrate/spawn', this.handleSpawnWorker.bind(this));
    this.app.post('/orchestrate/dismiss/:handle', this.handleDismissWorker.bind(this));
    this.app.post('/orchestrate/send/:handle', this.handleSendToWorker.bind(this));
    this.app.get('/orchestrate/workers', this.handleGetWorkers.bind(this));
    this.app.get('/orchestrate/output/:handle', this.handleGetWorkerOutput.bind(this));

    // Debug
    this.app.get('/debug', this.handleDebug.bind(this));
  }

  // ============================================================================
  // ROUTE HANDLERS
  // ============================================================================

  private handleHealth(_req: Request, res: Response): void {
    const debug = this.storage.getDebugInfo();
    const response: HealthResponse = {
      status: 'ok',
      version: '2.0.0',
      persistence: 'sqlite',
      dbPath: this.config.dbPath,
      agents: debug.users.length,
      chats: debug.chats.length,
      messages: debug.messageCount,
      workers: this.workerManager.getWorkerCount(),
    };
    res.json(response);
  }

  private handleMetrics(_req: Request, res: Response): void {
    const debug = this.storage.getDebugInfo();
    const healthStats = this.workerManager.getHealthStats();
    const restartStats = this.workerManager.getRestartStats();
    const workers = this.workerManager.getWorkers();

    // Count workers by state
    const byState: Record<WorkerState, number> = {
      starting: 0,
      ready: 0,
      working: 0,
      stopping: 0,
      stopped: 0,
    };
    for (const worker of workers) {
      byState[worker.state]++;
    }

    // Count tasks by status
    const byStatus: Record<TaskStatus, number> = {
      open: 0,
      in_progress: 0,
      resolved: 0,
      blocked: 0,
    };
    for (const task of debug.tasks) {
      byStatus[task.status]++;
    }

    const metrics: ServerMetrics = {
      uptime: Date.now() - this.startTime,
      workers: {
        total: healthStats.total,
        healthy: healthStats.healthy,
        degraded: healthStats.degraded,
        unhealthy: healthStats.unhealthy,
        byState,
      },
      tasks: {
        total: debug.tasks.length,
        byStatus,
      },
      agents: debug.users.length,
      chats: debug.chats.length,
      messages: debug.messageCount,
      restarts: restartStats,
    };

    res.json(metrics);
  }

  private handleAuth(req: Request, res: Response): void {
    const { handle, teamName, agentType } = req.body as AgentRegistration;

    const reqCheck = validateRequired(req.body, ['handle', 'teamName']);
    if (!reqCheck.valid) {
      res.status(400).json({ error: reqCheck.error } as ErrorResponse);
      return;
    }

    const handleCheck = validateString(handle, 'handle', 1, 50);
    if (!handleCheck.valid) {
      res.status(400).json({ error: handleCheck.error } as ErrorResponse);
      return;
    }

    const teamCheck = validateString(teamName, 'teamName', 1, 50);
    if (!teamCheck.valid) {
      res.status(400).json({ error: teamCheck.error } as ErrorResponse);
      return;
    }

    if (agentType) {
      const typeCheck = validateEnum(agentType, 'agentType', ['team-lead', 'worker']);
      if (!typeCheck.valid) {
        res.status(400).json({ error: typeCheck.error } as ErrorResponse);
        return;
      }
    }

    const uid = generateUid(teamName, handle);
    const now = new Date().toISOString();
    const agent: TeamAgent = {
      uid,
      handle,
      teamName,
      agentType: agentType ?? 'worker',
      createdAt: now,
      lastSeen: now,
    };

    this.storage.insertUser(agent);

    const token = jwt.sign(
      { uid, handle, teamName, agentType: agent.agentType },
      this.config.jwtSecret,
      { expiresIn: this.config.jwtExpiresIn } as jwt.SignOptions
    );

    console.log(`[AUTH] ${handle} (${agent.agentType}) joined team "${teamName}"`);

    const response: AuthResponse = {
      uid,
      handle,
      teamName,
      agentType: agent.agentType,
      token,
    };
    res.json(response);
  }

  private handleGetUser(req: Request, res: Response): void {
    const user = this.storage.getUser(req.params.uid);
    if (!user) {
      res.status(404).json({ error: 'User not found' } as ErrorResponse);
      return;
    }
    res.json(user);
  }

  private handleGetUserChats(req: Request, res: Response): void {
    const { uid } = req.params;
    const chats = this.storage.getChatsByUser(uid);
    const result = chats.map(chat => {
      const unread = this.storage.getUnread(chat.id, uid);
      const messages = this.storage.getMessages(chat.id, 1);
      const lastMessage = messages[messages.length - 1];
      return {
        id: chat.id,
        participants: chat.participants,
        unread,
        lastMessage,
        updatedAt: chat.updatedAt,
      };
    });
    res.json(result);
  }

  private handleGetTeamAgents(req: Request, res: Response): void {
    res.json(this.storage.getUsersByTeam(req.params.teamName));
  }

  private handleBroadcast(req: Request, res: Response): void {
    const { teamName } = req.params;
    const { from, text, metadata } = req.body as BroadcastRequest;

    const fromUser = this.storage.getUser(from);
    if (!fromUser) {
      res.status(404).json({ error: 'Sender not found' } as ErrorResponse);
      return;
    }

    const teamChatId = generateTeamChatId(teamName);
    const agents = this.storage.getUsersByTeam(teamName);
    const participants = agents.map(a => a.uid);

    let chat = this.storage.getChat(teamChatId);
    if (!chat) {
      const now = new Date().toISOString();
      chat = {
        id: teamChatId,
        participants,
        isTeamChat: true,
        teamName,
        createdAt: now,
        updatedAt: now,
      };
      this.storage.insertChat(chat);
      participants.forEach(uid => this.storage.setUnread(teamChatId, uid, 0));
    }

    const messageId = uuidv4();
    const now = new Date().toISOString();
    const message: Message = {
      id: messageId,
      chatId: teamChatId,
      fromHandle: 'collab:' + fromUser.handle,
      fromUid: from,
      text,
      timestamp: now,
      status: 'pending',
      metadata: { ...metadata, isBroadcast: true },
    };

    this.storage.insertMessage(message);
    this.storage.updateChatTime(teamChatId, now);
    participants.forEach(uid => {
      if (uid !== from) this.storage.incrementUnread(teamChatId, uid);
    });

    console.log(`[BROADCAST] ${fromUser.handle} -> ${teamName}: ${text.slice(0, 50)}...`);
    this.broadcastToChat(teamChatId, { type: 'broadcast', message, handle: fromUser.handle });
    res.json(message);
  }

  private handleGetTeamTasks(req: Request, res: Response): void {
    const tasks = this.storage.getTasksByTeam(req.params.teamName);
    res.json(tasks);
  }

  private handleCreateChat(req: Request, res: Response): void {
    const { uid1, uid2 } = req.body;

    const reqCheck = validateRequired(req.body, ['uid1', 'uid2']);
    if (!reqCheck.valid) {
      res.status(400).json({ error: reqCheck.error } as ErrorResponse);
      return;
    }

    const user1 = this.storage.getUser(uid1);
    const user2 = this.storage.getUser(uid2);
    if (!user1) {
      res.status(404).json({ error: 'User uid1 not found' } as ErrorResponse);
      return;
    }
    if (!user2) {
      res.status(404).json({ error: 'User uid2 not found' } as ErrorResponse);
      return;
    }
    if (uid1 === uid2) {
      res.status(400).json({ error: 'Cannot create chat with yourself' } as ErrorResponse);
      return;
    }

    const chatId = generateChatId(uid1, uid2);
    const existing = this.storage.getChat(chatId);
    if (!existing) {
      const now = new Date().toISOString();
      const chat: Chat = {
        id: chatId,
        participants: [uid1, uid2],
        isTeamChat: false,
        teamName: null,
        createdAt: now,
        updatedAt: now,
      };
      this.storage.insertChat(chat);
      this.storage.setUnread(chatId, uid1, 0);
      this.storage.setUnread(chatId, uid2, 0);
      console.log(`[CHAT] Created ${chatId}`);
    }
    res.json({ chatId });
  }

  private handleGetMessages(req: Request, res: Response): void {
    const { chatId } = req.params;
    const { limit = '50', after } = req.query;

    const chat = this.storage.getChat(chatId);
    if (!chat) {
      res.status(404).json({ error: 'Chat not found' } as ErrorResponse);
      return;
    }

    let messages: Message[];
    if (after && typeof after === 'string') {
      const afterMessages = this.storage.getMessages(chatId, 1);
      const afterMsg = afterMessages.find(m => m.id === after);
      messages = afterMsg
        ? this.storage.getMessagesAfter(chatId, afterMsg.timestamp, parseInt(limit as string, 10))
        : this.storage.getMessages(chatId, parseInt(limit as string, 10));
    } else {
      messages = this.storage.getMessages(chatId, parseInt(limit as string, 10));
    }

    res.json(messages);
  }

  private handleSendMessage(req: Request, res: Response): void {
    const { chatId } = req.params;
    const { from, text, metadata } = req.body as SendMessageRequest;

    const reqCheck = validateRequired(req.body, ['from', 'text']);
    if (!reqCheck.valid) {
      res.status(400).json({ error: reqCheck.error } as ErrorResponse);
      return;
    }

    const textCheck = validateString(text, 'text', 1, 50000);
    if (!textCheck.valid) {
      res.status(400).json({ error: textCheck.error } as ErrorResponse);
      return;
    }

    const chat = this.storage.getChat(chatId);
    if (!chat) {
      res.status(404).json({ error: 'Chat not found' } as ErrorResponse);
      return;
    }

    const fromUser = this.storage.getUser(from);
    if (!fromUser) {
      res.status(404).json({ error: 'Sender not found' } as ErrorResponse);
      return;
    }

    const messageId = uuidv4();
    const now = new Date().toISOString();
    const message: Message = {
      id: messageId,
      chatId,
      fromHandle: 'collab:' + fromUser.handle,
      fromUid: from,
      text,
      timestamp: now,
      status: 'pending',
      metadata: metadata ?? {},
    };

    this.storage.insertMessage(message);
    this.storage.updateChatTime(chatId, now);
    chat.participants.forEach(uid => {
      if (uid !== from) this.storage.incrementUnread(chatId, uid);
    });

    console.log(`[MSG] ${fromUser.handle}: ${text.slice(0, 50)}...`);
    this.broadcastToChat(chatId, { type: 'new_message', message, handle: fromUser.handle });
    res.json(message);
  }

  private handleMarkRead(req: Request, res: Response): void {
    const { chatId } = req.params;
    const { uid } = req.body;

    if (!uid) {
      res.status(400).json({ error: 'uid is required' } as ErrorResponse);
      return;
    }

    const chat = this.storage.getChat(chatId);
    if (!chat) {
      res.status(404).json({ error: 'Chat not found' } as ErrorResponse);
      return;
    }

    this.storage.clearUnread(chatId, uid);
    res.json({ success: true });
  }

  private handleCreateTask(req: Request, res: Response): void {
    const { fromUid, toHandle, teamName, subject, description, blockedBy } = req.body as CreateTaskRequest;

    const reqCheck = validateRequired(req.body, ['fromUid', 'toHandle', 'teamName', 'subject']);
    if (!reqCheck.valid) {
      res.status(400).json({ error: reqCheck.error } as ErrorResponse);
      return;
    }

    const subjectCheck = validateString(subject, 'subject', 3, 200);
    if (!subjectCheck.valid) {
      res.status(400).json({ error: subjectCheck.error } as ErrorResponse);
      return;
    }

    if (description) {
      const descCheck = validateString(description, 'description', 0, 10000);
      if (!descCheck.valid) {
        res.status(400).json({ error: descCheck.error } as ErrorResponse);
        return;
      }
    }

    if (blockedBy && !Array.isArray(blockedBy)) {
      res.status(400).json({ error: 'blockedBy must be an array of task IDs' } as ErrorResponse);
      return;
    }

    const fromUser = this.storage.getUser(fromUid);
    if (!fromUser) {
      res.status(404).json({ error: 'Sender not found' } as ErrorResponse);
      return;
    }

    const agents = this.storage.getUsersByTeam(teamName);
    const toUser = agents.find(a => a.handle === toHandle);
    if (!toUser) {
      res.status(404).json({ error: `Agent ${toHandle} not found` } as ErrorResponse);
      return;
    }

    const taskId = uuidv4();
    const now = new Date().toISOString();
    const task: TeamTask = {
      id: taskId,
      teamName,
      subject,
      description: description ?? null,
      ownerHandle: toHandle,
      ownerUid: toUser.uid,
      createdByHandle: fromUser.handle,
      createdByUid: fromUid,
      status: 'open',
      blockedBy: blockedBy ?? [],
      createdAt: now,
      updatedAt: now,
    };

    this.storage.insertTask(task);

    // Create chat and send task assignment message
    const chatId = generateChatId(fromUid, toUser.uid);
    let chat = this.storage.getChat(chatId);
    if (!chat) {
      chat = {
        id: chatId,
        participants: [fromUid, toUser.uid],
        isTeamChat: false,
        teamName: null,
        createdAt: now,
        updatedAt: now,
      };
      this.storage.insertChat(chat);
      this.storage.setUnread(chatId, fromUid, 0);
      this.storage.setUnread(chatId, toUser.uid, 0);
    }

    const messageId = uuidv4();
    const message: Message = {
      id: messageId,
      chatId,
      fromHandle: 'collab:' + fromUser.handle,
      fromUid,
      text: `[TASK] ${subject}\n\n${description ?? ''}`,
      timestamp: now,
      status: 'pending',
      metadata: { taskId, type: 'task_assignment' },
    };
    this.storage.insertMessage(message);
    this.storage.incrementUnread(chatId, toUser.uid);

    console.log(`[TASK] ${fromUser.handle} -> ${toHandle}: ${subject}`);
    this.broadcastToChat(chatId, { type: 'task_assigned', task, handle: fromUser.handle });
    res.json(task);
  }

  private handleGetTask(req: Request, res: Response): void {
    const task = this.storage.getTask(req.params.taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found' } as ErrorResponse);
      return;
    }
    res.json(task);
  }

  private handleUpdateTask(req: Request, res: Response): void {
    const { taskId } = req.params;
    const { status } = req.body as UpdateTaskRequest;

    if (!status) {
      res.status(400).json({ error: 'status is required' } as ErrorResponse);
      return;
    }

    const statusCheck = validateEnum(status, 'status', ['open', 'in_progress', 'resolved', 'blocked']);
    if (!statusCheck.valid) {
      res.status(400).json({ error: statusCheck.error } as ErrorResponse);
      return;
    }

    const task = this.storage.getTask(taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found' } as ErrorResponse);
      return;
    }

    // Enforce task dependencies
    if (status === 'resolved' && task.blockedBy.length > 0) {
      const unresolvedBlockers = task.blockedBy.filter(blockerId => {
        const blocker = this.storage.getTask(blockerId);
        return blocker && blocker.status !== 'resolved';
      });
      if (unresolvedBlockers.length > 0) {
        res.status(400).json({
          error: 'Cannot resolve task: blocked by unresolved tasks',
          blockedBy: unresolvedBlockers,
        } as ErrorResponse);
        return;
      }
    }

    const now = new Date().toISOString();
    this.storage.updateTaskStatus(taskId, status as TaskStatus, now);
    console.log(`[TASK] ${taskId.slice(0, 8)}... status -> ${status}`);
    res.json({ ...task, status, updatedAt: now });
  }

  // ============================================================================
  // ORCHESTRATION HANDLERS (NEW)
  // ============================================================================

  private async handleSpawnWorker(req: Request, res: Response): Promise<void> {
    const request = req.body as SpawnWorkerRequest;

    if (!request.handle) {
      res.status(400).json({ error: 'handle is required' } as ErrorResponse);
      return;
    }

    try {
      const worker = await this.workerManager.spawnWorker(request);
      this.broadcastToAll({ type: 'worker_spawned', worker });
      res.json(worker);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message } as ErrorResponse);
    }
  }

  private async handleDismissWorker(req: Request, res: Response): Promise<void> {
    const { handle } = req.params;

    const worker = this.workerManager.getWorkerByHandle(handle);
    if (!worker) {
      res.status(404).json({ error: `Worker '${handle}' not found` } as ErrorResponse);
      return;
    }

    await this.workerManager.dismissWorkerByHandle(handle);
    this.broadcastToAll({ type: 'worker_dismissed', handle });
    res.json({ success: true, handle });
  }

  private handleSendToWorker(req: Request, res: Response): void {
    const { handle } = req.params;
    const { message } = req.body;

    if (!message) {
      res.status(400).json({ error: 'message is required' } as ErrorResponse);
      return;
    }

    const success = this.workerManager.sendToWorkerByHandle(handle, message);
    if (!success) {
      res.status(404).json({ error: `Worker '${handle}' not found or stopped` } as ErrorResponse);
      return;
    }

    res.json({ success: true, handle });
  }

  private handleGetWorkers(_req: Request, res: Response): void {
    const workers = this.workerManager.getWorkers().map(w => ({
      id: w.id,
      handle: w.handle,
      teamName: w.teamName,
      state: w.state,
      workingDir: w.workingDir,
      sessionId: w.sessionId,
      spawnedAt: w.spawnedAt,
      currentTaskId: w.currentTaskId,
    }));
    res.json(workers);
  }

  private handleGetWorkerOutput(req: Request, res: Response): void {
    const { handle } = req.params;

    const worker = this.workerManager.getWorkerByHandle(handle);
    if (!worker) {
      res.status(404).json({ error: `Worker '${handle}' not found` } as ErrorResponse);
      return;
    }

    res.json({
      handle,
      state: worker.state,
      output: worker.recentOutput,
    });
  }

  private handleDebug(_req: Request, res: Response): void {
    const debug = this.storage.getDebugInfo();
    const workers = this.workerManager.getWorkers().map(w => ({
      id: w.id,
      handle: w.handle,
      state: w.state,
    }));
    res.json({ ...debug, workers });
  }

  // ============================================================================
  // WEBSOCKET
  // ============================================================================

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('[WS] New connection');
      const extWs = ws as ExtendedWebSocket;
      extWs.isAlive = true;
      extWs.subscribedChats = new Set();

      extWs.on('pong', () => {
        extWs.isAlive = true;
      });

      extWs.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString()) as WebSocketMessage;
          if (msg.type === 'subscribe' && msg.chatId) {
            extWs.subscribedChats.add(msg.chatId);
            extWs.uid = msg.uid;
            if (!this.subscriptions.has(msg.chatId)) {
              this.subscriptions.set(msg.chatId, new Set());
            }
            this.subscriptions.get(msg.chatId)!.add(extWs);
            console.log(`[WS] Subscribed to ${msg.chatId}`);
            extWs.send(JSON.stringify({ type: 'subscribed', chatId: msg.chatId }));
          } else if (msg.type === 'unsubscribe' && msg.chatId) {
            extWs.subscribedChats.delete(msg.chatId);
            this.subscriptions.get(msg.chatId)?.delete(extWs);
          } else if (msg.type === 'ping') {
            extWs.send(JSON.stringify({ type: 'pong' }));
          }
        } catch (e) {
          console.error('[WS] Error:', (e as Error).message);
        }
      });

      extWs.on('close', () => {
        extWs.subscribedChats.forEach(chatId => {
          this.subscriptions.get(chatId)?.delete(extWs);
        });
        console.log('[WS] Connection closed');
      });
    });

    // Heartbeat interval
    setInterval(() => {
      this.wss.clients.forEach(ws => {
        const extWs = ws as ExtendedWebSocket;
        if (!extWs.isAlive) {
          extWs.subscribedChats?.forEach(chatId => {
            this.subscriptions.get(chatId)?.delete(extWs);
          });
          return extWs.terminate();
        }
        extWs.isAlive = false;
        extWs.ping();
      });
    }, 30000);
  }

  private broadcastToChat(chatId: string, message: WebSocketMessage): void {
    const subs = this.subscriptions.get(chatId);
    if (!subs) return;
    const payload = JSON.stringify(message);
    subs.forEach(ws => {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    });
  }

  private broadcastToAll(message: WebSocketMessage): void {
    const payload = JSON.stringify(message);
    this.wss.clients.forEach(ws => {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    });
  }

  // ============================================================================
  // WORKER EVENTS
  // ============================================================================

  private setupWorkerEvents(): void {
    this.workerManager.on('worker:output', ({ handle, event }) => {
      this.broadcastToAll({ type: 'worker_output', handle, output: JSON.stringify(event) });
    });

    this.workerManager.on('worker:exit', ({ handle }) => {
      this.broadcastToAll({ type: 'worker_dismissed', handle });
    });
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  private setupCleanup(): void {
    // Cleanup rate limits every 5 minutes
    setInterval(() => {
      const now = Date.now();
      for (const [ip, limit] of this.rateLimits) {
        if (now - limit.windowStart > this.config.rateLimitWindow * 2) {
          this.rateLimits.delete(ip);
        }
      }
    }, 300000);

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\nShutting down...');
      this.workerManager.dismissAll().then(() => {
        this.storage.close();
        process.exit(0);
      });
    });
  }

  // ============================================================================
  // START
  // ============================================================================

  start(): void {
    this.server.listen(this.config.port, () => {
      console.log('\n' +
        '==============================================================\n' +
        '     Claude Code Collab Server v2.0 (TypeScript)\n' +
        '          with Worker Orchestration\n' +
        '==============================================================\n' +
        `  HTTP API:    http://localhost:${this.config.port}\n` +
        `  WebSocket:   ws://localhost:${this.config.port}/ws\n` +
        `  Database:    ${this.config.dbPath}\n` +
        `  Max Workers: ${this.config.maxWorkers}\n` +
        '==============================================================\n' +
        '  Usage:\n' +
        '    export CLAUDE_CODE_TEAM_NAME="my-team"\n' +
        `    export CLAUDE_CODE_COLLAB_URL="http://localhost:${this.config.port}"\n` +
        '==============================================================\n'
      );
    });
  }

  async stop(): Promise<void> {
    console.log('[SERVER] Stopping...');
    await this.workerManager.dismissAll();
    this.wss.close();
    this.server.close();
    this.storage.close();
    console.log('[SERVER] Stopped');
  }
}
