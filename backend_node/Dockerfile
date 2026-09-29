# Use official Node 20 LTS slim Debian image (includes modern glibc and ca-certificates)
FROM node:20-slim

WORKDIR /app

# Install system utilities, ca-certificates, and ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    ffmpeg \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Download official yt-dlp Linux standalone binary to /usr/local/bin/yt-dlp
RUN curl -L -f https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

# CRITICAL BUILD VERIFICATION: Docker build fails immediately if yt-dlp executable cannot run
RUN /usr/local/bin/yt-dlp --version

# Install dependencies and build application
COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Environment settings
ENV NODE_ENV=production
ENV YTDLP_PATH=/usr/local/bin/yt-dlp

EXPOSE 10000

# Run backend application
CMD ["node", "dist/server.js"]
