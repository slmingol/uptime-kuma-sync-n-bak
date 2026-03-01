FROM node:18-alpine

# Build arguments
ARG VERSION=1.0.0
ARG BUILD_DATE
ARG VCS_REF

# Labels
LABEL org.opencontainers.image.title="Uptime Kuma Sync & Backup"
LABEL org.opencontainers.image.description="Sync monitors and groups between multiple Uptime Kuma instances with automatic backup"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.created="${BUILD_DATE}"
LABEL org.opencontainers.image.source="https://github.com/slmingol/uptime-kuma-sync-n-bak"
LABEL org.opencontainers.image.revision="${VCS_REF}"
LABEL org.opencontainers.image.licenses="MIT"

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production
Add version info
RUN echo "${VERSION}" > /app/VERSION

# 
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
