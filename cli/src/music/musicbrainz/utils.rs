//! Utility functions for MusicBrainz CLI operations
//!
//! This module contains shared helper functions, configuration utilities,
//! and common functionality used across MusicBrainz CLI commands.

use grimoire::{
    config::AppConfig,
    musicbrainz::{MusicBrainzClient, MusicBrainzConfig},
};

/// Extract MusicBrainz configuration from app config
pub fn get_musicbrainz_config(config: &AppConfig) -> Result<MusicBrainzConfig, String> {
    // Check if MusicBrainz is enabled
    if !config.musicbrainz.enabled {
        return Err("musicbrainz integration is not enabled in config".to_string());
    }

    // Return a copy of the config since all fields have defaults
    Ok(config.musicbrainz.clone())
}

/// Test MusicBrainz configuration
pub async fn handle_test_config(config: &AppConfig) -> Result<(), Box<dyn std::error::Error>> {
    println!("🧪 testing musicbrainz configuration...");

    let musicbrainz_config = match get_musicbrainz_config(config) {
        Ok(config) => config,
        Err(e) => {
            println!("❌ configuration error: {}", e);
            return Ok(());
        }
    };

    println!("✓ musicbrainz configuration loaded:");
    println!("  enabled: {}", musicbrainz_config.enabled);
    println!("  user_agent: {}", musicbrainz_config.user_agent);
    println!("  rate_limit_ms: {}", musicbrainz_config.rate_limit_ms);
    println!("  base_url: {}", musicbrainz_config.base_url);
    println!("  cover_art_url: {}", musicbrainz_config.cover_art_url);
    println!("  cache_ttl_hours: {}", musicbrainz_config.cache_ttl_hours);
    println!(
        "  max_concurrent_requests: {}",
        musicbrainz_config.max_concurrent_requests
    );
    println!(
        "  duration_tolerance_seconds: {}",
        musicbrainz_config.duration_tolerance_seconds
    );
    println!(
        "  enable_duration_matching: {}",
        musicbrainz_config.enable_duration_matching
    );
    println!();

    // Test client creation
    match MusicBrainzClient::new(musicbrainz_config) {
        Ok(_client) => {
            println!("✓ musicbrainz client created successfully");
            println!("✓ configuration test passed");
        }
        Err(e) => {
            println!("❌ failed to create musicbrainz client: {}", e);
        }
    }

    Ok(())
}

/// Print song metadata in a formatted way
pub fn print_song_metadata(song: &grimoire::music::Song) {
    println!("song metadata:");
    println!("  id: {}", song.id);
    println!("  title: {}", song.title);
    if let Some(ref artist) = song.artist {
        println!("  artist: {}", artist);
    }
    if let Some(ref album) = song.album {
        println!("  album: {}", album);
    }
    if let Some(track_number) = song.track_number {
        println!("  track: {}", track_number);
    }
    if let Some(ref genre) = song.genre {
        println!("  genre: {}", genre);
    }
    if let Some(duration) = song.formatted_duration() {
        println!("  duration: {}", duration);
    }

    // Show MusicBrainz metadata if present
    if let Some(mb_metadata) = song.metadata.get("musicbrainz") {
        println!(
            "  musicbrainz_data: {}",
            serde_json::to_string_pretty(mb_metadata).unwrap_or_default()
        );
    }
}

/// Check if a confidence threshold is valid (0-100)
pub fn validate_confidence_threshold(threshold: f32) -> Result<f32, String> {
    if threshold < 0.0 || threshold > 100.0 {
        return Err(format!(
            "confidence threshold must be between 0 and 100, got: {}",
            threshold
        ));
    }
    Ok(threshold / 100.0) // Convert percentage to decimal
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_confidence() {
        assert_eq!(format_confidence(0.85), "85.0%");
        assert_eq!(format_confidence(0.123), "12.3%");
        assert_eq!(format_confidence(1.0), "100.0%");
    }

    #[test]
    fn test_format_duration_ms() {
        assert_eq!(format_duration_ms(Some(180000)), "3:00");
        assert_eq!(format_duration_ms(Some(125000)), "2:05");
        assert_eq!(format_duration_ms(None), "unknown");
    }

    #[test]
    fn test_validate_confidence_threshold() {
        assert!(validate_confidence_threshold(85.0).is_ok());
        assert!(validate_confidence_threshold(0.0).is_ok());
        assert!(validate_confidence_threshold(100.0).is_ok());
        assert!(validate_confidence_threshold(-1.0).is_err());
        assert!(validate_confidence_threshold(101.0).is_err());
    }
}
