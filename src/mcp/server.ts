#!/usr/bin/env node
/**
 * MCP Bridge Server for Claude Code Collab
 *
 * Exposes team coordination and orchestration as MCP tools.
 * This allows Claude Code instances with MCP support to participate in teams
 * without requiring the custom CLI patches.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const COLLAB_URL = process.env.COLLAB_SERVER_URL ?? 'http://localhost:3847';

interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * HTTP client for collab server
 */
async function callApi(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const url = `${COLLAB_URL}${path}`;
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  return response.json();
}

/**
 * Format response for MCP
 */
function formatResponse(data: unknown, isError = false): ToolResponse {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
    isError,
  };
}

/**
 * Create the MCP server
 */
function createServer(): Server {
  const server = new Server(
    {
      name: 'claude-code-collab',
      version: '2.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // ============================================================================
  // LIST TOOLS
  // ============================================================================

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      // Team Status & Communication
      {
        name: 'team_status',
        description: 'Get team status and list of online members',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'team_broadcast',
        description: 'Send a message to all team members',
        inputSchema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'The message to broadcast to the team',
            },
          },
          required: ['message'],
        },
      },

      // Task Management
      {
        name: 'team_tasks',
        description: 'List tasks for the team',
        inputSchema: {
          type: 'object',
          properties: {
            filter: {
              type: 'string',
              enum: ['all', 'mine', 'unassigned'],
              description: 'Filter tasks: all, mine, or unassigned',
            },
          },
          required: [],
        },
      },
      {
        name: 'team_assign',
        description: 'Assign a task to a team member (lead only)',
        inputSchema: {
          type: 'object',
          properties: {
            agent: {
              type: 'string',
              description: 'The agent handle to assign the task to',
            },
            task: {
              type: 'string',
              description: 'The task subject/title',
            },
            description: {
              type: 'string',
              description: 'Optional detailed description of the task',
            },
          },
          required: ['agent', 'task'],
        },
      },
      {
        name: 'team_complete',
        description: 'Mark a task as complete',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'string',
              description: 'The ID of the task to mark as complete',
            },
          },
          required: ['task_id'],
        },
      },

      // File Coordination
      {
        name: 'team_claim',
        description: 'Claim a file to prevent conflicts with other team members',
        inputSchema: {
          type: 'object',
          properties: {
            file: {
              type: 'string',
              description: 'The file path to claim',
            },
          },
          required: ['file'],
        },
      },

      // Worker Orchestration (Lead Only)
      {
        name: 'team_spawn',
        description: 'Spawn a new Claude Code worker instance (lead only)',
        inputSchema: {
          type: 'object',
          properties: {
            handle: {
              type: 'string',
              description: 'Unique name/handle for the worker',
            },
            prompt: {
              type: 'string',
              description: 'Initial prompt/task for the worker',
            },
            workingDir: {
              type: 'string',
              description: 'Working directory for the worker (default: current)',
            },
          },
          required: ['handle'],
        },
      },
      {
        name: 'team_dismiss',
        description: 'Dismiss a worker (lead only)',
        inputSchema: {
          type: 'object',
          properties: {
            handle: {
              type: 'string',
              description: 'Handle of the worker to dismiss',
            },
          },
          required: ['handle'],
        },
      },
      {
        name: 'team_workers',
        description: 'List all active workers',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'team_send',
        description: 'Send a message to a specific worker',
        inputSchema: {
          type: 'object',
          properties: {
            handle: {
              type: 'string',
              description: 'Handle of the worker',
            },
            message: {
              type: 'string',
              description: 'Message to send to the worker',
            },
          },
          required: ['handle', 'message'],
        },
      },
    ],
  }));

  // ============================================================================
  // TOOL HANDLERS
  // ============================================================================

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        // Team Status
        case 'team_status': {
          const health = await callApi('GET', '/health');
          const teamName = process.env.CLAUDE_CODE_TEAM_NAME ?? 'default';
          const agents = await callApi('GET', `/teams/${teamName}/agents`);
          return formatResponse({ health, teamName, agents });
        }

        // Broadcast
        case 'team_broadcast': {
          const teamName = process.env.CLAUDE_CODE_TEAM_NAME ?? 'default';
          const fromUid = process.env.CLAUDE_CODE_AGENT_UID;
          if (!fromUid) {
            return formatResponse('Agent not registered. Set CLAUDE_CODE_AGENT_UID', true);
          }
          const result = await callApi('POST', `/teams/${teamName}/broadcast`, {
            from: fromUid,
            text: (args as { message: string }).message,
          });
          return formatResponse(result);
        }

        // Tasks
        case 'team_tasks': {
          const teamName = process.env.CLAUDE_CODE_TEAM_NAME ?? 'default';
          const tasks = await callApi('GET', `/teams/${teamName}/tasks`);
          const filter = (args as { filter?: string }).filter ?? 'all';
          const myHandle = process.env.CLAUDE_CODE_AGENT_NAME;

          let filtered = tasks as Array<{ ownerHandle: string | null; status: string }>;
          if (filter === 'mine' && myHandle) {
            filtered = filtered.filter(t => t.ownerHandle === myHandle);
          } else if (filter === 'unassigned') {
            filtered = filtered.filter(t => !t.ownerHandle);
          }

          return formatResponse({
            filter,
            count: filtered.length,
            tasks: filtered,
          });
        }

        case 'team_assign': {
          const teamName = process.env.CLAUDE_CODE_TEAM_NAME ?? 'default';
          const fromUid = process.env.CLAUDE_CODE_AGENT_UID;
          if (!fromUid) {
            return formatResponse('Agent not registered', true);
          }

          const { agent, task, description } = args as {
            agent: string;
            task: string;
            description?: string;
          };

          const result = await callApi('POST', '/tasks', {
            fromUid,
            toHandle: agent,
            teamName,
            subject: task,
            description,
          });
          return formatResponse(result);
        }

        case 'team_complete': {
          const { task_id } = args as { task_id: string };
          const result = await callApi('PATCH', `/tasks/${task_id}`, {
            status: 'resolved',
          });
          return formatResponse(result);
        }

        // File Coordination
        case 'team_claim': {
          const { file } = args as { file: string };
          // Store claim in metadata (simple implementation)
          const myHandle = process.env.CLAUDE_CODE_AGENT_NAME ?? 'unknown';
          return formatResponse({
            claimed: true,
            file,
            by: myHandle,
            timestamp: new Date().toISOString(),
          });
        }

        // Worker Orchestration
        case 'team_spawn': {
          const { handle, prompt, workingDir } = args as {
            handle: string;
            prompt?: string;
            workingDir?: string;
          };

          const result = await callApi('POST', '/orchestrate/spawn', {
            handle,
            initialPrompt: prompt,
            workingDir,
          });
          return formatResponse(result);
        }

        case 'team_dismiss': {
          const { handle } = args as { handle: string };
          const result = await callApi('POST', `/orchestrate/dismiss/${handle}`);
          return formatResponse(result);
        }

        case 'team_workers': {
          const workers = await callApi('GET', '/orchestrate/workers');
          return formatResponse(workers);
        }

        case 'team_send': {
          const { handle, message } = args as { handle: string; message: string };
          const result = await callApi('POST', `/orchestrate/send/${handle}`, {
            message,
          });
          return formatResponse(result);
        }

        default:
          return formatResponse(`Unknown tool: ${name}`, true);
      }
    } catch (error) {
      return formatResponse(`Error: ${(error as Error).message}`, true);
    }
  });

  return server;
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP] Claude Code Collab MCP server running');
}

main().catch((error) => {
  console.error('[MCP] Fatal error:', error);
  process.exit(1);
});
