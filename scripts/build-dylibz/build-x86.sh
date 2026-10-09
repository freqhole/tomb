#!/usr/bin/env bash
# builds a flat, fully self-contained directory of mpv+ffmpeg dylibs on a
# real, native Intel Mac - no rosetta, no `arch -x86_64` wrapping, no
# Xcode/SDK/swiftc pinning (see this script's own "why no pinning" note
# below), and NO dependency on the rest of this (or any) repo: this file
# is meant to be copied alone onto a bare Intel Mac with nothing else
# checked out, and just run.
#
# deliberately knows nothing about charnel, tauri.macos.conf.json, or
# mpv-runtime/committed/ - it just produces a plain directory of
# dylibs (+ MoltenVK_icd.json, ffmpeg, ffprobe) ready to be copied
# wherever they're needed. scripts/build-dylibz/charnel-mpv-runtime.sh's
# `integrate_prebuilt_dylib_dir` function (run separately, on a machine
# that DOES have this repo checked out) folds that directory into the
# real charnel app + commits the refreshed mpv-runtime/committed/x86_64
# snapshot - copy/scp/airdrop the output directory over there and run
# that once this script finishes.
#
# why no Xcode/SDK *pinning* (a full Xcode install is still required,
# see below - this is specifically about not forcing one particular
# version/DEVELOPER_DIR/SDKROOT the way build-x86-on-arm64.sh does):
# that dance (see scripts/build-dylibz/x86-formula-patches.sh) exists
# solely because a build machine's system-default Xcode can be newer
# than charnel's actual macOS-12.0 minimum, emitting Swift runtime
# symbols that don't exist on an old target. a real Intel Mac that
# itself tops out at an old macOS release (Xcode has its own
# macOS-version floor; a Mac stuck on macOS 12.4 physically cannot
# install anything past Xcode 13.x) already has a system Xcode old
# enough that none of that applies - this script just installs/selects
# whatever full Xcode you've got/can still get, no further overrides.
# if your actual Intel Mac has since been updated to a newer macOS (and
# so could have a modern/default Xcode), you'd hit the same newer-
# Xcode-emits-newer-symbols problem this script doesn't guard against -
# use build-x86-on-arm64.sh's pinning approach instead in that case.
#
# usage: build-x86.sh [output-dir]
#   output-dir: where to write the bundled dylib directory (default:
#   ./mpv-dylibs-x86_64 in the current directory). safe to re-run - mpv
#   itself is only (re)installed if missing, but the bundling step
#   always reruns (fast, no network/compile needed) so this also works
#   as a cheap "refresh output-dir to match whatever's currently
#   installed" after e.g. a `brew upgrade mpv`.
set -euo pipefail

if [ "$(uname -m)" != "x86_64" ]; then
  echo "build-x86.sh: this machine reports '$(uname -m)', not x86_64 - run scripts/build-dylibz/build-x86-on-arm64.sh instead if you're cross-building from an arm64 Mac." >&2
  exit 1
fi

DEST="${1:-$(pwd)/mpv-dylibs-x86_64}"

# ---- stock machine bootstrap: a full Xcode install, then homebrew ----
# CLT alone isn't enough - mpv's dependency closure needs a real
# Xcode.app (deno, a transitive dep via yt-dlp, and molten-vk both
# refuse to build without it). no specific version is pinned here (see
# this file's own header comment) - whatever you've got/can still
# install on this macOS version is fine, this just makes sure SOME full
# Xcode is present and selected.
XCODE_APP="/Applications/Xcode.app"
if ! [ -d "$XCODE_APP" ]; then
  xip_path=$(find "$HOME/Downloads" -maxdepth 1 -iname 'Xcode*.xip' -print -quit 2>/dev/null || true)
  if [ -z "$xip_path" ]; then
    echo "build-x86.sh: $XCODE_APP not found, and no Xcode*.xip in ~/Downloads." >&2
    echo "download a version compatible with this macOS release from https://developer.apple.com/download/all/, save it to ~/Downloads, and re-run this script." >&2
    exit 1
  fi
  echo "build-x86.sh: extracting $xip_path (this takes a while, it's a multi-GB archive)..."
  extract_dir=$(mktemp -d)
  (cd "$extract_dir" && xip --expand "$xip_path")
  extracted_app=$(find "$extract_dir" -maxdepth 1 -iname 'Xcode*.app' -print -quit)
  if [ -z "$extracted_app" ]; then
    echo "build-x86.sh: xip --expand didn't produce an Xcode.app in $extract_dir" >&2
    exit 1
  fi
  echo "build-x86.sh: moving extracted app to $XCODE_APP..."
  mv "$extracted_app" "$XCODE_APP"
  rm -rf "$extract_dir"
