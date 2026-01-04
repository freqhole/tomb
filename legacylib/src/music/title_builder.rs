//! Smart title construction for music files
//!
//! This module provides intelligent title building from audio metadata,
//! with fallback strategies for missing or incomplete information.

use super::AudioMetadata;

/// Errors that can occur during title construction
#[derive(Debug, thiserror::Error)]
pub enum TitleBuilderError {
    #[error("No valid title could be constructed from available data")]
    NoValidTitle,
    #[error("Invalid file path: {0}")]
    InvalidFilePath(String),
}

/// Configuration for title building behavior
#[derive(Debug, Clone)]
pub struct TitleBuilderConfig {
    /// Include artist in title when available
    pub include_artist: bool,
    /// Separator between title and artist
    pub artist_separator: String,
    /// Maximum length for constructed titles
    pub max_length: Option<usize>,
    /// Whether to clean up common filename patterns
    pub clean_filename_patterns: bool,
    /// Custom tag priority order for title extraction
    pub title_tag_priority: Vec<String>,
    /// Custom tag priority order for artist extraction
    pub artist_tag_priority: Vec<String>,
}

impl Default for TitleBuilderConfig {
    fn default() -> Self {
        Self {
            include_artist: true,
            artist_separator: " - ".to_string(),
            max_length: Some(200),
            clean_filename_patterns: true,
            title_tag_priority: vec![
                "Title".to_string(),
                "TITLE".to_string(),
                "title".to_string(),
                "Track".to_string(),
                "TrackTitle".to_string(),
            ],
            artist_tag_priority: vec![
                "Artist".to_string(),
                "ARTIST".to_string(),
                "artist".to_string(),
                "AlbumArtist".to_string(),
                "Performer".to_string(),
            ],
        }
    }
}

/// Smart title builder for music files
#[derive(Debug, Clone)]
pub struct TitleBuilder {
    config: TitleBuilderConfig,
}

impl TitleBuilder {
    /// Create a new title builder with default configuration
    pub fn new() -> Self {
        Self {
            config: TitleBuilderConfig::default(),
        }
    }

    /// Create a title builder with custom configuration
    pub fn with_config(config: TitleBuilderConfig) -> Self {
        Self { config }
    }

    /// Build a title from audio metadata
    pub fn build_title(&self, metadata: &AudioMetadata) -> String {
        // Priority 1: Title + Artist tags
        if let Some(title) = self.extract_title_from_tags(metadata) {
            if self.config.include_artist {
                if let Some(artist) = self.extract_artist_from_tags(metadata) {
                    let combined = format!("{}{}{}", title, self.config.artist_separator, artist);
                    return self.apply_length_limit(combined);
                }
            }
            return self.apply_length_limit(title);
        }

        // Priority 2: Filename without extension (cleaned)
        if let Some(filename) = metadata.filename_without_extension() {
            let cleaned = if self.config.clean_filename_patterns {
                self.clean_filename(&filename)
            } else {
                filename
            };
            return self.apply_length_limit(cleaned);
        }

        // Priority 3: Full file path as last resort
        self.apply_length_limit(metadata.file_path.clone())
    }

    /// Extract title from metadata tags using priority order
    fn extract_title_from_tags(&self, metadata: &AudioMetadata) -> Option<String> {
        for tag_name in &self.config.title_tag_priority {
            if let Some(title) = metadata.get_tag(tag_name) {
                let cleaned = title.trim().to_string();
                if !cleaned.is_empty() {
                    return Some(cleaned);
                }
            }
        }
        None
    }

    /// Extract artist from metadata tags using priority order
    fn extract_artist_from_tags(&self, metadata: &AudioMetadata) -> Option<String> {
        for tag_name in &self.config.artist_tag_priority {
            if let Some(artist) = metadata.get_tag(tag_name) {
                let cleaned = artist.trim().to_string();
                if !cleaned.is_empty() {
                    return Some(cleaned);
                }
            }
        }
        None
    }

