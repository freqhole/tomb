#!/usr/bin/env bash
# rewrites charnel's compiled binary's libmpv.2.dylib reference to
# Contents/Frameworks, where tauri's `bundle.macOS.frameworks` config
# copies it (via scripts/fetch-mpv-runtime.sh's dylibbundler-based
# homebrew bundling) - same for both arm64 and x86_64, both bundled +
# hard-linked identically.
#
# the binary's CURRENT reference isn't a fixed string to hardcode - it
# depends entirely on whatever -L search path / dylib satisfied the
# linker at build time (see .cargo/config.toml + scripts/fetch-mpv-
# runtime.sh), which has changed more than once this project's history.
# so: read the binary's OWN current reference via otool instead of
# assuming it - confirmed necessary for real 2026-09-30 when switching
# arm64 from mpv-libre-runtime to homebrew silently broke a hardcoded old
# value here.
#
# run as tauri's `build.beforeBundleCommand` hook - fires after `cargo
# build` produces the binary but before tauri-bundler copies it (and the
# frameworks) into the .app, so the fixed-up load command is what
# actually ships. libmpv.2.dylib's own references to its sibling dylibs
# need no fixup: those stay @loader_path-relative, and every dylib ends
# up in the same Contents/Frameworks directory together.
set -euo pipefail

TARGET_TRIPLE="${TAURI_ENV_TARGET_TRIPLE:?TAURI_ENV_TARGET_TRIPLE not set - run this via the beforeBundleCommand hook}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BINARY="$REPO_ROOT/target/$TARGET_TRIPLE/release/charnel"

if [ ! -f "$BINARY" ]; then
  echo "fixup-mpv-install-name: no binary at $BINARY, skipping" >&2
  exit 0
fi

CURRENT_REF="$(otool -L "$BINARY" | awk '/libmpv\.2\.dylib/ { print $1; exit }')"
if [ -z "$CURRENT_REF" ]; then
  echo "fixup-mpv-install-name: $BINARY doesn't reference libmpv.2.dylib at all, skipping" >&2
  exit 0
fi

NEW_REF="@executable_path/../Frameworks/libmpv.2.dylib"

install_name_tool -change \
  "$CURRENT_REF" \
  "$NEW_REF" \
  "$BINARY"

echo "fixup-mpv-install-name: rewrote libmpv.2.dylib reference ($CURRENT_REF -> $NEW_REF) in $BINARY"

# the bundled ffmpeg/ffprobe CLI binaries (see scripts/fetch-mpv-
# runtime.sh) land under tauri's `bundle.resources` (Contents/Resources/
# mpv-runtime/lib/), not `bundle.macOS.frameworks` - tauri-bundler only
# codesigns the main executable, the .app bundle itself, and explicit
# `frameworks` entries, never arbitrary files under `resources` (confirmed
# for real 2026-10-03: notarization rejected these two specifically, with
# "not signed with a valid Developer ID certificate" / "no secure
# timestamp" / "hardened runtime not enabled" - the exact three things a
# real `codesign --options runtime --timestamp` call fixes). sign them
# here, at their STAGED location, before tauri-bundler copies them into
# the .app - a plain file copy preserves a Mach-O binary's embedded
# signature byte-for-byte, and tauri's own later signing pass never
# touches loose resource files, so this survives into the final bundle.
#
# skipped entirely for unsigned local dev builds: the Makefile sets
# APPLE_SIGNING_IDENTITY=- (codesign's ad-hoc sentinel) when no real
# identity is configured, and ad-hoc signing can't get a secure
# timestamp anyway (no real cert to present to Apple's timestamp
# server) - harmless, since unsigned builds are never notarized.
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ] && [ "$APPLE_SIGNING_IDENTITY" != "-" ]; then
  MPV_LIB_DIR="$REPO_ROOT/client/charnel/src-tauri/mpv-runtime/lib"
  for bin in ffmpeg ffprobe; do
    if [ -f "$MPV_LIB_DIR/$bin" ]; then
      codesign --force --options runtime --timestamp --sign "$APPLE_SIGNING_IDENTITY" "$MPV_LIB_DIR/$bin"
      echo "fixup-mpv-install-name: codesigned bundled $bin at $MPV_LIB_DIR/$bin"
    fi
  done
fi

