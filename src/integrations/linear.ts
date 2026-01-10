/**
 * Linear Integration
 * 
 * Syncs tasks between Claude Code Collab and Linear.
 */

import type { TeamTask, TaskStatus } from '../types.js';

const STATUS_MAP: Record<TaskStatus, string> = {
  open: 'Backlog',
  in_progress: 'In Progress',
  resolved: 'Done',
  blocked: 'Blocked',
};

const REVERSE_STATUS_MAP: Record<string, TaskStatus> = {
  'Backlog': 'open',
  'Todo': 'open',
  'In Progress': 'in_progress',
  'In Review': 'in_progress',
  'Done': 'resolved',
  'Completed': 'resolved',
  'Blocked': 'blocked',
};

export interface LinearConfig {
  enabled: boolean;
  teamId?: string;
  projectId?: string;
  labelId?: string;
}

export function isLinearAvailable(): boolean {
  return !!process.env.LINEAR_API_KEY || !!process.env.LINEAR_MCP_ENABLED;
}

export function taskToLinearIssue(task: TeamTask): { title: string; description: string; state: string } {
  return {
    title: task.subject,
    description: task.description ?? `Task from Claude Code Collab\n\nAssigned to: ${task.ownerHandle}`,
    state: STATUS_MAP[task.status],
  };
}

export function linearStateToTaskStatus(stateName: string): TaskStatus {
  return REVERSE_STATUS_MAP[stateName] ?? 'open';
}

export function createLinearIssueMCP(task: TeamTask, config: LinearConfig) {
  return {
    tool: 'mcp__linear__create_issue',
    args: {
      title: task.subject,
      description: task.description ?? '',
      team: config.teamId,
      project: config.projectId,
      labels: config.labelId ? [config.labelId] : undefined,
      state: STATUS_MAP[task.status],
    },
  };
}

export function updateLinearIssueMCP(issueId: string, task: TeamTask) {
  return {
    tool: 'mcp__linear__update_issue',
    args: { id: issueId, title: task.subject, state: STATUS_MAP[task.status] },
  };
}

console.log('[LINEAR] Integration module loaded');
