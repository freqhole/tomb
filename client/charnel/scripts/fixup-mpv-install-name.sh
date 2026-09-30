#!/usr/bin/env bash
# rewrites charnel's compiled binary so it looks for libmpv.2.dylib in
# Contents/Frameworks (where tauri's `bundle.macOS.frameworks` config
# copies it) instead of libmpv.2.dylib's own baked-in install name
# (@loader_path/libmpv.2.dylib, meaning "next to whatever loads me" - which
# for our binary living in Contents/MacOS would otherwise mean
# Contents/MacOS, not Contents/Frameworks).
#
# run as tauri's `build.beforeBundleCommand` hook - fires after `cargo
# build` produces the binary but before tauri-bundler copies it (and the
# frameworks) into the .app, so the fixed-up load command is what actually
# ships. libmpv.2.dylib's own references to its 2 sibling dylibs
# (libgraphite2/libvulkan) need no fixup: those stay @loader_path-relative,
# and all three end up in the same Contents/Frameworks directory together.
set -euo pipefail

TARGET_TRIPLE="${TAURI_ENV_TARGET_TRIPLE:?TAURI_ENV_TARGET_TRIPLE not set - run this via the beforeBundleCommand hook}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BINARY="$REPO_ROOT/target/$TARGET_TRIPLE/release/charnel"

if [ ! -f "$BINARY" ]; then
  echo "fixup-mpv-install-name: no binary at $BINARY, skipping" >&2
  exit 0
fi

install_name_tool -change \
  "@loader_path/libmpv.2.dylib" \
  "@executable_path/../Frameworks/libmpv.2.dylib" \
  "$BINARY"

echo "fixup-mpv-install-name: rewrote libmpv.2.dylib reference in $BINARY"
