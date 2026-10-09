//! windows-specific subprocess spawn helper.
//!
//! every ffmpeg/ffprobe/yt-dlp subprocess spawned by this codebase pops
//! a visible console window on windows by default, even with
//! stdout/stderr already piped - windows always allocates a console
//! for a new process unless explicitly told not to. the fix is the
//! `CREATE_NO_WINDOW` process creation flag; everywhere else this is a
//! no-op, so every spawn site can call these unconditionally.

/// hides the console window a spawned `std::process::Command` would
/// otherwise pop open on windows. no-op on every other platform.
pub fn hide_console_window_std(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

/// same as [`hide_console_window_std`], for `tokio::process::Command` -
/// which has no `creation_flags` of its own, but exposes the
/// underlying `std::process::Command` via `as_std_mut()`.
pub fn hide_console_window(cmd: &mut tokio::process::Command) {
    #[cfg(windows)]
    {
        hide_console_window_std(cmd.as_std_mut());
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// not much to assert cross-platform (the flag only has an
    /// observable effect on windows), but confirms both helpers at
    /// least compile and don't panic on every target this crate builds
    /// for.
    #[test]
    fn hide_console_window_does_not_panic() {
        hide_console_window_std(&mut std::process::Command::new("true"));
        hide_console_window(&mut tokio::process::Command::new("true"));
    }
}
