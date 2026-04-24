#!/bin/bash
# build-flatpak.sh - creates flatpak from pre-built .deb without flatpak-builder
# this avoids the sandbox/privilege issues of flatpak-builder in Docker
#
# usage: ./build-flatpak.sh <input.deb> <output.flatpak> [arch]
# arch: x86_64 (default) or aarch64

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

APP_ID="net.freqhole.freqhole"
RUNTIME="org.gnome.Platform"
RUNTIME_VERSION="50"
SDK="org.gnome.Sdk"

WORK_DIR=$(mktemp -d)
BUILD_DIR="$WORK_DIR/build"
REPO_DIR="$WORK_DIR/repo"

cleanup() {
    rm -rf "$WORK_DIR"
}
trap cleanup EXIT

echo "extracting deb..."
mkdir -p "$WORK_DIR/deb"
cd "$WORK_DIR/deb"
ar x "$DEB_FILE"
tar xf data.tar.* || tar xf data.tar

echo "initializing flatpak build..."
flatpak build-init "$BUILD_DIR" "$APP_ID" "$SDK" "$RUNTIME" "$RUNTIME_VERSION"

echo "copying files..."
# copy binary (tauri app is named charnel internally, rename to freqhole)
if [ -f "$WORK_DIR/deb/usr/bin/charnel" ]; then
    install -Dm755 "$WORK_DIR/deb/usr/bin/charnel" "$BUILD_DIR/files/bin/freqhole"
elif [ -f "$WORK_DIR/deb/usr/bin/freqhole" ]; then
    install -Dm755 "$WORK_DIR/deb/usr/bin/freqhole" "$BUILD_DIR/files/bin/freqhole"
else
    echo "error: could not find binary (tried charnel, freqhole)"
    ls -la "$WORK_DIR/deb/usr/bin/" 2>/dev/null || echo "usr/bin not found"
    exit 1
fi

# copy desktop file (rename to match app id)
# tauri may name it charnel.desktop or freqhole.desktop
for desktop_name in freqhole charnel; do
    if [ -f "$WORK_DIR/deb/usr/share/applications/${desktop_name}.desktop" ]; then
        install -Dm644 "$WORK_DIR/deb/usr/share/applications/${desktop_name}.desktop" \
            "$BUILD_DIR/files/share/applications/$APP_ID.desktop"
        # fix Icon and Exec paths
        sed -i "s|^Icon=.*|Icon=$APP_ID|" "$BUILD_DIR/files/share/applications/$APP_ID.desktop"
        sed -i "s|^Exec=.*|Exec=freqhole %U|" "$BUILD_DIR/files/share/applications/$APP_ID.desktop"
        break
    fi
done

# copy icons (may be named freqhole or charnel)
for icon_name in freqhole charnel; do
    for size in 32x32 128x128 256x256; do
        icon="$WORK_DIR/deb/usr/share/icons/hicolor/$size/apps/${icon_name}.png"
        if [ -f "$icon" ]; then
            install -Dm644 "$icon" "$BUILD_DIR/files/share/icons/hicolor/$size/apps/$APP_ID.png"
        fi
    done
    # also check for @2x icons
    for size in 128x128@2x 256x256@2; do
        icon="$WORK_DIR/deb/usr/share/icons/hicolor/$size/apps/${icon_name}.png"
        if [ -f "$icon" ]; then
            base_size=$(echo "$size" | sed 's/@2x$//' | sed 's/@2$//')
            install -Dm644 "$icon" "$BUILD_DIR/files/share/icons/hicolor/$base_size/apps/$APP_ID.png"
        fi
    done
done

# copy metainfo
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/net.freqhole.freqhole.metainfo.xml" ]; then
    install -Dm644 "$SCRIPT_DIR/net.freqhole.freqhole.metainfo.xml" \
        "$BUILD_DIR/files/share/metainfo/$APP_ID.metainfo.xml"
fi

echo "finishing flatpak build..."
flatpak build-finish "$BUILD_DIR" \
    --share=ipc \
    --socket=fallback-x11 \
    --socket=wayland \
    --device=dri \
    --socket=pulseaudio \
    --share=network \
    --filesystem=xdg-music:ro \
    --filesystem=home:ro \
    --talk-name=org.kde.StatusNotifierWatcher \
    --talk-name=org.freedesktop.Notifications \
    --talk-name=org.freedesktop.portal.Desktop \
    --talk-name=org.freedesktop.secrets \
    --persist=.local/share/net.freqhole.charnel \
    --command=freqhole

echo "exporting to repo..."
mkdir -p "$REPO_DIR"
flatpak build-export "$REPO_DIR" "$BUILD_DIR"

echo "creating bundle..."
flatpak build-bundle "$REPO_DIR" "$OUTPUT_FLATPAK" "$APP_ID" --arch="$ARCH"

echo "done: $OUTPUT_FLATPAK"
