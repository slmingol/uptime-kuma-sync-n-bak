#!/bin/bash

# Uptime Kuma Backup Script
# Usage: ./backup-uptime.sh <instance-name>

# Check for --list flag
if [ "$1" = "--list" ] || [ "$1" = "-l" ]; then
  node uptime-kuma-backup.js --list
  exit 0
fi

# Check if instance name provided
if [ $# -eq 1 ]; then
  # Use named instance from config
  echo "Backing up instance '$1'..."
  node uptime-kuma-backup.js "$1"
elif [ $# -eq 0 ]; then
  # Check if .env file exists for environment variable approach
  if [ -f .env.uptime-kuma.local ]; then
    export $(cat .env.uptime-kuma.local | grep -v '^#' | xargs)
    node uptime-kuma-backup.js
  else
    echo "Usage: ./backup-uptime.sh <instance-name>"
    echo "       ./backup-uptime.sh --list"
    echo ""
    echo "Options:"
    echo "  --list, -l       List available instances"
    echo ""
    echo "Examples:"
    echo "  ./backup-uptime.sh primary      # Backup 'primary' instance from config"
    echo "  ./backup-uptime.sh secondary    # Backup 'secondary' instance from config"
    echo ""
    echo "Or configure instance in uptime-kuma-config.json"
    exit 1
  fi
else
  echo "Error: Too many arguments"
  echo "Usage: ./backup-uptime.sh <instance-name>"
  exit 1
fi
