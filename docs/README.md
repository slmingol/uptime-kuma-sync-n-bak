<div align="center">
  <img src="https://raw.githubusercontent.com/slmingol/uptime-kuma-sync-n-bak/main/assets/logo.svg?v=2" alt="Uptime Kuma Sync & Backup" width="400">
</div>

# Uptime Kuma Sync Tool

[![Build and Push Container](https://github.com/slmingol/uptime-kuma-sync-n-bak/actions/workflows/build-and-push.yml/badge.svg)](https://github.com/slmingol/uptime-kuma-sync-n-bak/actions/workflows/build-and-push.yml)
[![Version](https://img.shields.io/github/v/release/slmingol/uptime-kuma-sync-n-bak)](https://github.com/slmingol/uptime-kuma-sync-n-bak/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/slmingol/uptime-kuma-sync-n-bak/blob/main/docs/LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Enabled-2496ED?logo=docker)](https://github.com/slmingol/uptime-kuma-sync-n-bak/tree/main/docker)
[![Container Registry](https://img.shields.io/badge/ghcr.io-uptime--kuma--sync--n--bak-blue?logo=docker)](https://github.com/slmingol/uptime-kuma-sync-n-bak/pkgs/container/uptime-kuma-sync-n-bak)
[![Uptime Kuma](https://img.shields.io/badge/Uptime%20Kuma-Compatible-5CDD8B)](https://github.com/louislam/uptime-kuma)

This tool synchronizes monitors and groups between two Uptime Kuma instances while preserving instance-specific settings.

## Features

- ✅ Syncs monitors (HTTP, TCP, Ping, etc.)
- ✅ Syncs groups/tags with color coding
- ✅ **Shallow & Deep Sync Modes** - Choose to preserve or copy instance-specific settings
- ✅ Preserves instance-specific settings (intervals, timeouts, TTLs) in shallow mode
- ✅ Updates existing monitors or creates new ones
- ✅ Maps tags/groups correctly between instances
- ✅ **Parent/Group relationships** - Correctly maintains monitor hierarchies (191 monitors)
- ✅ **Named instance configuration** - Reference instances by name
- ✅ **Automatic backup before sync** - Creates a timestamped backup of the target instance
- ✅ **Standalone backup tool** - Backup any instance on demand
- ✅ **Restore tool** - Restore from any backup file
- ✅ **Diff tool** - Compare monitors between two instances

### Known Limitations

- ⚠️ **Tag syncing limitation**: The Uptime Kuma Socket.IO `editMonitor` API does not persist tag associations reliably. Tags work for monitors with matching IDs between instances but may not sync for monitors requiring ID remapping. See [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md) for details. **Workaround**: Manually add tags via the Uptime Kuma UI after syncing.

## Installation

1. Install required dependencies:

```bash
npm install axios socket.io-client dotenv
```

2. Configure your instances:

**Option A: Named Instances (Recommended)**

Copy the example config and edit with your instance details:

```bash
cp uptime-kuma-config.json.example uptime-kuma-config.json
```

Edit `uptime-kuma-config.json`:

```json
{
  "instances": {
    "primary": {
      "url": "https://uptime1.example.com",
      "username": "admin",
      "password": "your-password",
      "description": "Primary production instance"
    },
    "secondary": {
      "url": "https://uptime2.example.com",
      "username": "admin",
      "password": "your-password",
      "description": "Secondary backup instance"
    }
  },
  "backup": {
    "directory": "./uptime-kuma-backups"
  }
}
```

**Option B: Environment Variables**

Copy `.env.uptime-kuma` to `.env.uptime-kuma.local` and configure:

```bash
cp .env.uptime-kuma .env.uptime-kuma.local
```

## Docker Installation (Recommended for Portability)

No Node.js installation required! Run everything in a Docker container.

### Using Pre-built Images (Easiest)

Pull the latest image from GitHub Container Registry:

```bash
docker pull ghcr.io/slmingol/uptime-kuma-sync-n-bak:latest
# or specific version
docker pull ghcr.io/slmingol/uptime-kuma-sync-n-bak:1.0.0
```

Then use `uptime-kuma-docker.sh` (update the IMAGE_NAME variable to use ghcr.io image) or run directly:

```bash
docker run --rm \
  -v "$(pwd)/uptime-kuma-config.json:/app/uptime-kuma-config.json:ro" \
  -v "$(pwd)/uptime-kuma-backups:/app/uptime-kuma-backups" \
  ghcr.io/slmingol/uptime-kuma-sync-n-bak:latest \
  node src/uptime-kuma-backup.js --list
```

### Building Locally

1. Build the Docker image:

```bash
./scripts/uptime-kuma-docker.sh build
```

2. Create your config file:

```bash
cp uptime-kuma-config.json.example uptime-kuma-config.json
# Edit with your instance details
```

3. Run commands:

```bash
# List available instances
./scripts/uptime-kuma-docker.sh list

# Backup an instance
./scripts/uptime-kuma-docker.sh backup primary

# Sync between instances (shallow mode - default)
./scripts/uptime-kuma-docker.sh sync primary secondary

# Deep sync (copy all settings)
./scripts/uptime-kuma-docker.sh sync primary secondary --deep

# Restore from backup
./scripts/uptime-kuma-docker.sh restore uptime-kuma-backups/primary-2026-03-01.json secondary
```

### Docker Commands Reference

```bash
./scripts/uptime-kuma-docker.sh list                                    # List configured instances
./scripts/uptime-kuma-docker.sh backup <instance>                       # Backup an instance
./scripts/uptime-kuma-docker.sh sync <source> <target>                  # Sync instances (shallow)
./scripts/uptime-kuma-docker.sh sync <source> <target> --deep           # Sync with all settings
./scripts/uptime-kuma-docker.sh diff <source> <target>                  # Compare instances
./scripts/uptime-kuma-docker.sh restore <backup-file> [instance]        # Restore from backup
./scripts/uptime-kuma-docker.sh build                                   # Build the image
./scripts/uptime-kuma-docker.sh shell                                   # Interactive shell
./scripts/uptime-kuma-docker.sh help                                    # Show help
```

### Docker Compose (For Scheduled Backups)

The `docker-compose.yml` file includes a service for scheduled backups:

```yaml
# Edit docker-compose.yml to customize backup schedule
# Default: backup every 6 hours

docker-compose up -d uptime-kuma-backup-cron
```

To run one-off commands with docker-compose:

```bash
# Backup
docker-compose run --rm uptime-kuma-sync node src/uptime-kuma-backup.js primary

# Sync
docker-compose run --rm uptime-kuma-sync node src/uptime-kuma-sync.js primary secondary

# Diff
docker-compose run --rm uptime-kuma-sync node src/uptime-kuma-diff.js primary secondary

# List instances
docker-compose run --rm uptime-kuma-sync node src/uptime-kuma-backup.js --list
```

### Manual Docker Run

If you prefer direct `docker run` commands:

```bash
# Build image
docker build -t uptime-kuma-sync:latest .

# Run backup
docker run --rm \
  -v "$(pwd)/uptime-kuma-config.json:/app/uptime-kuma-config.json:ro" \
  -v "$(pwd)/uptime-kuma-backups:/app/uptime-kuma-backups" \
  uptime-kuma-sync:latest node src/uptime-kuma-backup.js primary

# Run sync
docker run --rm \
  -v "$(pwd)/uptime-kuma-config.json:/app/uptime-kuma-config.json:ro" \
  -v "$(pwd)/uptime-kuma-backups:/app/uptime-kuma-backups" \
  uptime-kuma-sync:latest node src/uptime-kuma-sync.js primary secondary
```

## Usage

### Sync with Named Instances (Recommended)

The easiest way to sync - just reference your instances by name:

```bash
# Sync from primary to secondary
./scripts/sync-uptime.sh primary secondary

# Or run directly:
node src/uptime-kuma-sync.js primary secondary
```

Output example:
```
=== Creating Backup ===
Creating backup: uptime-kuma-backups/secondary-2026-03-01T15-30-00.json
Backup saved: 25 monitors, 5 tags
✓ Backup complete

=== Starting Sync ===
From: primary (https://uptime1.example.com)
To: secondary (https://uptime2.example.com)
...
```

Backups are automatically named based on the instance name!

### Sync with Environment Variables

Using .env file:

```bash
./scripts/sync-uptime.sh
```

Or use environment variables directly:

```bash
SOURCE_UPTIME_URL=http://localhost:3001 \
SOURCE_UPTIME_USER=admin \
SOURCE_UPTIME_PASS=password1 \
SOURCE_NAME=primary \
TARGET_UPTIME_URL=http://localhost:3002 \
TARGET_UPTIME_USER=admin \
TARGET_UPTIME_PASS=password2 \
TARGET_NAME=secondary \
node src/uptime-kuma-sync.js
```

## Sync Modes

The sync tool supports two modes to fit different use cases:

### Shallow Sync (Default)

**Best for:** Maintaining independent instances with different monitoring configurations

Shallow sync copies monitor definitions while preserving instance-specific settings on the target:

```bash
# Shallow sync - preserves target's check intervals and timeouts
./scripts/sync-uptime.sh primary secondary
node src/uptime-kuma-sync.js primary secondary
```

**What gets synced:**
- Monitor names and types
- URLs, hostnames, and ports  
- Descriptions and keywords
- Tags/groups (with colors)
- Headers, body, method
- Authentication settings
- Certificate settings

**What is preserved** on the target:
- Check intervals
- Retry intervals
- Timeout values
- Max retries
- Notification settings
- DNS settings
- Accepted status codes

**Use cases:**
- Syncing monitors to a backup instance with different check frequencies
- Maintaining a test environment with slower polling
- Keeping notification settings separate per instance

### Deep Sync

**Best for:** Creating exact replicas or clones

Deep sync copies **everything** from source to target, including all instance-specific settings:

```bash
# Deep sync - copies ALL settings including intervals
./scripts/sync-uptime.sh primary secondary --deep
node src/uptime-kuma-sync.js primary secondary --deep
```

**What gets synced:**
- Everything from shallow mode PLUS:
- Check intervals
- Retry intervals  
- Timeout values
- Max retries
- Notification settings
- DNS settings
- Accepted status codes
- All other configuration fields

**Use cases:**
- Creating an exact replica/clone of an instance
- Disaster recovery setup
- Migrating to a new instance
- Setting up identical production/staging environments

### Setting Default Mode

You can set the default mode in your config file:

```json
{
  "sync": {
    "mode": "deep"
  }
}
```

Override the default with command-line flags:
```bash
# Force shallow sync even if config says deep
./scripts/sync-uptime.sh primary secondary --shallow

# Force deep sync even if config says shallow  
./scripts/sync-uptime.sh primary secondary --deep
```

### Manual Backup

Backup any instance by name:

```bash
# Backup named instance from config
node src/uptime-kuma-backup.js primary

# Creates: uptime-kuma-backups/primary-2026-03-01T15-30-00.json
```

Or with environment variables:

```bash
UPTIME_URL=https://uptime.example.com \
UPTIME_USER=admin \
UPTIME_PASS=password \
node src/uptime-kuma-backup.js production
```

### Restore from Backup

Restore to a named instance:

```bash
node src/uptime-kuma-restore.js uptime-kuma-backups/primary-2026-03-01.json secondary
```

Or with environment variables:

```bash
TARGET_UPTIME_URL=https://uptime.example.com \
TARGET_UPTIME_USER=admin \
TARGET_UPTIME_PASS=password \
node src/uptime-kuma-restore.js uptime-kuma-backups/backup.json
```

**Note:** Restoring will ADD monitors from the backup. It won't delete existing monitors.

### Compare Instances (Diff)

Compare monitors between two instances to see what's different:

```bash
# Using bash wrapper
./scripts/diff-uptime.sh primary secondary

# Or run directly
node src/uptime-kuma-diff.js primary secondary

# Or with npm
npm run diff primary secondary

# Show condensed summary (TL;DR mode)
./scripts/diff-uptime.sh primary secondary --tldr
node src/uptime-kuma-diff.js primary secondary --tldr
```

The diff tool shows:
- **Identical monitors** - Monitors that match completely
- **Different monitors** - Monitors with the same name but different settings
- **Only in source** - Monitors that exist only in the first instance
- **Only in target** - Monitors that exist only in the second instance

**TL;DR Mode:** Use `--tldr` flag to show a condensed summary with just monitor names and the most common differences, perfect for a quick overview.

Output Example:
```
Comparing monitors from primary to secondary...
Fetched 201 monitors from primary
Fetched 202 monitors from secondary

=== Summary ===
Identical monitors: 160
Different monitors: 41
Only in primary: 0
Only in secondary: 1

--- Monitors with differences (41) ---
  • Core Svcs [group] - 1 field(s) different
  • DNS - bubs.us.to [dns] - 1 field(s) different
  • WEB - Bandle [http] - 2 field(s) different
  ...

--- Most common differences ---
  • tags: 31 monitor(s)
  • childrenIDs: 9 monitor(s)
  • pathName: 9 monitor(s)
```

Or for full detail (without `--tldr`):
```
=== Differences ===
Monitor: Disk Usage
  childrenIDs: [147,146,145] → [224,223,222]
...
```

See [README.diff.md](README.diff.md) for detailed documentation.

**Docker Usage:**
```bash
# Using docker-compose
docker-compose run --rm uptime-kuma-sync ./scripts/diff-uptime.sh primary secondary
docker-compose run --rm uptime-kuma-sync ./scripts/diff-uptime.sh primary secondary --tldr

# Using Docker wrapper script
./scripts/uptime-kuma-docker.sh diff primary secondary
./scripts/uptime-kuma-docker.sh diff primary secondary --tldr
```

### Using Diff to Determine Sync Direction

The sync tool is **bi-directional** and **safe** - you can sync in either direction with automatic backups. Use the diff tool to determine which instance has the correct configuration:

**Safety Features:**
- ✅ Automatic backup of target instance before sync
- ✅ Non-destructive - updates existing monitors and creates missing ones (doesn't delete)
- ✅ Preserves instance-specific settings (intervals, timeouts, notifications)

**Workflow to Get Instances In Sync:**

```bash
# 1. Compare both directions to see what's different
./scripts/diff-uptime.sh primary secondary --tldr
./scripts/diff-uptime.sh secondary primary --tldr

# 2. Identify your "source of truth" (the instance with correct data)
#    - Which has the correct tags/groups?
#    - Which has the correct monitor configurations?
#    - Which has the latest changes you want to keep?

# 3. Sync FROM your source of truth TO the other instance
./scripts/sync-uptime.sh <correct-instance> <target-instance>

# 4. Verify instances are now in sync
./scripts/diff-uptime.sh primary secondary --tldr
```

**Example Scenario:**

Your diff shows secondary has 1 extra monitor and different tags on 31 monitors:
```bash
# Check what secondary would change in primary
./scripts/diff-uptime.sh secondary primary --tldr

# If secondary has the correct tags, sync it to primary
./scripts/sync-uptime.sh secondary primary

# Or if primary is correct, sync the other direction
./scripts/sync-uptime.sh primary secondary
```

**Backup Location:** The tool creates timestamped backups in `uptime-kuma-backups/` before each sync. You can restore if needed:
```bash
./scripts/restore-uptime.sh uptime-kuma-backups/primary-2026-03-01T15-30-00.json primary
```

### Automated Sync

Set up a cron job to run periodically:

```bash
# Run every hour - sync from primary to secondary
0 * * * * cd /path/to/project && ./scripts/sync-uptime.sh primary secondary >> /var/log/uptime-sync.log 2>&1

# Daily backup of production instance
0 2 * * * cd /path/to/project && node src/uptime-kuma-backup.js production >> /var/log/uptime-backup.log 2>&1
```

## Configuration Files

### uptime-kuma-config.json

Define all your instances in one place:

```json
{
  "instances": {
    "production": {
      "url": "https://uptime-prod.example.com",
      "username": "admin",
      "password": "prod-password",
      "description": "Production monitoring"
    },
    "staging": {
      "url": "https://uptime-staging.example.com",
      "username": "admin",
      "password": "staging-password",
      "description": "Staging environment"
    },
    "local": {
      "url": "http://localhost:3001",
      "username": "admin",
      "password": "admin",
      "description": "Local development"
    }
  },
  "backup": {
    "directory": "./uptime-kuma-backups"
  },
  "sync": {
    "mode": "shallow",
    "excludedFields": [
      "interval",
      "retryInterval",
      "resendInterval",
      "maxretries",
      "timeout",
      "upside_down",
      "maxredirects",
      "accepted_statuscodes",
      "dns_resolve_type",
      "dns_resolve_server",
      "notificationIDList"
    ]
  }
}
```

**Sync Mode:**
- `"mode": "shallow"` (default) - Preserves instance-specific settings on target
- `"mode": "deep"` - Copies all settings for an exact replica
- Can be overridden with `--deep` or `--shallow` flags

**Benefits:**
- Define once, use everywhere
- Automatic backup naming based on instance
- Easy to manage multiple instances
- No need to remember URLs and credentials
- Version control friendly (add to .gitignore)

### Instance Name Examples

Choose meaningful names for your instances:
- `production` / `backup`
- `primary` / `secondary`  
- `datacenter1` / `datacenter2`
- `aws` / `azure`
- `main` / `failover`

These names appear in:
- Backup filenames  
- Sync console output
- Log files

## What Gets Synced

> **Note:** The fields below apply to **Shallow Sync mode** (default). For **Deep Sync mode**, ALL fields are copied including instance-specific settings. See the [Sync Modes](#sync-modes) section for details.

### Synced Fields (Shallow Mode)
- Monitor name
- Monitor type (HTTP, TCP, Ping, etc.)
- URL/hostname
- Port
- Description
- Tags/groups (with colors)
- Headers
- Body
- Method
- Authentication settings
- Certificate settings
- Keywords

### NOT Synced in Shallow Mode (Instance-Specific)
- Check interval
- Retry interval  
- Resend interval
- Max retries
- Timeout
- Status inversion (upside down)
- Max redirects
- Accepted status codes
- DNS settings
- Notification settings

**In Deep Sync Mode:** All the above instance-specific fields ARE synced for an exact replica.

## Customization

### Exclude Additional Fields

Edit `uptime-kuma-config.json` to customize which fields are excluded:

```json
{
  "sync": {
    "excludedFields": [
      "interval",
      "your_custom_field"
    ]
  }
}
```

### Include More Fields

Remove fields from the `excludedFields` array to sync them between instances.

## Backup Management

### Backup Files

Backups are JSON files containing:
- All monitors with complete configuration
- All tags/groups with colors
- Timestamp and instance information

### Backup Naming

When using named instances, backups are automatically named:
- Format: `{instance-name}-{timestamp}.json`
- Example: `primary-2026-03-01T10-30-00.json`

This makes it easy to identify which instance a backup is from!

### Backup Location

Default: `./uptime-kuma-backups/`

Configure in `uptime-kuma-config.json`:
```json
{
  "backup": {
    "directory": "/path/to/backups"
  }
}
```

Or with environment variable:
```bash
export BACKUP_DIR=/path/to/backups
```

### Cleaning Old Backups

```bash
# Keep last 30 days
find uptime-kuma-backups/ -name "*.json" -mtime +30 -delete

# Keep last 10 backups per instance
for instance in primary secondary; do
  ls -t uptime-kuma-backups/${instance}-*.json | tail -n +11 | xargs rm -f
done
```

## Emergency Recovery

If a sync goes wrong, restore from the automatic backup:

```bash
# Find the latest backup
ls -lt uptime-kuma-backups/

# Restore to the named instance
node src/uptime-kuma-restore.js uptime-kuma-backups/secondary-2026-03-01T15-30-00.json secondary
```

## Workflow

1. **Initial Setup**: Configure both instances with their desired intervals, timeouts, and notification settings
2. **Add Monitors**: Add monitors to your "source" instance with appropriate tags/groups
3. **Run Sync**: Execute sync with instance names: `./scripts/sync-uptime.sh primary secondary`
4. **Verify**: Check target instance - monitors should be there with target's existing timing settings
5. **Regular Syncs**: Schedule periodic syncs to keep monitors in sync

## Troubleshooting

### Connection Issues

- Verify both instances are accessible
- Check firewall rules
- Ensure correct URLs (include http:// or https://)

### Authentication Errors

- Verify username and password in config
- Check if 2FA is enabled (not supported)
- Ensure the user has admin privileges

### Tag/Group Mismatches

- Tags are matched by name AND color
- If colors differ, new tags will be created
- Manually merge tags in the target instance if needed

### Instance Not Found Error

```
Error: Instance 'xyz' not found in uptime-kuma-config.json
Available instances: primary, secondary, local
```

- Check spelling of instance name
- Verify instance exists in config file
- List available instances: `cat uptime-kuma-config.json | jq '.instances | keys'`

## Bidirectional Sync

To keep both instances in sync:

1. Run sync from Instance A to Instance B
2. Run sync from Instance B to Instance A
3. Schedule both syncs to run alternately

Example:
```bash
# Sync A → B every even hour
0 */2 * * * cd /path/to/project && ./scripts/sync-uptime.sh primary secondary

# Sync B → A every odd hour  
0 1-23/2 * * * cd /path/to/project && ./scripts/sync-uptime.sh secondary primary
```

## Scripts Overview

### Core Node.js Scripts
- **uptime-kuma-sync.js** - Sync monitors between two instances (auto-backup included)
- **uptime-kuma-backup.js** - Standalone backup tool for any instance
- **uptime-kuma-restore.js** - Restore monitors from a backup file

### Bash Wrapper Scripts
- **sync-uptime.sh** - Convenience wrapper for syncing
- **backup-uptime.sh** - Convenience wrapper for backups
- **restore-uptime.sh** - Convenience wrapper for restoring

### Docker Scripts
- **uptime-kuma-docker.sh** - All-in-one Docker wrapper (recommended)
- **Dockerfile** - Container definition
- **docker-compose.yml** - For scheduled backups and easy deployment

### Configuration Files
- **uptime-kuma-config.json** - Instance configuration (create from .example file)
- **uptime-kuma-config.json.example** - Template configuration file
- **.env.uptime-kuma** - Environment variable template (optional)

## Notes

- The script uses Socket.IO to communicate with Uptime Kuma
- Monitors are matched by name + type
- Existing monitors are updated, new ones are created
- Deleted monitors in source are NOT deleted in target (manual cleanup needed)
- **Automatic backups are created before every sync** - No data loss risk!
- Instance names in config make it easy to manage multiple environments

## API Reference

Uptime Kuma uses Socket.IO events:
- `login` - Authenticate
- `getMonitorList` - Get all monitors
- `getMonitor` - Get monitor details
- `getTags` - Get all tags
- `addTag` - Create tag
- `add` - Create monitor
- `editMonitor` - Update monitor