fi

if [ "$(xcode-select -p 2>/dev/null)" != "$XCODE_APP/Contents/Developer" ]; then
  echo "build-x86.sh: selecting $XCODE_APP as the active developer directory (enter your password if prompted)..."
  sudo xcode-select -s "$XCODE_APP"
fi

if ! xcodebuild -license check >/dev/null 2>&1; then
  echo "build-x86.sh: accepting Xcode's license (enter your password if prompted)..."
  sudo xcodebuild -license accept
fi

# -runFirstLaunch has no built-in "already done" check to query (unlike
# -license check above) - track it ourselves so reruns don't re-prompt
# for a password for something that's already finished.
FIRSTLAUNCH_MARKER="$HOME/.build-x86-xcode-firstlaunch-done"
if ! [ -f "$FIRSTLAUNCH_MARKER" ]; then
  echo "build-x86.sh: running Xcode's first-launch setup (installs additional components if needed, enter your password if prompted)..."
  sudo xcodebuild -runFirstLaunch
  touch "$FIRSTLAUNCH_MARKER"
fi

# homebrew's official installer now hard-refuses to even run on Intel
# ("Homebrew on macOS is only supported on Apple Silicon processors!",
# confirmed real 2026-10-08), and the standard Intel prefix itself,
# /usr/local, turned out to be a SIP-protected firmlink mount point on
# this machine (confirmed real 2026-10-08: `chown` on it fails with
# "Operation not permitted" even via sudo, `ls -lanO /usr/local` showing
# the `sunlnk` flag) - fighting SIP for this is the wrong move. bootstrap
# directly from the raw brew tarball into a plain, non-protected
# directory instead (the same trick build-x86-on-arm64.sh already uses
# for its own relocatable x86_64 prefix) - /Users/Shared is
# world-writable on every Mac, no sudo needed at all.
BREW_PREFIX="/Users/Shared/freqhole-homebrew-x86"
if ! [ -x "$BREW_PREFIX/bin/brew" ]; then
  echo "build-x86.sh: bootstrapping homebrew at $BREW_PREFIX (official installer + /usr/local both refuse to cooperate on this machine, see comment above)..."
  mkdir -p "$BREW_PREFIX"
  curl -fsSL https://github.com/Homebrew/brew/tarball/main \
    | tar xz --strip-components 1 -C "$BREW_PREFIX"
fi
export PATH="$BREW_PREFIX/bin:$PATH"

