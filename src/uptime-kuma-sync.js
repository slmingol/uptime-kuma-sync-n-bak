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
    this.syncMode = config.syncMode || 'shallow'; // 'shallow' or 'deep'
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
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 1000,
        timeout: 10000
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
   * Add a tag to a monitor
   */
  async addMonitorTag(socket, tagID, monitorID, value = '') {
    return new Promise((resolve, reject) => {
      socket.emit('addMonitorTag', tagID, monitorID, value, (res) => {
        if (res.ok) {
          resolve(res);
        } else {
          reject(new Error(`Failed to add tag to monitor: ${res.msg}`));
        }
      });
    });
  }

  /**
   * Remove a tag from a monitor
   */
  async deleteMonitorTag(socket, tagID, monitorID, value = '') {
    return new Promise((resolve, reject) => {
      socket.emit('deleteMonitorTag', tagID, monitorID, value, (res) => {
        if (res.ok) {
          resolve(res);
        } else {
          reject(new Error(`Failed to delete tag from monitor: ${res.msg}`));
        }
      });
    });
  }

  /**
   * Add or update a monitor
   */
  async saveMonitor(socket, monitor) {
    return new Promise((resolve, reject) => {
      // Deep clone and remove undefined values that cause SQL errors
      const cleanMonitor = JSON.parse(JSON.stringify(monitor));
      
      socket.emit('add', cleanMonitor, (res) => {
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
      // Deep clone and remove undefined values that cause SQL errors
      const cleanMonitor = JSON.parse(JSON.stringify(monitor));
      
      socket.emit('editMonitor', cleanMonitor, (res) => {
        if (res.ok) {
          resolve(res.monitorID);
        } else {
          reject(new Error(`Failed to update monitor: ${res.msg}`));
        }
      });
    });
  }

  /**
   * Clean monitor data for syncing
   * In shallow mode: removes instance-specific fields (intervals, timeouts, etc.) 
   * In deep mode: copies ALL fields including instance-specific settings
   */
  cleanMonitorData(monitor) {
    const cleaned = { ...monitor };
    
    // Array fields that should be reset to empty arrays instead of deleted
    const arrayFields = ['accepted_statuscodes'];  // notificationIDList is actually an object, not an array
    
    // In shallow mode, remove excluded fields to preserve target's instance-specific settings
    // In deep mode, keep all fields - we want an exact copy
    if (this.syncMode === 'shallow') {
      // Remove excluded fields (or reset to empty array if it's an array field)
      this.excludedFields.forEach(field => {
        if (arrayFields.includes(field)) {
          // Special handling for accepted_statuscodes - use sensible default
          if (field === 'accepted_statuscodes') {
            cleaned[field] = monitor.type === 'http' || monitor.type === 'keyword' ? ['200-299'] : [];
          } else {
            cleaned[field] = [];
          }
        } else {
          delete cleaned[field];
        }
      });
    }
    
    // Always ensure critical fields exist with proper defaults (applies to both modes)
    if (cleaned.notificationIDList === undefined || cleaned.notificationIDList === null) {
      cleaned.notificationIDList = {};  // Must be object, not array
    }
    if (cleaned.accepted_statuscodes === undefined || cleaned.accepted_statuscodes === null) {
      cleaned.accepted_statuscodes = monitor.type === 'http' || monitor.type === 'keyword' ? ['200-299'] : [];
    }
    if (cleaned.conditions === undefined || cleaned.conditions === null) {
      cleaned.conditions = [];  // Must be array
    }
    if (cleaned.tags === undefined || cleaned.tags === null) {
      cleaned.tags = [];  // Must be array
    }
    
    // Remove internal fields
    delete cleaned.id;
    delete cleaned.userId;
    delete cleaned.created_date;
    delete cleaned.updated_date;
    
    // Remove foreign key references that won't match across instances
    delete cleaned.docker_host;
    // NOTE: parent field is kept and will be remapped during sync
    
    // Remove auto-generated/computed fields
    delete cleaned.path;
    delete cleaned.pathName;  // camelCase variant
    delete cleaned.path_name;  // snake_case variant
    
    // Remove malformed fields (bugs in Uptime Kuma)
    // Try multiple possible variations - be aggressive here
    delete cleaned.children_i_ds;
    delete cleaned.children_ids;
    delete cleaned.childrenIds;
    delete cleaned.childrenIDs;  // Actual field name used by Uptime Kuma
    delete cleaned.children;
    
    // Remove any fields that are undefined or cause SQL errors
    const keysToDelete = [];
    Object.keys(cleaned).forEach(key => {
      if (cleaned[key] === undefined) {
        keysToDelete.push(key);
      }
      // Remove fields with malformed names (containing special chars that shouldn't be there)
      if (key.includes('_i_d') && key !== 'tag_id' && key !== 'monitor_id') {
        keysToDelete.push(key);
      }
    });
    
    // Actually delete them
    keysToDelete.forEach(key => delete cleaned[key]);
    
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
      console.log(`Mode: ${this.syncMode.toUpperCase()} ${this.syncMode === 'deep' ? '(copying ALL settings)' : '(preserving instance-specific settings)'}`);
      console.log(`Mode: ${this.syncMode.toUpperCase()} ${this.syncMode === 'deep' ? '(copying all settings)' : '(preserving instance-specific settings)'}`);
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
      
      // Sync each monitor - First pass (sync without parent relationships)
      let created = 0;
      let updated = 0;
      let skipped = 0;
      const failedMonitors = [];
      const monitorIdMapping = {}; // Maps source monitor IDs to target monitor IDs
      const monitorsWithParent = []; // Track monitors that have parent relationships
      
      for (const sourceMonitor of monitorList) {
        let fullMonitor;
        try {
          // Get full monitor details
          fullMonitor = await this.getMonitor(sourceSocket, sourceMonitor.id);
          
          // Store original source ID for mapping
          const sourceId = fullMonitor.id;
          
          // Store parent relationship if it exists (to be remapped in second pass)
          const originalParent = fullMonitor.parent;
          
          // Clean the monitor data
          const cleanedMonitor = this.cleanMonitorData(fullMonitor);
          
          // Temporarily remove parent for first pass (will be added in second pass with remapped ID)
          delete cleanedMonitor.parent;
          
          // Find matching monitor in target (by name and type)
          const matchingTarget = targetMonitorList.find(
            m => m.name === cleanedMonitor.name && m.type === cleanedMonitor.type
          );
          
          if (matchingTarget) {
            // Update existing monitor
            console.log(`Updating: ${cleanedMonitor.name}`);
            cleanedMonitor.id = matchingTarget.id;
            
            // Fetch full target monitor details to get complete tag list
            const fullTargetMonitor = await this.getMonitor(targetSocket, matchingTarget.id);
            
            // STEP 1: Remove ALL existing tags first to avoid duplicates
            if (fullTargetMonitor.tags && Array.isArray(fullTargetMonitor.tags)) {
              console.log(`  Removing ${fullTargetMonitor.tags.length} existing tags from ${cleanedMonitor.name}...`);
              for (const existingTag of fullTargetMonitor.tags) {
                try {
                  console.log(`    - Deleting tag: ${existingTag.name || existingTag.tag_id} (value: ${existingTag.value || 'none'})`);
                  await this.deleteMonitorTag(targetSocket, existingTag.tag_id, matchingTarget.id, existingTag.value || '');
                  console.log(`      ✓ Deleted successfully`);
                } catch (err) {
                  // Ignore errors - tag might not exist or already deleted
                  console.warn(`      ✗ Could not delete tag: ${err.message}`);
                }
              }
            } else {
              console.log(`  No existing tags to remove`);
            }
            
            // Extract and map tags - we'll sync them separately via addMonitorTag API
            const monitorTags = [];
            if (cleanedMonitor.tags && Array.isArray(cleanedMonitor.tags)) {
              for (const tag of cleanedMonitor.tags) {
                monitorTags.push({
                  tag_id: tagMapping[tag.tag_id] || tag.tag_id,
                  value: tag.value || ''
                });
              }
            }
            
            // Remove tags from monitor object - editMonitor doesn't handle them
            delete cleanedMonitor.tags;
            
            // STEP 2: Update the monitor
            await this.updateMonitor(targetSocket, cleanedMonitor);
            
            // STEP 3: Add tags from source using dedicated addMonitorTag API
            if (monitorTags.length > 0) {
              console.log(`  Adding ${monitorTags.length} tags from source...`);
              for (const tag of monitorTags) {
                try {
                  console.log(`    + Adding tag: ${tag.tag_id} (value: ${tag.value || 'none'})`);
                  await this.addMonitorTag(targetSocket, tag.tag_id, matchingTarget.id, tag.value);
                  console.log(`      ✓ Added successfully`);
                } catch (err) {
                  console.warn(`      ✗ Could not add tag: ${err.message}`);
                }
              }
            } else {
              console.log(`  No tags to add from source`);
            }
            
            // Store ID mapping
            monitorIdMapping[sourceId] = matchingTarget.id;
            
            // Track if this monitor has a parent that needs remapping
            if (originalParent) {
              monitorsWithParent.push({
                targetId: matchingTarget.id,
                sourceParentId: originalParent,
                monitor: cleanedMonitor
              });
            }
            
            updated++;
          } else {
            // Create new monitor using two-phase approach to work around server bug
            console.log(`Creating: ${cleanedMonitor.name}`);
            
            // Phase 1: Create with minimal required fields only
            const minimalMonitor = {
              name: cleanedMonitor.name,
              type: cleanedMonitor.type,
              active: true,
              // Required fields
              notificationIDList: {},  // Object, not array!
              accepted_statuscodes: cleanedMonitor.accepted_statuscodes || ['200-299'],
              // Required NOT NULL field (array)
              conditions: cleanedMonitor.conditions || []  // Array, not object!
            };
            
            // Add type-specific required fields
            if (cleanedMonitor.url) minimalMonitor.url = cleanedMonitor.url;
            if (cleanedMonitor.hostname) minimalMonitor.hostname = cleanedMonitor.hostname;
            if (cleanedMonitor.port) minimalMonitor.port = cleanedMonitor.port;
            
            const monitorID = await this.saveMonitor(targetSocket, minimalMonitor);
            
            // Phase 2: Update with full details (but remove tags first)
            const monitorTags = [];
            if (cleanedMonitor.tags && Array.isArray(cleanedMonitor.tags)) {
              for (const tag of cleanedMonitor.tags) {
                monitorTags.push({
                  tag_id: tagMapping[tag.tag_id] || tag.tag_id,
                  value: tag.value || ''
                });
              }
            }
            delete cleanedMonitor.tags;  // Remove tags - will add separately
            
            cleanedMonitor.id = monitorID;
            await this.updateMonitor(targetSocket, cleanedMonitor);
            
            // Phase 3: Add tags using dedicated API (no need to delete for new monitors)
            if (monitorTags.length > 0) {
              for (const tag of monitorTags) {
                try {
                  await this.addMonitorTag(targetSocket, tag.tag_id, monitorID, tag.value);
                } catch (err) {
                  console.warn(`Warning: Could not add tag ${tag.tag_id} to new monitor ${cleanedMonitor.name}: ${err.message}`);
                }
              }
            }
            
            // Store ID mapping
            monitorIdMapping[sourceId] = monitorID;
            
            // Track if this monitor has a parent that needs remapping
            if (originalParent) {
              monitorsWithParent.push({
                targetId: monitorID,
                sourceParentId: originalParent,
                monitor: cleanedMonitor
              });
            }
            
            created++;
          }
        } catch (err) {
          const errorMsg = err.message || '';
          
          // Check if it's a server-side schema error (children_i_ds bug)
          if (errorMsg.includes('children_i_ds') || errorMsg.includes('SQLITE_ERROR')) {
            console.error(`⚠ Schema Error: ${sourceMonitor.name} - Server-side Uptime Kuma bug`);
            failedMonitors.push({
              name: sourceMonitor.name,
              type: fullMonitor?.type || 'unknown',
              url: fullMonitor?.url || fullMonitor?.hostname || 'N/A',
              reason: 'Server schema incompatibility (children_i_ds)'
            });
          } else {
            console.error(`Error syncing monitor ${sourceMonitor.name}: ${errorMsg}`);
          }
          skipped++;
        }
      }
      
      // Second pass: Update parent relationships
      if (monitorsWithParent.length > 0) {
        console.log(`\nUpdating parent relationships for ${monitorsWithParent.length} monitors...`);
        
        let parentUpdated = 0;
        let parentSkipped = 0;
        
        for (const { targetId, sourceParentId, monitor } of monitorsWithParent) {
          try {
            // Map source parent ID to target parent ID
            const targetParentId = monitorIdMapping[sourceParentId];
            
            if (targetParentId) {
              // Update monitor with remapped parent ID
              monitor.id = targetId;
              monitor.parent = targetParentId;
              // Ensure tags are not included (they were already synced in first pass)
              delete monitor.tags;
              
              await this.updateMonitor(targetSocket, monitor);
              parentUpdated++;
            } else {
              console.log(`⚠ Warning: Parent not found for ${monitor.name} (source parent ID: ${sourceParentId})`);
              parentSkipped++;
            }
          } catch (err) {
            console.error(`Error updating parent for ${monitor.name}: ${err.message}`);
            parentSkipped++;
          }
        }
        
        console.log(`Parent relationships updated: ${parentUpdated}, skipped: ${parentSkipped}`);
      }
      
      console.log('\n=== Sync Complete ===');
      console.log(`Created: ${created}`);
      console.log(`Updated: ${updated}`);
      console.log(`Skipped: ${skipped}`);
      console.log(`Total: ${monitorList.length}`);
      
      // Report failed monitors if any
      if (failedMonitors.length > 0) {
        console.log('\n⚠ Failed Monitors (Server Schema Incompatibility):');
        console.log('These monitors could not be created due to an Uptime Kuma server bug.');
        console.log('You may need to create them manually in the target instance.\n');
        failedMonitors.forEach((monitor, idx) => {
          console.log(`${idx + 1}. ${monitor.name}`);
          console.log(`   Type: ${monitor.type}`);
          console.log(`   URL: ${monitor.url}`);
          console.log(`   Reason: ${monitor.reason}\n`);
        });
      }
      
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
function loadConfig(sourceName, targetName, options = {}) {
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
      syncMode: options.syncMode || fileConfig.sync?.mode || 'shallow',
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
    syncMode: options.syncMode || process.env.SYNC_MODE || 'shallow',
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
  node uptime-kuma-sync.js <source-instance> <target-instance> [options]
  node uptime-kuma-sync.js [options]

Options:
  -h, --help       Show this help message
  -l, --list       List available instances
  --deep           Deep sync mode - copy ALL settings including intervals, timeouts, etc.
  --shallow        Shallow sync mode (default) - preserve instance-specific settings

Sync Modes:
  Shallow (default): Syncs monitor names, types, URLs, and configuration while
                     preserving instance-specific settings like check intervals,
                     timeouts, and notification settings on the target.
                     
  Deep:              Copies ALL monitor settings from source to target, including
                     intervals, timeouts, retry settings, and notifications.
                     Use this to create an exact replica of the source instance.

Examples:
  # Shallow sync (preserves target's intervals & timeouts):
  node uptime-kuma-sync.js primary secondary
  
  # Deep sync (copies ALL settings including intervals):
  node uptime-kuma-sync.js primary secondary --deep
  
  # Using environment variables:
  SOURCE_UPTIME_URL=... TARGET_UPTIME_URL=... node uptime-kuma-sync.js
  
Configuration:
  - Define instances in uptime-kuma-config.json
  - Or use environment variables (SOURCE_UPTIME_URL, etc.)
  - Set default mode in config: {"sync": {"mode": "deep"}}
  - See uptime-kuma-config.json for example
`);
  process.exit(0);
}

// Only run if this file is executed directly (not required as a module)
if (require.main === module) {
  // Parse sync mode from arguments
  let syncMode = 'shallow'; // default
  if (args.includes('--deep')) {
    syncMode = 'deep';
  } else if (args.includes('--shallow')) {
    syncMode = 'shallow';
  }
  
  // Filter out mode flags from args to get instance names
  const instanceArgs = args.filter(arg => !arg.startsWith('--') && !arg.startsWith('-'));
  const sourceName = instanceArgs[0];
  const targetName = instanceArgs[1];

  // Configuration
  const config = loadConfig(sourceName, targetName, { syncMode });

  // Show warning if using default values
  if (!sourceName && !process.env.SOURCE_UPTIME_URL) {
    console.warn('Warning: Using default localhost URLs. Configure uptime-kuma-config.json or set environment variables.\n');
  }

  // Run sync
  const syncer = new UptimeKumaSync(config);
  syncer.sync();
}

// Export for testing
module.exports = UptimeKumaSync;
