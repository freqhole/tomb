//! dependency checks for setup wizard

use std::path::PathBuf;

/// status of required and optional dependencies
#[derive(Debug, Clone)]
pub struct DependencyStatus {
    /// path to ffmpeg if found (recommended for audio processing)
    pub ffmpeg_path: Option<PathBuf>,
    /// path to ffprobe if found (comes with ffmpeg, used for duration extraction)
    pub ffprobe_path: Option<PathBuf>,
    /// path to yt-dlp if found (optional, enables URL downloads)
    pub ytdlp_path: Option<PathBuf>,
}

impl DependencyStatus {
    /// returns true - wizard can always proceed, ffmpeg just enables features
    pub fn can_proceed(&self) -> bool {
        true
    }

    /// returns true if ffmpeg is available
    pub fn has_ffmpeg(&self) -> bool {
        self.ffmpeg_path.is_some()
    }

    /// returns true if ffprobe is available
    pub fn has_ffprobe(&self) -> bool {
        self.ffprobe_path.is_some()
    }

    /// returns true if yt-dlp is available
    pub fn has_ytdlp(&self) -> bool {
        self.ytdlp_path.is_some()
    }
}

/// common installation paths to check (GUI apps don't inherit shell PATH)
const COMMON_PATHS: &[&str] = &[
    "/opt/homebrew/bin",              // homebrew on Apple Silicon
    "/usr/local/bin",                 // homebrew on Intel / manual installs
    "/usr/bin",                       // system
    "/bin",                           // system
    "/opt/local/bin",                 // MacPorts
    "/usr/local/Cellar/ffmpeg/*/bin", // homebrew cellar (glob won't work but leave for reference)
];

/// find executable by name, checking PATH and common locations
fn find_executable(name: &str) -> Option<PathBuf> {
    // first try PATH
    if let Ok(path) = which::which(name) {
        return Some(path);
    }

    // check common locations (for GUI apps that don't have full PATH)
    for dir in COMMON_PATHS {
        let candidate = PathBuf::from(dir).join(name);
        if candidate.exists() && candidate.is_file() {
            return Some(candidate);
        }
    }

    // `~/.local/bin` - where `pip install --user`/`pipx install` (the most
    // common way people get yt-dlp) puts its binary on linux/macOS. not a
    // literal in `COMMON_PATHS` above since it depends on `$HOME` - a GUI
    // app launched from a dock/menu (not a login shell) won't have this on
    // its inherited `PATH` even if the user's own shell does.
    if let Some(home) = dirs::home_dir() {
        let candidate = home.join(".local").join("bin").join(name);
        if candidate.exists() && candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}

/// check for required and optional dependencies
pub fn check_dependencies() -> DependencyStatus {
    DependencyStatus {
        ffmpeg_path: find_executable("ffmpeg"),
        ffprobe_path: find_executable("ffprobe"),
        ytdlp_path: find_executable("yt-dlp"),
    }
}

/// genuinely runs ffmpeg (a tiny real encode) and ffprobe (parsing that
/// encode's output) to confirm both actually work - not just that the
/// files exist and respond to `-version`/similar, which a present-but-
/// broken dylib closure can still do (confirmed for real 2026-10-02: a
/// `libmpv.2.dylib` with unresolved/incompatible dependencies crashed at
/// video-playback time despite `ffmpeg -version` running fine standalone,
/// version output alone isn't a reliable signal). used during setup to
/// decide whether a fresh install can safely default to the
/// bundled-mpv-backed "experimental player" - see
/// `client/charnel/src-tauri/src/commands.rs`'s `run_setup_core`.
pub fn smoke_test_ffmpeg(ffmpeg_path: &std::path::Path, ffprobe_path: &std::path::Path) -> bool {
    let out = std::env::temp_dir().join(format!(
        "freqhole-ffmpeg-smoke-test-{}.mp4",
        std::process::id()
    ));

    let mut encode_cmd = std::process::Command::new(ffmpeg_path);
    encode_cmd
        .args([
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=1:size=64x64:rate=5",
            "-c:v",
            "libx264",
            "-y",
        ])
        .arg(&out);
    crate::process_ext::hide_console_window_std(&mut encode_cmd);
    let encode_ok = encode_cmd
        .output()
        .map(|o| o.status.success() && out.is_file())
        .unwrap_or(false);

    let probe_ok = encode_ok && {
        let mut probe_cmd = std::process::Command::new(ffprobe_path);
        probe_cmd
            .args(["-v", "error", "-show_entries", "stream=codec_name"])
            .arg(&out);
        crate::process_ext::hide_console_window_std(&mut probe_cmd);
        probe_cmd
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    };

    let _ = std::fs::remove_file(&out);
    probe_ok
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_dependencies() {
        let status = check_dependencies();
        // just verify it runs without panicking
        // actual availability depends on system
        let _ = status.can_proceed();
        let _ = status.has_ffmpeg();
        let _ = status.has_ffprobe();
        let _ = status.has_ytdlp();
    }
}
