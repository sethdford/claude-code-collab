#!/usr/bin/env node
/**
 * Claude Code Task Tools Enabler (Lite)
 *
 * Enables ONLY the hidden task management tools:
 * - TaskCreate: Create tasks with descriptions
 * - TaskUpdate: Update task status
 * - TaskList: List all tasks
 * - TaskGet: Get task details
 *
 * NO server required. Tasks are managed locally.
 *
 * Usage: node patch-tasks-only.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

// Find Claude Code CLI
function findClaudeCLI() {
  const possiblePaths = [];

  if (os.platform() === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    possiblePaths.push(
      path.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
      path.join(os.homedir(), '.npm', '_npx')
    );
  } else {
    possiblePaths.push(
      '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js',
      '/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js',
      path.join(os.homedir(), '.npm', '_npx')
    );

    // Try which command (safe - no user input)
    try {
      const whichResult = execFileSync('which', ['claude'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      if (whichResult) {
        const realPath = fs.realpathSync(whichResult);
        const cliPath = realPath.replace(/\/bin\/claude$/, '/lib/node_modules/@anthropic-ai/claude-code/cli.js');
        if (fs.existsSync(cliPath)) {
          return cliPath;
        }
      }
    } catch (e) {
      // which command not found or claude not in PATH
    }
  }

  // Check npx cache
  const npxPath = path.join(os.homedir(), '.npm', '_npx');
  if (fs.existsSync(npxPath)) {
    const dirs = fs.readdirSync(npxPath);
    for (const dir of dirs) {
      const cliPath = path.join(npxPath, dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
      if (fs.existsSync(cliPath)) {
        return cliPath;
      }
    }
  }

  // Check standard paths
  for (const p of possiblePaths) {
    if (fs.existsSync(p) && p.endsWith('.js')) {
      return p;
    }
  }

  return null;
}

function patchCLI(cliPath) {
  console.log('Reading CLI file...');
  let content = fs.readFileSync(cliPath, 'utf8');
  const originalContent = content;

  // Only patch $q() for task tools
  const patch = {
    from: 'function $q(){return!1}',
    to: 'function $q(){return!0}',
    name: 'Task Tools ($q)'
  };

  if (content.includes(patch.to)) {
    console.log(`✓ ${patch.name} already enabled`);
    return false;
  }

  if (content.includes(patch.from)) {
    content = content.replace(patch.from, patch.to);
    console.log(`✓ Enabled ${patch.name}`);
  } else {
    console.log(`⚠ Could not find ${patch.name} flag (may be different version)`);
    return false;
  }

  // Backup original
  const backupPath = cliPath + '.backup.tasks';
  if (!fs.existsSync(backupPath)) {
    fs.writeFileSync(backupPath, originalContent);
    console.log(`✓ Backup saved to ${backupPath}`);
  }

  // Write patched version
  fs.writeFileSync(cliPath, content);
  return true;
}

// Main
console.log('');
console.log('Claude Code Task Tools Enabler (Lite)');
console.log('=====================================');
console.log('');

const cliPath = findClaudeCLI();
if (!cliPath) {
  console.error('ERROR: Could not find Claude Code CLI');
  console.error('');
  console.error('Install it first:');
  console.error('  npm install -g @anthropic-ai/claude-code');
  console.error('  # or');
  console.error('  npx @anthropic-ai/claude-code');
  process.exit(1);
}

console.log(`Found CLI: ${cliPath}`);
console.log('');

const patched = patchCLI(cliPath);

console.log('');
if (patched) {
  console.log('SUCCESS! Task tools are now enabled.');
  console.log('');
  console.log('Available tools:');
  console.log('  - TaskCreate: Create a new task');
  console.log('  - TaskUpdate: Update task status');
  console.log('  - TaskList: List all tasks');
  console.log('  - TaskGet: Get task details');
  console.log('');
  console.log('Try it: claude');
  console.log('Then ask: "Create a task to review the code"');
} else {
  console.log('Task tools may already be enabled or the CLI version differs.');
  console.log('Try running: claude');
}
