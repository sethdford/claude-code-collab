#!/usr/bin/env node
/**
 * Claude Code Collab Server - Entry Point
 *
 * Team coordination and worker orchestration for Claude Code instances.
 */

import { CollabServer } from './server.js';

const server = new CollabServer();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[SERVER] Shutting down...');
  await server.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[SERVER] Received SIGTERM, shutting down...');
  await server.stop();
  process.exit(0);
});

// Start the server
server.start();
