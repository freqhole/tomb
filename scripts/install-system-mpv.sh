#!/usr/bin/env bash
# self-install a native, OS-matched libmpv via homebrew ON THIS MACHINE,
# then move the app's bundled libmpv.2.dylib aside so charnel's existing
# weak-link + rpath fallback (see fixup-mpv-install-name.sh) picks up the
# homebrew-built one instead. useful as an immediate workaround on a
# machine where the bundled copy crashes at launch (confirmed real-world
# 2026-10-05: a macOS 10.15.7 machine's bundled libmpv.2.dylib referenced
# /usr/lib/swift/libswiftUniformTypeIdentifiers.dylib, a macOS 11+-only
# framework, since it was built on a newer host OS than this one).
#
# run this ON THE AFFECTED MACHINE (not a dev/build machine) - it
# installs homebrew + mpv for the current user/OS if needed, which
# sidesteps the mismatch entirely since homebrew builds/bottles mpv
# against THIS machine's actual OS and Xcode.
#
# caveat: homebrew no longer ships Intel macOS bottles for mpv (see
# fetch-mpv-runtime.sh's own comments) - on an Intel Mac this likely
# means a slow from-source build (ffmpeg, libplacebo, etc. - can be
# multi-hour on older/weaker hardware), and homebrew's own minimum
# supported macOS version may simply refuse to install on very old
# systems. check that before relying on this script.
set -euo pipefail

if [ "$(uname)" != "Darwin" ]; then
  echo "install-system-mpv: this script is macOS-only." >&2
  exit 1
fi

APP_PATH="${1:-/Applications/freqhole.app}"
FRAMEWORKS_DIR="$APP_PATH/Contents/Frameworks"
BUNDLED_MPV="$FRAMEWORKS_DIR/libmpv.2.dylib"

if ! [ -d "$APP_PATH" ]; then
  echo "install-system-mpv: $APP_PATH not found - pass the app path as an argument if it's installed elsewhere." >&2
  exit 1
fi

BREW_BIN="$(command -v brew || true)"
if [ -z "$BREW_BIN" ]; then
  if [ -x /opt/homebrew/bin/brew ]; then
    BREW_BIN=/opt/homebrew/bin/brew
  elif [ -x /usr/local/bin/brew ]; then
    BREW_BIN=/usr/local/bin/brew
  fi
fi

if [ -z "$BREW_BIN" ]; then
  echo "install-system-mpv: homebrew not found, installing (this prompts for your password; follow its on-screen instructions)..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [ -x /opt/homebrew/bin/brew ]; then
    BREW_BIN=/opt/homebrew/bin/brew
  elif [ -x /usr/local/bin/brew ]; then
    BREW_BIN=/usr/local/bin/brew
  else
    echo "install-system-mpv: couldn't find brew after installing - open a new terminal (so its PATH changes take effect) and re-run this script." >&2
    exit 1
  fi
fi

echo "install-system-mpv: installing mpv via homebrew (targets THIS machine's real OS/Xcode, so no bundled-copy ABI mismatch is possible)..."
"$BREW_BIN" install mpv

if [ -f "$BUNDLED_MPV" ]; then
  BACKUP="$BUNDLED_MPV.bundled-bak"
  echo "install-system-mpv: moving the app's bundled libmpv.2.dylib aside so dyld falls back to the homebrew copy (backed up to $BACKUP)..."
  mv "$BUNDLED_MPV" "$BACKUP"
else
  echo "install-system-mpv: no bundled libmpv.2.dylib found at $BUNDLED_MPV - nothing to move aside."
fi

echo "install-system-mpv: done. relaunch $APP_PATH and confirm video playback works."
echo "install-system-mpv: to undo, restore the backup: mv '$BUNDLED_MPV.bundled-bak' '$BUNDLED_MPV'"
