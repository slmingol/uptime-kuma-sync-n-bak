#!/bin/bash

# Docker wrapper script for uptime-kuma-sync-n-bak
# This makes it easy to run commands without remembering docker run syntax
# Supports both Docker and Podman

IMAGE_NAME="uptime-kuma-sync:latest"

# Detect container runtime (docker or podman)
if command -v docker &> /dev/null; then
  CONTAINER_CMD="docker"
elif command -v podman &> /dev/null; then
  CONTAINER_CMD="podman"
else
  echo "Error: Neither docker nor podman found. Please install one of them."
  exit 1
fi

# Check if config file exists
if [ ! -f "./uptime-kuma-config.json" ]; then
  echo "Error: uptime-kuma-config.json not found in current directory"
  echo "Please create it from uptime-kuma-config.json.example"
  exit 1
fi

# Create backup directory if it doesn't exist
mkdir -p ./uptime-kuma-backups

# Function to run a command in the container
run_command() {
  $CONTAINER_CMD run --rm \
    -v "$(pwd)/uptime-kuma-config.json:/app/uptime-kuma-config.json:ro" \
    -v "$(pwd)/uptime-kuma-backups:/app/uptime-kuma-backups" \
    "$IMAGE_NAME" "$@"
}

# Parse command
case "$1" in
  list|--list|-l)
    echo "Listing available instances..."
    run_command node uptime-kuma-backup.js --list
    ;;
  
  backup)
    if [ -z "$2" ]; then
      echo "Usage: $0 backup <instance-name>"
      exit 1
    fi
    echo "Backing up instance: $2"
    run_command node uptime-kuma-backup.js "$2"
    ;;
  
  sync)
    if [ -z "$2" ] || [ -z "$3" ]; then
      echo "Usage: $0 sync <source-instance> <target-instance>"
      exit 1
    fi
    echo "Syncing from $2 to $3..."
    run_command node uptime-kuma-sync.js "$2" "$3"
    ;;
  
  restore)
    if [ -z "$2" ]; then
      echo "Usage: $0 restore <backup-file> [target-instance]"
      exit 1
    fi
    echo "Restoring from backup: $2"
    if [ -n "$3" ]; then
      run_command node uptime-kuma-restore.js "$2" "$3"
    else
      run_command node uptime-kuma-restore.js "$2"
    fi
    ;;
  
  build)
    echo "Building $CONTAINER_CMD image..."
    $CONTAINER_CMD build -t "$IMAGE_NAME" .
    ;;
  
  shell)
    echo "Starting interactive shell in container..."
    $CONTAINER_CMD run --rm -it \
      -v "$(pwd)/uptime-kuma-config.json:/app/uptime-kuma-config.json:ro" \
      -v "$(pwd)/uptime-kuma-backups:/app/uptime-kuma-backups" \
      --entrypoint /bin/sh \
      "$IMAGE_NAME"
    ;;
  
  help|--help|-h|"")
    cat << 'EOF'
Docker/Podman Wrapper for Uptime Kuma Sync & Backup

Usage: ./docker-run.sh <command> [options]

Commands:
  list                              List available instances
  backup <instance>                 Backup an instance
  sync <source> <target>            Sync from source to target instance
  restore <backup-file> [instance]  Restore from backup
  build                             Build the container image
  shell                             Open interactive shell in container
  help                              Show this help message

Examples:
  ./docker-run.sh build
  ./docker-run.sh list
  ./docker-run.sh backup primary
  ./docker-run.sh sync primary secondary
  ./docker-run.sh restore uptime-kuma-backups/primary-2026-03-01.json secondary

Requirements:
  - Docker or Podman installed
  - uptime-kuma-config.json in current directory

EOF
    ;;
  
  *)
    echo "Unknown command: $1"
    echo "Run '$0 help' for usage information"
    exit 1
    ;;
esac
