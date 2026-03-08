# Uptime Kuma Sync & Backup Tool - Copilot Instructions

## Project Overview

**Purpose**: Synchronize monitors and groups between multiple Uptime Kuma instances while preserving instance-specific settings, with automatic backup and restore functionality

**Type**: Node.js CLI Tool  
**Tech Stack**: Node.js 14+, Socket.IO, Axios, Docker  
**Deployment**: CLI execution (Node.js) or Docker containers (ghcr.io)  
**Repository**: https://github.com/slmingol/uptime-kuma-sync-n-bak

## Features

- Syncs monitors (HTTP, TCP, Ping, etc.) between Uptime Kuma instances
- Syncs groups/tags with color coding
- Preserves instance-specific settings (intervals, timeouts, TTLs)
- Named instance configuration (JSON config file or .env)
- Automatic backup before sync
- Standalone backup/restore/diff tools
- Docker support with multi-arch builds (amd64/arm64)

## Build & Validation

### Setup & Common Commands
```bash
npm install && cp uptime-kuma-config.json.example uptime-kuma-config.json
# Edit config with instance URLs/credentials

# Operations
npm run sync primary secondary     # Sync monitors
npm run backup primary             # Backup instance (timestamped)
npm run restore backup.json target # Restore from backup
npm run diff primary secondary     # Show differences
npm test && node --check *.js      # Test & validate

# Docker (multi-arch: amd64/arm64)
docker pull ghcr.io/slmingol/uptime-kuma-sync-n-bak:latest
docker run --rm -v "$(pwd)/uptime-kuma-config.json:/app/uptime-kuma-config.json:ro" \
  -v "$(pwd)/uptime-kuma-backups:/app/uptime-kuma-backups" \
  ghcr.io/slmingol/uptime-kuma-sync-n-bak:latest node uptime-kuma-sync.js primary secondary
```

**Dependencies**: axios, socket.io-client, dotenv

## Project Layout

```
uptime-kuma-sync-n-bak/
├── uptime-kuma-sync.js          # Main sync tool (~600 LOC)
├── uptime-kuma-backup.js        # Backup tool (~400 LOC)
├── uptime-kuma-restore.js       # Restore tool (~300 LOC)
├── uptime-kuma-diff.js          # Diff tool (~400 LOC)
├── uptime-kuma-sync.test.js     # Unit tests (~300 LOC)
├── package.json                 # Dependencies & scripts
├── docker-compose.yml           # Docker deployment config
├── Dockerfile                   # Multi-stage Docker build
├── uptime-kuma-config.json      # Instance configuration (user-created)
├── uptime-kuma-config.json.example  # Configuration template
├── uptime-kuma-backups/         # Backup storage directory
├── sync-uptime.sh               # Sync wrapper script
├── backup-uptime.sh             # Backup wrapper script
├── restore-uptime.sh            # Restore wrapper script
├── diff-uptime.sh               # Diff wrapper script
├── uptime-kuma-docker.sh        # Docker execution helper
├── update-version.sh            # Version management script
└── .github/workflows/
    ├── build-and-push.yml       # Auto-build & push to GHCR
    └── pr-validation.yml        # PR syntax & Docker checks
```

**Key Files**:
- **uptime-kuma-config.json**: Defines instances with URL, username, password, description
- **package.json**: Scripts (sync, backup, restore, diff, test), version auto-updates VERSION file on `npm version`
- **Dockerfile**: Multi-stage build (Node.js 18-alpine), ~2MB compressed image

## Configuration

**uptime-kuma-config.json**: Define instances (url, username, password, description) and backup directory  
**Alternative**: .env.uptime-kuma.local with SOURCE_URL, TARGET_URL, SOURCE_USERNAME, etc.

## CI/CD Workflows

**Build and Push** (main, v*.*.* tags): Extract version → Build multi-arch image → Push to ghcr.io with semver/latest tags  
**PR Validation**: JS syntax check → JSON validation → Docker build/test → Version consistency

## Architecture

### Sync Workflow
1. **Connect**: Authenticate to source and target instances via Socket.IO
2. **Fetch**: Retrieve monitors and tags from both instances
3. **Backup**: Auto-backup target instance before changes (timestamped JSON)
4. **Map Tags**: Match tag names between instances, create missing tags on target
5. **Sync Monitors**: Update existing or create new monitors on target
6. **Preserve Settings**: Keep instance-specific intervals, timeouts, notifications

**Tag Mapping**: Matches tags by name and color, creates new tags if missing on target

### Backup Format
Timestamped JSON files: `{instance-name}-{YYYY-MM-DDTHH-mm-ss}.json`  
Contains: monitors, tags, metadata (timestamp, instance name, monitor/tag counts)

### Restore Logic
1. Parse backup file
2. Connect to target instance
3. Map existing tags or create new ones
4. Restore monitors with updated tag IDs

## Development Workflow

**Workflow**: Edit JS files → Update tests → `npm test && node --check *.js` → `npm version patch/minor/major` (auto-updates VERSION file, commits, tags) → Submit PR

**Testing**: `node uptime-kuma-sync.js --list`, `node uptime-kuma-backup.js primary`, `node uptime-kuma-restore.js backup.json secondary --dry-run`

## Known Issues

- **Socket.IO Connection Timeout**: If instances are slow to respond, increase timeout in code (default: connection waits for auth)
- **Large Backup Files**: Instances with 100+ monitors create multi-MB backups. Consider backup retention policy.
- **Tag Color Mismatch**: If tags exist with same name but different colors, sync prefers existing tag (no color update)

## Docker Deployment

**Scheduled Backups**: docker-compose.yml runs backup every 6 hours (21600s sleep, customize as needed)  
**Multi-arch**: linux/amd64, linux/arm64 (Raspberry Pi 4+ compatible)

## Security

**Credentials**: uptime-kuma-config.json or .env file (both gitignored). Use read-only Docker mounts (`:ro`) for config files.  
**.dockerignore/.gitignore**: Exclude node_modules, backups, credentials

## Documentation

- **README.md**: Full usage guide, features, installation, Docker deployment
- **CONTRIBUTING.md**: Contribution guidelines
- **uptime-kuma-config.json.example**: Configuration template with comments

## Trust Statement

This tool is production-ready with CI/CD validation on every PR and automatic multi-arch Docker builds. The codebase follows Node.js best practices with clear separation of concerns (sync/backup/restore/diff in separate files). Automated workflows ensure syntax validation and Docker build integrity before merges.

**Validation**: Run `npm test` and `node --check *.js` before committing. All PRs must pass pr-validation.yml checks.
