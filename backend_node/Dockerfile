FROM node:22-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    ffmpeg \
    python3 \
    python3-venv \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/yt-dlp-venv && \
    /opt/yt-dlp-venv/bin/pip install --no-cache-dir -U yt-dlp

RUN /opt/yt-dlp-venv/bin/yt-dlp --version

COPY package*.json ./

RUN npm install

RUN npm rebuild sqlite3 --build-from-source

COPY . .

RUN npm run build

ENV NODE_ENV=production
ENV YTDLP_PATH=/opt/yt-dlp-venv/bin/yt-dlp

EXPOSE 10000

CMD ["node", "dist/server.js"]