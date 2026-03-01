FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY *.js ./
COPY *.sh ./

# Make shell scripts executable
RUN chmod +x *.sh

# Create directories for config and backups
RUN mkdir -p /app/uptime-kuma-backups /app/config

# Set volumes
VOLUME ["/app/config", "/app/uptime-kuma-backups"]

# Default command shows help
CMD ["node", "uptime-kuma-sync.js", "--help"]
