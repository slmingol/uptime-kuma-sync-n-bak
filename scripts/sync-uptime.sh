#!/bin/bash

# Uptime Kuma Sync Script
# Usage: ./sync-uptime.sh [source-instance] [target-instance] [options]

# Check for --list flag
if [ "$1" = "--list" ] || [ "$1" = "-l" ]; then
  node ../src/uptime-kuma-sync.js --list
  exit 0
fi

# Check if instance names provided
if [ $# -ge 2 ]; then
  # Use named instances from config
  # Pass all arguments to the Node.js script
  echo "Syncing from '$1' to '$2'..."
  node ../src/uptime-kuma-sync.js "$@"
elif [ -f .env.uptime-kuma.local ]; then
  # Load environment variables from .env file
  export $(cat .env.uptime-kuma.local | grep -v '^#' | xargs)
  node ../src/uptime-kuma-sync.js "$@"
else
  echo "Usage: ./sync-uptime.sh <source-instance> <target-instance> [options]"
  echo "       ./sync-uptime.sh --list"
  echo "   or: Configure .env.uptime-kuma.local for environment variable approach"
  echo ""
  echo "Options:"
  echo "  --list, -l       List available instances"
  echo "  --deep           Deep sync - copy ALL settings including intervals"
  echo "  --shallow        Shallow sync (default) - preserve instance-specific settings"
  echo ""
  echo "Examples:"
  echo "  ./sync-uptime.sh primary secondary          # Shallow sync (default)"
  echo "  ./sync-uptime.sh primary secondary --deep   # Deep sync"
  echo "  ./sync-uptime.sh                            # Using .env file"
  exit 1
fi
