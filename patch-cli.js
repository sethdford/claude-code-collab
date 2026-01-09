#!/usr/bin/env node
/**
 * Claude Code CLI Patcher
 *
 * This script patches Claude Code's cli.js to:
 * 1. Enable hidden beta features ($q, NW1, SQ1)
 * 2. Replace Firebase stubs with local server implementations
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const COLLAB_URL = process.env.CLAUDE_CODE_COLLAB_URL || 'http://localhost:3847';

// Find the CLI using safe file operations
function findCli() {
  const locations = [
    '/tmp/claude-code-analysis/package/cli.js',
  ];

  for (const loc of locations) {
    if (fs.existsSync(loc)) {
      return loc;
    }
  }

  // Check npm cache
  const npmCacheBase = path.join(process.env.HOME, '.npm/_npx');
  if (fs.existsSync(npmCacheBase)) {
    const dirs = fs.readdirSync(npmCacheBase);
    for (const dir of dirs) {
      const cliPath = path.join(npmCacheBase, dir, 'node_modules/@anthropic-ai/claude-code/cli.js');
      if (fs.existsSync(cliPath)) {
        return cliPath;
      }
    }
  }

  // Try to download using npm
  console.log('Downloading latest Claude Code package...');
  const tmpDir = '/tmp/claude-code-analysis';
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    execFileSync('npm', ['pack', '@anthropic-ai/claude-code'], {
      cwd: tmpDir,
      stdio: 'pipe'
    });

    const tgzFiles = fs.readdirSync(tmpDir).filter(f => f.endsWith('.tgz'));
    if (tgzFiles.length > 0) {
      execFileSync('tar', ['-xzf', tgzFiles[0]], {
        cwd: tmpDir,
        stdio: 'pipe'
      });
    }

    const cliPath = path.join(tmpDir, 'package/cli.js');
    if (fs.existsSync(cliPath)) {
      return cliPath;
    }
  } catch (e) {
    console.error('Failed to download Claude Code package:', e.message);
  }

  return null;
}

// Local server implementation code to inject
const LOCAL_COLLAB_IMPL = `
// === CLAUDE COLLAB LOCAL IMPLEMENTATION ===
const COLLAB_URL = process.env.CLAUDE_CODE_COLLAB_URL || '${COLLAB_URL}';
let _collabUser = null;
let _collabWs = null;
let _messageCallbacks = new Set();

async function _collabFetch(endpoint, options = {}) {
  const url = COLLAB_URL + endpoint;
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  if (!res.ok) throw new Error('Collab API error: ' + res.status);
  return res.json();
}

async function _collabAuth() {
  if (_collabUser) return _collabUser;

  const teamName = process.env.CLAUDE_CODE_TEAM_NAME;
  const handle = process.env.CLAUDE_CODE_AGENT_NAME || 'agent-' + Math.random().toString(36).slice(2, 8);
  const agentType = process.env.CLAUDE_CODE_AGENT_TYPE || 'worker';

  if (!teamName) {
    return null;
  }

  try {
    _collabUser = await _collabFetch('/auth', {
      method: 'POST',
      body: JSON.stringify({ handle, teamName, agentType })
    });
    console.log('[Collab] Authenticated as', handle, 'in team', teamName);
    _collabConnectWs();
    return _collabUser;
  } catch (e) {
    return null;
  }
}

let _subscribedChats = new Set();

function _collabConnectWs() {
  if (_collabWs) return;
  if (!_collabUser) return;

  try {
    const wsUrl = COLLAB_URL.replace('http', 'ws') + '/ws';
    const WebSocket = require('ws');
    _collabWs = new WebSocket(wsUrl);

    _collabWs.on('open', () => {
      console.log('[Collab] WebSocket connected');
      // Re-subscribe to previously subscribed chats on reconnect
      _subscribedChats.forEach(chatId => {
        _collabWs.send(JSON.stringify({
          type: 'subscribe',
          chatId,
          uid: _collabUser ? _collabUser.uid : null
        }));
      });
    });

    _collabWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'new_message' || msg.type === 'broadcast' || msg.type === 'task_assigned') {
          _messageCallbacks.forEach(cb => {
            try { cb(msg); } catch (e) {}
          });
        }
      } catch (e) {}
    });

    _collabWs.on('close', () => {
      _collabWs = null;
      console.log('[Collab] WebSocket closed, reconnecting in 5s...');
      setTimeout(_collabConnectWs, 5000);
    });

    _collabWs.on('error', (err) => {
      console.log('[Collab] WebSocket error:', err.message);
    });
  } catch (e) {}
}

function _collabSubscribe(chatId) {
  _subscribedChats.add(chatId);
  if (_collabWs && _collabWs.readyState === 1) {
    _collabWs.send(JSON.stringify({
      type: 'subscribe',
      chatId,
      uid: _collabUser ? _collabUser.uid : null
    }));
  }
}
// === END CLAUDE COLLAB LOCAL IMPLEMENTATION ===
`;

function patch(cliPath) {
  console.log('Reading CLI from:', cliPath);

  let content = fs.readFileSync(cliPath, 'utf8');

  // Backup
  const backupPath = cliPath + '.backup.' + Date.now();
  fs.writeFileSync(backupPath, content);
  console.log('Backup created:', backupPath);

  // 1. Enable feature flags
  const patches = [
    { from: 'function $q(){return!1}', to: 'function $q(){return!0}', name: 'Task Tools ($q)' },
    { from: 'function NW1(){return!1}', to: 'function NW1(){return!0}', name: 'Team Collaboration (NW1)' },
    { from: 'function SQ1(){return!1}', to: 'function SQ1(){return!0}', name: 'Discover Command (SQ1)' },
  ];

  patches.forEach(p => {
    if (content.includes(p.from)) {
      content = content.replace(p.from, p.to);
      console.log('✓ Enabled:', p.name);
    } else if (content.includes(p.to)) {
      console.log('○ Already enabled:', p.name);
    } else {
      console.log('✗ Not found:', p.name);
    }
  });

  // 2. Inject local collaboration implementation at the start
  if (!content.includes('CLAUDE COLLAB LOCAL IMPLEMENTATION')) {
    const insertPoint = content.indexOf('var ');
    if (insertPoint > 0) {
      content = content.slice(0, insertPoint) + LOCAL_COLLAB_IMPL + '\n' + content.slice(insertPoint);
      console.log('✓ Injected local collaboration implementation');
    }
  } else {
    console.log('○ Local collaboration already injected');
  }

  // Write patched file
  fs.writeFileSync(cliPath, content);
  console.log('\n✓ Patched CLI written to:', cliPath);

  // 3. Install ws dependency in Claude Code's directory
  const cliDir = path.dirname(cliPath);
  const wsPath = path.join(cliDir, 'node_modules', 'ws');
  if (!fs.existsSync(wsPath)) {
    console.log('\nInstalling ws dependency...');
    try {
      execFileSync('npm', ['install', 'ws', '--no-save'], {
        cwd: cliDir,
        stdio: 'pipe'
      });
      console.log('✓ Installed ws for WebSocket support');
    } catch (e) {
      console.log('⚠ Warning: Could not install ws. WebSocket features may not work.');
      console.log('  Run manually: cd ' + cliDir + ' && npm install ws');
    }
  } else {
    console.log('○ ws already installed');
  }

  const scriptDir = path.dirname(process.argv[1]);
  console.log(`
═══════════════════════════════════════════════════════════════
  Patching complete!

  To use team mode:

  1. Start the local collaboration server:
     cd ${scriptDir}
     npm start

  2. Set environment variables:
     export CLAUDE_CODE_TEAM_NAME="my-team"
     export CLAUDE_CODE_AGENT_TYPE="team-lead"
     export CLAUDE_CODE_AGENT_NAME="lead-1"
     export CLAUDE_CODE_COLLAB_URL="http://localhost:3847"

  3. Run the patched CLI:
     node ${cliPath}

═══════════════════════════════════════════════════════════════
  `);
}

function unpatch(cliPath) {
  const dir = path.dirname(cliPath);
  const basename = path.basename(cliPath);

  const backups = fs.readdirSync(dir)
    .filter(f => f.startsWith(basename + '.backup.'))
    .sort()
    .reverse();

  if (backups.length === 0) {
    console.log('No backups found');
    return;
  }

  const latestBackup = path.join(dir, backups[0]);
  console.log('Restoring from:', latestBackup);

  fs.copyFileSync(latestBackup, cliPath);
  console.log('✓ Restored original CLI');
}

// Main
const command = process.argv[2] || 'patch';
const cliPath = process.argv[3] || findCli();

if (!cliPath) {
  console.error('Could not find Claude Code CLI');
  console.error('Usage: node patch-cli.js [patch|unpatch] [/path/to/cli.js]');
  process.exit(1);
}

switch (command) {
  case 'patch':
    patch(cliPath);
    break;
  case 'unpatch':
    unpatch(cliPath);
    break;
  default:
    console.error('Unknown command:', command);
    console.error('Usage: node patch-cli.js [patch|unpatch] [/path/to/cli.js]');
    process.exit(1);
}
