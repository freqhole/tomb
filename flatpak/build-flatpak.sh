#!/bin/bash
# build-flatpak.sh - builds the real flatpak via `flatpak-builder`, using
# net.freqhole.freqhole.yml (which builds libmpv from source - see that
# file's own comments for why).
#
# replaces an earlier version of this script that called `flatpak
# build-init`/`build-finish`/`build-export` directly (to avoid
# flatpak-builder's sandbox requirements) and bundled a prebuilt system
# `mpv-libs` package's full `ldd` dependency closure by hand. abandoned
# 2026-09-29 after that approach caused a runtime crash (`libsecret-1.so.0:
# undefined symbol: g_variant_builder_init_static`) from duplicating
# libraries (glib among them) that org.gnome.Platform already provides -
# see docs/libmpv-experimental-player-plan.md for the full story.
#
# usage: ./build-flatpak.sh <input.deb> <output.flatpak> [arch]
# arch: x86_64 (default) or aarch64
#
# note: this compiles mpv + ffmpeg + libass (+ their own small dependency
# set) from source on first run - expect a genuinely long build (tens of
# minutes), not the near-instant "just repackage a prebuilt .deb" this
# used to be. flatpak-builder caches per-module results in
# .flatpak-builder/ (left inside the container, so it only helps within a
# single `docker run`) - see this repo's Makefile for how the container
# itself gets rebuilt/reused across invocations.

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
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR=$(mktemp -d)

cleanup() {
    rm -f "$SCRIPT_DIR/freqhole.deb"
    # flatpak-builder's rofiles-fuse cache mount can still be briefly busy
    # right after it exits ("Device or resource busy") - don't let that
    # turn an otherwise-successful build into a reported failure. this
    # whole dir is thrown away regardless once the (--rm) container exits.
    rm -rf "$WORK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

# the manifest's `freqhole` module references `path: freqhole.deb`,
# resolved relative to the manifest's own directory - stage the real
# .deb there under that exact name (cleaned up on exit via the trap
# above, so this doesn't leave a stray file around).
cp "$DEB_FILE" "$SCRIPT_DIR/freqhole.deb"

echo "building flatpak via flatpak-builder (compiles mpv+ffmpeg+libass from source - this takes a while, especially the first time)..."
# --state-dir: flatpak-builder defaults this to .flatpak-builder relative
# to the CWD, not the (already-safe) $WORK_DIR/build below - pin it
# explicitly so it can never accidentally land under a reserved path
# like /app again (see Dockerfile.flatpak's WORKDIR comment).
flatpak-builder \
    --arch="$ARCH" \
    --state-dir="$WORK_DIR/state" \
    --repo="$WORK_DIR/repo" \
    --force-clean \
    "$WORK_DIR/build" \
    "$SCRIPT_DIR/net.freqhole.freqhole.yml"

echo "creating bundle..."
flatpak build-bundle --arch="$ARCH" "$WORK_DIR/repo" "$OUTPUT_FLATPAK" "$APP_ID"

echo "done: $OUTPUT_FLATPAK"
