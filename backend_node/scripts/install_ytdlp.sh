#!/usr/bin/env sh
set -e

echo "[Build] ===== Installing official yt-dlp standalone binary ====="

BIN_DIR="$(pwd)/bin"
mkdir -p "$BIN_DIR"
LOCAL_YTDLP="$BIN_DIR/yt-dlp"

OS_NAME="$(uname -s 2>/dev/null || echo "Unknown")"
ARCH_NAME="$(uname -m 2>/dev/null || echo "x86_64")"

echo "[Build Diagnostic] Host OS: ${OS_NAME}, Architecture: ${ARCH_NAME}"
if command -v uname >/dev/null 2>&1; then
  echo "[Build Diagnostic] Kernel Details: $(uname -a)"
fi

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

if command -v curl >/dev/null 2>&1; then
  curl -L -f --retry 3 --retry-delay 2 "$DOWNLOAD_URL" -o "$LOCAL_YTDLP"
elif command -v wget >/dev/null 2>&1; then
  wget -O "$LOCAL_YTDLP" "$DOWNLOAD_URL"
else
  echo "[Build] ERROR: Neither curl nor wget is available!" >&2
  exit 1
fi

chmod +x "$LOCAL_YTDLP" 2>/dev/null || chmod a+rx "$LOCAL_YTDLP"

if [ ! -s "$LOCAL_YTDLP" ]; then
  echo "[Build] ERROR: Downloaded yt-dlp binary is empty!" >&2
  exit 1
fi

echo "[Build Diagnostic] File Details: $(ls -lah "$LOCAL_YTDLP" 2>/dev/null || true)"
if command -v file >/dev/null 2>&1; then
  echo "[Build Diagnostic] File Type: $(file "$LOCAL_YTDLP")"
fi
if command -v ldd >/dev/null 2>&1; then
  echo "[Build Diagnostic] Dynamic Linking (ldd):"
  ldd "$LOCAL_YTDLP" || true
fi

echo "[Build] ===== Verifying yt-dlp Executable ====="
echo "[Build] Executing ${LOCAL_YTDLP} --version..."

# Verify executable runs and output version, capturing stderr on error
if YTDLP_VER="$("$LOCAL_YTDLP" --version 2>&1)"; then
  echo "[Build] SUCCESS: Installed & verified yt-dlp version: ${YTDLP_VER}"
else
  EXEC_ERR=$?
  echo "[Build] FATAL ERROR: Binary execution failed with code ${EXEC_ERR}!" >&2
  echo "[Build] Output/Error: ${YTDLP_VER}" >&2
  exit ${EXEC_ERR}
fi
