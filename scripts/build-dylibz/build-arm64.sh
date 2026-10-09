#!/usr/bin/env bash
# stages libmpv for macOS arm64, bundled + hard-linked + fully
# self-contained - end users never need homebrew (or anything else)
# installed to run charnel.
#
# bundles homebrew's REAL mpv build (`brew install mpv` against the
# system /opt/homebrew prefix) into
# client/charnel/src-tauri/mpv-runtime/lib (referenced by
# tauri.macos.conf.json's `bundle.macOS.frameworks`, regenerated every
# run since the exact dependency filenames drift with homebrew's own
# package versions).
#
# the bundled dylib closure gets committed to git under
# mpv-runtime/committed/arm64 once built (see stage_from_committed in
# common.sh) - CI and fresh local checkouts reuse that committed
# snapshot by default instead of redoing the homebrew build every run.
#
# see scripts/build-dylibz/build-x86-on-arm64.sh for cross-compiling the
# x86_64 dylibs from this same (arm64) machine via rosetta, and
# scripts/build-dylibz/build-x86.sh for building them natively on a real
# Intel Mac instead.
#
# usage: scripts/build-dylibz/build-arm64.sh [--rebuild]
#
# by default, if client/charnel/src-tauri/mpv-runtime/committed/arm64
# already has a bundled dylib closure checked into git, this just copies
# it into place (seconds, no homebrew/network/compiler needed at all) -
# pass --rebuild to force redoing the real homebrew fetch+build+bundle
# below and refresh that committed snapshot (e.g. to pick up a newer mpv
# release).
set -euo pipefail

ARCH="arm64"
REBUILD="${1:-}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUNDLE_DEST="$REPO_ROOT/client/charnel/src-tauri/mpv-runtime/lib"
COMMITTED_DIR="$REPO_ROOT/client/charnel/src-tauri/mpv-runtime/committed/$ARCH"
CONF_PATH="$REPO_ROOT/client/charnel/src-tauri/tauri.macos.conf.json"

# shellcheck source=scripts/build-dylibz/charnel-mpv-runtime.sh
source "$REPO_ROOT/scripts/build-dylibz/charnel-mpv-runtime.sh"

if [ -d "$COMMITTED_DIR" ] && [ "$REBUILD" != "--rebuild" ]; then
  # /Users/Shared (world-writable, no sudo needed, not per-user like
  # $HOME - same reasoning as x86_64's stub dir) matches a second
  # `.cargo/config.toml` rustflags `-L` entry for this target - a clean
  # CI runner never runs `brew install mpv` on this fast path, so
  # without this, rathole's `-lmpv` has nothing to resolve against
  # (confirmed for real 2026-10-02: `make build-mac-arm` failed in CI
  # with "library 'mpv' not found" despite charnel's own bundling
  # succeeding, since charnel only needs the dylib *copied* into its app
  # bundle, never linked against at compile time). /usr/local/lib (this
  # target's other `-L` entry) would also work on CI's runner but needs
  # sudo on a normal dev mac, so this dedicated path is used instead -
  # safe to pass unconditionally either way.
  stage_from_committed false "/Users/Shared/freqhole-mpv-arm64/lib"
  exit 0
fi

if ! [ -f /opt/homebrew/opt/mpv/lib/libmpv.2.dylib ]; then
  echo "build-dylibz: installing mpv via homebrew..."
  brew install mpv
fi
bundle_mpv_dylib_closure /opt/homebrew/opt/mpv/lib/libmpv.2.dylib false brew
