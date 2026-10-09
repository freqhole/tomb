#!/usr/bin/env bash
# shared helpers for scripts/build-dylibz/build-{arm64,x86-on-arm64,x86}.sh -
# sourced, not run directly. expects REPO_ROOT, BUNDLE_DEST, COMMITTED_DIR,
# CONF_PATH, and ARCH to already be set by the sourcing script.

# regenerates tauri.macos.conf.json to reference every dylib currently in
# $BUNDLE_DEST - shared by both the committed-snapshot fast path and the
# real bundle_mpv_dylib_closure slow path below.
#
# $1: "true" to also set bundle.macOS.minimumSystemVersion to 14.0 (x86_64
#     only - arm64's rustc default of 11.0 is already fine).
regen_tauri_conf() {
    local need_min_version="$1"
    python3 - "$BUNDLE_DEST" "$CONF_PATH" "$need_min_version" <<'PYEOF'
import json
import os
import sys

bundle_dest, conf_path, need_min_version = sys.argv[1], sys.argv[2], sys.argv[3]
entries = sorted(os.listdir(bundle_dest))
dylibs = [f for f in entries if f.endswith(".dylib")]
# tauri's `bundle.macOS.frameworks` requires actual dylibs/.frameworks -
# the MoltenVK ICD manifest (plain json) and the bundled ffmpeg/ffprobe
# CLI binaries (plain executables, no extension) are all read/exec'd at
# runtime rather than something macOS treats as a loadable framework, so
# they belong under `bundle.resources` instead (rejected with "Framework
# path should have .framework extension" otherwise).
resources = [f for f in entries if f.endswith(".json") or f in ("ffmpeg", "ffprobe")]
conf = {
    "build": {"beforeBundleCommand": "scripts/fixup-mpv-install-name.sh"},
    "bundle": {
        "macOS": {"frameworks": [f"mpv-runtime/lib/{f}" for f in dylibs]},
        "resources": [f"mpv-runtime/lib/{f}" for f in resources],
    },
}
if need_min_version == "true":
    conf["bundle"]["macOS"]["minimumSystemVersion"] = "14.0"
with open(conf_path, "w") as fh:
    json.dump(conf, fh, indent=2)
    fh.write("\n")
PYEOF
}

