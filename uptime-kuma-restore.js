#!/usr/bin/env node

/**
 * Uptime Kuma Restore Tool
 * Restores monitors and tags from a backup file
 */

const io = require('socket.io-client');
const fs = require('fs');
const path = require('path');

class UptimeKumaRestore {
  constructor(config) {
    this.targetUrl = config.targetUrl;
    this.targetUsername = config.targetUsername;
    this.targetPassword = config.targetPassword;
    this.backupFile = config.backupFile;
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
   * Add or update a tag
   */
  async saveTag(socket, tag) {
    return new Promise((resolve, reject) => {
      socket.emit('addTag', tag, (res) => {
        if (res.ok) {
          resolve(res.tag);
        } else {
          reject(new Error(`Failed to save tag: ${res.msg}`));
        }
      });
    });
  }

  /**
   * Add a monitor
   */
  async saveMonitor(socket, monitor) {
    return new Promise((resolve, reject) => {
      socket.emit('add', monitor, (res) => {
        if (res.ok) {
          resolve(res.monitorID);
        } else {
          reject(new Error(`Failed to save monitor: ${res.msg}`));
        }
      });
    });
  }

  /**
   * Main restore function
   */
  async restore() {
    console.log('Starting Uptime Kuma restore...\n');
    
    // Check if backup file exists
    if (!fs.existsSync(this.backupFile)) {
      console.error(`Error: Backup file not found: ${this.backupFile}`);
      process.exit(1);
    }

    let socket;
    
    try {
      // Read backup file
      console.log(`Reading backup: ${this.backupFile}`);
      const backupData = JSON.parse(fs.readFileSync(this.backupFile, 'utf8'));
      console.log(`Backup from: ${backupData.timestamp}`);
      console.log(`Monitors: ${backupData.monitors.length}`);
      console.log(`Tags: ${Object.keys(backupData.tags).length}\n`);

      // Connect to target instance
      console.log('Connecting to target instance...');
      socket = await this.connect(
        this.targetUrl,
        this.targetUsername,
        this.targetPassword
      );

      // Restore tags first
      console.log('\nRestoring tags...');
      const tagMapping = {};
      
      for (const [oldId, tag] of Object.entries(backupData.tags)) {
        const newTag = await this.saveTag(socket, {
          name: tag.name,
          color: tag.color
        });
        tagMapping[oldId] = newTag.id || newTag.tag_id;
        console.log(`✓ ${tag.name}`);
      }

      // Restore monitors
      console.log('\nRestoring monitors...');
      let restored = 0;
      let failed = 0;

      for (const monitor of backupData.monitors) {
        try {
          // Remove internal IDs
          const cleanMonitor = { ...monitor };
          delete cleanMonitor.id;
          delete cleanMonitor.userId;
          delete cleanMonitor.created_date;
          delete cleanMonitor.updated_date;

          // Map tags to new IDs
          if (cleanMonitor.tags && Array.isArray(cleanMonitor.tags)) {
            cleanMonitor.tags = cleanMonitor.tags.map(tag => ({
              ...tag,
              tag_id: tagMapping[tag.tag_id] || tag.tag_id
            }));
          }

          await this.saveMonitor(socket, cleanMonitor);
          console.log(`✓ ${cleanMonitor.name}`);
          restored++;
        } catch (err) {
          console.error(`✗ ${monitor.name}: ${err.message}`);
          failed++;
        }
      }

      console.log('\n=== Restore Complete ===');
      console.log(`Restored: ${restored}`);
      console.log(`Failed: ${failed}`);
      console.log(`Total: ${backupData.monitors.length}`);

    } catch (err) {
      console.error('Restore failed:', err.message);
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
      targetUrl: instance.url,
      targetUsername: instance.username,
      targetPassword: instance.password
    };
  }
  
  // Fall back to environment variables
  return {
    targetUrl: process.env.TARGET_UPTIME_URL || 'http://localhost:3002',
    targetUsername: process.env.TARGET_UPTIME_USER || 'admin',
    targetPassword: process.env.TARGET_UPTIME_PASS || ''
  };
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`
Uptime Kuma Restore Tool

Usage:
  node uptime-kuma-restore.js <backup-file> [instance-name]
  node uptime-kuma-restore.js <backup-file>

Options:
  -h, --help    Show this help message

Examples:
  # Restore to named instance from config:
  node uptime-kuma-restore.js backups/primary-2026-03-01.json primary
  
  # Restore using environment variables:
  TARGET_UPTIME_URL=... node uptime-kuma-restore.js backups/backup.json

Arguments:
  backup-file      Path to backup JSON file (required)
  instance-name    Target instance name from config (optional)
  `);
  process.exit(0);
}

const backupFile = args[0];
const instanceName = args[1];

// Load instance config
const instanceConfig = instanceName ? loadInstanceConfig(instanceName) : {};

// Configuration
const config = {
  targetUrl: instanceConfig.targetUrl || process.env.TARGET_UPTIME_URL || 'http://localhost:3002',
  targetUsername: instanceConfig.targetUsername || process.env.TARGET_UPTIME_USER || 'admin',
  targetPassword: instanceConfig.targetPassword || process.env.TARGET_UPTIME_PASS || '',
  backupFile
};

// Run restore
const restorer = new UptimeKumaRestore(config);
restorer.restore();
