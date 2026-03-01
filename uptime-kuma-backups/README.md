# Uptime Kuma Backups

This directory stores JSON backups of Uptime Kuma instances.

## Backup Files

Each backup contains:
- All monitors with full configuration
- All tags/groups
- Timestamp and instance metadata

## File Naming

Format: `{instance-name}-{ISO-timestamp}.json`

Examples:
- `target-2026-03-01T10-30-00.json`
- `production-2026-03-01T14-15-30.json`

## Automatic Backups

The sync script automatically creates a backup of the target instance before each sync operation.

## Manual Management

### List backups
```bash
ls -lh uptime-kuma-backups/
```

### View backup contents
```bash
cat uptime-kuma-backups/target-2026-03-01T10-30-00.json | jq .
```

### Delete old backups (keep last 30 days)
```bash
find uptime-kuma-backups/ -name "*.json" -mtime +30 -delete
```

### Keep only last 10 backups
```bash
ls -t uptime-kuma-backups/*.json | tail -n +11 | xargs rm -f
```

## Restore

Use the restore script:
```bash
node uptime-kuma-restore.js uptime-kuma-backups/backup-file.json
```
