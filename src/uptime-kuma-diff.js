#!/usr/bin/env node

const io = require('socket.io-client');
const fs = require('fs');

/**
 * Uptime Kuma Diff Tool
 * Compares monitors between two Uptime Kuma instances
 */
class UptimeKumaDiff {
  constructor(config) {
    this.sourceUrl = config.sourceUrl;
    this.sourceUsername = config.sourceUsername;
    this.sourcePassword = config.sourcePassword;
    this.sourceName = config.sourceName || 'source';
    
    this.targetUrl = config.targetUrl;
    this.targetUsername = config.targetUsername;
    this.targetPassword = config.targetPassword;
    this.targetName = config.targetName || 'target';
    
    this.ignoreFields = config.ignoreFields || defaultIgnoreFields();    this.tldr = config.tldr || false;  }

  /**
   * Connect to Uptime Kuma instance
   */
  async connect(url, username, password) {
    return new Promise((resolve, reject) => {
      const socket = io(url, {
        reconnection: false,
        timeout: 10000
      });

      socket.on('connect', () => {
        socket.emit('login', {
          username: username,
          password: password,
          token: ''
        }, (res) => {
          if (res.ok) {
            resolve(socket);
          } else {
            reject(new Error(`Login failed: ${res.msg}`));
          }
        });
      });

      socket.on('connect_error', (err) => {
        reject(new Error(`Connection failed: ${err.message}`));
      });
    });
  }

  /**
   * Get all monitors
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
   * Get detailed monitor info
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
   * Normalize monitor for comparison
   */
  normalizeMonitor(monitor) {
    const normalized = { ...monitor };
    
    // Remove fields that should be ignored
    this.ignoreFields.forEach(field => {
      delete normalized[field];
    });
    
    // Remove instance-specific fields
    delete normalized.id;
    delete normalized.userId;
    delete normalized.created_date;
    delete normalized.updated_date;
    delete normalized.docker_host;
    delete normalized.parent;
    delete normalized.path;
    delete normalized.path_name;
    
    return normalized;
  }

  /**
   * Deep compare two objects
   */
  deepDiff(obj1, obj2, path = '') {
    const differences = [];
    const allKeys = new Set([...Object.keys(obj1), ...Object.keys(obj2)]);
    
    for (const key of allKeys) {
      const currentPath = path ? `${path}.${key}` : key;
      const val1 = obj1[key];
      const val2 = obj2[key];
      
      if (!(key in obj1)) {
        differences.push({
          field: currentPath,
          source: undefined,
          target: val2
        });
      } else if (!(key in obj2)) {
        differences.push({
          field: currentPath,
          source: val1,
          target: undefined
        });
      } else if (typeof val1 === 'object' && val1 !== null && typeof val2 === 'object' && val2 !== null) {
        if (Array.isArray(val1) && Array.isArray(val2)) {
          if (JSON.stringify(val1) !== JSON.stringify(val2)) {
            differences.push({
              field: currentPath,
              source: val1,
              target: val2
            });
          }
        } else {
          differences.push(...this.deepDiff(val1, val2, currentPath));
        }
      } else if (val1 !== val2) {
        differences.push({
          field: currentPath,
          source: val1,
          target: val2
        });
      }
    }
    
    return differences;
  }

  /**
   * Format value for display
   */
  formatValue(value) {
    if (value === undefined) return '(not set)';
    if (value === null) return 'null';
    if (typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'string' && value.length > 100) return value.substring(0, 97) + '...';
    return String(value);
  }

