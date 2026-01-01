# =============================================================================
# Podcast Generator API - Production Docker Image
# =============================================================================

FROM node:20-alpine

# OCI Labels - REQUIRED for all images
LABEL org.opencontainers.image.title="Podcast Generator API"
LABEL org.opencontainers.image.description="Generate podcasts from text using OpenAI TTS and Piper TTS"
LABEL org.opencontainers.image.version="1.5.0"
LABEL org.opencontainers.image.vendor="ecoworks"
LABEL org.opencontainers.image.source="https://github.com/smhunt/podcast-generator-endpoint"
LABEL org.opencontainers.image.authors="sean@ecoworks.ca"
LABEL org.opencontainers.image.licenses="MIT"

# Ecoworks Labels - for filtering and cleanup
LABEL com.ecoworks.project="podcast-generator"
LABEL com.ecoworks.component="api"
LABEL com.ecoworks.environment="prod"

# Build args for dynamic labels
ARG BUILD_DATE
ARG GIT_COMMIT
ARG VERSION=1.5.0

LABEL org.opencontainers.image.created="${BUILD_DATE}"
LABEL org.opencontainers.image.revision="${GIT_COMMIT}"

# Create app directory
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Install Piper TTS and ffmpeg for free voice generation
RUN apk add --no-cache wget tar ffmpeg && \
    mkdir -p /app/piper && \
    cd /app/piper && \
    # Download Piper TTS binary for Alpine Linux (amd64)
    wget -q https://github.com/rhasspy/piper/releases/download/v1.2.0/piper_amd64.tar.gz && \
    tar -xzf piper_amd64.tar.gz && \
    rm piper_amd64.tar.gz && \
    chmod +x piper/piper && \
    # Download a good quality voice model (en_US-lessac-medium)
    mkdir -p models && \
    cd models && \
    wget -q https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx && \
    wget -q https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json && \
    # Download additional voice: amy (female, medium quality)
    wget -q https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx && \
    wget -q https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx.json && \
    # Download additional voice: ryan (male, high quality)
    wget -q https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/ryan/high/en_US-ryan-high.onnx && \
    wget -q https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/ryan/high/en_US-ryan-high.onnx.json && \
    cd /app

# Copy package files
COPY package*.json ./

# Install dependencies (production only)
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY src/ ./src/
COPY public/ ./public/

# Create audio directory with correct permissions
RUN mkdir -p /app/audio && chown -R nodejs:nodejs /app && \
    chown -R nodejs:nodejs /app/piper

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3087

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3087/health || exit 1

# Start the application
CMD ["node", "src/index.js"]
