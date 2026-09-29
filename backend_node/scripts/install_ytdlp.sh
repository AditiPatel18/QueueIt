#!/usr/bin/env sh
set -e

echo "[Build] ===== Installing official yt-dlp Linux standalone binary ====="

# Define local target directory inside project root
BIN_DIR="$(pwd)/bin"
mkdir -p "$BIN_DIR"
LOCAL_YTDLP="$BIN_DIR/yt-dlp"

OS_NAME="$(uname -s 2>/dev/null || echo "Unknown")"
ARCH_NAME="$(uname -m 2>/dev/null || echo "x86_64")"

echo "[Build] Host OS: ${OS_NAME}, Architecture: ${ARCH_NAME}"

# Select standalone executable asset based on OS/arch.
# Note: yt-dlp_linux is PyInstaller standalone binary; does NOT require python3 host runtime.
case "$OS_NAME" in
  *MINGW*|*MSYS*|*CYGWIN*|*Windows*)
    ASSET_NAME="yt-dlp.exe"
    LOCAL_YTDLP="$BIN_DIR/yt-dlp.exe"
    ;;
  *)
    case "$ARCH_NAME" in
      aarch64|arm64)
        ASSET_NAME="yt-dlp_linux_aarch64"
        ;;
      *)
        ASSET_NAME="yt-dlp_linux"
        ;;
    esac
    ;;
esac

DOWNLOAD_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ASSET_NAME}"
echo "[Build] Downloading ${ASSET_NAME} from ${DOWNLOAD_URL}..."

# Download binary using curl (-f fails on HTTP errors, -L follows redirects)
if command -v curl >/dev/null 2>&1; then
  curl -L -f --retry 3 --retry-delay 2 "$DOWNLOAD_URL" -o "$LOCAL_YTDLP"
elif command -v wget >/dev/null 2>&1; then
  wget -O "$LOCAL_YTDLP" "$DOWNLOAD_URL"
else
  echo "[Build] ERROR: Neither curl nor wget is available to download yt-dlp!" >&2
  exit 1
fi

# Ensure executable permissions
chmod +x "$LOCAL_YTDLP" 2>/dev/null || chmod a+rx "$LOCAL_YTDLP"

# Check non-empty binary file
if [ ! -s "$LOCAL_YTDLP" ]; then
  echo "[Build] ERROR: Downloaded yt-dlp binary is empty!" >&2
  exit 1
fi

if command -v file >/dev/null 2>&1; then
  echo "[Build] Downloaded binary file type: $(file "$LOCAL_YTDLP")"
fi

echo "[Build] ===== Verifying yt-dlp Executable ====="
echo "[Build] Local binary path: ${LOCAL_YTDLP}"

# Execute version check to verify binary runs in this environment
YTDLP_VER="$("$LOCAL_YTDLP" --version)"

if [ -z "$YTDLP_VER" ]; then
  echo "[Build] ERROR: yt-dlp executable returned empty output when invoked with --version!" >&2
  exit 1
fi

echo "[Build] Successfully installed & verified yt-dlp version: ${YTDLP_VER}"