  /**
   * Print comparison results
   */
  async printDiff(sourceMonitors, targetMonitors) {
    const sourceMap = new Map();
    const targetMap = new Map();
    
    // Build maps keyed by name+type
    for (const monitor of Object.values(sourceMonitors)) {
      const key = `${monitor.name}::${monitor.type}`;
      sourceMap.set(key, monitor);
    }
    
    for (const monitor of Object.values(targetMonitors)) {
      const key = `${monitor.name}::${monitor.type}`;
      targetMap.set(key, monitor);
    }
    
    const allKeys = new Set([...sourceMap.keys(), ...targetMap.keys()]);
    
    const onlyInSource = [];
    const onlyInTarget = [];
    const different = [];
    let identical = 0;
    
    for (const key of allKeys) {
      const sourceMonitor = sourceMap.get(key);
      const targetMonitor = targetMap.get(key);
      
      if (!targetMonitor) {
        onlyInSource.push(sourceMonitor);
      } else if (!sourceMonitor) {
        onlyInTarget.push(targetMonitor);
      } else {
        const normalized1 = this.normalizeMonitor(sourceMonitor);
        const normalized2 = this.normalizeMonitor(targetMonitor);
        const diffs = this.deepDiff(normalized1, normalized2);
        
        if (diffs.length > 0) {
          different.push({
            monitor: sourceMonitor,
            differences: diffs
          });
        } else {
          identical++;
        }
      }
    }
    
    // Print summary
    console.log('\n==============================');
    console.log('UPTIME KUMA DIFF REPORT');
    console.log('==============================');
    console.log(`Source: ${this.sourceName} (${this.sourceUrl})`);
    console.log(`Target: ${this.targetName} (${this.targetUrl})`);
    console.log('==============================\n');
    
    console.log('Summary:');
    console.log(`  Identical: ${identical}`);
    console.log(`  Different: ${different.length}`);
    console.log(`  Only in ${this.sourceName}: ${onlyInSource.length}`);
    console.log(`  Only in ${this.targetName}: ${onlyInTarget.length}`);
    console.log(`  Total: ${allKeys.size}\n`);
    
    // Print monitors only in source
    if (onlyInSource.length > 0) {
      console.log(`\n--- Monitors only in ${this.sourceName.toUpperCase()} (${onlyInSource.length}) ---`);
      onlyInSource.sort((a, b) => a.name.localeCompare(b.name));
      for (const monitor of onlyInSource) {
        console.log(`  • ${monitor.name} [${monitor.type}]`);
        if (monitor.url) console.log(`    URL: ${monitor.url}`);
        if (monitor.hostname) console.log(`    Host: ${monitor.hostname}:${monitor.port || 'N/A'}`);
      }
    }
    
    // Print monitors only in target
    if (onlyInTarget.length > 0) {
      console.log(`\n--- Monitors only in ${this.targetName.toUpperCase()} (${onlyInTarget.length}) ---`);
      onlyInTarget.sort((a, b) => a.name.localeCompare(b.name));
      for (const monitor of onlyInTarget) {
        console.log(`  • ${monitor.name} [${monitor.type}]`);
        if (monitor.url) console.log(`    URL: ${monitor.url}`);
        if (monitor.hostname) console.log(`    Host: ${monitor.hostname}:${monitor.port || 'N/A'}`);
      }
    }
    
    // Print differing monitors
    if (different.length > 0) {
      if (this.tldr) {
        // TL;DR mode: Just list monitor names and most common differences
        console.log(`\n--- Monitors with differences (${different.length}) ---`);
        different.sort((a, b) => a.monitor.name.localeCompare(b.monitor.name));
        
        // Collect field frequency
        const fieldCounts = {};
        for (const { differences } of different) {
          for (const diff of differences) {
            fieldCounts[diff.field] = (fieldCounts[diff.field] || 0) + 1;
          }
        }
        
        // List monitors
        for (const { monitor, differences } of different) {
          console.log(`  • ${monitor.name} [${monitor.type}] - ${differences.length} field(s) different`);
        }
        
        // Show most common different fields
        console.log(`\n--- Most common differences ---`);
        const sortedFields = Object.entries(fieldCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);
        for (const [field, count] of sortedFields) {
          console.log(`  • ${field}: ${count} monitor(s)`);
        }
      } else {
        // Full detail mode
        console.log(`\n--- Monitors with differences (${different.length}) ---`);
        different.sort((a, b) => a.monitor.name.localeCompare(b.monitor.name));
        
        for (const { monitor, differences } of different) {
          console.log(`\n  Monitor: ${monitor.name} [${monitor.type}]`);
          console.log(`  Differences (${differences.length}):`);
          
          for (const diff of differences) {
            console.log(`    • ${diff.field}:`);
            console.log(`      ${this.sourceName}: ${this.formatValue(diff.source)}`);
            console.log(`      ${this.targetName}: ${this.formatValue(diff.target)}`);
          }
        }
      }
    }
    
    console.log('\n==============================\n');
  }