    /// Clean up common filename patterns
    fn clean_filename(&self, filename: &str) -> String {
        let mut cleaned = filename.to_string();

        // Remove common track number patterns like "01 - " or "1. " or "Track 05 - "
        if let Ok(re) = regex::Regex::new(r"^(?:Track\s+)?\d{1,3}[\s\-\.]+") {
            cleaned = re.replace(&cleaned, "").to_string();
        }

        // Remove file extension if somehow still present
        if let Some(pos) = cleaned.rfind('.') {
            if pos > 0 {
                let potential_ext = &cleaned[pos + 1..];
                if potential_ext.len() <= 4 && potential_ext.chars().all(|c| c.is_alphanumeric()) {
                    cleaned = cleaned[..pos].to_string();
                }
            }
        }

        // Clean up extra whitespace
        cleaned = cleaned.trim().to_string();

        // Replace multiple spaces/underscores with single space
        if let Ok(re) = regex::Regex::new(r"[\s_]+") {
            cleaned = re.replace_all(&cleaned, " ").to_string();
        }

        // If cleaning resulted in empty string, return original
        if cleaned.is_empty() {
            filename.to_string()
        } else {
            cleaned
        }
    }

    /// Apply maximum length limit if configured
    fn apply_length_limit(&self, title: String) -> String {
        if let Some(max_len) = self.config.max_length {
            if title.len() > max_len {
                let truncated = title.chars().take(max_len - 3).collect::<String>();
                format!("{}...", truncated)
            } else {
                title
            }
        } else {
            title
        }
    }

    /// Get a reference to the configuration
    pub fn config(&self) -> &TitleBuilderConfig {
        &self.config
    }

    /// Update the configuration
    pub fn set_config(&mut self, config: TitleBuilderConfig) {
        self.config = config;
    }
}

impl Default for TitleBuilder {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn create_metadata_with_tags(tags: Vec<(&str, &str)>, file_path: &str) -> AudioMetadata {
        let mut tag_map = HashMap::new();
        for (key, value) in tags {
            tag_map.insert(key.to_string(), value.to_string());
        }
        AudioMetadata::new(tag_map, file_path.to_string())
    }

    #[test]
    fn test_title_with_artist() {
        let metadata = create_metadata_with_tags(
            vec![("Title", "Bohemian Rhapsody"), ("Artist", "Queen")],
            "/music/queen/song.mp3",
        );

        let builder = TitleBuilder::new();
        let title = builder.build_title(&metadata);

        assert_eq!(title, "Bohemian Rhapsody - Queen");
    }

    #[test]
    fn test_title_only() {
        let metadata = create_metadata_with_tags(
            vec![("Title", "Bohemian Rhapsody")],
            "/music/queen/song.mp3",
        );

        let builder = TitleBuilder::new();
        let title = builder.build_title(&metadata);

        assert_eq!(title, "Bohemian Rhapsody");
    }

    #[test]
    fn test_artist_disabled() {
        let metadata = create_metadata_with_tags(
            vec![("Title", "Bohemian Rhapsody"), ("Artist", "Queen")],
            "/music/queen/song.mp3",
        );

        let mut config = TitleBuilderConfig::default();
        config.include_artist = false;

        let builder = TitleBuilder::with_config(config);
        let title = builder.build_title(&metadata);

        assert_eq!(title, "Bohemian Rhapsody");
    }

    #[test]
    fn test_custom_separator() {
        let metadata = create_metadata_with_tags(
            vec![("Title", "Bohemian Rhapsody"), ("Artist", "Queen")],
            "/music/queen/song.mp3",
        );

        let mut config = TitleBuilderConfig::default();
        config.artist_separator = " by ".to_string();

        let builder = TitleBuilder::with_config(config);
        let title = builder.build_title(&metadata);

        assert_eq!(title, "Bohemian Rhapsody by Queen");
    }

