#!/usr/bin/env bash
# fetches a prebuilt, portable libmpv (+ its 2 sibling dylibs) for macOS and
# stages it in two places:
#   - /usr/local/lib (with an unversioned libmpv.dylib symlink) so cargo's
#     linker can resolve libmpv2-sys's bare `-lmpv` at build time - see
#     .cargo/config.toml's rustflags for both apple-darwin targets.
#   - client/charnel/src-tauri/mpv-runtime/lib, referenced by
#     tauri.conf.json's `bundle.macOS.frameworks` so the dylibs get bundled
#     directly into freqhole.app - no Homebrew (or anything else) required
#     on the end user's machine.
#
# source: https://github.com/Zencok/mpv-libre-runtime - publishes
# reproducible, checksummed, portable (@loader_path-relative install names)
# libmpv runtimes for exactly this "embed in a host app" use case. real
# upstream mpv itself (via Homebrew) works fine for local arm64 dev but:
#   1. doesn't ship an x86_64 macOS bottle at all anymore, and
#   2. its arm64 bottle has absolute /opt/homebrew/... install names plus a
#      deep dependency tree (ffmpeg, libass, libplacebo, ...), so it isn't
#      portable/bundleable without extra dylibbundler-style rewriting.
# mpv-libre-runtime solves both: same portable design on every arch.
#
# usage: scripts/fetch-mpv-runtime.sh <arm64|x86_64>
set -euo pipefail

ARCH="${1:?usage: fetch-mpv-runtime.sh <arm64|x86_64>}"
RELEASE_TAG="runtime-mpv-2a4eb8067c-librempeg-9c00336e26-fb08030026"
BASE_URL="https://github.com/Zencok/mpv-libre-runtime/releases/download/$RELEASE_TAG"

case "$ARCH" in
  arm64)
    ASSET="mpv-libre-runtime-darwin-arm64.tar.xz"
    EXPECTED_SHA256="c62529940423437e6d96c810ef6bccb3ddd44659001a2bb4fa6ba1c69136336d"
    ;;
  x86_64)
    ASSET="mpv-libre-runtime-darwin-x64.tar.xz"
    EXPECTED_SHA256="99995d48421e0fcd2c24152cf4bb4523b86e30294d105e9a3683e6da92b3cdc5"
    ;;
  *)
    echo "fetch-mpv-runtime.sh: unknown arch '$ARCH' (expected arm64 or x86_64)" >&2
    exit 1
    ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_DEST="$REPO_ROOT/client/charnel/src-tauri/mpv-runtime/lib"
LINK_DEST="/usr/local/lib"
STAMP="$BUNDLE_DEST/.fetched-$ARCH-$RELEASE_TAG"

if [ -f "$STAMP" ] && [ -f "$LINK_DEST/libmpv.dylib" ]; then
  echo "fetch-mpv-runtime: already staged for $ARCH at this release, skipping download"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "fetch-mpv-runtime: downloading $ASSET..."
curl -fsSL -o "$TMP/$ASSET" "$BASE_URL/$ASSET"
echo "$EXPECTED_SHA256  $TMP/$ASSET" | shasum -a 256 -c -
tar -xf "$TMP/$ASSET" -C "$TMP"

mkdir -p "$BUNDLE_DEST"
cp "$TMP/lib/libmpv.2.dylib" "$TMP/lib/libgraphite2.3.dylib" "$TMP/lib/libvulkan.1.dylib" "$BUNDLE_DEST/"
echo "fetch-mpv-runtime: staged for bundling at $BUNDLE_DEST"

# /usr/local is root:wheel 755 on a stock macOS install (no homebrew ever
# installed there) - happens on apple silicon since homebrew's native
# prefix is /opt/homebrew instead. bootstrap it once with non-interactive
# sudo (works passwordlessly on github's macos runners, same as homebrew's
# own installer already relies on) - never prompts for a password locally.
# not fatal if it fails: arm64 dev machines already have a working libmpv
# via homebrew's /opt/homebrew/lib (see .cargo/config.toml), so linking
# still works there even without this. only actually required for x86_64
# (no homebrew fallback exists there anymore) and in CI (which has sudo).
if [ ! -w "$LINK_DEST" ] && [ ! -d "$LINK_DEST" ]; then
  if ! (sudo -n mkdir -p "$LINK_DEST" && sudo -n chown "$(id -u):$(id -g)" "$LINK_DEST") 2>/dev/null; then
    echo "fetch-mpv-runtime: warning: $LINK_DEST isn't writable and isn't sudo-creatable non-interactively - skipping the linker copy." >&2
    echo "fetch-mpv-runtime: if \`cargo build\` fails to find -lmpv, run once: sudo mkdir -p $LINK_DEST && sudo chown \$(id -u):\$(id -g) $LINK_DEST" >&2
    touch "$STAMP"
    exit 0
  fi
fi

mkdir -p "$LINK_DEST"
cp "$TMP/lib/libmpv.2.dylib" "$TMP/lib/libgraphite2.3.dylib" "$TMP/lib/libvulkan.1.dylib" "$LINK_DEST/"
ln -sf libmpv.2.dylib "$LINK_DEST/libmpv.dylib"
echo "fetch-mpv-runtime: staged for linking at $LINK_DEST"

touch "$STAMP"
