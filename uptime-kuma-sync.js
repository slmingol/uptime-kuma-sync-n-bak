#!/usr/bin/env node

/**
 * Uptime Kuma Sync Tool
 * Syncs monitors and groups between two Uptime Kuma instances
 * while preserving instance-specific settings (TTL, intervals, etc.)
 */

const axios = require('axios');
const io = require('socket.io-client');
const fs = require('fs');
const path = require('path');

class UptimeKumaSync {
  constructor(config) {
    this.sourceUrl = config.sourceUrl;
    this.targetUrl = config.targetUrl;
    this.sourceUsername = config.sourceUsername;
    this.sourcePassword = config.sourcePassword;
    this.targetUsername = config.targetUsername;
    this.targetPassword = config.targetPassword;
    this.sourceName = config.sourceName || 'source';
    this.targetName = config.targetName || 'target';
    this.backupDir = config.backupDir || './uptime-kuma-backups';
    this.excludedFields = config.excludedFields || [
      'interval',
      'retryInterval',
      'resendInterval',
      'maxretries',
      'timeout',
      'upside_down',
      'maxredirects',
      'accepted_statuscodes',
      'dns_resolve_type',
      'dns_resolve_server',
      'notificationIDList'
    ];
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
        
        // Login
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
      // Listen for monitorList event
      socket.once('monitorList', (data) => {
        resolve(data);
      });
      
      // Request monitor list
      socket.emit('getMonitorList', (res) => {
        if (res && res.ok === false) {
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
   * Get all tags (groups)
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
   * Add or update a monitor
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
   * Update an existing monitor
   */
  async updateMonitor(socket, monitor) {
    return new Promise((resolve, reject) => {
      socket.emit('editMonitor', monitor, (res) => {
        if (res.ok) {
          resolve(res.monitorID);
        } else {
          reject(new Error(`Failed to update monitor: ${res.msg}`));
        }
      });
    });
  }

  /**
   * Clean monitor data by removing instance-specific fields
   */
  cleanMonitorData(monitor) {
    const cleaned = { ...monitor };
    
    // Remove excluded fields
    this.excludedFields.forEach(field => {
      delete cleaned[field];
    });
    
    // Remove internal fields
    delete cleaned.id;
    delete cleaned.userId;
    delete cleaned.created_date;
    delete cleaned.updated_date;
    
    return cleaned;
  }

  /**
   * Find or create matching tags in target instance
   */
  async syncTags(sourceSocket, targetSocket) {
    const sourceTags = await this.getTags(sourceSocket);
    const targetTags = await this.getTags(targetSocket);
    
    const tagMapping = {};
    
    for (const [sourceId, sourceTag] of Object.entries(sourceTags)) {
      // Find matching tag by name and color
      let matchingTag = Object.values(targetTags).find(
        t => t.name === sourceTag.name && t.color === sourceTag.color
      );
      
      if (!matchingTag) {
        // Create new tag
        console.log(`Creating tag: ${sourceTag.name}`);
        matchingTag = await this.saveTag(targetSocket, {
          name: sourceTag.name,
          color: sourceTag.color
        });
      }
      
      tagMapping[sourceId] = matchingTag.id || matchingTag.tag_id;
    }
    
    return tagMapping;
  }

  /**
   * Backup target instance configuration
   */
  async backup(socket, instanceName) {
    try {
      // Create backup directory if it doesn't exist
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const backupFile = path.join(this.backupDir, `${instanceName}-${timestamp}.json`);

      console.log(`Creating backup: ${backupFile}`);

      // Get all monitors with full details
      const monitorList = await this.getMonitors(socket);
      const monitors = [];

      for (const monitor of Object.values(monitorList)) {
        const fullMonitor = await this.getMonitor(socket, monitor.id);
        monitors.push(fullMonitor);
      }

      // Get all tags
      const tags = await this.getTags(socket);

      // Create backup object
      const backup = {
        timestamp: new Date().toISOString(),
        instance: instanceName,
        monitors,
        tags
      };

      // Write to file
      fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
      console.log(`Backup saved: ${monitors.length} monitors, ${Object.keys(tags).length} tags\n`);

      return backupFile;
    } catch (err) {
      console.error(`Backup failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Main sync function
   */
  async sync() {
    console.log('Starting Uptime Kuma sync...\n');
    
    let sourceSocket, targetSocket;
    
    try {
      // Connect to both instances
      console.log('Connecting to source instance...');
      sourceSocket = await this.connect(
        this.sourceUrl,
        this.sourceUsername,
        this.sourcePassword
      );
      
      console.log('Connecting to target instance...');
      targetSocket = await this.connect(
        this.targetUrl,
        this.targetUsername,
        this.targetPassword
      );
      
      // Backup target instance before syncing
      console.log('\n=== Creating Backup ===');
      const backupFile = await this.backup(targetSocket, this.targetName);
      console.log(`✓ Backup complete: ${backupFile}`);
      
      console.log('\n=== Starting Sync ===');
      console.log(`From: ${this.sourceName} (${this.sourceUrl})`);
      console.log(`To: ${this.targetName} (${this.targetUrl})`);
      console.log('Syncing tags...');
      const tagMapping = await this.syncTags(sourceSocket, targetSocket);
      console.log(`Tag mapping created: ${Object.keys(tagMapping).length} tags\n`);
      
      // Get monitors from source
      console.log('Fetching monitors from source...');
      const sourceMonitors = await this.getMonitors(sourceSocket);
      const monitorList = Object.values(sourceMonitors);
      console.log(`Found ${monitorList.length} monitors\n`);
      
      // Get monitors from target
      console.log('Fetching monitors from target...');
      const targetMonitors = await this.getMonitors(targetSocket);
      const targetMonitorList = Object.values(targetMonitors);
      
      // Sync each monitor
      let created = 0;
      let updated = 0;
      let skipped = 0;
      
      for (const sourceMonitor of monitorList) {
        try {
          // Get full monitor details
          const fullMonitor = await this.getMonitor(sourceSocket, sourceMonitor.id);
          
          // Clean the monitor data
          const cleanedMonitor = this.cleanMonitorData(fullMonitor);
          
          // Map tags
          if (cleanedMonitor.tags && Array.isArray(cleanedMonitor.tags)) {
            cleanedMonitor.tags = cleanedMonitor.tags.map(tag => ({
              ...tag,
              tag_id: tagMapping[tag.tag_id] || tag.tag_id
            }));
          }
          
          // Find matching monitor in target (by name and type)
          const matchingTarget = targetMonitorList.find(
            m => m.name === cleanedMonitor.name && m.type === cleanedMonitor.type
          );
          
          if (matchingTarget) {
            // Update existing monitor
            console.log(`Updating: ${cleanedMonitor.name}`);
            cleanedMonitor.id = matchingTarget.id;
            await this.updateMonitor(targetSocket, cleanedMonitor);
            updated++;
          } else {
            // Create new monitor
            console.log(`Creating: ${cleanedMonitor.name}`);
            await this.saveMonitor(targetSocket, cleanedMonitor);
            created++;
          }
        } catch (err) {
          console.error(`Error syncing monitor ${sourceMonitor.name}: ${err.message}`);
          skipped++;
        }
      }
      
      console.log('\n=== Sync Complete ===');
      console.log(`Created: ${created}`);
      console.log(`Updated: ${updated}`);
      console.log(`Skipped: ${skipped}`);
      console.log(`Total: ${monitorList.length}`);
      
    } catch (err) {
      console.error('Sync failed:', err.message);
      process.exit(1);
    } finally {
      // Disconnect
      if (sourceSocket) sourceSocket.disconnect();
      if (targetSocket) targetSocket.disconnect();
    }
  }
}

/**
 * List available instances from config file
 */
function listInstances() {
  const configFile = process.env.CONFIG_FILE || './uptime-kuma-config.json';
  
  if (!fs.existsSync(configFile)) {
    console.log('No config file found at:', configFile);
    console.log('Create uptime-kuma-config.json to define instances.');
    return;
  }
  
  const fileConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  
  if (!fileConfig.instances || Object.keys(fileConfig.instances).length === 0) {
    console.log('No instances defined in config file.');
    return;
  }
  
  console.log('\nAvailable instances:\n');
  
  for (const [name, config] of Object.entries(fileConfig.instances)) {
    console.log(`  ${name}`);
    console.log(`    URL: ${config.url}`);
    if (config.description) {
      console.log(`    Description: ${config.description}`);
    }
    console.log('');
  }
}

/**
 * Load configuration from file or environment
 */
function loadConfig(sourceName, targetName) {
  const configFile = process.env.CONFIG_FILE || './uptime-kuma-config.json';
  
  // If instance names provided, load from config file
  if (sourceName && targetName && fs.existsSync(configFile)) {
    const fileConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    
    if (!fileConfig.instances[sourceName]) {
      console.error(`Error: Instance '${sourceName}' not found in ${configFile}`);
      console.log(`Available instances: ${Object.keys(fileConfig.instances).join(', ')}`);
      process.exit(1);
    }
    
    if (!fileConfig.instances[targetName]) {
      console.error(`Error: Instance '${targetName}' not found in ${configFile}`);
      console.log(`Available instances: ${Object.keys(fileConfig.instances).join(', ')}`);
      process.exit(1);
    }
    
    const source = fileConfig.instances[sourceName];
    const target = fileConfig.instances[targetName];
    
    return {
      sourceUrl: source.url,
      sourceUsername: source.username,
      sourcePassword: source.password,
      sourceName: sourceName,
      targetUrl: target.url,
      targetUsername: target.username,
      targetPassword: target.password,
      targetName: targetName,
      backupDir: fileConfig.backup?.directory || './uptime-kuma-backups',
      excludedFields: fileConfig.sync?.excludedFields || defaultExcludedFields()
    };
  }
  
  // Fall back to environment variables
  return {
    sourceUrl: process.env.SOURCE_UPTIME_URL || 'http://localhost:3001',
    sourceUsername: process.env.SOURCE_UPTIME_USER || 'admin',
    sourcePassword: process.env.SOURCE_UPTIME_PASS || '',
    sourceName: process.env.SOURCE_NAME || 'source',
    targetUrl: process.env.TARGET_UPTIME_URL || 'http://localhost:3002',
    targetUsername: process.env.TARGET_UPTIME_USER || 'admin',
    targetPassword: process.env.TARGET_UPTIME_PASS || '',
    targetName: process.env.TARGET_NAME || 'target',
    backupDir: process.env.BACKUP_DIR || './uptime-kuma-backups',
    excludedFields: defaultExcludedFields()
  };
}

function defaultExcludedFields() {
  return [
    'interval',           // Check interval
    'retryInterval',      // Retry interval
    'resendInterval',     // Notification resend interval
    'maxretries',         // Max retries
    'timeout',            // Request timeout
    'upside_down',        // Invert status
    'maxredirects',       // Max redirects
    'accepted_statuscodes', // Accepted status codes
    'dns_resolve_type',   // DNS resolve type
    'dns_resolve_server', // DNS server
    'notificationIDList'  // Notification settings (instance-specific)
  ];
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.includes('--list') || args.includes('-l')) {
  listInstances();
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Uptime Kuma Sync Tool

Usage:
  node uptime-kuma-sync.js <source-instance> <target-instance>
  node uptime-kuma-sync.js [options]

Options:
  -h, --help       Show this help message
  -l, --list       List available instances

Examples:
  # Using named instances from uptime-kuma-config.json:
  node uptime-kuma-sync.js primary secondary
  
  # Using environment variables:
  SOURCE_UPTIME_URL=... TARGET_UPTIME_URL=... node uptime-kuma-sync.js
  
Configuration:
  - Define instances in uptime-kuma-config.json
  - Or use environment variables (SOURCE_UPTIME_URL, etc.)
  - See uptime-kuma-config.json for example
`);
  process.exit(0);
}

const sourceName = args[0];
const targetName = args[1];

// Configuration
const config = loadConfig(sourceName, targetName);

// Show warning if using default values
if (!sourceName && !process.env.SOURCE_UPTIME_URL) {
  console.warn('Warning: Using default localhost URLs. Configure uptime-kuma-config.json or set environment variables.\n');
}

// Run sync
const syncer = new UptimeKumaSync(config);
syncer.sync();
