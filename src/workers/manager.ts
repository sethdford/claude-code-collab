/**
 * Worker Manager
 *
 * Manages spawning, monitoring, and communication with Claude Code worker instances.
 * Uses child_process.spawn with NDJSON streaming for bidirectional communication.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { v4 as uuidv4 } from 'uuid';
import type {
  WorkerProcess,
  WorkerState,
  ClaudeEvent,
  SpawnWorkerRequest,
  SpawnWorkerResponse,
} from '../types.js';

const MAX_OUTPUT_LINES = 100;

export interface WorkerManagerEvents {
  'worker:ready': { workerId: string; handle: string; sessionId: string | null };
  'worker:output': { workerId: string; handle: string; event: ClaudeEvent };
  'worker:result': { workerId: string; handle: string; result: string; durationMs?: number };
  'worker:error': { workerId: string; handle: string; error: string };
  'worker:exit': { workerId: string; handle: string; code: number | null };
}

export class WorkerManager extends EventEmitter {
  private workers = new Map<string, WorkerProcess>();
  private maxWorkers: number;
  private defaultTeamName: string;
  private serverUrl: string;

  constructor(options: {
    maxWorkers?: number;
    defaultTeamName?: string;
    serverUrl?: string;
  } = {}) {
    super();
    this.maxWorkers = options.maxWorkers ?? 5;
    this.defaultTeamName = options.defaultTeamName ?? 'default';
    this.serverUrl = options.serverUrl ?? 'http://localhost:3847';
  }

  /**
   * Spawn a new Claude Code worker instance
   */
  async spawnWorker(request: SpawnWorkerRequest): Promise<SpawnWorkerResponse> {
    if (this.workers.size >= this.maxWorkers) {
      throw new Error(`Maximum workers (${this.maxWorkers}) reached`);
    }

    // Check if worker with this handle already exists
    const existingWorker = this.getWorkerByHandle(request.handle);
    if (existingWorker) {
      throw new Error(`Worker with handle '${request.handle}' already exists`);
    }

    const workerId = uuidv4();
    const teamName = request.teamName ?? this.defaultTeamName;
    const workingDir = request.workingDir ?? process.cwd();

    // Build Claude Code arguments
    const args = [
      '--print',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--dangerously-skip-permissions',
    ];

    // Resume session if provided
    if (request.sessionId) {
      args.push('--resume', request.sessionId);
    }

    // Spawn the process
    const proc = spawn('claude', args, {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        CLAUDE_CODE_TEAM_NAME: teamName,
        CLAUDE_CODE_AGENT_TYPE: 'worker',
        CLAUDE_CODE_AGENT_NAME: request.handle,
        CLAUDE_CODE_COLLAB_URL: this.serverUrl,
      },
    });

    const worker: WorkerProcess = {
      id: workerId,
      handle: request.handle,
      teamName,
      process: proc,
      sessionId: request.sessionId ?? null,
      workingDir,
      state: 'starting',
      recentOutput: [],
      spawnedAt: Date.now(),
      currentTaskId: null,
    };

    this.workers.set(workerId, worker);
    this.setupProcessHandlers(worker);

    // Send initial prompt if provided
    if (request.initialPrompt) {
      // Wait a bit for the process to initialize
      setTimeout(() => {
        this.sendToWorker(workerId, request.initialPrompt!);
      }, 500);
    }

    console.log(`[WORKER] Spawned ${request.handle} (${workerId.slice(0, 8)}...)`);

    return {
      id: workerId,
      handle: worker.handle,
      teamName: worker.teamName,
      workingDir: worker.workingDir,
      state: worker.state,
      spawnedAt: worker.spawnedAt,
    };
  }

  /**
   * Set up event handlers for a worker process
   */
  private setupProcessHandlers(worker: WorkerProcess): void {
    let outputBuffer = '';

    // Handle stdout (NDJSON events)
    worker.process.stdout?.on('data', (data: Buffer) => {
      outputBuffer += data.toString();
      const lines = outputBuffer.split('\n');
      outputBuffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.trim()) {
          this.parseNdjsonLine(worker, line);
        }
      }
    });

    // Handle stderr
    worker.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text && !text.includes('deprecated')) {
        this.addOutput(worker, `[stderr] ${text}`);
        this.emit('worker:error', {
          workerId: worker.id,
          handle: worker.handle,
          error: text,
        });
      }
    });

    // Handle process exit
    worker.process.on('close', (code) => {
      worker.state = 'stopped';
      console.log(`[WORKER] ${worker.handle} exited with code ${code}`);
      this.emit('worker:exit', {
        workerId: worker.id,
        handle: worker.handle,
        code,
      });
      this.workers.delete(worker.id);
    });

    // Handle process errors
    worker.process.on('error', (err) => {
      console.error(`[WORKER] ${worker.handle} error:`, err.message);
      this.emit('worker:error', {
        workerId: worker.id,
        handle: worker.handle,
        error: err.message,
      });
    });
  }

  /**
   * Parse a single NDJSON line from Claude Code output
   */
  private parseNdjsonLine(worker: WorkerProcess, line: string): void {
    try {
      const event = JSON.parse(line) as ClaudeEvent;
      this.handleClaudeEvent(worker, event);
    } catch {
      // Not JSON, treat as plain text output
      this.addOutput(worker, line);
    }
  }

  /**
   * Handle a Claude Code event
   */
  private handleClaudeEvent(worker: WorkerProcess, event: ClaudeEvent): void {
    // Track session ID from init
    if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
      worker.sessionId = event.session_id;
      worker.state = 'ready';
      console.log(`[WORKER] ${worker.handle} ready (session: ${event.session_id.slice(0, 8)}...)`);
      this.emit('worker:ready', {
        workerId: worker.id,
        handle: worker.handle,
        sessionId: worker.sessionId,
      });
    }

    // Track working state
    if (event.type === 'assistant') {
      worker.state = 'working';

      // Extract text content for output
      if (event.message?.content) {
        for (const content of event.message.content) {
          if (content.type === 'text' && content.text) {
            this.addOutput(worker, content.text);
          }
        }
      }
    }

    // Track completion
    if (event.type === 'result') {
      worker.state = 'ready';
      if (event.result) {
        this.addOutput(worker, `[result] ${event.result}`);
      }
      this.emit('worker:result', {
        workerId: worker.id,
        handle: worker.handle,
        result: event.result ?? '',
        durationMs: event.duration_ms,
      });
    }

    // Emit general output event
    this.emit('worker:output', {
      workerId: worker.id,
      handle: worker.handle,
      event,
    });
  }

  /**
   * Add output line to worker's recent output buffer
   */
  private addOutput(worker: WorkerProcess, line: string): void {
    worker.recentOutput.push(line);
    if (worker.recentOutput.length > MAX_OUTPUT_LINES) {
      worker.recentOutput.shift();
    }
  }

  /**
   * Send a message to a worker
   */
  sendToWorker(workerId: string, message: string): boolean {
    const worker = this.workers.get(workerId);
    if (!worker || worker.state === 'stopped') {
      return false;
    }

    const jsonMessage = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: message }],
      },
    });

    worker.process.stdin?.write(jsonMessage + '\n');
    worker.state = 'working';
    this.addOutput(worker, `[user] ${message}`);
    return true;
  }

  /**
   * Send a message to a worker by handle
   */
  sendToWorkerByHandle(handle: string, message: string): boolean {
    const worker = this.getWorkerByHandle(handle);
    if (!worker) return false;
    return this.sendToWorker(worker.id, message);
  }

  /**
   * Dismiss (terminate) a worker
   */
  async dismissWorker(workerId: string): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    console.log(`[WORKER] Dismissing ${worker.handle}`);
    worker.state = 'stopping';

    // Close stdin to signal end
    worker.process.stdin?.end();

    // Send SIGTERM
    worker.process.kill('SIGTERM');

    // Force kill after timeout
    const timeout = setTimeout(() => {
      if (worker.state !== 'stopped') {
        console.log(`[WORKER] Force killing ${worker.handle}`);
        worker.process.kill('SIGKILL');
      }
    }, 5000);

    // Wait for exit
    await new Promise<void>((resolve) => {
      const checkStopped = setInterval(() => {
        if (worker.state === 'stopped' || !this.workers.has(workerId)) {
          clearInterval(checkStopped);
          clearTimeout(timeout);
          resolve();
        }
      }, 100);
    });
  }

  /**
   * Dismiss a worker by handle
   */
  async dismissWorkerByHandle(handle: string): Promise<void> {
    const worker = this.getWorkerByHandle(handle);
    if (!worker) return;
    await this.dismissWorker(worker.id);
  }

  /**
   * Get a worker by ID
   */
  getWorker(workerId: string): WorkerProcess | undefined {
    return this.workers.get(workerId);
  }

  /**
   * Get a worker by handle
   */
  getWorkerByHandle(handle: string): WorkerProcess | undefined {
    for (const worker of this.workers.values()) {
      if (worker.handle === handle) {
        return worker;
      }
    }
    return undefined;
  }

  /**
   * Get all workers
   */
  getWorkers(): WorkerProcess[] {
    return Array.from(this.workers.values());
  }

  /**
   * Get worker count
   */
  getWorkerCount(): number {
    return this.workers.size;
  }

  /**
   * Get recent output from a worker
   */
  getWorkerOutput(workerId: string): string[] {
    const worker = this.workers.get(workerId);
    return worker?.recentOutput ?? [];
  }

  /**
   * Dismiss all workers
   */
  async dismissAll(): Promise<void> {
    const workers = Array.from(this.workers.keys());
    await Promise.all(workers.map((id) => this.dismissWorker(id)));
  }
}
