# Uptime Kuma Sync & Backup Tool - Copilot Instructions

## Project Overview

**Purpose**: Synchronize monitors and groups between multiple Uptime Kuma instances while preserving instance-specific settings, with automatic backup and restore functionality

**Type**: Node.js CLI Tool  
**Tech Stack**: Node.js 14+ (18+ recommended), Socket.IO, Axios, Docker  
**Size**: ~2,400 LOC across 11 files  
**Deployment**: CLI execution (Node.js) or Docker containers (ghcr.io)

## Build & Validation - ALWAYS FOLLOW THESE STEPS

### Initial Setup (First Time Only)
```bash
# 1. Install dependencies - ALWAYS run this first
npm install

# 2. Create configuration file from example
cp uptime-kuma-config.json.example uptime-kuma-config.json
# Edit uptime-kuma-config.json with your instance URLs and credentials
```

### Validation Commands (Run Before Any Commit)
```bash
# 1. Syntax check - ALWAYS pass before committing
node --check src/uptime-kuma-sync.js
node --check src/uptime-kuma-backup.js
node --check src/uptime-kuma-restore.js
node --check src/uptime-kuma-diff.js

# 2. JSON validation
node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8'))"
node -e "JSON.parse(require('fs').readFileSync('uptime-kuma-config.json.example', 'utf8'))"

# 3. Test help commands work
npm run sync -- --help
npm run backup -- --help
npm run restore -- --help
npm run diff -- --help
```

### Important: Tests Currently Broken
**NOTE**: `npm test` currently FAILS because test files have incorrect import paths (expecting files in root, but actual files are in src/). DO NOT rely on `npm test` for validation. Use syntax checks above instead.

### Docker Build & Validation
```bash
# Build from project root (docker/Dockerfile references ../src and ../scripts)
podman build -f docker/Dockerfile -t uptime-kuma-sync:test .

# Test the docker image works
podman run --rm uptime-kuma-sync:test node src/uptime-kuma-sync.js --help
podman run --rm uptime-kuma-sync:test node src/uptime-kuma-backup.js --help
```

**Common Docker Error**: If build fails with "cannot find package.json", ensure you're running from repository root and Dockerfile uses `COPY ../` paths correctly.

## Project Layout

```
uptime-kuma-sync-n-bak/
├── src/                         # Source code directory
│   ├── uptime-kuma-sync.js      # Main sync tool (680 LOC)
│   ├── uptime-kuma-backup.js    # Backup tool (275 LOC)
│   ├── uptime-kuma-restore.js   # Restore tool (285 LOC)
│   └── uptime-kuma-diff.js      # Diff/compare tool (476 LOC)
├── scripts/                     # Shell wrapper scripts
│   ├── sync-uptime.sh           # Sync wrapper (37 LOC)
│   ├── backup-uptime.sh         # Backup wrapper (40 LOC)
│   ├── restore-uptime.sh        # Restore wrapper (46 LOC)
│   ├── diff-uptime.sh           # Diff wrapper (71 LOC)
│   ├── uptime-kuma-docker.sh    # Docker helper (152 LOC)
│   └── update-version.sh        # Version update script (8 LOC)
├── test/
│   └── uptime-kuma-sync.test.js # Unit tests (351 LOC) - BROKEN, see note above
├── docs/                        # Documentation
│   ├── README.md                # Main documentation (linked from root)
│   ├── README.diff.md           # Diff tool documentation
│   ├── CONTRIBUTING.md          # Contribution guidelines
│   └── LICENSE                  # MIT License
├── docker/
│   └── Dockerfile               # Multi-arch Docker build (Node 18-alpine)
├── assets/
│   └── logo.svg                 # Repository logo
├── .github/
│   ├── workflows/
│   │   ├── build-and-push.yml   # Main branch → GHCR push (multi-arch: amd64/arm64)
│   │   └── pr-validation.yml    # PR checks: syntax, JSON, Docker build
│   └── copilot-instructions.md  # This file
├── package.json                 # NPM scripts and dependencies
├── package-lock.json            # Locked dependency versions
├── docker-compose.yml           # Docker compose config (references docker/Dockerfile)
├── uptime-kuma-config.json.example  # Configuration template
├── uptime-kuma-config.json      # User config (gitignored, create from example)
├── uptime-kuma-backups/         # Backup storage (gitignored, created automatically)
├── .env.uptime-kuma             # Environment variable template
├── .markdownlint.json           # Markdown linting rules
├── .dockerignore                # Docker build exclusions
├── .gitignore                   # Git exclusions
├── VERSION                      # Version number (auto-updated by npm version)
├── README.md                    # Symlink → docs/README.md
├── LICENSE                      # Symlink → docs/LICENSE
└── docker-compose.yml           # Symlink → docker/docker-compose.yml
```

### Key Architecture Points

**File Organization**: JavaScript source in `src/`, shell scripts in `scripts/`, tests in `test/`, docs in `docs/`