  /**
   * Run diff comparison
   */
  async diff() {
    let sourceSocket = null;
    let targetSocket = null;
    
    try {
      // Connect to source
      console.log(`Connecting to ${this.sourceName} (${this.sourceUrl})...`);
      sourceSocket = await this.connect(this.sourceUrl, this.sourceUsername, this.sourcePassword);
      console.log(`✓ Connected to ${this.sourceName}`);
      
      // Connect to target
      console.log(`Connecting to ${this.targetName} (${this.targetUrl})...`);
      targetSocket = await this.connect(this.targetUrl, this.targetUsername, this.targetPassword);
      console.log(`✓ Connected to ${this.targetName}`);
      
      // Get monitors from both
      console.log(`\nFetching monitors from ${this.sourceName}...`);
      const sourceMonitors = await this.getMonitors(sourceSocket);
      console.log(`✓ Found ${Object.keys(sourceMonitors).length} monitors`);
      
      console.log(`Fetching monitors from ${this.targetName}...`);
      const targetMonitors = await this.getMonitors(targetSocket);
      console.log(`✓ Found ${Object.keys(targetMonitors).length} monitors`);
      
      // Compare and print
      await this.printDiff(sourceMonitors, targetMonitors);
      
    } catch (err) {
      console.error('Diff failed:', err.message);
      process.exit(1);
    } finally {
      // Disconnect
      if (sourceSocket) sourceSocket.disconnect();
      if (targetSocket) targetSocket.disconnect();
    }
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
      ignoreFields: fileConfig.diff?.ignoreFields || defaultIgnoreFields()
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
    ignoreFields: defaultIgnoreFields()
  };
}

function defaultIgnoreFields() {
  return [
    'id',
    'userId',
    'created_date',
    'updated_date',
    'docker_host',
    'parent',
    'path',
    'path_name',
    // Often different between instances
    'notificationIDList',
    // These are typically excluded during sync, so ignore them in diff too
    'interval',
    'retryInterval',
    'maxretries',
    'timeout',
    'resendInterval',
    'upside_down',
    'maxredirects',
    'accepted_statuscodes',
    'dns_resolve_type',
    'dns_resolve_server',
  ];
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Uptime Kuma Diff Tool

Usage:
  node uptime-kuma-diff.js <source-instance> <target-instance> [options]
  node uptime-kuma-diff.js [options]

Options:
  -h, --help       Show this help message
  --tldr           Show condensed summary (monitor names and common differences only)

Examples:
  # Compare named instances from uptime-kuma-config.json:
  node uptime-kuma-diff.js primary secondary
  
  # Show condensed summary:
  node uptime-kuma-diff.js primary secondary --tldr
  
  # Using environment variables:
  SOURCE_UPTIME_URL=... TARGET_UPTIME_URL=... node uptime-kuma-diff.js

Configuration:
  - Define instances in uptime-kuma-config.json
  - Or use environment variables (SOURCE_UPTIME_URL, etc.)
  - Customize ignored fields in config file under "diff.ignoreFields"
`);
  process.exit(0);
}

// Parse flags
const tldr = args.includes('--tldr');
const nonFlagArgs = args.filter(arg => !arg.startsWith('--'));

const sourceName = nonFlagArgs[0];
const targetName = nonFlagArgs[1];

// Configuration
const config = loadConfig(sourceName, targetName);
config.tldr = tldr;

// Show warning if using default values
if (!sourceName && !process.env.SOURCE_UPTIME_URL) {
  console.warn('Warning: Using default localhost URLs. Configure uptime-kuma-config.json or set environment variables.\n');
}

// Run diff
const differ = new UptimeKumaDiff(config);
differ.diff();
