#!/usr/bin/env node

/**
 * Uptime Kuma Sync Tool
 * Syncs monitors and groups between two Uptime Kuma instances
 * while preserving instance-specific settings (TTL, intervals, etc.)
 */

const axios = require('axios');
const crypto = require('crypto');
const io = require('socket.io-client');
const fs = require('fs');
const path = require('path');

const STATE_FILE = '.uptime-kuma-sync-state.json';

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
    this.incremental = config.incremental !== false; // default true; --force disables
    this.prune = config.prune || false;             // delete target monitors absent from source
    this.dryRun = config.dryRun || false;           // preview destructive actions without applying
    this.bidirectional = config.bidirectional || false; // also sync target-only monitors back to source
    this.verbose = config.verbose || false; // Enable detailed logging
    this.excludedFields = config.excludedFields || [
      'interval',
      'retryInterval',
      'resendInterval',
      'maxretries',
      'timeout',
      'upside_down',
      'maxredirects',
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
        transports: ['polling', 'websocket'],
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 1000,
        timeout: 10000
      });

      // Capture server-pushed events that arrive shortly after login
      socket._statusPageList = [];
      socket.on('statusPageList', (data) => {
        socket._statusPageList = Object.values(data || {});
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
            // Brief wait for server-pushed events (monitorList, statusPageList, etc.)
            setTimeout(() => resolve(socket), 500);
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
   * Get list of all status pages via REST API
   */
  async getStatusPageList(baseUrl) {
    const response = await axios.get(`${baseUrl}/api/status-page/list`);
    return Array.isArray(response.data) ? response.data : [];
  }

  /**
   * Get full status page config and public group list via REST API
   */
  async getStatusPage(baseUrl, slug) {
    const response = await axios.get(`${baseUrl}/api/status-page/${slug}`);
    return response.data;
  }

  /**
   * Create a new (empty) status page
   */
  async addStatusPage(socket, name, slug) {
    return new Promise((resolve, reject) => {
      socket.emit('addStatusPage', name, slug, (res) => {
        if (res.ok) {
          resolve(res);
        } else {
          reject(new Error(`Failed to create status page "${slug}": ${res.msg}`));
        }
      });
    });
  }

  /**
   * Save/update a status page with its config and monitor groups
   */
  async saveStatusPage(socket, slug, config, publicGroupList) {
    return new Promise((resolve, reject) => {
      socket.emit('saveStatusPage', slug, config, '', publicGroupList, (res) => {
        if (res.ok) {
          resolve(res);
        } else {
          reject(new Error(`Failed to save status page "${slug}": ${res.msg}`));
        }
      });
    });
  }

  /**
   * Sync all status pages from source to target.
   * Must be called after monitor sync so monitorIdMapping is fully populated.
   * Uses statusPageList captured from the socket event emitted after login.
   */
  async syncStatusPages(sourceSocket, targetSocket, monitorIdMapping) {
    console.log('\n=== Syncing Status Pages ===');

    // statusPageList is captured from the server-pushed socket event at connect time
    const sourcePages = sourceSocket._statusPageList || [];

    if (!sourcePages.length) {
      console.log('No status pages found in source');
      return;
    }

    console.log(`Found ${sourcePages.length} status page(s) in source`);

    const targetSlugs = new Set((targetSocket._statusPageList || []).map(p => p.slug));

    let created = 0, updated = 0, failed = 0;

    for (const page of sourcePages) {
      try {
        const sourceData = await this.getStatusPage(this.sourceUrl, page.slug);
        const { config, publicGroupList } = sourceData;

        // Remap monitor IDs from source to target; drop monitors with no mapping
        const remappedGroupList = (publicGroupList || []).map(group => {
          const mapped = (group.monitorList || [])
            .filter(m => {
              const hasMapped = monitorIdMapping[m.id] !== undefined;
              if (!hasMapped && this.verbose) {
                console.log(`  Skipping unmapped monitor ID ${m.id} in group "${group.name}"`);
              }
              return hasMapped;
            })
            .map(m => ({ id: monitorIdMapping[m.id] }));
          return { name: group.name, weight: group.weight, monitorList: mapped };
        }).filter(group => group.monitorList.length > 0);

        // analyticsType must be null or one of: "google","umami","plausible","matomo","rybbit"
        // empty string fails server validation; field is analyticsId (not analyticsCode)
        const analyticsId = config.analyticsId || config.googleAnalyticsId || null;
        const analyticsType = config.analyticsType || (analyticsId ? 'google' : null);
        const analyticsScriptUrl = config.analyticsScriptUrl || null;

        const cleanConfig = {
          slug: config.slug,
          title: config.title,
          description: config.description || '',
          theme: config.theme || 'light',
          published: config.published !== false,
          showTags: config.showTags || false,
          domainNameList: config.domainNameList || [],
          customCSS: config.customCSS || '',
          footerText: config.footerText || null,
          showPoweredBy: config.showPoweredBy !== false,
          icon: config.icon || '/icon.svg',
          analyticsType,
          analyticsId,
          analyticsScriptUrl
        };

        if (!targetSlugs.has(page.slug)) {
          console.log(`Creating: ${config.title} (${page.slug})`);
          await this.addStatusPage(targetSocket, config.title, page.slug);
          created++;
        } else {
          console.log(`Updating: ${config.title} (${page.slug})`);
          updated++;
        }

        await this.saveStatusPage(targetSocket, page.slug, cleanConfig, remappedGroupList);

      } catch (err) {
        console.error(`Error syncing status page "${page.slug}": ${err.message}`);
        failed++;
      }
    }

    console.log(`Status pages: ${created} created, ${updated} updated${failed ? `, ${failed} failed` : ''}`);
    return { created, updated, failed };
  }

  /**
   * Delete a monitor from an instance
   */
  async deleteMonitor(socket, monitorId) {
    return new Promise((resolve, reject) => {
      socket.emit('deleteMonitor', monitorId, (res) => {
        if (res.ok) resolve();
        else reject(new Error(`Failed to delete monitor ${monitorId}: ${res.msg}`));
      });
    });
  }

  /**
   * Delete monitors on target that no longer exist in source.
   * Respects --dry-run: logs what would be deleted without acting.
   * Groups are skipped — group membership is determined by their children.
   */
  async pruneMonitors(targetSocket, sourceMonitorList, targetMonitorList) {
    console.log('\n=== Pruning Stale Monitors ===');
    const sourceKeys = new Set(sourceMonitorList.map(m => `${m.name}::${m.type}`));
    const toDelete = targetMonitorList.filter(m => m.type !== 'group' && !sourceKeys.has(`${m.name}::${m.type}`));

    if (!toDelete.length) {
      console.log('Nothing to prune — target has no monitors absent from source');
      return;
    }

    if (this.dryRun) {
      console.log(`Dry-run: would delete ${toDelete.length} monitor(s) from target:`);
      toDelete.forEach(m => console.log(`  - [${m.id}] ${m.name} [${m.type}]`));
      return;
    }

    let pruned = 0, pruneFailed = 0;
    for (const m of toDelete) {
      try {
        console.log(`Deleting: ${m.name} [${m.type}]`);
        await this.deleteMonitor(targetSocket, m.id);
        pruned++;
      } catch (err) {
        console.error(`  Failed to delete ${m.name}: ${err.message}`);
        pruneFailed++;
      }
    }
    console.log(`Pruned: ${pruned}${pruneFailed ? `, failed: ${pruneFailed}` : ''}`);
  }

  /**
   * Second pass of bidirectional sync: copy monitors that exist only on target to source.
   * Source wins all conflicts — this only creates/updates monitors absent from source.
   * reverseIdMapping maps target IDs → source IDs for parent remapping.
   */
  async syncBidirectionalPass(sourceSocket, targetSocket, sourceMonitorList, targetMonitorList, reverseIdMapping, tagMapping) {
    console.log('\n=== Bidirectional Pass (target → source) ===');
    const sourceKeys = new Set(sourceMonitorList.map(m => `${m.name}::${m.type}`));
    const targetOnly = targetMonitorList.filter(m => m.type !== 'group' && !sourceKeys.has(`${m.name}::${m.type}`));

    if (!targetOnly.length) {
      console.log('Nothing to sync — no monitors exist only on target');
      return;
    }

    console.log(`Found ${targetOnly.length} monitor(s) only on target — syncing to source`);

    // Refresh source monitor list for accurate matching after first pass
    const freshSource = await this.getMonitors(sourceSocket);
    const freshSourceList = Object.values(freshSource);
    const sourceByKey = {};
    for (const m of freshSourceList) sourceByKey[`${m.name}::${m.type}`] = m;

    let created = 0, updated = 0, failed = 0;
    const monitorsWithParent = [];

    for (const tm of targetOnly) {
      try {
        const fullMonitor = await this.getMonitor(targetSocket, tm.id);
        const sourceId = tm.id;
        const originalParent = fullMonitor.parent;
        const cleaned = this.cleanMonitorData(fullMonitor);
        delete cleaned.parent;

        // Remap tags using inverse tag mapping (target tag_id → source tag_id)
        const monitorTags = [];
        if (cleaned.tags && Array.isArray(cleaned.tags)) {
          for (const tag of cleaned.tags) {
            const sourcTagId = tagMapping ? Object.entries(tagMapping).find(([s, t]) => t === tag.tag_id)?.[0] : null;
            if (sourcTagId) monitorTags.push({ tag_id: parseInt(sourcTagId), value: tag.value || '' });
          }
        }
        delete cleaned.tags;

        const existing = sourceByKey[`${tm.name}::${tm.type}`];
        let targetMonitorId;

        if (existing) {
          console.log(`Updating on source: ${cleaned.name}`);
          cleaned.id = existing.id;
          await this.updateMonitor(sourceSocket, cleaned);
          targetMonitorId = existing.id;
          updated++;
        } else {
          console.log(`Creating on source: ${cleaned.name}`);
          const minimalMonitor = {
            name: cleaned.name,
            type: cleaned.type,
            active: true,
            notificationIDList: {},
            accepted_statuscodes: cleaned.accepted_statuscodes || ['200-299'],
            conditions: cleaned.conditions || []
          };
          if (cleaned.url) minimalMonitor.url = cleaned.url;
          if (cleaned.hostname) minimalMonitor.hostname = cleaned.hostname;
          if (cleaned.port) minimalMonitor.port = cleaned.port;
          targetMonitorId = await this.saveMonitor(sourceSocket, minimalMonitor);
          cleaned.id = targetMonitorId;
          await this.updateMonitor(sourceSocket, cleaned);
          created++;
        }

        // Add tags
        for (const tag of monitorTags) {
          try { await this.addMonitorTag(sourceSocket, tag.tag_id, targetMonitorId, tag.value); } catch (_) {}
        }

        // Track parent for second pass
        if (originalParent) {
          const sourcParentId = reverseIdMapping[originalParent];
          if (sourcParentId) {
            monitorsWithParent.push({ targetId: targetMonitorId, sourceParentId: sourcParentId, monitor: cleaned });
          }
        }
      } catch (err) {
        console.error(`Error syncing ${tm.name} to source: ${err.message}`);
        failed++;
      }
    }

    // Remap parents
    for (const { targetId, sourceParentId, monitor } of monitorsWithParent) {
      try {
        monitor.id = targetId;
        monitor.parent = sourceParentId;
        delete monitor.tags;
        await this.updateMonitor(sourceSocket, monitor);
      } catch (err) {
        console.error(`Error setting parent for ${monitor.name}: ${err.message}`);
      }
    }

    console.log(`Bidirectional pass — Created: ${created}, Updated: ${updated}${failed ? `, Failed: ${failed}` : ''}`);
  }

  /**
   * Compute a short hash of a monitor's syncable fields for change detection.
   * Uses the raw monitorList entry (no extra socket call needed).
   */
  computeMonitorHash(monitor) {
    const skip = new Set([
      'id', 'userId', 'created_date', 'updated_date', 'docker_host',
      'parent', 'path', 'pathName', 'path_name', 'childrenIDs',
      'children_i_ds', 'childrenIds', 'children', 'active'
    ]);
    const relevant = {};
    for (const [k, v] of Object.entries(monitor)) {
      if (!skip.has(k) && v !== undefined) relevant[k] = v;
    }
    const stable = JSON.stringify(relevant, Object.keys(relevant).sort());
    return crypto.createHash('md5').update(stable).digest('hex').slice(0, 8);
  }

  loadSyncState() {
    if (fs.existsSync(STATE_FILE)) {
      try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) {}
    }
    return {};
  }

  saveSyncState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }

  /**
   * Clean monitor data for syncing
   * In shallow mode: removes instance-specific fields (intervals, timeouts, etc.)
   * In deep mode: copies ALL fields including instance-specific settings
   */
  cleanMonitorData(monitor) {
    const cleaned = { ...monitor };
    
    // In shallow mode, remove excluded fields to preserve target's instance-specific settings
    // In deep mode, keep all fields - we want an exact copy
    if (this.syncMode === 'shallow') {
      this.excludedFields.forEach(field => delete cleaned[field]);
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
    
    if (this.verbose) {
      console.log('\n=== Tag Mapping Debug ===');
      console.log('Source tags:');
      for (const [key, tag] of Object.entries(sourceTags)) {
        console.log(`  key=${key}, id=${tag.id}, tag_id=${tag.tag_id}, name=${tag.name}`);
      }
      console.log('Target tags:');
      for (const [key, tag] of Object.entries(targetTags)) {
        console.log(`  key=${key}, id=${tag.id}, tag_id=${tag.tag_id}, name=${tag.name}`);
      }
    }
    
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
      
      if (this.verbose) {
        console.log(`Matching source ${sourceId} (${sourceTag.name}): found target tag with id=${matchingTag.id}, tag_id=${matchingTag.tag_id}, name=${matchingTag.name}`);
      }
      const targetId = matchingTag.tag_id || matchingTag.id;
      
      // KEY FIX: Use the source tag's actual tag_id (not the object key) as the mapping key
      // because monitor.tags[].tag_id refers to this value
      const sourceTagId = sourceTag.tag_id || sourceTag.id;
      tagMapping[sourceTagId] = targetId;
      if (this.verbose) {
        console.log(`Map: source tag_id ${sourceTagId} (${sourceTag.name}) -> target tag_id ${targetId}`);
      }
    }
    
    if (this.verbose) {
      console.log('=== End Tag Mapping ===\n');
    }
    
    return { tagMapping, sourceTags };
  }

  /**
   * Backup target instance configuration
   */
  async backup(socket, instanceName, instanceUrl) {
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

      // Get all status pages (list captured from statusPageList socket event at login)
      const statusPages = [];
      const pageList = socket._statusPageList || [];
      for (const page of pageList) {
        try {
          const pageData = await this.getStatusPage(instanceUrl, page.slug);
          statusPages.push(pageData);
        } catch (err) {
          console.warn(`Could not backup status page "${page.slug}": ${err.message}`);
        }
      }

      // Create backup object
      const backup = {
        timestamp: new Date().toISOString(),
        instance: instanceName,
        monitors,
        tags,
        statusPages
      };

      // Write to file
      fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
      console.log(`Backup saved: ${monitors.length} monitors, ${Object.keys(tags).length} tags, ${statusPages.length} status pages\n`);

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
      const backupFile = await this.backup(targetSocket, this.targetName, this.targetUrl);
      console.log(`✓ Backup complete: ${backupFile}`);
      
      console.log('\n=== Starting Sync ===');
      console.log(`From: ${this.sourceName} (${this.sourceUrl})`);
      console.log(`To: ${this.targetName} (${this.targetUrl})`);
      console.log(`Mode: ${this.syncMode.toUpperCase()} ${this.syncMode === 'deep' ? '(copying ALL settings)' : '(preserving instance-specific settings)'}`);
      console.log(`Mode: ${this.syncMode.toUpperCase()} ${this.syncMode === 'deep' ? '(copying all settings)' : '(preserving instance-specific settings)'}`);
      console.log('Syncing tags...');
      const { tagMapping, sourceTags } = await this.syncTags(sourceSocket, targetSocket);
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
      
      // Load incremental state
      const stateKey = `${this.sourceName}->${this.targetName}`;
      const syncState = this.loadSyncState();
      const pairState = syncState[stateKey] || { monitorHashes: {} };
      const newHashes = {};
      const useIncremental = this.incremental;

      if (useIncremental && Object.keys(pairState.monitorHashes).length > 0) {
        console.log(`Incremental sync: comparing against last sync (${pairState.lastSync || 'unknown'})`);
      } else if (!useIncremental) {
        console.log('Full sync forced (--force)');
      }

      // Build target lookup by name+type for fast matching
      const targetByKey = {};
      for (const m of targetMonitorList) {
        targetByKey[`${m.name}::${m.type}`] = m;
      }

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
          // Incremental: skip monitors whose hash hasn't changed and exist on target
          const monitorKey = `${sourceMonitor.name}::${sourceMonitor.type}`;
          const hash = this.computeMonitorHash(sourceMonitor);
          newHashes[monitorKey] = hash;

          if (useIncremental && pairState.monitorHashes[monitorKey] === hash) {
            const targetMatch = targetByKey[monitorKey];
            if (targetMatch) {
              monitorIdMapping[sourceMonitor.id] = targetMatch.id;
              if (this.verbose) console.log(`Skipping (unchanged): ${sourceMonitor.name}`);
              skipped++;
              continue;
            }
          }

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
              if (this.verbose) { console.log(`  Removing ${fullTargetMonitor.tags.length} existing tags from ${cleanedMonitor.name}...`); }
              for (const existingTag of fullTargetMonitor.tags) {
                try {
                  if (this.verbose) { console.log(`    - Deleting tag: ${existingTag.name || existingTag.tag_id} (value: ${existingTag.value || 'none'})`); }
                  await this.deleteMonitorTag(targetSocket, existingTag.tag_id, matchingTarget.id, existingTag.value || '');
                  if (this.verbose) { console.log(`      ✓ Deleted successfully`); }
                } catch (err) {
                  // Ignore errors - tag might not exist or already deleted
                  if (this.verbose) { console.warn(`      ✗ Could not delete tag: ${err.message}`); }
                }
              }
            } else if (this.verbose) {
              console.log(`  No existing tags to remove`);
            }
            
            // Extract and map tags - we'll sync them separately via addMonitorTag API
            const monitorTags = [];
            if (cleanedMonitor.tags && Array.isArray(cleanedMonitor.tags)) {
              for (const tag of cleanedMonitor.tags) {
                monitorTags.push({
                  original_source_id: tag.tag_id,
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
              if (this.verbose) { console.log(`  Adding ${monitorTags.length} tags from source...`); }
              for (const tag of monitorTags) {
                try {
                  if (this.verbose) {
                    // Find source tag by ID (not by object key)
                    const sourceTag = Object.values(sourceTags).find(t => (t.tag_id || t.id) === tag.original_source_id);
                    const sourceTagName = sourceTag?.name || 'unknown';
                    console.log(`    + Adding tag: source ${tag.original_source_id} (${sourceTagName}) -> target ${tag.tag_id} (value: ${tag.value || 'none'})`);
                  }
                  await this.addMonitorTag(targetSocket, tag.tag_id, matchingTarget.id, tag.value);
                  if (this.verbose) { console.log(`      ✓ Added successfully`); }
                } catch (err) {
                  console.warn(`      ✗ Could not add tag: ${err.message}`);
                }
              }
            } else if (this.verbose) {
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
                  original_source_id: tag.tag_id,
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
              if (this.verbose) { console.log(`  Adding ${monitorTags.length} tags to new monitor...`); }
              for (const tag of monitorTags) {
                try {
                  if (this.verbose) {
                    // Find source tag by ID (not by object key)
                    const sourceTag = Object.values(sourceTags).find(t => (t.tag_id || t.id) === tag.original_source_id);
                    const sourceTagName = sourceTag?.name || 'unknown';
                    console.log(`    + Adding tag: source ${tag.original_source_id} (${sourceTagName}) -> target ${tag.tag_id}`);
                  }
                  await this.addMonitorTag(targetSocket, tag.tag_id, monitorID, tag.value);
                  if (this.verbose) { console.log(`      ✓ Added successfully`); }
                } catch (err) {
                  console.warn(`      ✗ Could not add tag: ${err.message}`);
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
      
      // Sync status pages using the monitor ID mapping built above
      const spResult = await this.syncStatusPages(sourceSocket, targetSocket, monitorIdMapping);

      // Build reverse mapping (target ID → source ID) for bidirectional pass
      const reverseIdMapping = {};
      for (const [srcId, tgtId] of Object.entries(monitorIdMapping)) {
        reverseIdMapping[tgtId] = parseInt(srcId);
      }

      // Prune: delete target monitors absent from source (mutually exclusive with bidirectional)
      if (this.prune) {
        await this.pruneMonitors(targetSocket, monitorList, targetMonitorList);
      }

      // Bidirectional: copy target-only monitors back to source
      if (this.bidirectional) {
        await this.syncBidirectionalPass(sourceSocket, targetSocket, monitorList, targetMonitorList, reverseIdMapping, tagMapping);
      }

      // Persist incremental state (merge new hashes with any unchanged ones)
      syncState[stateKey] = {
        lastSync: new Date().toISOString(),
        monitorHashes: { ...pairState.monitorHashes, ...newHashes }
      };
      this.saveSyncState(syncState);

      console.log('\n=== Sync Complete ===');
      console.log(`Created: ${created}`);
      console.log(`Updated: ${updated}`);
      console.log(`Unchanged (skipped): ${skipped}`);
      console.log(`Total: ${monitorList.length}`);

      return {
        created, updated, skipped,
        failed: failedMonitors.length,
        total: monitorList.length,
        statusPages: spResult || { created: 0, updated: 0, failed: 0 }
      };
      
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
      throw err;
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
      incremental: options.incremental !== false,
      prune: options.prune || false,
      dryRun: options.dryRun || false,
      bidirectional: options.bidirectional || false,
      verbose: options.verbose || false,
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
    incremental: options.incremental !== false,
    prune: options.prune || false,
    dryRun: options.dryRun || false,
    bidirectional: options.bidirectional || false,
    verbose: options.verbose || false,
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
  --force          Full sync - ignore incremental state, update all monitors
  --prune          Delete monitors on target that no longer exist in source
  --dry-run        Preview --prune deletions without applying them
  --bidirectional  Also sync monitors only on target back to source (conflicts: source wins)
  -v, --verbose    Show detailed tag sync operations and debugging information

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
  
  # Verbose output (shows detailed tag operations):
  node uptime-kuma-sync.js primary secondary --verbose
  
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

  // Parse flags
  const verbose = args.includes('--verbose') || args.includes('-v');
  const incremental = !args.includes('--force');
  const prune = args.includes('--prune');
  const dryRun = args.includes('--dry-run');
  const bidirectional = args.includes('--bidirectional');

  if (prune && bidirectional) {
    console.error('Error: --prune and --bidirectional are mutually exclusive');
    process.exit(1);
  }

  // Filter out mode flags from args to get instance names
  const instanceArgs = args.filter(arg => !arg.startsWith('--') && !arg.startsWith('-'));
  const sourceName = instanceArgs[0];
  const targetName = instanceArgs[1];

  // Configuration
  const config = loadConfig(sourceName, targetName, { syncMode, verbose, incremental, prune, dryRun, bidirectional });

  // Show warning if using default values
  if (!sourceName && !process.env.SOURCE_UPTIME_URL) {
    console.warn('Warning: Using default localhost URLs. Configure uptime-kuma-config.json or set environment variables.\n');
  }

  // Run sync
  const syncer = new UptimeKumaSync(config);
  syncer.sync().catch(err => {
    console.error('Sync failed:', err.message);
    process.exit(1);
  });
}

// Export for testing
module.exports = UptimeKumaSync;
