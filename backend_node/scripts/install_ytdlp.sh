#!/usr/bin/env sh
set -e

echo "[Build] ===== Installing official yt-dlp Linux standalone binary ====="

# Define local target directory inside project root
BIN_DIR="$(pwd)/bin"
mkdir -p "$BIN_DIR"
LOCAL_YTDLP="$BIN_DIR/yt-dlp"

# Download official yt-dlp release binary
echo "[Build] Downloading latest yt-dlp standalone binary from GitHub..."
curl -L -f https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o "$LOCAL_YTDLP"
chmod a+rx "$LOCAL_YTDLP"

# Optionally copy to /usr/local/bin if /usr/local/bin is writable
if [ -w "/usr/local/bin" ]; then
  echo "[Build] Copying yt-dlp to /usr/local/bin/yt-dlp..."
  cp "$LOCAL_YTDLP" /usr/local/bin/yt-dlp || true
  chmod a+rx /usr/local/bin/yt-dlp || true
fi

# Export PATH so subsequent build verification commands can find it
export PATH="$BIN_DIR:/usr/local/bin:$PATH"

echo "[Build] ===== Verifying yt-dlp Installation ====="
if command -v yt-dlp >/dev/null 2>&1; then
  echo "[Build] Executable path (which yt-dlp): $(which yt-dlp)"
  yt-dlp --version
elif [ -x "$LOCAL_YTDLP" ]; then
  echo "[Build] Executable path (local binary): $LOCAL_YTDLP"
  "$LOCAL_YTDLP" --version
else
  echo "[Build] ERROR: yt-dlp binary installation failed or is not executable!" >&2
  exit 1
fi

echo "[Build] yt-dlp binary installation verified successfully."
