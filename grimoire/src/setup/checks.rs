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
