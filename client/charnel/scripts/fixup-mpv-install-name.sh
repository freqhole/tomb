#!/usr/bin/env bash
# rewrites charnel's compiled binary so it looks for libmpv.2.dylib in
# Contents/Frameworks (where tauri's `bundle.macOS.frameworks` config
# copies it) instead of wherever libmpv2-sys's bare `-lmpv` happened to
# resolve it at link time.
#
# that "wherever" isn't a single fixed string: it depends entirely on
# whatever -L search path / dylib satisfied the linker for the arch being
# built (see .cargo/config.toml + scripts/fetch-mpv-runtime.sh) - arm64
# currently links against homebrew's REAL mpv, whose own install name is
# an absolute path (/opt/homebrew/opt/mpv/lib/libmpv.2.dylib), while
# x86_64 links against the portable mpv-libre-runtime build, whose own
# install name is already @loader_path-relative. hardcoding one specific
# old value here silently no-ops (and ships a broken binary) the moment
# either side changes - confirmed for real 2026-09-30 when switching arm64
# from mpv-libre-runtime to homebrew did exactly that. so: read the
# binary's OWN current reference via otool instead of assuming it.
#
# run as tauri's `build.beforeBundleCommand` hook - fires after `cargo
# build` produces the binary but before tauri-bundler copies it (and the
# frameworks) into the .app, so the fixed-up load command is what actually
# ships. libmpv.2.dylib's own references to its sibling dylibs need no
# fixup: those stay @loader_path-relative, and every dylib ends up in the
# same Contents/Frameworks directory together.
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

install_name_tool -change \
  "$CURRENT_REF" \
  "@executable_path/../Frameworks/libmpv.2.dylib" \
  "$BINARY"

echo "fixup-mpv-install-name: rewrote libmpv.2.dylib reference ($CURRENT_REF -> @executable_path/../Frameworks/libmpv.2.dylib) in $BINARY"