    #[test]
    fn test_fallback_to_filename() {
        let metadata = create_metadata_with_tags(vec![], "/music/queen/01 - Bohemian Rhapsody.mp3");

        let builder = TitleBuilder::new();
        let title = builder.build_title(&metadata);

        assert_eq!(title, "Bohemian Rhapsody");
    }

    #[test]
    fn test_filename_cleaning() {
        let test_cases = vec![
            ("01 - Great Song", "Great Song"),
            ("1. Another Song", "Another Song"),
            ("03-Third_Song", "Third Song"),
            ("Track 05 - Fourth Song", "Fourth Song"),
            ("99 Final Song", "Final Song"),
            ("song_with_underscores", "song with underscores"),
            ("Song   with   spaces", "Song with spaces"),
        ];

        let builder = TitleBuilder::new();

        for (input, expected) in test_cases {
            let cleaned = builder.clean_filename(input);
            assert_eq!(cleaned, expected, "Failed for input: {}", input);
        }
    }

    #[test]
    fn test_length_limit() {
        let metadata = create_metadata_with_tags(
            vec![
                ("Title", "A Very Long Song Title That Exceeds Normal Length"),
                (
                    "Artist",
                    "Artist With A Very Long Name That Also Exceeds Normal Length",
                ),
            ],
            "/music/test.mp3",
        );

        let mut config = TitleBuilderConfig::default();
        config.max_length = Some(20);

        let builder = TitleBuilder::with_config(config);
        let title = builder.build_title(&metadata);

        assert!(title.len() <= 20);
        assert!(title.ends_with("..."));
    }

    #[test]
    fn test_case_insensitive_tags() {
        let metadata = create_metadata_with_tags(
            vec![("TITLE", "Test Song"), ("artist", "Test Artist")],
            "/music/test.mp3",
        );

        let builder = TitleBuilder::new();
        let title = builder.build_title(&metadata);

        assert_eq!(title, "Test Song - Test Artist");
    }

    #[test]
    fn test_tag_priority() {
        let metadata = create_metadata_with_tags(
            vec![
                ("Track", "Wrong Title"),
                ("Title", "Correct Title"),
                ("TITLE", "Also Wrong"),
            ],
            "/music/test.mp3",
        );

        let builder = TitleBuilder::new();
        let title = builder.build_title(&metadata);

        assert_eq!(title, "Correct Title");
    }

    #[test]
    fn test_empty_tags_ignored() {
        let metadata = create_metadata_with_tags(
            vec![("Title", ""), ("TITLE", "   "), ("Track", "Actual Title")],
            "/music/test.mp3",
        );

        let builder = TitleBuilder::new();
        let title = builder.build_title(&metadata);

        assert_eq!(title, "Actual Title");
    }

    #[test]
    fn test_fallback_to_full_path() {
        // Test with a root path "/" to force full path fallback
        let metadata = AudioMetadata {
            tags: std::collections::HashMap::new(),
            file_path: "/".to_string(),
        };

        let builder = TitleBuilder::new();
        let title = builder.build_title(&metadata);

        // Since filename_without_extension returns None for root path,
        // it should fallback to the full path
        assert_eq!(title, "/");
    }

    #[test]
    fn test_whitespace_trimming() {
        let metadata = create_metadata_with_tags(
            vec![
                ("Title", "  Spaced Title  "),
                ("Artist", "\t Tabbed Artist \n"),
            ],
            "/music/test.mp3",
        );

        let builder = TitleBuilder::new();
        let title = builder.build_title(&metadata);

        assert_eq!(title, "Spaced Title - Tabbed Artist");
    }

    #[test]
    fn test_custom_tag_priority() {
        let metadata = create_metadata_with_tags(
            vec![("Title", "Wrong Title"), ("CustomTitle", "Correct Title")],
            "/music/test.mp3",
        );

        let mut config = TitleBuilderConfig::default();
        config.title_tag_priority = vec!["CustomTitle".to_string(), "Title".to_string()];

        let builder = TitleBuilder::with_config(config);
        let title = builder.build_title(&metadata);

        assert_eq!(title, "Correct Title");
    }
}
