//! musicbrainz configuration management
//!
//! provides configuration structures for musicbrainz api client settings,
//! rate limiting, and caching options.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// musicbrainz service configuration
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MusicBrainzConfig {
    /// whether musicbrainz integration is enabled
    #[serde(default)]
    pub enabled: bool,

    /// user agent string for api requests (required by musicbrainz)
    #[serde(default = "default_user_agent")]
    pub user_agent: String,

    /// minimum time between requests in milliseconds
    #[serde(default = "default_rate_limit_ms")]
    pub rate_limit_ms: u64,

    /// base url for musicbrainz api
    #[serde(default = "default_base_url")]
    pub base_url: String,

    /// cover art archive base url
    #[serde(default = "default_cover_art_url")]
    pub cover_art_url: String,

    /// request timeout in seconds
    #[serde(default = "default_timeout_seconds")]
    pub timeout_seconds: u64,

    /// maximum concurrent requests
    #[serde(default = "default_max_concurrent_requests")]
    pub max_concurrent_requests: usize,

    /// cache ttl in hours
    #[serde(default = "default_cache_ttl_hours")]
    pub cache_ttl_hours: u64,

    /// maximum retry attempts for failed requests
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,

    /// duration tolerance in seconds for matching (±tolerance)
    #[serde(default = "default_duration_tolerance_seconds")]
    pub duration_tolerance_seconds: u32,

    /// whether to include duration constraints in queries (can be too restrictive)
    #[serde(default)]
    pub enable_duration_matching: bool,

    /// tag name to apply to complete albums
    #[serde(default = "default_full_album_tag")]
    pub full_album_tag: String,
}

impl Default for MusicBrainzConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            user_agent: "tomb-musicbrainz-client/1.0 (https://github.com/freqhole/tomb)"
                .to_string(),
            rate_limit_ms: 1000, // 1 second between requests (musicbrainz requirement)
            base_url: "https://musicbrainz.org/ws/2".to_string(),
            cover_art_url: "https://coverartarchive.org".to_string(),
            timeout_seconds: 30,
            max_concurrent_requests: 1, // conservative default for rate limiting
            cache_ttl_hours: 24,
            max_retries: 3,
            duration_tolerance_seconds: 5,
            enable_duration_matching: false, // disabled by default as it can be too restrictive
            full_album_tag: "full album".to_string(),
        }
    }
}

impl MusicBrainzConfig {
    /// validate configuration settings
    pub fn validate(&self) -> Result<(), String> {
        if self.enabled {
            if self.user_agent.is_empty() {
                return Err("user_agent is required when musicbrainz is enabled".to_string());
            }

            if self.rate_limit_ms < 1000 {
                return Err(
                    "rate_limit_ms must be at least 1000ms per musicbrainz guidelines".to_string(),
                );
            }

            if self.timeout_seconds == 0 {
                return Err("timeout_seconds must be greater than 0".to_string());
            }

            if self.max_concurrent_requests == 0 {
                return Err("max_concurrent_requests must be greater than 0".to_string());
            }

            if !self.base_url.starts_with("http") {
                return Err("base_url must be a valid http/https url".to_string());
            }

            if !self.cover_art_url.starts_with("http") {
                return Err("cover_art_url must be a valid http/https url".to_string());
            }
        }

        Ok(())
    }

    /// get rate limit duration
    pub fn rate_limit_duration(&self) -> Duration {
        Duration::from_millis(self.rate_limit_ms)
    }

    /// get request timeout duration
    pub fn timeout_duration(&self) -> Duration {
        Duration::from_secs(self.timeout_seconds)
    }

    /// get cache ttl duration
    pub fn cache_ttl_duration(&self) -> Duration {
        Duration::from_secs(self.cache_ttl_hours * 3600)
    }
}

fn default_user_agent() -> String {
    "tomb-musicbrainz-client/1.0 (https://github.com/freqhole/tomb)".to_string()
}

fn default_rate_limit_ms() -> u64 {
    1000
}

fn default_base_url() -> String {
    "https://musicbrainz.org/ws/2".to_string()
}

fn default_cover_art_url() -> String {
    "https://coverartarchive.org".to_string()
}

fn default_timeout_seconds() -> u64 {
    30
}

fn default_max_concurrent_requests() -> usize {
    1
}

fn default_cache_ttl_hours() -> u64 {
    24
}

fn default_max_retries() -> u32 {
    3
}

fn default_duration_tolerance_seconds() -> u32 {
    5
}

fn default_full_album_tag() -> String {
    "full album".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config_validation() {
        let config = MusicBrainzConfig::default();
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_enabled_config_validation() {
        let mut config = MusicBrainzConfig::default();
        config.enabled = true;
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_invalid_rate_limit() {
        let mut config = MusicBrainzConfig::default();
        config.enabled = true;
        config.rate_limit_ms = 500; // too low
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_empty_user_agent() {
        let mut config = MusicBrainzConfig::default();
        config.enabled = true;
        config.user_agent = "".to_string();
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_durations() {
        let config = MusicBrainzConfig::default();
        assert_eq!(config.rate_limit_duration(), Duration::from_millis(1000));
        assert_eq!(config.timeout_duration(), Duration::from_secs(30));
        assert_eq!(config.cache_ttl_duration(), Duration::from_secs(24 * 3600));
    }
}
