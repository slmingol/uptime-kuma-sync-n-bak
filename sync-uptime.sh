#!/bin/bash

# Uptime Kuma Sync Script
# Usage: ./sync-uptime.sh [source-instance] [target-instance]

# Check for --list flag
if [ "$1" = "--list" ] || [ "$1" = "-l" ]; then
  node uptime-kuma-sync.js --list
  exit 0
fi

# Check if instance names provided
if [ $# -eq 2 ]; then
  # Use named instances from config
  echo "Syncing from '$1' to '$2'..."
  node uptime-kuma-sync.js "$1" "$2"
elif [ -f .env.uptime-kuma.local ]; then
  # Load environment variables from .env file
  export $(cat .env.uptime-kuma.local | grep -v '^#' | xargs)
  node uptime-kuma-sync.js
else
  echo "Usage: ./sync-uptime.sh <source-instance> <target-instance>"
  echo "       ./sync-uptime.sh --list"
  echo "   or: Configure .env.uptime-kuma.local for environment variable approach"
  echo ""
  echo "Options:"
  echo "  --list, -l       List available instances"
  echo ""
  echo "Examples:"
  echo "  ./sync-uptime.sh primary secondary  # Using named instances"
  echo "  ./sync-uptime.sh                     # Using .env file"
  exit 1
fi
