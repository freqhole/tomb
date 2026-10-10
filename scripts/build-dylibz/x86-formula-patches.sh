#!/usr/bin/env bash
# shared homebrew formula-patching + mpv/ffmpeg build logic for x86_64 -
# sourced, not run directly, by both build-x86-on-arm64.sh (cross-building
# from an arm64 host via rosetta) and build-x86.sh (building natively on a
# real Intel Mac). the two differ only in HOW brew gets invoked and
# whether a dedicated relocatable prefix is needed at all - everything
# else (Xcode/SDK pinning, the cc/ld shim patch, ffmpeg/mpv formula
# patches) is identical and lives here once.
#
# expects these already set by the sourcing script: BUNDLE_DEST,
# COMMITTED_DIR, CONF_PATH, ARCH ("x86_64"), REBUILD, FORCE (and
# common.sh already sourced, for stage_from_committed/
# bundle_mpv_dylib_closure/regen_tauri_conf).
#
# $1: BREW_PREFIX - the homebrew prefix to operate on (a dedicated
#     relocatable one under rosetta, or the real /usr/local on a native
#     Intel Mac).
# $2: BREW_CMD - how to actually invoke that prefix's `brew` (e.g.
#     "arch -x86_64 /Users/Shared/freqhole-homebrew-x86/bin/brew" or just
#     "/usr/local/bin/brew") - word-split unquoted throughout, so must
#     not itself contain anything needing quoting/escaping (same
#     convention as bundle_mpv_dylib_closure's own brew_cmd param in
#     common.sh).
patch_and_build_mpv_for_x86() {
    local BREW_PREFIX="$1"
    local BREW_CMD="$2"

    # modern homebrew resolves `brew info`/`brew install` through a
    # remote JSON API by default and keeps no local formula .rb files at
    # all - fine for installing, but `brew cat mpv` (used below to seed
    # our patched tap) literally cats the on-disk formula file, so it
    # silently prints nothing (exit 0, zero bytes) without a real local
    # homebrew/core clone. `brew tap homebrew/core` alone also no-ops
    # ("no longer typically necessary") - `--force` is required to
    # actually get the clone. confirmed for real 2026-10-05.
    if ! [ -d "$BREW_PREFIX/Library/Taps/homebrew/homebrew-core" ]; then
      echo "build-dylibz: force-tapping homebrew/core locally (brew cat needs a real formula file on disk, not just the API)..."
      $BREW_CMD tap homebrew/core --force
    fi

    # two self-healing checks, both confirmed real 2026-10-07 and both
    # cheap/idempotent enough to just always run rather than trusting
    # a human to remember them:
    #
    # 1. a keg left over from an interrupted previous install (e.g. a
    #    formula that failed partway through its own `install` method)
    #    can have read-only (444) files, which then blocks a later
    #    reinstall's `cp`/`install` step with "Permission denied" even
    #    though the current user owns the file and its containing
    #    directory - libvpx's `vpx.pc` hit this exactly.
    if [ -d "$BREW_PREFIX/Cellar" ]; then
      chmod -R u+w "$BREW_PREFIX/Cellar" 2>/dev/null || true
    fi
    # 2. a keg-only formula (e.g. libarchive, which conflicts with
    #    macOS's own bundled tar/cpio) whose install got interrupted
    #    before `brew link` ran leaves its Cellar files fully present
    #    but with NO `opt/<formula>` symlink at all - anything that
    #    resolves the dependency through `opt/` (dylibbundler included)
    #    then can't find it, and dylibbundler's interactive "does not
    #    exist, try again" prompt loops forever since nothing is there
    #    to answer it non-interactively. re-link anything missing it.
    for keg_dir in "$BREW_PREFIX"/Cellar/*/; do
      [ -d "$keg_dir" ] || continue
      formula_name=$(basename "$keg_dir")
      if ! [ -e "$BREW_PREFIX/opt/$formula_name" ]; then
        echo "build-dylibz: $formula_name is installed but missing its opt/ symlink (likely an interrupted install) - re-linking..."
        $BREW_CMD link --force --overwrite "$formula_name" >/dev/null 2>&1 || true
      fi
    done

    # per-formula ENV["MACOSX_DEPLOYMENT_TARGET"] patches (see ffmpeg/mpv
    # below) only ever cover the ONE formula they're applied to - mpv
    # pulls in ~86 formulae total (ffmpeg, then x265 confirmed real
    # 2026-10-07, and likely more after that: libplacebo, dav1d, libvpx,
    # x264, libass, etc.), each independently built from source against
    # whatever macOS this machine happens to be running, and each
    # capable of embedding the exact same class of "built for Mac OS X
    # <host-version>" symbol that's missing on a real macOS 12.0
    # (Monterey, charnel's actual minimum) target - patching them one at
    # a time as each one surfaces a crash is not scalable.
    #
    # homebrew's own `cc`/`clang`/`ld` shim (every single compiler and
    # linker invocation, for every formula, is routed through this one
    # script - that's the entire point of superenv) only ever RAISES an
    # explicit `-mmacosx-version-min=` flag up to a floor
    # (HOMEBREW_MACOS_OLDEST_ALLOWED, see `refurbish_arg` in this file) -
    # there is no existing homebrew mechanism to LOWER one, and most
    # build systems (cmake, meson, a bare `clang` invocation with no
    # explicit flag at all) just default to whatever `sw_vers` reports
    # for the host when nothing else overrides it. patching this ONE
    # file directly (part of our own x86_64 homebrew prefix - never
    # touches the user's real arm64 homebrew, if this is a cross-build
    # host) to unconditionally force `-mmacosx-version-min=12.0`
    # (compile/link) or `-macosx_version_min 12.0` (raw `ld`) onto every
    # invocation closes this for the ENTIRE dependency graph in one
    # shot, instead of reactively patching formulae one at a time as
    # each new one surfaces the same bug.
    CC_SHIM="$BREW_PREFIX/Library/Homebrew/shims/super/cc"
    if [ -f "$CC_SHIM" ] && ! grep -q "freqhole: force macOS 12.0 deployment target" "$CC_SHIM"; then
      echo "build-dylibz: patching homebrew's cc/ld shim to force a macOS 12.0 deployment target on every compile/link, for every formula..."
      python3 - "$CC_SHIM" <<'PYEOF'
import sys

path = sys.argv[1]
with open(path) as f:
    content = f.read()
marker = "    optional_args + @positional_args\n  end"
if marker not in content:
    print(f"build-dylibz: cc shim patch failed - expected marker not found in {path}", file=sys.stderr)
    sys.exit(1)
patch = (
    "    # freqhole: force macOS 12.0 deployment target on every\n"
    "    # compile/link, for every formula (see scripts/build-dylibz/).\n"
    "    if mac?\n"
    "      if [:cc, :cxx, :ccld, :cxxld].include?(mode)\n"
    "        optional_args << \"-mmacosx-version-min=12.0\"\n"
    "      elsif mode == :ld\n"
    "        optional_args << \"-macosx_version_min\" << \"12.0\"\n"
    "      end\n"
    "    end\n\n"
    "    optional_args + @positional_args\n  end"
)
content = content.replace(marker, patch, 1)
with open(path, "w") as f:
    f.write(content)
PYEOF
    fi

    # the cc shim patch above only affects formulae that actually get
    # RECOMPILED - `brew install ffmpeg` doesn't rebuild ffmpeg's own
    # already-satisfied dependencies (x265 included) just because ffmpeg
    # itself reinstalled, so a formula built in an EARLIER run (before
    # this patch existed) keeps its old, wrongly-targeted dylib forever
    # unless something forces it to rebuild too (confirmed real
    # 2026-10-07: x265 kept crashing, "built for Mac OS X 15.0", on a
    # rebuild that only force-reinstalled ffmpeg+mpv). this x86_64
    # prefix exists solely for mpv + its dependency closure + dylibbundler
    # (nothing else is ever installed into it), so `--force` wipes every
    # formula currently installed here and lets the ffmpeg/mpv installs
    # below pull them all back in fresh, guaranteeing every single dylib
    # in the chain is actually recompiled under the corrected shim - not
    # just the two formulae this script happens to patch directly.
    # deliberately separate from plain `--rebuild` (which leaves
    # already-installed dependencies alone): an unrelated formula failing
    # mid-build (e.g. vapoursynth's own packaging bug, confirmed real
    # 2026-10-07) shouldn't force every OTHER already-correctly-rebuilt
    # dependency to redo a multi-hour compile too - just rerun with
    # `--rebuild` alone to resume, reusing whatever already succeeded.
    if [ "$FORCE" = "--force" ]; then
      INSTALLED_FORMULAE=$($BREW_CMD list --formula 2>/dev/null)
      if [ -n "$INSTALLED_FORMULAE" ]; then
        echo "build-dylibz: --force requested - wiping all currently installed x86_64 formulae (mpv's full dependency closure, e.g. x265) so every dylib is recompiled under the corrected cc shim..."
        # shellcheck disable=SC2086
        $BREW_CMD uninstall --force --ignore-dependencies $INSTALLED_FORMULAE
      fi
    fi

    # reaching this code at all already implies --rebuild was passed
    # (see the outer `stage_from_committed` gate above) - checking
    # `$REBUILD = "--rebuild"` again here was always true, silently
    # forcing a full mpv uninstall+reinstall (and, transitively, every
    # dependency touched below) on every single invocation, even a bare
    # retry after an unrelated later step (dylibbundler, committed-
    # snapshot refresh) failed - defeating the exact "just rerun with
    # --rebuild to resume" case described above `--force`'s own comment.
    # only (re)install if mpv genuinely isn't there yet - `--force`
    # (wipes every formula first, see above) is the actual way to force
    # a true from-scratch mpv rebuild.
    if ! [ -f "$BREW_PREFIX/opt/mpv/lib/libmpv.2.dylib" ]; then
      echo "build-dylibz: installing mpv (targeting macOS 12.0) via x86_64 homebrew (from source - homebrew no longer ships Intel macOS bottles; this can take a long time the first run, cached after)..."
      # homebrew otherwise builds against whatever macOS version is
      # running ON THIS MACHINE (not a fixed minimum) - mpv's cocoa
      # backend is partly written in Swift, so an unpinned build here
      # silently links against Swift runtime symbols only present on THIS
      # machine's OS, crashing at launch on an older-but-still->=14 target
      # Mac with "Symbol not found" against libswiftCore.dylib (confirmed
      # for real 2026-10-02).
      #
      # a plain `export MACOSX_DEPLOYMENT_TARGET=14.0` before `brew
      # install` does NOT work, nor does `HOMEBREW_FAKE_MACOS=14.0`
      # (homebrew's own internal "pretend to be running an older macOS"
      # escape hatch) - confirmed empirically both leave `otool -l`
      # showing `minos 15.0` (the host's real OS version) afterward:
      # homebrew's superenv sandbox strips/ignores arbitrary inherited env
      # vars (and mpv's meson-based formula never itself forwards
      # MACOSX_DEPLOYMENT_TARGET to the swiftc/clang subprocesses it
      # spawns), and mpv's own swiftc invocation never passes an explicit
      # `-target`/version-min flag either - so the ONLY thing that
      # actually works is setting ENV["MACOSX_DEPLOYMENT_TARGET"] from
      # *inside* the formula's own `install` method, which runs AFTER
      # superenv's sanitization and so genuinely persists into every
      # meson/ninja/swiftc subprocess it spawns. confirmed via `otool -l`
      # showing `minos 14.0` afterward.
      #
      # homebrew refuses to load/install a bare formula.rb path directly
      # ("Homebrew requires formulae to be in a tap") - so this
      # regenerates a tiny persistent local tap each run from whatever
      # mpv.rb homebrew-core currently ships (keeping it in sync with
      # upstream mpv version/patch bumps automatically) with that one
      # line patched in, and installs from the patched copy instead of
      # plain `brew install mpv`.
      #
      # minos 12.0 alone isn't enough: mpv's cocoa backend is partly
      # Swift, and whatever Xcode built it determines which Swift stdlib
      # ABI symbols get emitted, independent of the deployment-target
      # flag (confirmed for real 2026-10-02 - a minos-14.0 build still
      # referenced `_$ss20__StaticArrayStorageCN`, a symbol added to the
      # Swift runtime around the macOS 15 SDK, absent from macOS 14's
      # system libswiftCore.dylib - the same class of bug bites any SDK
      # newer than the deployment target, not just that specific pair).
      # pinning DEVELOPER_DIR at a side-by-side Xcode 13.4.1 (bundles
      # the macOS 12.3 SDK - the closest match to our actual 12.0
      # minimum, so a symbol added after 12.0 isn't even declared in the
      # headers, let alone referenceable) avoids that codegen path
      # entirely - only applied if that specific Xcode happens to be
      # installed, so this degrades to "whatever Xcode is active"
      # everywhere else (CI included, until pinned there too).
      #
      # DEVELOPER_DIR alone did NOT work either (confirmed for real
      # 2026-10-02, round two - a rebuild with DEVELOPER_DIR pinned to
      # Xcode 15.4 still showed `sdk 15.4` in `otool -l`'s
      # LC_BUILD_VERSION, and `dyld_info -imports` still listed
      # `_$ss20__StaticArrayStorageCN` - nm's classic symbol-table view
      # doesn't surface this symbol at all since it's bound via newer
      # chained fixups, so always use dyld_info to check for it, not nm):
      # homebrew's superenv sandbox precomputes an absolute SDKROOT
      # pointing at whatever Xcode is active BEFORE `install` ever runs,
      # and meson/swiftc read that env var directly rather than invoking
      # `xcrun` themselves - so DEVELOPER_DIR changes which `xcrun`
      # resolves to if something calls it, but does nothing for a tool
      # that just reads the already-exported SDKROOT. explicitly
      # overriding SDKROOT too (via the system `/usr/bin/xcrun` - xcrun
      # itself isn't bundled per-Xcode-copy, it resolves SDKs through
      # whatever DEVELOPER_DIR points at) closes that gap.
      PINNED_XCODE="/Applications/Xcode_13.4.1.app"
      # DEVELOPER_DIR/SDKROOT set from a formula's own `install` method
      # (below) DOES correctly propagate into ordinary subprocesses
      # (confirmed real 2026-10-07 via a throwaway test formula), but
      # mpv's swift support doesn't invoke swiftc through any of the
      # usual env-var-respecting paths: its `osdep/mac/meson.build` calls
      # `TOOLS/macos-sdk-version.py` to get `macos_sdk_path`, hardcodes
      # that into an explicit `-sdk <path>` flag on the swiftc command
      # line, and meson's own built-in `-Dswift_args` option (which
      # WOULD otherwise be the normal override mechanism) never even
      # reaches this custom `custom_target()` build step (confirmed real
      # 2026-10-07 - a `-Dswift_args=...` set via the formula patch
      # showed up fine as a meson "User defined option" but never
      # appeared anywhere in the real swiftc invocation captured in
      # Homebrew's own per-step build log). an explicit CLI flag always
      # wins over an env var for swiftc, so simply setting SDKROOT
      # doesn't help once that flag is hardcoded in.
      #
      # macos-sdk-version.py itself, however, explicitly checks for a
      # `MACOS_SDK`/`MACOS_SDK_VERSION` env var override before ever
      # calling `xcrun` - this is mpv's own, intentional escape hatch
      # for exactly this situation, and it's what the mpv patch below
      # actually sets (plain env vars read via Python's `os.environ`,
      # no meson option plumbing or Homebrew superenv path involved).
      LOCAL_TAP_DIR="$BREW_PREFIX/Library/Taps/freqhole-local/homebrew-mpv-patched"
      if ! [ -d "$LOCAL_TAP_DIR" ]; then
        $BREW_CMD tap-new freqhole-local/mpv-patched
      fi
      # meson's swift compiler detection has NO environment-variable
      # override at all, unlike c/cpp/objc (`CC`/`CXX`/`OBJC`) - confirmed
      # via meson's own source, `ENV_VAR_COMPILER_MAP` has no 'swift' key
      # - so it always falls back to whatever bare `swiftc` resolves to on
      # PATH (the newest/default Xcode, confirmed real 2026-10-07 via the
      # actual ninja command line: `/Applications/Xcode.app/.../swiftc`
      # despite DEVELOPER_DIR/SDKROOT being correctly pinned elsewhere).
      # the only way meson lets you override this is a `--native-file`
      # with a `[binaries] swift = '...'` entry, so generate one pointing
      # at the pinned Xcode's own swiftc and pass it on the meson setup
      # command line below (the ENV["MACOS_SDK"]/ENV["MACOS_SDK_VERSION"]
      # override above still controls the `-sdk` flag passed to it; this
      # controls which swiftc binary actually receives that flag).
      PINNED_SWIFTC="$PINNED_XCODE/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc"
      MPV_SWIFT_NATIVE_FILE="$LOCAL_TAP_DIR/mpv-swift-native.ini"
      # mpv's own osdep/mac/meson.build does a SEPARATE, manual
      # `find_program('swiftc')` call (for things like its "Swift
      # library directory" detection script) that's entirely distinct
      # from meson's own swift-language compiler detection - confirmed
      # real 2026-10-08 via the setup log: "Program .../Xcode.app/...
      # swiftc found: YES" kept showing the system default even with
      # the `swift = ...` entry below in place. `find_program()` looks
      # up native-file `[binaries]` entries by the EXACT string passed
      # to it, so both keys are needed: `swift` for the former, `swiftc`
      # for the latter.
      printf '[binaries]\nswift = %s\nswiftc = %s\n' "'$PINNED_SWIFTC'" "'$PINNED_SWIFTC'" > "$MPV_SWIFT_NATIVE_FILE"
      # the MACOSX_DEPLOYMENT_TARGET/Xcode pin above only ever applied
      # to mpv's own `install` method - mpv's ~86 dependencies (ffmpeg
      # included) are plain, unpatched homebrew/core formulae that build
      # against whatever OS/SDK this machine's Xcode actually reports,
      # which is NOT macOS 12 on a modern dev machine. confirmed real
      # crash 2026-10-06: a vanilla-built libavutil.61.1.102.dylib was
      # "built for Mac OS X 15.0" and referenced `_CVBufferCopyAttachments`
      # (a CoreVideo symbol added in macOS 12), missing on a macOS
      # 12.0 target if the build doesn't correctly weak-link it - the
      # exact same class of bug as the earlier libswiftCore mismatch,
      # just in a dependency instead of mpv itself. patch+pre-install
      # ffmpeg the same way so mpv's own dependency resolution finds
      # this already-installed, correctly deployment-targeted keg
      # instead of fetching/building a fresh vanilla one (homebrew
      # doesn't care which tap satisfied a dependency, only that a
      # formula of that name/version is installed).
      $BREW_CMD cat ffmpeg > "$LOCAL_TAP_DIR/Formula/ffmpeg.rb"
      if ! [ -s "$LOCAL_TAP_DIR/Formula/ffmpeg.rb" ]; then
        echo "build-dylibz: 'brew cat ffmpeg' produced an empty file." >&2
        exit 1
      fi
      python3 - "$LOCAL_TAP_DIR/Formula/ffmpeg.rb" "$PINNED_XCODE" <<'PYEOF'
import sys

path, pinned_xcode = sys.argv[1], sys.argv[2]
with open(path) as f:
    content = f.read()
marker = "  def install\n"
idx = content.index(marker) + len(marker)
pinned_developer_dir = f"{pinned_xcode}/Contents/Developer"
# a deployment target tells the compiler "this symbol is always
# present from version X on" - charnel's actual macOS minimum is 12.0,
# so that's the value that must be set here (not 14.0, not 10.15 - see
# this file's own history for the earlier, now-abandoned attempt to
# support 10.15, which pinned 14.0 here to dodge an unrelated Swift ABI
# issue since fixed by raising the minimum instead of chasing it
# per-symbol).
injects = [
    '    ENV["MACOSX_DEPLOYMENT_TARGET"] = "12.0" if OS.mac?\n',
    f'    if OS.mac? && File.directory?("{pinned_xcode}")\n'
    f'      ENV["DEVELOPER_DIR"] = "{pinned_developer_dir}"\n'
    f'      ENV["SDKROOT"] = Utils.safe_popen_read("/usr/bin/xcrun", "--sdk", "macosx", "--show-sdk-path").strip\n'
    f'    end\n',
]
for inject in injects:
    if inject not in content:
        content = content[:idx] + inject + content[idx:]
        idx += len(inject)
with open(path, "w") as f:
    f.write(content)
PYEOF
      # `--build-from-source` only forces the NAMED formula(s) on the
      # command line to compile - homebrew still happily pours a
      # prebuilt BOTTLE for any dependency that has one, which entirely
      # bypasses the cc/ld shim patch above (no compile ever happens, so
      # nothing injected into that shim can possibly apply). confirmed
      # real 2026-10-06: libplacebo installed "(bottled)", no build log
      # at all, still crashing with `minos 14.0` baked in from
      # homebrew's own bottle-CI default - evidently Intel bottles exist
      # for plenty of "simple" formulae even though mpv/ffmpeg
      # themselves don't have one. the actual, intended Homebrew
      # mechanism for this (there is no env var for it - confirmed via
      # Homebrew's own source: `--build-from-source` has no `env:`
      # wiring at all) is to list every dependency EXPLICITLY alongside
      # `--build-from-source`, so this computes ffmpeg's full runtime
      # dependency closure (x265, libvpx, dav1d, etc. - excluding
      # build-only tools like meson/nasm, which never ship and so can't
      # carry a runtime deployment-target bug) and forces every one of
      # them to compile too, in the same install invocation.
      # `brew deps` returns the full runtime closure, but not all of it
      # actually ends up inside the bundled app - yt-dlp's own embedded
      # Python/Deno toolchain (never a compiled dylib mpv links against,
      # confirmed absent from a real crash log's `Binary Images` list
      # 2026-10-06) and a handful of other transitive libs that are
      # pulled in but never actually linked into libmpv.2.dylib's closure
      # (dylibbundler only ever copies what's REALLY linked) don't need
      # forcing from source - skip them so this doesn't waste time
      # recompiling e.g. deno/python@3.14 (notoriously slow) for
      # something that was never the problem in the first place.
      NEVER_BUNDLED_DEPS_REGEX='^(ca-certificates|certifi|cffi|deno|giflib|libtiff|mpdecimal|pycparser|python@3\.14|readline|sqlite|webp|cairo|flac|icu4c@78|json-c|libogg|libsndfile|libvorbis|lzo|pixman|vulkan-headers|xorgproto)$'
      FFMPEG_DEPS=$($BREW_CMD deps freqhole-local/mpv-patched/ffmpeg | grep -vE "$NEVER_BUNDLED_DEPS_REGEX")
      # reaching this code at all already implies --rebuild was passed
      # (see the outer `stage_from_committed` gate above) - checking
      # `$REBUILD = "--rebuild"` again here was always true and silently
      # forced a full uninstall+reinstall on every single invocation,
      # even a bare retry after an unrelated later step failed (the
      # exact "just rerun with --rebuild to resume" case the comment
      # above this promises). only reinstall if ffmpeg genuinely isn't
      # there - `--force` (wipes every formula first, see above) is the
      # actual way to force a true from-scratch ffmpeg rebuild.
      if ! $BREW_CMD list ffmpeg >/dev/null 2>&1; then
        # shellcheck disable=SC2086
        $BREW_CMD install --no-ask --build-from-source freqhole-local/mpv-patched/ffmpeg $FFMPEG_DEPS
      fi
      $BREW_CMD cat mpv > "$LOCAL_TAP_DIR/Formula/mpv.rb"
      if ! [ -s "$LOCAL_TAP_DIR/Formula/mpv.rb" ]; then
        echo "build-dylibz: 'brew cat mpv' produced an empty file - homebrew/core isn't tapped locally as a real git clone (needed for brew cat specifically, not for brew install). try '$BREW_CMD tap homebrew/core --force'." >&2
        exit 1
      fi
      python3 - "$LOCAL_TAP_DIR/Formula/mpv.rb" "$PINNED_XCODE" "$MPV_SWIFT_NATIVE_FILE" <<'PYEOF'
import sys

path, pinned_xcode, native_file = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f:
    content = f.read()
marker = "  def install\n"
idx = content.index(marker) + len(marker)
pinned_developer_dir = f"{pinned_xcode}/Contents/Developer"
# charnel's actual macOS minimum is 12.0 - see the matching comment in
# the ffmpeg patch above for why this isn't 14.0 or 10.15 anymore.
injects = [
    '    ENV["MACOSX_DEPLOYMENT_TARGET"] = "12.0" if OS.mac?\n',
    f'    if OS.mac? && File.directory?("{pinned_xcode}")\n'
    f'      ENV["DEVELOPER_DIR"] = "{pinned_developer_dir}"\n'
    # xcrun isn't bundled per-Xcode-copy - it's the single system
    # /usr/bin/xcrun, which resolves SDKs via the DEVELOPER_DIR just set
    # above (already inherited since it's a plain ENV assignment).
    f'      ENV["SDKROOT"] = Utils.safe_popen_read("/usr/bin/xcrun", "--sdk", "macosx", "--show-sdk-path").strip\n'
    # mpv's own osdep/mac/meson.build hardcodes an explicit `-sdk`
    # flag on every swiftc invocation from `TOOLS/macos-sdk-version.py`'s
    # output - that script checks these two exact env vars before ever
    # calling `xcrun` itself (confirmed real 2026-10-07 by reading the
    # actual mpv-0.41.0 source), so this is what actually controls the
    # SDK swift code gets compiled against, unlike SDKROOT above (which
    # only affects mpv's plain C/ObjC sources).
    f'      ENV["MACOS_SDK"] = ENV["SDKROOT"]\n'
    f'      ENV["MACOS_SDK_VERSION"] = "12.3"\n'
    f'    end\n',
]
for inject in injects:
    if inject not in content:
        content = content[:idx] + inject + content[idx:]
        idx += len(inject)

# `-Dcplayer=false`: we only ever bundle `libmpv.2.dylib` itself, never
# an `mpv` binary, so the standalone CLI player is a pure waste of
# build time here (the bash-completion install-step guard further down
# already accounts for this being off).
cplayer_disable_args = '      -Dcplayer=false\n'
vulkan_marker = '      -Dvulkan=enabled\n'
if vulkan_marker in content and cplayer_disable_args not in content:
    content = content.replace(vulkan_marker, vulkan_marker + cplayer_disable_args, 1)

# meson's swift compiler detection has NO env-var override at all
# (unlike CC/CXX/OBJC), so ENV["SDKROOT"]/ENV["DEVELOPER_DIR"] above
# never changes which swiftc binary actually runs - confirmed real
# 2026-10-07 via the real ninja command line, which kept invoking
# /Applications/Xcode.app's (the system default, newest) swiftc
# regardless. `--native-file` with a `[binaries] swift = ...` entry is
# meson's one real escape hatch for this - the generated file (above)
# points straight at the pinned Xcode's own swiftc.
native_file_arg = f'      --native-file={native_file}\n'
if vulkan_marker in content and native_file_arg not in content:
    content = content.replace(vulkan_marker, vulkan_marker + native_file_arg, 1)

# the native-file above still doesn't help: mpv's top-level meson.build
# resolves its swift compiler via a raw `run_command(xcrun, '-find',
# 'swiftc')` subprocess call, not `find_program('swiftc')` - a native
# file's `[binaries]` section only intercepts the latter, so this is
# entirely dependent on DEVELOPER_DIR actually reaching that specific
# subprocess (confirmed real 2026-10-08: it didn't - `xcrun -find
# swiftc` run directly with DEVELOPER_DIR exported correctly resolves
# to the pinned Xcode, but the ENV["DEVELOPER_DIR"] set above still
# didn't change what the real `meson setup` run picked). patch the
# source directly instead of chasing environment propagation further -
# this is applied via `inreplace` inside `install`, after mpv's source
# is unpacked but before `meson setup` runs.
pinned_swiftc = f"{pinned_developer_dir}/Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc"
pinned_swift = f"{pinned_developer_dir}/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift"
inreplace_inject = (
    '    inreplace "meson.build",\n'
    '      "swift_prog = find_program(run_command(xcrun, \'-find\', \'swiftc\', check: true).stdout().strip())",\n'
    f'      "swift_prog = find_program(\'{pinned_swiftc}\')"\n'
    # confirmed real 2026-10-08: patching the above alone correctly
    # made mpv's build detect "Swift version: 5.6.1" (so the first
    # patch IS taking effect), which routes into mpv's "old swift
    # frontend" fallback path for swift <5.8 (needed for
    # swift_compat.swift's `#if !swift(>=5.7)` polyfill to activate at
    # all) - but that fallback block does a SECOND, separate
    # `xcrun -find swift` (note: no trailing "c") lookup of its own in
    # osdep/mac/meson.build, re-resolving back to the system default
    # toolchain and silently defeating the first patch. same fix,
    # second file/line.\n'
    '    inreplace "osdep/mac/meson.build",\n'
    '      "swift_prog = find_program(run_command(xcrun, \'-find\', \'swift\', check: true).stdout().strip())",\n'
    f'      "swift_prog = find_program(\'{pinned_swift}\')"\n'
)
marker2 = "  def install\n"
idx2 = content.index(marker2) + len(marker2)
if inreplace_inject not in content:
    content = content[:idx2] + inreplace_inject + content[idx2:]

# mpv's bare `depends_on "ffmpeg"` resolves to the globally-known
# homebrew/core/ffmpeg - but our own patched (12.0-deployment-target,
# pinned-Xcode) ffmpeg above is installed under THIS tap instead, and
# homebrew refuses to have two different-tap formulae of the same name
# installed at once ("Formulae with the same name from different taps
# cannot be installed at the same time", confirmed real 2026-10-07).
# tap-qualify it so mpv's dependency resolves to our already-installed,
# already-patched ffmpeg instead of trying to pull in a second, vanilla
# one (which would also reintroduce the exact "built for Mac OS X
# 15.0"/missing-CoreVideo-symbol crash the ffmpeg patch above exists to
# avoid).
ffmpeg_depends_line = '  depends_on "ffmpeg"\n'
ffmpeg_depends_replacement = '  depends_on "freqhole-local/mpv-patched/ffmpeg"\n'
content = content.replace(ffmpeg_depends_line, ffmpeg_depends_replacement, 1)

# vapoursynth is only ever dlopen'd at runtime by mpv's optional vs
# filter bridge - libmpv.2.dylib never links against it directly
# (confirmed absent from the bundled Frameworks closure in a real crash
# log 2026-10-06), so charnel loses nothing by disabling it outright.
# worth doing regardless of deployment-target concerns: vapoursynth's
# own formula builds a python extension via pip/pyproject.toml, which
# hard-failed with "Preparing metadata (pyproject.toml) did not run
# successfully / No available output" on a from-scratch x86_64 build
# (confirmed real failure 2026-10-07) - a flaky, Tier-3-support-tier
# homebrew/core formula with its own unrelated packaging problems, not
# worth fighting just to support a filter path this app never uses.
# dropping the `depends_on` line too means homebrew never attempts to
# build it at all, instead of building it and then mpv ignoring it.
vapoursynth_depends_line = '  depends_on "vapoursynth"\n'
content = content.replace(vapoursynth_depends_line, '', 1)
vapoursynth_disable_arg = '      -Dvapoursynth=disabled\n'
if vulkan_marker in content and vapoursynth_disable_arg not in content:
    content = content.replace(vulkan_marker, vulkan_marker + vapoursynth_disable_arg, 1)

# yt-dlp is a convenience companion CLI mpv's formula installs
# alongside itself (invoked at runtime via a PATH lookup from mpv's
# own ytdl_hook.lua, never linked into libmpv.2.dylib - confirmed
# absent from the bundled Frameworks closure in a real crash log
# 2026-10-06), not something mpv's own build needs to compile - dropping
# it avoids pulling in its own dependency chain (deno, which has no
# x86_64 bottle and so drags in a from-source rust+llvm build just to
# produce a CLI tool this app never bundles or invokes - confirmed real
# 2026-10-07, llvm alone took a very long time to compile for zero
# benefit).
yt_dlp_depends_line = '  depends_on "yt-dlp"\n'
content = content.replace(yt_dlp_depends_line, '', 1)

# the formula's own install method (not meson) unconditionally runs
# `bash_completion.install share/"bash-completion/completions/mpv"`
# right after `meson install`, assuming meson's own cplayer-gated
# install_data call already created that file - which it never does
# with -Dcplayer=false, so this hits ENOENT (confirmed real failure
# 2026-10-06). guard it so it's skipped when absent (we only bundle
# libmpv.2.dylib, never the standalone mpv CLI, so losing this is a
# non-issue).
bash_completion_line = 'bash_completion.install share/"bash-completion/completions/mpv"'
guarded_line = bash_completion_line + ' if (share/"bash-completion/completions/mpv").exist?'
if bash_completion_line in content and guarded_line not in content:
    content = content.replace(bash_completion_line, guarded_line, 1)

with open(path, "w") as f:
    f.write(content)
PYEOF
      # same bottle-bypassing problem as ffmpeg's own deps above, for
      # mpv's direct dependency closure (libplacebo, x265's sibling
      # deps, vulkan-loader, etc. - confirmed real 2026-10-06: libplacebo
      # was exactly this, "(bottled)", `minos 14.0`, crashing on
      # `std::to_chars(double)` missing from a real 12.0 libc++.dylib).
      MPV_DEPS=$($BREW_CMD deps freqhole-local/mpv-patched/mpv | grep -vE "$NEVER_BUNDLED_DEPS_REGEX")
      # `--rebuild` can mean "mpv is already installed, but a formula
      # patch changed (e.g. the deployment target) and must actually take
      # effect" - `brew install` alone refuses with "already installed"
      # in that case, so force it off first.
      if $BREW_CMD list mpv >/dev/null 2>&1; then
        echo "build-dylibz: uninstalling existing x86_64 mpv so the patched formula reinstalls cleanly..."
        $BREW_CMD uninstall --force mpv
      fi
      # `brew uninstall` doesn't always clean up opt/mpv (it's supposed
      # to be a symlink to the Cellar keg) - a leftover real directory
      # there makes the post-install `brew link` step fail with
      # "Directory not empty @ dir_s_rmdir" (confirmed real failure
      # 2026-10-06). remove it if it's not a symlink so link can recreate it.
      if [ -e "$BREW_PREFIX/opt/mpv" ] && ! [ -L "$BREW_PREFIX/opt/mpv" ]; then
        echo "build-dylibz: $BREW_PREFIX/opt/mpv is a stale real directory (not a symlink) - removing it so brew link can succeed..."
        rm -rf "$BREW_PREFIX/opt/mpv"
      fi
      # recent homebrew defaults to an interactive "Do you want to
      # proceed with the installation? [y/n]" confirmation before
      # installing - --no-ask skips it (confirmed real prompt
      # 2026-10-06, see `brew install --help`'s `-y, --no-ask`).
      # shellcheck disable=SC2086
      $BREW_CMD install --no-ask --build-from-source freqhole-local/mpv-patched/mpv $MPV_DEPS
    fi
    if ! $BREW_CMD list dylibbundler >/dev/null 2>&1; then
      echo "build-dylibz: installing dylibbundler via x86_64 homebrew..."
      $BREW_CMD install --no-ask dylibbundler
    fi
    # file-manipulation tools (install_name_tool/codesign/otool/
    # dylibbundler) just read+rewrite mach-o load commands - they don't
    # need to run AS x86_64 to edit an x86_64 dylib, and macOS
    # transparently invokes rosetta for any x86_64 binary regardless of
    # how it's launched, so no `arch -x86_64` wrapping is needed here.
    # PATH-prepend so `dylibbundler` resolves to this x86_64 homebrew's
    # own copy (matching the architecture of the files it's rewriting).
    export PATH="$BREW_PREFIX/bin:$PATH"
    # `need_min_version` false (see stage_from_committed's x86_64 branch
    # above for why) - drops minimumSystemVersion entirely rather than
    # forcing a 14.0 floor on the shipped app.
    bundle_mpv_dylib_closure "$BREW_PREFIX/opt/mpv/lib/libmpv.2.dylib" false "$BREW_CMD"
}
