# JackIn — media API server (node:20-slim).
# System deps: ffmpeg (transcode/remux), aria2 (download worker), python3
# (media search/download scripts in apps/python-services).
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    aria2 \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Manifests first for layer caching (npm ci needs all workspace manifests).
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json

# Production deps only. tsx is the dev-mode runner, so install it explicitly
# (--no-save, --omit=dev) to keep `npm run start -w @jackin/server` working.
RUN npm ci --omit=dev \
    && npm install --no-save --omit=dev tsx@^4

# Python services (media engine, download worker, subtitle service).
COPY apps/python-services ./apps/python-services
RUN python3 -m pip install --no-cache-dir -r apps/python-services/requirements.txt

# Server source (web app not needed inside this image).
COPY apps/server ./apps/server

# Runtime media data lives on the /data volume (overrides the repo-relative
# default DATA_DIR). Python scripts run from the system python3.
ENV PORT=3001 \
    JACKIN_DATA_DIR=/data \
    PYTHON_BIN=/usr/bin/python3

VOLUME /data
EXPOSE 3001

CMD ["npm", "run", "start", "-w", "@jackin/server"]
