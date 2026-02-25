//! dependency checks for setup wizard

use std::path::PathBuf;

/// status of required and optional dependencies
#[derive(Debug, Clone)]
pub struct DependencyStatus {
    /// path to ffmpeg if found (required)
    pub ffmpeg_path: Option<PathBuf>,
    /// path to yt-dlp if found (optional, enables URL downloads)
    pub ytdlp_path: Option<PathBuf>,
}

impl DependencyStatus {
    /// returns true if all required dependencies are available
    pub fn can_proceed(&self) -> bool {
        self.ffmpeg_path.is_some()
    }

    /// returns true if ffmpeg is available
    pub fn has_ffmpeg(&self) -> bool {
        self.ffmpeg_path.is_some()
    }

    /// returns true if yt-dlp is available
    pub fn has_ytdlp(&self) -> bool {
        self.ytdlp_path.is_some()
    }
}

/// check for required and optional dependencies
pub fn check_dependencies() -> DependencyStatus {
    DependencyStatus {
        ffmpeg_path: which::which("ffmpeg").ok(),
        ytdlp_path: which::which("yt-dlp").ok(),
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
        let _ = status.has_ytdlp();
    }
}