# copies the committed/<arch> snapshot into $BUNDLE_DEST - the fast path,
# used whenever that snapshot exists and --rebuild wasn't passed.
#
# $1: "true" to set bundle.macOS.minimumSystemVersion (see regen_tauri_conf).
# $2: optional - if set, also stage libmpv.2.dylib (+ unversioned symlink)
#     at this path, so `cargo build`'s `-lmpv` linker step (e.g. rathole,
#     which links libmpv directly rather than bundling it tauri-style)
#     has a real file to resolve against without needing a real `brew
#     install mpv` ever run on this machine - both arches use this (see
#     each branch below for the path): arm64's committed fast path never
#     installs homebrew's real mpv at all, so it needs this just as much
#     as x86_64 does.
stage_from_committed() {
    local need_min_version="$1"
    local linker_stub_dir="${2:-}"

    rm -rf "$BUNDLE_DEST"
    mkdir -p "$BUNDLE_DEST"
    cp "$COMMITTED_DIR"/*.dylib "$BUNDLE_DEST/"
    # MoltenVK's ICD manifest (see bundle_mpv_dylib_closure) - not every
    # committed/<arch> snapshot necessarily has one yet, so don't fail if
    # the glob matches nothing.
    cp "$COMMITTED_DIR"/*.json "$BUNDLE_DEST/" 2>/dev/null || true
    # bundled ffmpeg/ffprobe CLI binaries (see bundle_mpv_dylib_closure) -
    # same "not every snapshot has one yet" caveat as the json manifest.
    cp "$COMMITTED_DIR/ffmpeg" "$COMMITTED_DIR/ffprobe" "$BUNDLE_DEST/" 2>/dev/null || true
    # homebrew-built dylibs are mode 444 - tauri-bundler's xattr/codesign
    # steps need write access to touch them at all.
    chmod u+w "$BUNDLE_DEST"/*.dylib
    chmod u+w "$BUNDLE_DEST/ffmpeg" "$BUNDLE_DEST/ffprobe" 2>/dev/null || true
    regen_tauri_conf "$need_min_version"

    if [ -n "$linker_stub_dir" ]; then
        # this stub only exists so cargo's `-lmpv` has a real file to
        # resolve against on a machine with no real homebrew mpv install
        # at all (see this function's own doc comment above). if
        # $linker_stub_dir already resolves into a real Cellar keg (i.e.
        # homebrew's own `brew link` put a real symlink here from an
        # actual `brew install mpv`), NEVER write through it: doing so
        # permanently overwrites a pristine homebrew-built dylib with
        # whatever's in committed/$ARCH - which, if that snapshot is
        # stale (e.g. an interrupted previous run of this very script),
        # silently corrupts the real Cellar build too. confirmed real
        # 2026-10-06: an interrupted run left committed/x86_64 stale, and
        # the NEXT run's fast path clobbered a freshly-fixed real mpv
        # Cellar build with that stale snapshot via this exact
        # write-through, resurrecting an already-fixed bug. a plain
        # `mkdir -p` target (no real brew install present) is the only
        # case this stub is actually for.
        real_path="$(cd "$linker_stub_dir" 2>/dev/null && pwd -P || true)"
        if [ -f "$linker_stub_dir/libmpv.2.dylib" ] && [[ "$real_path" == *"/Cellar/"* ]]; then
            echo "build-dylibz: $linker_stub_dir resolves into a real homebrew Cellar keg - leaving its libmpv.2.dylib alone instead of overwriting with the committed/$ARCH snapshot"
        else
            mkdir -p "$linker_stub_dir"
            # homebrew-built dylibs are mode 444 (read-only) - `cp` propagates
            # that, and a stale copy from a previous run would then make a
            # plain `cp`/`ln -sf` here fail outright. `rm -f` only needs the
            # *directory* to be writable (not the target file itself), so
            # always clear these two files first rather than relying on them
            # not existing yet.
            rm -f "$linker_stub_dir/libmpv.2.dylib" "$linker_stub_dir/libmpv.dylib"
            cp -f "$COMMITTED_DIR/libmpv.2.dylib" "$linker_stub_dir/"
            chmod u+w "$linker_stub_dir/libmpv.2.dylib"
            ln -sf libmpv.2.dylib "$linker_stub_dir/libmpv.dylib"
        fi
    fi

    count=$(find "$BUNDLE_DEST" -name '*.dylib' | wc -l | tr -d ' ')
    echo "build-dylibz: staged $count dylibs from committed/$ARCH (pass --rebuild to refresh from a fresh homebrew build)"
}

# bundles a built mpv dylib (and its full dependency closure) into
# $BUNDLE_DEST, regenerates tauri.macos.conf.json, and refreshes
# committed/<arch> so future runs can skip straight to the fast path
# above - shared by both arch branches below, which differ only in HOW
# they get homebrew's mpv built/installed in the first place.
#
# $1: path to the homebrew-built libmpv.2.dylib to bundle.
# $2: "true" to also set bundle.macOS.minimumSystemVersion to 14.0 in the
#     generated config (x86_64 only - arm64's rustc default of 11.0 is
#     already fine).
# $3: brew invocation to use for `--prefix molten-vk` lookups (e.g. "brew"
#     or `arch -x86_64 /path/to/brew`) - word-split unquoted below, so
#     must not itself contain anything needing quoting/escaping.
bundle_mpv_dylib_closure() {
    local src_mpv_dylib="$1"
    local need_min_version="$2"
    local brew_cmd="$3"

    if ! command -v dylibbundler >/dev/null 2>&1; then
        echo "build-dylibz: installing dylibbundler via homebrew..."
        brew install dylibbundler
    fi

    rm -rf "$BUNDLE_DEST"
    mkdir -p "$BUNDLE_DEST"
    cp "$src_mpv_dylib" "$BUNDLE_DEST/"
    chmod u+w "$BUNDLE_DEST"/*.dylib

    # flat directory + uniform @loader_path/ for every rewrite (not
    # @loader_path/Frameworks/ or similar): dylibbundler rewrites every
    # dependency's references using the SAME -p prefix regardless of
    # whether that dependency itself lives at the top level or is a
    # dependency-of-a-dependency already inside -d's directory - a nested
    # prefix doubles up (Frameworks/Frameworks/...) for anything but the
    # top-level -x target. keeping everything in one flat dir with a bare
    # @loader_path/ sidesteps that entirely.
    (cd "$BUNDLE_DEST" && dylibbundler -b -of -cd -x libmpv.2.dylib -d . -p "@loader_path/" </dev/null)

    # dylibbundler adds an @loader_path/ rpath to the -x target that's
    # entirely redundant (every rewritten reference already uses an
    # explicit @loader_path/<name> path, not @rpath/<name>) and, for
    # reasons not fully understood, sometimes adds it twice - a literal
    # duplicate LC_RPATH load command, which ld refuses to link against
    # ("duplicate LC_RPATH") once anything depends on this dylib. strip it.
    for f in "$BUNDLE_DEST"/*.dylib; do
        count=$(otool -l "$f" | grep -c "path @loader_path/ (offset" || true)
        if [ "$count" -gt 1 ]; then
            install_name_tool -delete_rpath "@loader_path/" "$f"
        fi
    done

    # the -x target's own install name (id) is untouched by dylibbundler -
    # still homebrew's absolute path. rewrite it so it's resolvable once
    # bundled - client/charnel/scripts/fixup-mpv-install-name.sh separately
    # rewrites OUR OWN executable's reference to this same file (baked in
    # at link time from this exact string) to
    # @executable_path/../Frameworks/libmpv.2.dylib.
    install_name_tool -id "@loader_path/libmpv.2.dylib" "$BUNDLE_DEST/libmpv.2.dylib"

    # every install_name_tool edit above invalidates whatever signature was
    # there before (homebrew's own, or none) - ad-hoc re-sign so dyld's
    # runtime validation doesn't refuse to load these (confirmed for real:
    # an unsigned/invalidated dylib gets the whole process SIGKILLed with
    # zero diagnostic output at all, easy to mistake for a rendering bug).
    codesign --force --sign - "$BUNDLE_DEST"/*.dylib

    # MoltenVK (the actual vulkan ICD/driver) isn't a static dependency of
    # libmpv.2.dylib - mpv's vulkan vo finds it at runtime via the vulkan
    # LOADER's own ICD-manifest discovery (a json file pointing at the
    # dylib), not a normal dlopen of a linked dependency - so dylibbundler
    # never sees or bundles it, even though libvulkan.1.dylib (the loader
    # itself) gets swept up fine. without this, the bundled app has a
    # vulkan loader with no driver to find at all: every vo/gpu context
    # fails identically with VK_ERROR_INCOMPATIBLE_DRIVER (confirmed for
    # real 2026-10-02 via mpv's own verbose log - audio plays, no video
    # window, no error dialog). bundle the dylib as a `frameworks` entry
    # (ends up flat at Contents/Frameworks/) and the manifest as a
    # `resources` entry (tauri rejects non-.dylib/.framework paths under
    # `frameworks` - "Framework path should have .framework extension" -
    # but resources entries preserve their FULL given relative path
    # instead of flattening, landing at
    # Contents/Resources/mpv-runtime/lib/MoltenVK_icd.json, confirmed via
    # an actual local build 2026-10-02) - so `library_path` can't be a
    # bare filename (the vulkan loader resolves non-absolute paths
    # relative to the manifest's OWN directory, which is no longer the
    # same directory as the dylib once they're split across
    # Frameworks/Resources like this). client/charnel's own startup code
    # points $VK_ICD_FILENAMES at this bundled manifest before mpv ever
    # touches vulkan - see video_window/libmpv_backend.rs.
    local moltenvk_prefix
    moltenvk_prefix=$($brew_cmd --prefix molten-vk 2>/dev/null || true)
    if [ -n "$moltenvk_prefix" ] && [ -f "$moltenvk_prefix/lib/libMoltenVK.dylib" ]; then
        cp "$moltenvk_prefix/lib/libMoltenVK.dylib" "$BUNDLE_DEST/"
        chmod u+w "$BUNDLE_DEST/libMoltenVK.dylib"
        install_name_tool -id "@loader_path/libMoltenVK.dylib" "$BUNDLE_DEST/libMoltenVK.dylib"
        codesign --force --sign - "$BUNDLE_DEST/libMoltenVK.dylib"

        python3 - "$moltenvk_prefix/etc/vulkan/icd.d/MoltenVK_icd.json" "$BUNDLE_DEST/MoltenVK_icd.json" <<'PYEOF'
import json
import sys

src, dest = sys.argv[1], sys.argv[2]
with open(src) as f:
    manifest = json.load(f)
# Contents/Resources/mpv-runtime/lib/MoltenVK_icd.json (this file) ->
# Contents/Frameworks/libMoltenVK.dylib (3 levels up, then into Frameworks).
manifest["ICD"]["library_path"] = "../../../Frameworks/libMoltenVK.dylib"
with open(dest, "w") as f:
    json.dump(manifest, f, indent=4)
    f.write("\n")
PYEOF
    else
        echo "build-dylibz: warning - molten-vk not found via '$brew_cmd --prefix molten-vk', bundled app's vulkan video output will not work" >&2
    fi

    # bundles ffmpeg/ffprobe (plain CLI binaries, used by grimoire's own
    # transcode/thumbnail/probe code via Command::new - a completely
    # separate code path from libmpv above) reusing THIS SAME dylib
    # closure, rather than a second independent copy of every ffmpeg lib -
    # confirmed for real 2026-10-02 that homebrew's standalone `ffmpeg`
    # formula (a direct dependency of `mpv`, always installed alongside
    # it) is ABI-compatible with mpv's own linked copies: matching
    # SONAMEs/compatibility versions, and a real `dylibbundler` pass
    # against the already-populated $BUNDLE_DEST correctly recognized
    # every dependency as already present (49 dylibs before, 49 after -
    # zero duplicates) and rewrote ffmpeg/ffprobe's references to them
    # directly, verified with a real libx264 encode + ffprobe decode in
    # the exact final bundle layout.
    #
    # ffmpeg/ffprobe are plain executables (no extension) - like
    # MoltenVK_icd.json above, tauri's `frameworks` key rejects them
    # ("Framework path should have .framework extension"), so they're
    # bundled as `resources` entries too, landing at
    # Contents/Resources/mpv-runtime/lib/{ffmpeg,ffprobe} (3 levels
    # removed from Contents/Frameworks/ where the dylibs actually live -
    # same nesting the MoltenVK manifest's library_path already accounts
    # for). client/charnel's own ffmpeg-path resolution prefers this
    # bundled copy, falling back to the user's own configured/PATH
    # ffmpeg if bundling failed or on non-macOS - see
    # grimoire/src/config.rs.
    local ffmpeg_prefix
    ffmpeg_prefix=$($brew_cmd --prefix ffmpeg 2>/dev/null || true)
    if [ -n "$ffmpeg_prefix" ] && [ -f "$ffmpeg_prefix/bin/ffmpeg" ] && [ -f "$ffmpeg_prefix/bin/ffprobe" ]; then
        cp "$ffmpeg_prefix/bin/ffmpeg" "$ffmpeg_prefix/bin/ffprobe" "$BUNDLE_DEST/"
        chmod u+w "$BUNDLE_DEST/ffmpeg" "$BUNDLE_DEST/ffprobe"
        # NOT dylibbundler here on purpose: pointing it at $BUNDLE_DEST (so
        # it recognizes the mpv closure as already-bundled) also makes it
        # re-rewrite THOSE dylibs' own inter-dependencies (e.g. libavcodec
        # -> libswresample) using ffmpeg/ffprobe's
        # @executable_path/../../../Frameworks/ prefix instead of leaving
        # their correct @loader_path/ references alone - confirmed for real
        # 2026-10-03 via a crash report: dyld refused to load libavcodec
        # because it looked for libswresample at
        # @executable_path/../../../Frameworks (3 levels up from
        # Contents/MacOS/charnel lands at /Applications/, not
        # Contents/Frameworks/). every dependency ffmpeg/ffprobe need is
        # already bundled under the same names (see comment above - zero
        # new dylibs), so just repoint their OWN load commands directly
        # instead of letting dylibbundler touch anything else.
        for bin in ffmpeg ffprobe; do
            f="$BUNDLE_DEST/$bin"
            while IFS= read -r dep; do
                case "$dep" in
                    /usr/lib/*|/System/*) continue ;;
                esac
                # homebrew deps are often referenced via an unversioned
                # SONAME symlink (e.g. libSvtAv1Enc.4.dylib) that doesn't
                # match the real, fully-versioned bundled filename
                # (libSvtAv1Enc.4.2.0.dylib) by basename alone - resolve
                # the symlink first so the lookup below matches what's
                # actually sitting in $BUNDLE_DEST.
                real_dep=$(python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "$dep" 2>/dev/null || echo "$dep")
                dep_name=$(basename "$real_dep")
                if [ -f "$BUNDLE_DEST/$dep_name" ]; then
                    install_name_tool -change "$dep" "@executable_path/../../../Frameworks/$dep_name" "$f"
                else
                    echo "build-dylibz: warning - $bin depends on $dep, not found in $BUNDLE_DEST (left as-is)" >&2
                fi
            done < <(otool -L "$f" | tail -n +2 | awk '{print $1}')
            codesign --force --sign - "$f"
        done
    else
        echo "build-dylibz: warning - ffmpeg not found via '$brew_cmd --prefix ffmpeg', bundled app will fall back to the user's own ffmpeg/ffprobe install" >&2
    fi

    regen_tauri_conf "$need_min_version"

    # refresh the committed snapshot so future runs (CI included) can use
    # the fast path above instead of rebuilding mpv from source again.
    rm -rf "$COMMITTED_DIR"
    mkdir -p "$COMMITTED_DIR"
    cp "$BUNDLE_DEST"/*.dylib "$COMMITTED_DIR/"
    cp "$BUNDLE_DEST"/*.json "$COMMITTED_DIR/" 2>/dev/null || true
    cp "$BUNDLE_DEST/ffmpeg" "$BUNDLE_DEST/ffprobe" "$COMMITTED_DIR/" 2>/dev/null || true

    count=$(find "$BUNDLE_DEST" -name '*.dylib' | wc -l | tr -d ' ')
    echo "build-dylibz: bundled $count dylibs from homebrew's mpv, regenerated $CONF_PATH, refreshed committed/$ARCH"
}

# folds an ALREADY-bundled, flat dylib directory (dylibs + optional
# MoltenVK_icd.json/ffmpeg/ffprobe, install names already rewritten to
# @loader_path/, already codesigned) into this checkout's
# $BUNDLE_DEST/$COMMITTED_DIR - the charnel-repo-specific half of what
# bundle_mpv_dylib_closure does, split out so a fully standalone,
# repo-independent build (e.g. scripts/build-dylibz/build-x86.sh, copied
# onto a machine with no tomb/ checkout at all) can produce that flat
# directory on its own, hand it back over (scp/airdrop/whatever), and
# have IT folded into the real repo here - without that standalone
# script needing to know anything about tauri.macos.conf.json or
# mpv-runtime/committed/ at all.
#
# $1: path to the pre-built flat dylib directory.
# $2: "true" to set bundle.macOS.minimumSystemVersion (see regen_tauri_conf).
integrate_prebuilt_dylib_dir() {
    local src_dir="$1"
    local need_min_version="$2"

    if ! [ -d "$src_dir" ] || ! compgen -G "$src_dir/*.dylib" >/dev/null; then
        echo "build-dylibz: $src_dir doesn't look like a bundled dylib directory (no *.dylib found)" >&2
        exit 1
    fi

    rm -rf "$BUNDLE_DEST"
    mkdir -p "$BUNDLE_DEST"
    cp "$src_dir"/*.dylib "$BUNDLE_DEST/"
    cp "$src_dir"/*.json "$BUNDLE_DEST/" 2>/dev/null || true
    cp "$src_dir/ffmpeg" "$src_dir/ffprobe" "$BUNDLE_DEST/" 2>/dev/null || true
    chmod u+w "$BUNDLE_DEST"/*.dylib
    chmod u+w "$BUNDLE_DEST/ffmpeg" "$BUNDLE_DEST/ffprobe" 2>/dev/null || true

    regen_tauri_conf "$need_min_version"

    rm -rf "$COMMITTED_DIR"
    mkdir -p "$COMMITTED_DIR"
    cp "$BUNDLE_DEST"/*.dylib "$COMMITTED_DIR/"
    cp "$BUNDLE_DEST"/*.json "$COMMITTED_DIR/" 2>/dev/null || true
    cp "$BUNDLE_DEST/ffmpeg" "$BUNDLE_DEST/ffprobe" "$COMMITTED_DIR/" 2>/dev/null || true

    count=$(find "$BUNDLE_DEST" -name '*.dylib' | wc -l | tr -d ' ')
    echo "build-dylibz: integrated $count dylibs from $src_dir, regenerated $CONF_PATH, refreshed committed/$ARCH"
}