**Root Symlinks**: README.md, LICENSE, and docker-compose.yml are symlinks to files in subdirectories for convenience

**PATH REFERENCES IN README**: All script paths in docs/README.md use either:
- Shell scripts: `./scripts/script-name.sh`
- Node scripts: `node src/script-name.js`
- NPM scripts: `npm run command`

**Configuration Precedence**:
1. Command-line named instances (from uptime-kuma-config.json)
2. Environment variables (from .env files or shell)

## NPM Scripts Reference

```json
"scripts": {
  "sync": "node src/uptime-kuma-sync.js",      // Sync monitors between instances
  "diff": "node src/uptime-kuma-diff.js",      // Compare instance differences
  "backup": "node src/uptime-kuma-backup.js",  // Backup an instance
  "restore": "node src/uptime-kuma-restore.js", // Restore from backup
  "test": "node --test",                       // Run tests (CURRENTLY BROKEN)
  "postversion": "..."                         // Auto-update VERSION file
}
```

## CI/CD Workflows

### Build and Push (.github/workflows/build-and-push.yml)
**Triggers**: Push to `main` branch OR tags matching `v*.*.*`  
**Steps**:
1. Extract version from package.json
2. Build multi-arch Docker image (linux/amd64, linux/arm64)
3. Push to ghcr.io/slmingol/uptime-kuma-sync-n-bak with tags:
   - `main` (for main branch)
   - `latest` (for main branch)
   - Semver tags (for version tags: `1.0.0`, `1.0`, `1`)

**Duration**: ~5-10 minutes for multi-arch build

### PR Validation (.github/workflows/pr-validation.yml)
**Triggers**: Pull requests to `main` branch  
**Steps**:
1. npm ci - Install exact dependency versions
2. Syntax validation - `node --check` on all src/*.js files
3. JSON validation - Validate package.json and uptime-kuma-config.json.example
4. Docker build test - Build image and test help commands
5. Version check - Extract and display current version

**All checks must pass before PR can be merged**

## Configuration Files

### uptime-kuma-config.json (User-created, gitignored)
```json
{
  "instances": {
    "primary": {
      "url": "https://uptime1.example.com",
      "username": "admin",
      "password": "your-password",
      "description": "Primary instance"
    },
    "secondary": { ... }
  },
  "backup": {
    "directory": "./uptime-kuma-backups"
  },
  "sync": {
    "mode": "shallow",  // or "deep"
    "excludedFields": ["interval", "retryInterval", ...]
  }
}
```

### .env File (Alternative configuration method)
Variables: `SOURCE_UPTIME_URL`, `SOURCE_UPTIME_USER`, `SOURCE_UPTIME_PASS`, `TARGET_UPTIME_URL`, `TARGET_UPTIME_USER`, `TARGET_UPTIME_PASS`

## Common Operations

### Making Code Changes
1. Edit files in `src/` directory (NOT root)
2. Run syntax validation: `node --check src/uptime-kuma-sync.js`
3. Test manually with help command: `npm run sync -- --help`
4. For documentation changes, edit`docs/README.md` (NOT root README.md - it's a symlink)

### Updating Version
```bash
npm version patch   # 1.0.0 → 1.0.1
npm version minor   # 1.0.0 → 1.1.0
npm version major   # 1.0.0 → 2.0.0
# This automatically updates VERSION file via postversion script
```

### Podman Development
```bash
# Build locally
podman build -f docker/Dockerfile -t uptime-kuma-sync:local .

# Run with config
podman run --rm \
  -v "$(pwd)/uptime-kuma-config.json:/app/uptime-kuma-config.json:ro" \
  -v "$(pwd)/uptime-kuma-backups:/app/uptime-kuma-backups" \
  uptime-kuma-sync:local node src/uptime-kuma-sync.js primary secondary
```

## Sync Architecture

### Two Sync Modes
1. **Shallow** (default): Syncs monitor configuration but preserves instance-specific settings (intervals, timeouts, notifications) on target
2. **Deep**: Copies ALL settings from source to target for exact replica

### Sync Workflow
1. Connect to both instances via Socket.IO
2. Authenticate with credentials
3. Fetch monitors and tags from both
4. **Create automatic backup** of target instance (timestamped JSON in uptime-kuma-backups/)
5. Map tags between instances (by name + color)
6. Create missing tags on target
7. Update or create monitors on target
8. Preserve specified fields (in shallow mode)

### Backup File Format
**Filename**: `{instance-name}-{YYYY-MM-DDTHH-mm-ss}.json`  
**Contains**: Full monitors array, tags array, metadata (timestamp, counts)

## Dependencies

**Runtime** (package.json dependencies):
- axios: ^1.6.7 - HTTP client for API calls
- socket.io-client: ^4.6.1 - WebSocket connection to Uptime Kuma

**Development** (devDependencies):
- dotenv: ^16.4.1 - Environment variable loading

**Engines**: Node.js >= 14.0.0 (18+ recommended for Docker)

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
