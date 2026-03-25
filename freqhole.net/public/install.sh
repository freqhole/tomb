#!/bin/sh
# freqhole CLI installer
# usage: curl -fsSL https://freqhole.net/install.sh | sh

set -e

REPO="freqhole/tomb"
BIN_NAME="freqhole"
INSTALL_DIR="$HOME/.local/bin"

# detect OS and architecture
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux)
    case "$ARCH" in
      x86_64)  TARGET="x86_64-unknown-linux-gnu" ;;
      aarch64) TARGET="aarch64-unknown-linux-gnu" ;;
      armv7l)  TARGET="armv7-unknown-linux-gnueabihf" ;;
      *) echo "error: unsupported architecture: $ARCH" >&2; exit 1 ;;
    esac
    ;;
  Darwin)
    case "$ARCH" in
      x86_64) TARGET="x86_64-apple-darwin" ;;
      arm64)  TARGET="aarch64-apple-darwin" ;;
      *) echo "error: unsupported architecture: $ARCH" >&2; exit 1 ;;
    esac
    ;;
  *)
    echo "error: unsupported OS: $OS" >&2
    exit 1
    ;;
esac

URL="https://github.com/$REPO/releases/latest/download/$BIN_NAME-$TARGET"

echo "freqhole installer"
echo "  target:  $TARGET"
echo "  from:    $URL"
echo "  to:      $INSTALL_DIR/$BIN_NAME"
echo ""

mkdir -p "$INSTALL_DIR"

# download binary
if command -v curl >/dev/null 2>&1; then
  curl -fsSL --progress-bar "$URL" -o "$INSTALL_DIR/$BIN_NAME"
elif command -v wget >/dev/null 2>&1; then
  wget -q --show-progress -O "$INSTALL_DIR/$BIN_NAME" "$URL"
else
  echo "error: curl or wget is required" >&2
  exit 1
fi

chmod +x "$INSTALL_DIR/$BIN_NAME"

echo ""
echo "installed: $INSTALL_DIR/$BIN_NAME"
echo ""

# check if install dir is in PATH
case ":$PATH:" in
  *":$INSTALL_DIR:"*)
    echo "run: freqhole init"
    ;;
  *)
    echo "note: $INSTALL_DIR is not in your PATH. add this to your shell profile:"
    echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo ""
    echo "then run: freqhole init"
    ;;
esac
