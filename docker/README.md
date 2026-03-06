# Docker Configuration

This directory contains all Docker-related files for the Uptime Kuma Sync & Backup tool.

## Files

- **Dockerfile** - Node.js 18 Alpine-based image with sync and backup tools
- **docker-compose.yml** - Docker Compose configuration for sync and scheduled backups

## Quick Start

### Using Pre-built Image

Pull from GitHub Container Registry:

```bash
docker pull ghcr.io/slmingol/uptime-kuma-sync-n-bak:latest
```

### One-time Sync

```bash
# From project root or docker/ directory
docker compose -f docker/docker-compose.yml run uptime-kuma-sync \
  node src/uptime-kuma-sync.js primary secondary
```

### One-time Backup

```bash
docker compose -f docker/docker-compose.yml run uptime-kuma-sync \
  node src/uptime-kuma-backup.js primary
```

### Restore from Backup

```bash
docker compose -f docker/docker-compose.yml run uptime-kuma-sync \
  node src/uptime-kuma-restore.js /app/uptime-kuma-backups/primary-2026-03-01.json secondary
```

### Scheduled Backups (Cron)

```bash
# Runs backup every 6 hours
docker compose -f docker/docker-compose.yml up -d uptime-kuma-backup-cron
```

## Configuration

Create `uptime-kuma-config.json` in the project root with your instances:

```json
{
  "instances": {
    "primary": {
      "url": "https://uptime1.example.com",
      "username": "admin",
      "password": "your-password"
    },
    "secondary": {
      "url": "https://uptime2.example.com",
      "username": "admin",
      "password": "your-password"
    }
  }
}
```

## Volumes

- `../uptime-kuma-config.json:/app/uptime-kuma-config.json:ro` - Configuration file (read-only)
- `../uptime-kuma-backups:/app/uptime-kuma-backups` - Backup storage directory

## Environment

- **Node.js**: 18 Alpine
- **Architecture**: linux/amd64, linux/arm64

## Commands

Available commands inside the container:

- `node src/uptime-kuma-sync.js <source> <target>` - Sync monitors
- `node src/uptime-kuma-backup.js <instance>` - Create backup
- `node src/uptime-kuma-restore.js <backup-file> <target>` - Restore backup
- `node src/uptime-kuma-diff.js <instance1> <instance2>` - Compare instances
