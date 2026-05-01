#!/bin/bash
# build-flatpak.sh - dumb-player flatpak from a pre-built .deb
# usage: ./build-flatpak.sh <input.deb> <output.flatpak> [arch]
set -e

DEB_FILE="$1"
OUTPUT_FLATPAK="$2"
ARCH="${3:-x86_64}"

if [ -z "$DEB_FILE" ] || [ -z "$OUTPUT_FLATPAK" ]; then
    echo "usage: $0 <input.deb> <output.flatpak> [arch]"
    exit 1
fi
if [ ! -f "$DEB_FILE" ]; then
    echo "error: deb file not found: $DEB_FILE"
    exit 1
fi

APP_ID="net.freqhole.dumbplayer"
RUNTIME="org.gnome.Platform"
RUNTIME_VERSION="50"
SDK="org.gnome.Sdk"

WORK_DIR=$(mktemp -d)
BUILD_DIR="$WORK_DIR/build"
REPO_DIR="$WORK_DIR/repo"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "extracting deb..."
mkdir -p "$WORK_DIR/deb"
cd "$WORK_DIR/deb"
ar x "$DEB_FILE"
tar xf data.tar.* || tar xf data.tar

echo "initializing flatpak build..."
flatpak build-init "$BUILD_DIR" "$APP_ID" "$SDK" "$RUNTIME" "$RUNTIME_VERSION"

# binary
for bn in dumb-player dumbplayer; do
    if [ -f "$WORK_DIR/deb/usr/bin/$bn" ]; then
        install -Dm755 "$WORK_DIR/deb/usr/bin/$bn" "$BUILD_DIR/files/bin/dumb-player"
        break
    fi
done
if [ ! -f "$BUILD_DIR/files/bin/dumb-player" ]; then
    echo "error: could not find binary in usr/bin"
    ls -la "$WORK_DIR/deb/usr/bin/" || true
    exit 1
fi

# desktop file
for dn in dumb-player dumbplayer; do
    src="$WORK_DIR/deb/usr/share/applications/${dn}.desktop"
    if [ -f "$src" ]; then
        install -Dm644 "$src" "$BUILD_DIR/files/share/applications/$APP_ID.desktop"
        sed -i "s|^Icon=.*|Icon=$APP_ID|" "$BUILD_DIR/files/share/applications/$APP_ID.desktop"
        sed -i "s|^Exec=.*|Exec=dumb-player|" "$BUILD_DIR/files/share/applications/$APP_ID.desktop"
        break
    fi
done

# icons
for icon_name in dumb-player dumbplayer; do
    for size in 32x32 128x128 256x256; do
        icon="$WORK_DIR/deb/usr/share/icons/hicolor/$size/apps/${icon_name}.png"
        [ -f "$icon" ] && install -Dm644 "$icon" "$BUILD_DIR/files/share/icons/hicolor/$size/apps/$APP_ID.png"
    done
done

# metainfo
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/net.freqhole.dumbplayer.metainfo.xml" ]; then
    install -Dm644 "$SCRIPT_DIR/net.freqhole.dumbplayer.metainfo.xml" \
        "$BUILD_DIR/files/share/metainfo/$APP_ID.metainfo.xml"
fi

echo "finishing flatpak build..."
flatpak build-finish "$BUILD_DIR" \
    --share=ipc \
    --share=network \
    --socket=fallback-x11 \
    --socket=wayland \
    --device=dri \
    --socket=pulseaudio \
    --filesystem=xdg-music:ro \
    --filesystem=xdg-download:ro \
    --filesystem=home:ro \
    --filesystem=/tmp \
    --filesystem=/media \
    --filesystem=/mnt \
    --filesystem=xdg-run/doc \
    --talk-name=org.freedesktop.portal.Desktop \
    --talk-name=org.freedesktop.portal.Documents \
    --talk-name=org.freedesktop.portal.FileChooser \
    --command=dumb-player

echo "exporting to repo..."
mkdir -p "$REPO_DIR"
flatpak build-export "$REPO_DIR" "$BUILD_DIR"

echo "creating bundle..."
flatpak build-bundle "$REPO_DIR" "$OUTPUT_FLATPAK" "$APP_ID" --arch="$ARCH"

echo "done: $OUTPUT_FLATPAK"
