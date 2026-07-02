#!/usr/bin/env node
/**
 * Dumps monitor names and current status page group membership from source instance.
 * Usage: node scripts/dump-status-pages.js <instance-name>
 */

const io = require('socket.io-client');
const fs = require('fs');

const configFile = process.env.CONFIG_FILE || './uptime-kuma-config.json';
const instanceName = process.argv[2];

if (!instanceName) {
  console.error('Usage: node scripts/dump-status-pages.js <instance-name>');
  process.exit(1);
}

const fileConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const instance = fileConfig.instances[instanceName];
if (!instance) {
  console.error(`Instance "${instanceName}" not found in config`);
  process.exit(1);
}

async function connect(url, username, password) {
  return new Promise((resolve, reject) => {
    const socket = io(url, { transports: ['polling', 'websocket'], reconnection: false });
    socket._statusPageList = [];
    socket.on('statusPageList', (data) => {
      socket._statusPageList = Object.values(data || {});
    });
    socket.on('connect', () => {
      socket.emit('login', { username, password, token: '' }, (res) => {
        if (res.ok) {
          setTimeout(() => resolve(socket), 500);
        } else {
          reject(new Error(`Login failed: ${res.msg}`));
        }
      });
    });
    socket.on('connect_error', (err) => reject(new Error(err.message)));
  });
}

(async () => {
  const socket = await connect(instance.url, instance.username, instance.password);

  // Get all monitors
  const monitors = await new Promise((resolve, reject) => {
    socket.once('monitorList', resolve);
    socket.emit('getMonitorList', (res) => {
      if (res && res.ok === false) reject(new Error('Failed to get monitors'));
    });
  });

  console.log('\n=== ALL MONITORS ===');
  const monitorMap = {};
  Object.values(monitors)
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(m => {
      monitorMap[m.id] = m.name;
      console.log(`  [${m.id}] ${m.name}`);
    });

  console.log('\n=== STATUS PAGES ===');
  for (const page of socket._statusPageList) {
    console.log(`\nPage: ${page.title} (${page.slug})`);
    try {
      const res = await fetch(`${instance.url}/api/status-page/${page.slug}`);
      const data = await res.json();
      (data.publicGroupList || []).forEach(group => {
        console.log(`  Group: ${group.name}`);
        (group.monitorList || []).forEach(m => {
          console.log(`    - [${m.id}] ${monitorMap[m.id] || m.name || '?'}`);
        });
      });
    } catch (err) {
      console.log(`  (could not fetch page detail: ${err.message})`);
    }
  }

  socket.disconnect();
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
