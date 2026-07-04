#!/usr/bin/env node

/**
 * Uptime Kuma List Tool
 * Lists monitors from an instance, optionally grouped by parent group.
 * --tldr: summary counts by group and type
 */

const io = require('socket.io-client');
const fs = require('fs');

const args = process.argv.slice(2);
const tldr = args.includes('--tldr');
const instanceName = args.find(a => !a.startsWith('--'));

if (!instanceName) {
  console.error('Usage: node uptime-kuma-list.js <instance-name> [--tldr]');
  process.exit(1);
}

const configFile = process.env.CONFIG_FILE || './uptime-kuma-config.json';
const fileConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const instance = fileConfig.instances[instanceName];
if (!instance) {
  console.error(`Instance "${instanceName}" not found in config`);
  console.error(`Available: ${Object.keys(fileConfig.instances).join(', ')}`);
  process.exit(1);
}

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

(async () => {
  const socket = await connect(instance.url, instance.username, instance.password);

  const monitorData = await new Promise((resolve, reject) => {
    socket.once('monitorList', resolve);
    socket.emit('getMonitorList', (res) => {
      if (res && res.ok === false) reject(new Error('Failed to get monitor list'));
    });
  });

  socket.disconnect();

  const all = Object.values(monitorData);
  const groups = all.filter(m => m.type === 'group').sort((a, b) => a.name.localeCompare(b.name));
  const byId = Object.fromEntries(all.map(m => [m.id, m]));

  // Build group → children map
  const children = {};
  for (const m of all) {
    if (m.type === 'group') continue;
    const key = m.parent != null ? m.parent : '__ungrouped__';
    if (!children[key]) children[key] = [];
    children[key].push(m);
  }
  for (const arr of Object.values(children)) {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  }

  const ungrouped = children['__ungrouped__'] || [];
  const nonGroupTotal = all.filter(m => m.type !== 'group').length;

  if (tldr) {
    console.log(`\n=== ${instanceName} — Monitor Summary (${nonGroupTotal} monitors, ${groups.length} groups) ===`);

    console.log('\nBy group:');
    for (const g of groups) {
      const count = (children[g.id] || []).length;
      console.log(`  ${String(count).padStart(3)}  ${g.name}`);
    }
    if (ungrouped.length) {
      console.log(`  ${String(ungrouped.length).padStart(3)}  (ungrouped)`);
    }

    const byType = {};
    for (const m of all) {
      if (m.type === 'group') continue;
      byType[m.type] = (byType[m.type] || 0) + 1;
    }
    console.log('\nBy type:');
    for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(3)}  ${type}`);
    }
    console.log('');
  } else {
    console.log(`\n=== ${instanceName} — All Monitors (${nonGroupTotal} monitors, ${groups.length} groups) ===`);

    for (const g of groups) {
      const kids = children[g.id] || [];
      console.log(`\n[${g.name}] (${kids.length})`);
      for (const m of kids) {
        const rawUrl = m.url && !m.url.endsWith('://') ? m.url : '';
        const target = rawUrl || (m.hostname ? `${m.hostname}${m.port ? ':' + m.port : ''}` : '');
        const targetStr = target ? `  ${target}` : '';
        console.log(`  [${String(m.id).padStart(3)}] ${m.type.padEnd(10)} ${m.name}${targetStr}`);
      }
    }

    if (ungrouped.length) {
      console.log(`\n[ungrouped] (${ungrouped.length})`);
      for (const m of ungrouped) {
        const rawUrl = m.url && !m.url.endsWith('://') ? m.url : '';
        const target = rawUrl || (m.hostname ? `${m.hostname}${m.port ? ':' + m.port : ''}` : '');
        const targetStr = target ? `  ${target}` : '';
        console.log(`  [${String(m.id).padStart(3)}] ${m.type.padEnd(10)} ${m.name}${targetStr}`);
      }
    }
    console.log('');
  }
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
