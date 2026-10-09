#!/usr/bin/env bash
# cross-builds the x86_64 mpv/ffmpeg dylib closure FROM an arm64 Mac, via
# rosetta - bootstraps a dedicated, relocatable x86_64 homebrew prefix at
# /Users/Shared/freqhole-homebrew-x86 (homebrew refuses to run from /tmp)
# rather than touching the system /opt/homebrew, and runs every brew
# command under `arch -x86_64`.
#
# homebrew dropped bottle (prebuilt binary) support for Intel macOS
# entirely as of ~September 2026 (`brew install mpv` now prints an
# explicit "we do not provide support for this platform" warning) - but
# building from source still works fine (requires a full Xcode.app
# install, not just the Command Line Tools - `deno`, a transitive
# dependency via yt-dlp, and `molten-vk` both refuse to build without
# it). it's ~86 formulas deep (ffmpeg, libplacebo, llvm, rust, ... - a
# multi-hour build the first time).
#
# see scripts/build-dylibz/build-x86.sh instead if you're running this
# natively on a real Intel Mac (no rosetta/relocatable-prefix dance
# needed there - see that script's own doc comment for why it exists as
# a separate thing).
#
# both architectures' bundled dylib closures get committed to git under
# mpv-runtime/committed/<arch> once built (see stage_from_committed in
# common.sh) - CI and fresh local checkouts reuse that committed
# snapshot by default instead of redoing the slow homebrew build every
# single run.
#
# history: this used to be a from-scratch weak-linking setup for x86_64
# (optional libmpv, never bundled) after both the prebuilt
# `mpv-libre-runtime` project AND homebrew's arm64 mpv build appeared to
# have a broken Vulkan-only GPU renderer on macOS (`vid=no`/`current-vo`
# unavailable, `VK_ERROR_INCOMPATIBLE_DRIVER` even with a real MoltenVK
# ICD explicitly supplied). confirmed for real later (2026-09-30) that
# this was never actually a broken renderer at all - it was macOS
# hardened runtime's Library Validation blocking `dlopen` of the
# ad-hoc-signed MoltenVK dylib the vulkan loader needs at runtime (fixed
# via `com.apple.security.cs.disable-library-validation` in
# client/charnel/src-tauri/macos/entitlements.plist). once that was
# understood, bundling homebrew's real mpv (arm64) and building mpv from
# source (x86_64) both just worked.
#
# this file used to be scripts/fetch-mpv-runtime.sh's x86_64 branch -
# split out (along with build-arm64.sh/build-x86.sh/common.sh/
# x86-formula-patches.sh) once that one script covering every
# arch+host combination had gotten too unwieldy to work with.
#
# usage: scripts/build-dylibz/build-x86-on-arm64.sh [--rebuild] [--force]
#
# by default, if client/charnel/src-tauri/mpv-runtime/committed/x86_64
# already has a bundled dylib closure checked into git, this just copies
# it into place (seconds, no homebrew/network/compiler needed at all) -
# pass --rebuild to force redoing the real homebrew fetch+build+bundle
# below and refresh that committed snapshot (e.g. to pick up a newer mpv
# release). --rebuild alone only forces ffmpeg+mpv themselves to
# reinstall - already-installed dependencies (x265, libplacebo, etc.)
# are left alone and reused as-is, so a run that fails partway through
# (e.g. one unrelated formula's build breaking) can just be rerun to
# pick up where it left off instead of redoing everything. pass --force
# too on the rare occasion something needs EVERY dependency recompiled
# from scratch (e.g. a change to the global cc/ld shim patch, which only
# affects formulae that actually get recompiled under it) - wipes every
# formula currently installed in the dedicated x86_64 prefix first.
set -euo pipefail

ARCH="x86_64"
REBUILD="${1:-}"
FORCE="${2:-}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUNDLE_DEST="$REPO_ROOT/client/charnel/src-tauri/mpv-runtime/lib"
COMMITTED_DIR="$REPO_ROOT/client/charnel/src-tauri/mpv-runtime/committed/$ARCH"
CONF_PATH="$REPO_ROOT/client/charnel/src-tauri/tauri.macos.conf.json"

# shellcheck source=scripts/build-dylibz/charnel-mpv-runtime.sh
source "$REPO_ROOT/scripts/build-dylibz/charnel-mpv-runtime.sh"
# shellcheck source=scripts/build-dylibz/x86-formula-patches.sh
source "$REPO_ROOT/scripts/build-dylibz/x86-formula-patches.sh"

if [ -d "$COMMITTED_DIR" ] && [ "$REBUILD" != "--rebuild" ]; then
  # same fixed path .cargo/config.toml's x86_64 rustflags point `-L`
  # at - stage_from_committed drops libmpv.2.dylib there too so
  # `cargo build --target x86_64-apple-darwin`'s `-lmpv` resolves
  # without needing homebrew (or any build) at all.
  #
  # `need_min_version` is false - mpv is weakly linked, so a
  # missing/incompatible bundled copy on an old macOS no longer needs
  # the APP ITSELF to refuse to launch; it just means
  # `is_libmpv_available()`'s dlsym check comes back false there and
  # the fallback player is used instead.
  stage_from_committed false "/Users/Shared/freqhole-homebrew-x86/opt/mpv/lib"
  exit 0
fi

# homebrew refuses to run from a prefix inside its own temp directory
# (anything under /tmp) - this is a real, persistent, relocatable
# install (not a throwaway), so /Users/Shared (world-writable on every
# mac, no sudo needed, NOT per-user like $HOME) is the right home for
# it: a fixed, known-at-config-write-time path is required since
# .cargo/config.toml's rustflags are static strings with no shell/env
# expansion, and this same path needs to agree with the one baked in
# there. cacheable across CI runs (actions/cache keyed on this path
# avoids re-running the ~86-formula from-source build every single
# release) and persists across local dev sessions the same way
# build-arm64.sh's system /opt/homebrew already does.
BREW_PREFIX="/Users/Shared/freqhole-homebrew-x86"
if ! [ -x "$BREW_PREFIX/bin/brew" ]; then
  echo "build-dylibz: bootstrapping a relocatable x86_64 homebrew at $BREW_PREFIX..."
  mkdir -p "$BREW_PREFIX"
  curl -fsSL https://github.com/Homebrew/brew/tarball/main \
    | tar xz --strip-components 1 -C "$BREW_PREFIX"
fi

BREW_CMD="arch -x86_64 $BREW_PREFIX/bin/brew"
patch_and_build_mpv_for_x86 "$BREW_PREFIX" "$BREW_CMD"
