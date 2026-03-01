#!/bin/bash

# Uptime Kuma Diff Script
# Compare monitors between two Uptime Kuma instances

# Function to display usage
usage() {
    echo "Usage: $0 <source-instance> <target-instance> [--tldr]"
    echo ""
    echo "Compare monitors between two Uptime Kuma instances."
    echo ""
    echo "Arguments:"
    echo "  source-instance  Name of the first instance (from config)"
    echo "  target-instance  Name of the second instance (from config)"
    echo ""
    echo "Options:"
    echo "  --tldr           Show condensed summary (monitor names and common differences)"
    echo ""
    echo "Examples:"
    echo "  $0 primary secondary          # Full detailed comparison"
    echo "  $0 primary secondary --tldr   # Condensed summary"
    echo ""
    echo "Alternative: Set environment variables in .env.uptime-kuma.local:"
    echo "  SOURCE_INSTANCE=primary"
    echo "  TARGET_INSTANCE=secondary"
    echo ""
    echo "Configuration:"
    echo "  Instances must be defined in uptime-kuma-config.json"
    echo "  Customize ignored fields in the diff.ignoreFields section"
    echo ""
    echo "See README.diff.md for more information."
    exit 1
}

# Check for help flag
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    usage
fi

# Check if instance names are provided as arguments
if [ $# -ge 2 ]; then
    SOURCE="$1"
    TARGET="$2"
    shift 2
    FLAGS="$@"
    
    echo "Comparing '$SOURCE' to '$TARGET'..."
    node uptime-kuma-diff.js "$SOURCE" "$TARGET" $FLAGS
    exit $?
fi

# Try to load from .env file
if [ -f .env.uptime-kuma.local ]; then
    echo "Loading configuration from .env.uptime-kuma.local..."
    export $(cat .env.uptime-kuma.local | grep -v '^#' | xargs)
    
    if [ -z "$SOURCE_INSTANCE" ] || [ -z "$TARGET_INSTANCE" ]; then
        echo "Error: .env.uptime-kuma.local must define SOURCE_INSTANCE and TARGET_INSTANCE"
        echo ""
        usage
    fi
    
    echo "Comparing '$SOURCE_INSTANCE' to '$TARGET_INSTANCE'..."
    node uptime-kuma-diff.js "$SOURCE_INSTANCE" "$TARGET_INSTANCE"
    exit $?
fi

# No arguments and no .env file
echo "Error: No instance names provided and no .env.uptime-kuma.local file found."
echo ""
usage
