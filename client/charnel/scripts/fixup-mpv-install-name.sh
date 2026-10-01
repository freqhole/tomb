#!/usr/bin/env bash
# rewrites charnel's compiled binary's libmpv.2.dylib reference to wherever
# it needs to be found AT RUNTIME - which differs per architecture:
#
#   - arm64: bundled, hard-linked. rewritten to Contents/Frameworks (where
#     tauri's `bundle.macOS.frameworks` config copies it, via
#     scripts/fetch-mpv-runtime.sh's dylibbundler-based homebrew bundling).
#   - x86_64: NOT bundled, weakly linked (see .cargo/config.toml's
#     `-weak-lmpv`) - there's no working portable/bundleable mpv build for
#     this architecture (homebrew dropped its x86_64 bottle; the
#     alternative, mpv-libre-runtime, turned out to have a broken macOS
#     GPU renderer - confirmed 2026-09-30). rewritten to an absolute
#     /usr/local/lib path instead, matching where a user's own separately-
#     installed mpv would realistically live - `grimoire::player::libmpv::
#     is_libmpv_available()` checks for this at runtime before ever
#     touching libmpv2, so charnel boots and runs fine either way.
#
# whatever the target, the binary's CURRENT reference isn't a fixed
# string to hardcode - it depends entirely on whatever -L search path /
# dylib satisfied the linker at build time (see .cargo/config.toml +
# scripts/fetch-mpv-runtime.sh), which has changed more than once this
# project's history. so: read the binary's OWN current reference via
# otool instead of assuming it - confirmed necessary for real 2026-09-30
# when switching arm64 from mpv-libre-runtime to homebrew silently broke
# a hardcoded old value here.
#
# run as tauri's `build.beforeBundleCommand` hook - fires after `cargo
# build` produces the binary but before tauri-bundler copies it (and, for
# arm64, the frameworks) into the .app, so the fixed-up load command is
# what actually ships. libmpv.2.dylib's own references to its sibling
# dylibs need no fixup: those stay @loader_path-relative, and (for arm64)
# every dylib ends up in the same Contents/Frameworks directory together.
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

case "$TARGET_TRIPLE" in
  x86_64-apple-darwin)
    NEW_REF="/usr/local/lib/libmpv.2.dylib"
    ;;
  *)
    NEW_REF="@executable_path/../Frameworks/libmpv.2.dylib"
    ;;
esac

install_name_tool -change \
  "$CURRENT_REF" \
  "$NEW_REF" \
  "$BINARY"

echo "fixup-mpv-install-name: rewrote libmpv.2.dylib reference ($CURRENT_REF -> $NEW_REF) in $BINARY"

