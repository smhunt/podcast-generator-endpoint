# =============================================================================
# Piper TTS Server - Persistent local TTS service
# =============================================================================

FROM python:3.11-slim

LABEL org.opencontainers.image.title="Piper TTS Server"
LABEL org.opencontainers.image.description="Fast local neural text-to-speech server"
LABEL com.ecoworks.project="podcast-generator"
LABEL com.ecoworks.component="piper-tts"

WORKDIR /app

# Install dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget curl \
    && rm -rf /var/lib/apt/lists/*

# Install piper-tts Python package
RUN pip install --no-cache-dir piper-tts flask gunicorn

# Download voice models
RUN mkdir -p /app/models && cd /app/models && \
    # Amy - Female, medium quality
    wget -q https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx && \
    wget -q https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx.json && \
    # Lessac - Male, medium quality
    wget -q https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx && \
    wget -q https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json && \
    # Ryan - Male, high quality
    wget -q https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/ryan/high/en_US-ryan-high.onnx && \
    wget -q https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/ryan/high/en_US-ryan-high.onnx.json

# Copy server script
COPY server.py /app/

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:5000", "--timeout", "120", "server:app"]