# per-formula patch catalog: drop a <formula-name>.py next to this
# script (scripts/build-dylibz/patches/) that takes a formula.rb path as
# its only arg and edits it in place, exiting non-zero (without writing
# anything) if it can't find what it's looking for - e.g.
# patches/jpeg-turbo.py, which forces a crashy parallel ctest run
# serial instead. applied automatically for anything not already
# installed, with no other build-x86.sh changes needed for the next
# formula that needs one. tolerates a missing patches/ dir entirely
# (e.g. if this script really was copied completely standalone) and
# falls back to a plain, unpatched install if a patch script itself
# fails to apply - a patch is a known workaround for a known problem,
# not something that should hard-block the whole build if it ever goes
# stale.
PATCHES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/patches" 2>/dev/null && pwd || true)"
if [ -n "$PATCHES_DIR" ] && [ -d "$PATCHES_DIR" ] && [ -n "$(ls -A "$PATCHES_DIR"/*.py 2>/dev/null)" ]; then
  # modern homebrew resolves formulas through a remote JSON API by
  # default and keeps no local formula .rb files at all - fine for
  # installing, but `brew cat <formula>` (needed below to seed a
  # patchable copy) literally cats the on-disk formula file, so it
  # silently prints nothing (exit 0, zero bytes) without a real local
  # homebrew/core clone (confirmed real 2026-10-08). `brew tap
  # homebrew/core` alone also no-ops ("no longer typically necessary") -
  # `--force` is required to actually get the clone.
  if ! [ -d "$BREW_PREFIX/Library/Taps/homebrew/homebrew-core" ]; then
    echo "build-x86.sh: force-tapping homebrew/core locally (brew cat needs a real formula file on disk, not just the API)..."
    brew tap homebrew/core --force
  fi
  for patch_file in "$PATCHES_DIR"/*.py; do
    [ -f "$patch_file" ] || continue
    formula_name="$(basename "$patch_file" .py)"
    if brew list "$formula_name" >/dev/null 2>&1; then
      continue
    fi
    echo "build-x86.sh: applying $patch_file to $formula_name before installing it..."
    LOCAL_TAP_DIR="$BREW_PREFIX/Library/Taps/freqhole-local/homebrew-mpv-patched"
    if ! [ -d "$LOCAL_TAP_DIR" ]; then
      brew tap-new freqhole-local/mpv-patched
    fi
    brew cat "$formula_name" > "$LOCAL_TAP_DIR/Formula/$formula_name.rb"
    if python3 "$patch_file" "$LOCAL_TAP_DIR/Formula/$formula_name.rb"; then
      # --keep-tmp: a failed build's sandbox dir (under $TMPDIR, printed
      # in the failure output) survives instead of being deleted, so a
      # multi-hour compile that fails near the end can be resumed with a
      # plain `ninja`/`meson compile -C build` directly in that preserved
      # directory - reusing everything already compiled - instead of
      # starting the whole `brew install` over from scratch.
      brew install --no-ask --keep-tmp --build-from-source "freqhole-local/mpv-patched/$formula_name"
    else
      echo "build-x86.sh: $patch_file failed to apply - falling back to a plain, unpatched install of $formula_name (may hit the same problem the patch exists to avoid)" >&2
      rm -f "$LOCAL_TAP_DIR/Formula/$formula_name.rb"
      brew install --no-ask "$formula_name"
    fi
  done
fi

if ! [ -f "$BREW_PREFIX/opt/mpv/lib/libmpv.2.dylib" ]; then
  echo "build-x86.sh: installing mpv via homebrew (from source - homebrew no longer ships Intel macOS bottles; this can take a while the first run, cached after)..."
  brew install --no-ask mpv
fi

if ! command -v dylibbundler >/dev/null 2>&1; then
  echo "build-x86.sh: installing dylibbundler via homebrew..."
  brew install --no-ask dylibbundler
fi

# ---- MoltenVK: built directly from its own source, NOT via homebrew ----
# homebrew's current molten-vk formula (1.4.2) requires Xcode 15.0.1+ to
# compile (confirmed real 2026-10-09: several unguarded newer-SDK Metal
# enum references - MTLLanguageVersion3_0/3_1, MTLTextureUsageShaderAtomic,
# MTLVertexFormatFloatRG11B10/RGB9E5 - fail to compile against Xcode
# 13.4.1's MacOSX12.3.sdk, across multiple source files). v1.2.11 (the
# last release before upstream moved that floor forward) was confirmed to
# still properly guard every one of those same symbols behind Xcode-13-
# and-earlier-compatible checks, so it's built directly here instead of
# via homebrew's (unbuildable-on-this-toolchain) formula - mpv itself
# never needs this at build time anyway (patches/mpv.py already drops its
# `depends_on "molten-vk"` for the same reason vapoursynth/yt-dlp are
# dropped: the vulkan loader finds libMoltenVK.dylib purely at runtime,
# via its own ICD-manifest discovery, never a build-time link).
MOLTENVK_VERSION="1.2.11"
MOLTENVK_SRC_DIR="/Users/Shared/freqhole-moltenvk-x86/MoltenVK-$MOLTENVK_VERSION"
MOLTENVK_DYLIB="$MOLTENVK_SRC_DIR/Package/Release/MoltenVK/dylib/macOS/libMoltenVK.dylib"
MOLTENVK_ICD_JSON="$MOLTENVK_SRC_DIR/MoltenVK/icd/MoltenVK_icd.json"

if ! command -v cmake >/dev/null 2>&1; then
  echo "build-x86.sh: installing cmake via homebrew (needed by MoltenVK's own fetchDependencies/build)..."
  brew install --no-ask cmake
fi

if ! [ -f "$MOLTENVK_DYLIB" ]; then
  echo "build-x86.sh: building MoltenVK v$MOLTENVK_VERSION directly from source (this runs its own fetchDependencies - cereal/glslang/SPIRV-Cross/Vulkan-Headers/Vulkan-Tools/Volk at the exact revisions v$MOLTENVK_VERSION itself pins - then compiles everything; takes a while the first run, cached after)..."
  if ! [ -d "$MOLTENVK_SRC_DIR" ]; then
    mkdir -p "$(dirname "$MOLTENVK_SRC_DIR")"
    git clone --branch "v$MOLTENVK_VERSION" --depth 1 https://github.com/KhronosGroup/MoltenVK.git "$MOLTENVK_SRC_DIR"
  fi
  (cd "$MOLTENVK_SRC_DIR" && ./fetchDependencies --macos && make macos)
fi

# ---- bundle the dylib closure into a flat, portable directory ----
echo "build-x86.sh: bundling into $DEST..."
rm -rf "$DEST"
mkdir -p "$DEST"
cp "$BREW_PREFIX/opt/mpv/lib/libmpv.2.dylib" "$DEST/"
chmod u+w "$DEST"/*.dylib

# flat directory + uniform @loader_path/ for every rewrite - see
# scripts/build-dylibz/charnel-mpv-runtime.sh's bundle_mpv_dylib_closure
# for the full rationale (identical logic, just writing into a
# standalone $DEST here instead of charnel's own bundle dir).
(cd "$DEST" && dylibbundler -b -of -cd -x libmpv.2.dylib -d . -p "@loader_path/" </dev/null)

for f in "$DEST"/*.dylib; do
    count=$(otool -l "$f" | grep -c "path @loader_path/ (offset" || true)
    if [ "$count" -gt 1 ]; then
        install_name_tool -delete_rpath "@loader_path/" "$f"
    fi
done

install_name_tool -id "@loader_path/libmpv.2.dylib" "$DEST/libmpv.2.dylib"
codesign --force --sign - "$DEST"/*.dylib

# MoltenVK (the vulkan ICD/driver) isn't a static dependency of
# libmpv.2.dylib - the vulkan loader finds it at runtime via its own ICD-
# manifest discovery, not a normal dlopen, so dylibbundler never bundles
# it even though libvulkan.1.dylib (the loader itself) does get swept
# up. same library_path rewrite charnel-mpv-runtime.sh does (3 levels
# up from wherever this manifest ends up relative to the dylib it
# names, consistent with how charnel's own integration step lays things
# out under Contents/Resources + Contents/Frameworks) - the integration
# step on the charnel side is what actually relies on this exact path,
# so it stays in lockstep with bundle_mpv_dylib_closure even though this
# script itself doesn't know what directory layout it'll end up in.
if [ -f "$MOLTENVK_DYLIB" ]; then
    cp "$MOLTENVK_DYLIB" "$DEST/"
    chmod u+w "$DEST/libMoltenVK.dylib"
    install_name_tool -id "@loader_path/libMoltenVK.dylib" "$DEST/libMoltenVK.dylib"
    codesign --force --sign - "$DEST/libMoltenVK.dylib"

    python3 - "$MOLTENVK_ICD_JSON" "$DEST/MoltenVK_icd.json" <<'PYEOF'
import json
import sys

src, dest = sys.argv[1], sys.argv[2]
with open(src) as f:
    manifest = json.load(f)
manifest["ICD"]["library_path"] = "../../../Frameworks/libMoltenVK.dylib"
with open(dest, "w") as f:
    json.dump(manifest, f, indent=4)
    f.write("\n")
PYEOF
else
    echo "build-x86.sh: warning - molten-vk not found, bundled app's vulkan video output will not work" >&2
fi

# ffmpeg/ffprobe, reusing this same dylib closure - see
# bundle_mpv_dylib_closure's own comment for why this is safe (ABI-
# compatible SONAMEs, confirmed zero duplicate dylibs).
ffmpeg_prefix=$(brew --prefix ffmpeg 2>/dev/null || true)
if [ -n "$ffmpeg_prefix" ] && [ -f "$ffmpeg_prefix/bin/ffmpeg" ] && [ -f "$ffmpeg_prefix/bin/ffprobe" ]; then
    cp "$ffmpeg_prefix/bin/ffmpeg" "$ffmpeg_prefix/bin/ffprobe" "$DEST/"
    chmod u+w "$DEST/ffmpeg" "$DEST/ffprobe"
    for bin in ffmpeg ffprobe; do
        f="$DEST/$bin"
        while IFS= read -r dep; do
            case "$dep" in
                /usr/lib/*|/System/*) continue ;;
            esac
            real_dep=$(python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "$dep" 2>/dev/null || echo "$dep")
            dep_name=$(basename "$real_dep")
            if [ -f "$DEST/$dep_name" ]; then
                install_name_tool -change "$dep" "@executable_path/../../../Frameworks/$dep_name" "$f"
            else
                echo "build-x86.sh: warning - $bin depends on $dep, not found in $DEST (left as-is)" >&2
            fi
        done < <(otool -L "$f" | tail -n +2 | awk '{print $1}')
        codesign --force --sign - "$f"
    done
else
    echo "build-x86.sh: warning - ffmpeg not found, bundled app will fall back to the user's own ffmpeg/ffprobe install" >&2
fi

count=$(find "$DEST" -name '*.dylib' | wc -l | tr -d ' ')
echo "build-x86.sh: done - $count dylibs in $DEST"
echo "build-x86.sh: copy $DEST to a machine with this repo checked out and run:"
echo "  source scripts/build-dylibz/charnel-mpv-runtime.sh && integrate_prebuilt_dylib_dir $DEST false"
