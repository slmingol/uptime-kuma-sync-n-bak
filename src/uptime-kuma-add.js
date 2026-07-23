#!/usr/bin/env node

/**
 * Uptime Kuma Add Monitor
 * Adds a single HTTP or ping monitor to a named instance.
 *
 * Usage:
 *   node uptime-kuma-add.js <instance> --name <name> --url <url> [options]
 *   node uptime-kuma-add.js <instance> --name <name> --type ping --hostname <host> [options]
 *
 * Options:
 *   --name <name>         Monitor display name (required)
 *   --url <url>           URL to monitor (required for http)
 *   --hostname <host>     Hostname or IP (required for ping)
 *   --type <type>         Monitor type: http (default) | ping
 *   --group <id>          Parent group ID (integer)
 *   --interval <seconds>  Check interval (default: 60)
 *   --dry-run             Print payload without adding
 */

const io = require('socket.io-client');
const fs = require('fs');

// ── Arg parsing ──────────────────────────────────────────────────────────────

const rawArgs = process.argv.slice(2);
const instanceName = rawArgs.find(a => !a.startsWith('--'));

function flag(name) {
  const idx = rawArgs.indexOf(`--${name}`);
  return idx !== -1 && rawArgs[idx + 1] ? rawArgs[idx + 1] : null;
}
function hasFlag(name) {
  return rawArgs.includes(`--${name}`);
}

const name     = flag('name');
const url      = flag('url');
const hostname = flag('hostname');
const type     = flag('type') || 'http';
const groupId  = flag('group') ? parseInt(flag('group'), 10) : null;
const interval = flag('interval') ? parseInt(flag('interval'), 10) : 60;
const dryRun   = hasFlag('dry-run');

if (!instanceName || !name) {
  console.error('Usage: node uptime-kuma-add.js <instance> --name <name> --url <url> [--type http|ping] [--group <id>] [--interval 60]');
  process.exit(1);
}
if (type === 'http' && !url) {
  console.error('Error: --url is required for http monitors');
  process.exit(1);
}
if (type === 'ping' && !hostname) {
  console.error('Error: --hostname is required for ping monitors');
  process.exit(1);
}

// ── Config ───────────────────────────────────────────────────────────────────

const configFile = process.env.CONFIG_FILE || './uptime-kuma-config.json';
const fileConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const instance = fileConfig.instances[instanceName];
if (!instance) {
  console.error(`Instance "${instanceName}" not found in config`);
  console.error(`Available: ${Object.keys(fileConfig.instances).join(', ')}`);
  process.exit(1);
}

// ── Build monitor payload ────────────────────────────────────────────────────

function buildMonitor() {
  const base = {
    name,
    type,
    interval,
    retryInterval: interval,
    maxretries: 3,
    parent: groupId,
    active: 1,
    conditions: [],
  };

  if (type === 'ping') {
    return { ...base, hostname, accepted_statuscodes: [] };
  }

  return {
    ...base,
    url,
    method: 'GET',
    accepted_statuscodes: ['200-299'],
  };
}

// ── Socket.io helpers ────────────────────────────────────────────────────────

async function connect(url, username, password) {
  return new Promise((resolve, reject) => {
    const socket = io(url, { transports: ['polling', 'websocket'], reconnection: false });
    socket.on('connect', () => {
      socket.emit('login', { username, password, token: '' }, (res) => {
        if (res.ok) setTimeout(() => resolve(socket), 500);
        else reject(new Error(`Login failed: ${res.msg}`));
      });
    });
    socket.on('connect_error', (err) => reject(new Error(err.message)));
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  const monitor = buildMonitor();

  if (dryRun) {
    console.log('\nDry run — would add monitor:');
    console.log(JSON.stringify(monitor, null, 2));
    return;
  }

  const socket = await connect(instance.url, instance.username, instance.password);

  await new Promise((resolve, reject) => {
    socket.emit('add', monitor, (res) => {
      if (res.ok) {
        console.log(`\x1b[32m✓\x1b[0m Added monitor: ${name} (id=${res.monitorID})`);
        resolve();
      } else {
        reject(new Error(`Failed to add monitor: ${res.msg}`));
      }
    });
  });

  socket.disconnect();
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
