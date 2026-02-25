//! setup defaults for different platforms

use serde::Serialize;
use std::path::PathBuf;

/// default values for setup wizard
#[derive(Debug, Clone, Serialize)]
pub struct SetupDefaults {
    /// default data directory (~/freqhole)
    pub data_dir: PathBuf,
    /// default music storage directory ({data_dir}/fetch)
    pub music_dir: PathBuf,
    /// default server name
    pub server_name: String,
    /// default server port
    pub server_port: u16,
    /// default username (from OS)
    pub username: String,
}

/// get defaults for setup - uses ~/freqhole/ for all platforms
///
/// tauri handles its own Application Support dir separately;
/// this is for CLI and general grimoire defaults
pub fn get_defaults() -> SetupDefaults {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));

    // simple default: ~/freqhole/ for all platforms
    let data_dir = home.join("freqhole");

    // music dir is a subdirectory of data dir
    let music_dir = data_dir.join("fetch");

    // get username from environment
    let username = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "freqroot".to_string());

    SetupDefaults {
        data_dir,
        music_dir,
        server_name: "freqhole".to_string(),
        server_port: 8080,
        username,
    }
}

/// get defaults using local directory (./data) relative to current working directory
///
/// useful for running freqhole from a specific installation directory
pub fn get_local_defaults() -> SetupDefaults {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let data_dir = cwd.join("data");
    let music_dir = data_dir.join("fetch");

    let username = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "freqroot".to_string());

    SetupDefaults {
        data_dir,
        music_dir,
        server_name: "freqhole".to_string(),
        server_port: 8080,
        username,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_defaults() {
        let defaults = get_defaults();
        assert!(!defaults.server_name.is_empty());
        assert!(defaults.server_port > 0);
        assert!(!defaults.username.is_empty());
        // data_dir should end with "freqhole"
        assert!(defaults.data_dir.ends_with("freqhole"));
        // music_dir should be inside data_dir
        assert!(defaults.music_dir.starts_with(&defaults.data_dir));
    }

    #[test]
    fn test_get_local_defaults() {
        let defaults = get_local_defaults();
        // data_dir should be ./data
        assert!(defaults.data_dir.ends_with("data"));
        // music_dir should be ./data/fetch
        assert!(defaults.music_dir.ends_with("fetch"));
    }
}
