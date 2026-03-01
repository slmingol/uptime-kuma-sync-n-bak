#!/usr/bin/env node

/**
 * Uptime Kuma Backup Tool
 * Creates a backup of monitors and tags from an Uptime Kuma instance
 */

const io = require('socket.io-client');
const fs = require('fs');
const path = require('path');

class UptimeKumaBackup {
  constructor(config) {
    this.url = config.url;
    this.username = config.username;
    this.password = config.password;
    this.backupDir = config.backupDir || './uptime-kuma-backups';
    this.instanceName = config.instanceName || 'instance';
  }

  /**
   * Connect to Uptime Kuma instance via Socket.IO
   */
  async connect(url, username, password) {
    return new Promise((resolve, reject) => {
      const socket = io(url, {
        transports: ['websocket'],
        reconnection: false
      });

      socket.on('connect', () => {
        console.log(`Connected to ${url}`);
        
        socket.emit('login', {
          username,
          password,
          token: ''
        }, (res) => {
          if (res.ok) {
            console.log(`Logged in to ${url}`);
            resolve(socket);
          } else {
            reject(new Error(`Login failed: ${res.msg}`));
          }
        });
      });

      socket.on('connect_error', (err) => {
        reject(new Error(`Connection error: ${err.message}`));
      });
    });
  }

  /**
   * Get all monitors from an instance
   */
  async getMonitors(socket) {
    return new Promise((resolve, reject) => {
      socket.emit('getMonitorList', (res) => {
        if (res.ok) {
          resolve(res);
        } else {
          reject(new Error('Failed to get monitor list'));
        }
      });
    });
  }

  /**
   * Get monitor details
   */
  async getMonitor(socket, monitorId) {
    return new Promise((resolve, reject) => {
      socket.emit('getMonitor', monitorId, (res) => {
        if (res.ok) {
          resolve(res.monitor);
        } else {
          reject(new Error(`Failed to get monitor ${monitorId}`));
        }
      });
    });
  }

  /**
   * Get all tags
   */
  async getTags(socket) {
    return new Promise((resolve, reject) => {
      socket.emit('getTags', (res) => {
        if (res.ok) {
          resolve(res.tags);
        } else {
          reject(new Error('Failed to get tags'));
        }
      });
    });
  }

  /**
   * Main backup function
   */
  async backup() {
    console.log('Starting Uptime Kuma backup...\n');
    
    let socket;
    
    try {
      // Create backup directory if it doesn't exist
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true });
      }

      // Connect to instance
      console.log('Connecting to instance...');
      socket = await this.connect(this.url, this.username, this.password);

      // Get all monitors with full details
      console.log('Fetching monitors...');
      const monitorList = await this.getMonitors(socket);
      const monitors = [];

      for (const monitor of Object.values(monitorList)) {
        const fullMonitor = await this.getMonitor(socket, monitor.id);
        monitors.push(fullMonitor);
        console.log(`✓ ${monitor.name}`);
      }

      // Get all tags
      console.log('\nFetching tags...');
      const tags = await this.getTags(socket);
      console.log(`✓ ${Object.keys(tags).length} tags`);

      // Create backup object
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const backupFile = path.join(this.backupDir, `${this.instanceName}-${timestamp}.json`);

      const backup = {
        timestamp: new Date().toISOString(),
        instance: this.instanceName,
        url: this.url,
        monitors,
        tags
      };

      // Write to file
      fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));

      console.log('\n=== Backup Complete ===');
      console.log(`File: ${backupFile}`);
      console.log(`Monitors: ${monitors.length}`);
      console.log(`Tags: ${Object.keys(tags).length}`);

    } catch (err) {
      console.error('Backup failed:', err.message);
      process.exit(1);
    } finally {
      if (socket) socket.disconnect();
    }
  }
}

/**
 * Load instance configuration
 */
function loadInstanceConfig(instanceName) {
  const configFile = process.env.CONFIG_FILE || './uptime-kuma-config.json';
  
  // If instance name provided, load from config file
  if (instanceName && fs.existsSync(configFile)) {
    const fileConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    
    if (!fileConfig.instances[instanceName]) {
      console.error(`Error: Instance '${instanceName}' not found in ${configFile}`);
      console.log(`Available instances: ${Object.keys(fileConfig.instances).join(', ')}`);
      process.exit(1);
    }
    
    const instance = fileConfig.instances[instanceName];
    
    return {
      url: instance.url,
      username: instance.username,
      password: instance.password,
      backupDir: fileConfig.backup?.directory || './uptime-kuma-backups',
      instanceName: instanceName
    };
  }
  
  // Fall back to environment variables
  return {
    url: process.env.UPTIME_URL || 'http://localhost:3001',
    username: process.env.UPTIME_USER || 'admin',
    password: process.env.UPTIME_PASS || '',
    backupDir: process.env.BACKUP_DIR || './uptime-kuma-backups',
    instanceName: instanceName || 'instance'
  };
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Uptime Kuma Backup Tool

Usage:
  node uptime-kuma-backup.js <instance-name>
  node uptime-kuma-backup.js [options]

Options:
  -h, --help       Show this help message

Examples:
  # Using named instance from uptime-kuma-config.json:
  node uptime-kuma-backup.js primary
  
  # Using environment variables:
  UPTIME_URL=... UPTIME_USER=... UPTIME_PASS=... node uptime-kuma-backup.js

Configuration:
  - Define instances in uptime-kuma-config.json
  - Or use environment variables (UPTIME_URL, etc.)
  `);
  process.exit(0);
}

const instanceName = args[0];

// Configuration
const config = loadInstanceConfig(instanceName);

// Run backup
const backupper = new UptimeKumaBackup(config);
backupper.backup();
