#!/bin/bash

# Uptime Kuma Restore Script
# Usage: ./restore-uptime.sh <backup-file> [instance-name]

# Check arguments
if [ $# -lt 1 ]; then
  echo "Usage: ./restore-uptime.sh <backup-file> [instance-name]"
  echo ""
  echo "Arguments:"
  echo "  backup-file      Path to backup JSON file (required)"
  echo "  instance-name    Target instance name from config (optional)"
  echo ""
  echo "Examples:"
  echo "  ./restore-uptime.sh uptime-kuma-backups/primary-2026-03-01.json"
  echo "  ./restore-uptime.sh uptime-kuma-backups/primary-2026-03-01.json secondary"
  exit 1
fi

BACKUP_FILE="$1"
INSTANCE_NAME="$2"

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: Backup file not found: $BACKUP_FILE"
  exit 1
fi

# Run restore
if [ -n "$INSTANCE_NAME" ]; then
  echo "Restoring from '$BACKUP_FILE' to instance '$INSTANCE_NAME'..."
  node uptime-kuma-restore.js "$BACKUP_FILE" "$INSTANCE_NAME"
else
  echo "Restoring from '$BACKUP_FILE'..."
  node uptime-kuma-restore.js "$BACKUP_FILE"
fi
