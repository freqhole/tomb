//! Music metadata extraction utilities
//!
//! This module provides functionality for extracting metadata from audio files,
//! extracted and cleaned up from the original file_walker implementation.

use lofty::{AudioFile, ItemValue, Probe, TaggedFileExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::time::SystemTime;
use thiserror::Error;
use tokio::fs;

/// Errors that can occur during metadata extraction
#[derive(Debug, Error)]
pub enum MetadataError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Audio file parsing error: {0}")]
    AudioParsingError(String),
    #[error("Invalid file path: {0}")]
    InvalidPath(String),
}

/// Audio metadata extracted from file tags
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioTags {
    /// Raw tag data from the audio file
    pub tags: HashMap<String, String>,
}

/// Audio properties extracted from the file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioProperties {
    /// Duration in seconds
    pub duration_seconds: Option<u64>,
    /// Sample rate in Hz
    pub sample_rate: Option<u32>,
    /// Number of audio channels
    pub channels: Option<u8>,
    /// Audio bitrate in bits per second
    pub bitrate: Option<u32>,
    /// Bit depth (bits per sample)
    pub bit_depth: Option<u8>,
}

/// File system metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMetadata {
    /// File size in bytes
    pub size_bytes: u64,
    /// File modification time
    pub modified: Option<SystemTime>,
    /// File creation time
    pub created: Option<SystemTime>,
    /// File extension (without the dot)
    pub extension: Option<String>,
}

/// Complete metadata for an audio file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompleteMetadata {
    /// Audio tag metadata
    pub tags: AudioTags,
    /// Audio file properties
    pub properties: AudioProperties,
    /// File system metadata
    pub file_metadata: FileMetadata,
}

/// Metadata extractor for audio files
pub struct MetadataExtractor {
    /// Whether to ignore errors and continue extraction
    pub ignore_errors: bool,
}

impl MetadataExtractor {
    /// Create a new metadata extractor
    pub fn new() -> Self {
        Self {
            ignore_errors: true,
        }
    }

    /// Create a metadata extractor that fails on any error
    pub fn strict() -> Self {
        Self {
            ignore_errors: false,
        }
    }

    /// Extract complete metadata from an audio file
    pub async fn extract_metadata<P: AsRef<Path>>(
        &self,
        path: P,
    ) -> Result<CompleteMetadata, MetadataError> {
        let path = path.as_ref();

        let tags = self.extract_tags(path).await?;
        let properties = self.extract_properties(path).await?;
        let file_metadata = self.extract_file_metadata(path).await?;

        Ok(CompleteMetadata {
            tags,
            properties,
            file_metadata,
        })
    }

    /// Extract only audio tags from a file
    pub async fn extract_tags<P: AsRef<Path>>(&self, path: P) -> Result<AudioTags, MetadataError> {
        let path = path.as_ref();
        let mut tags_map = HashMap::new();

        let tagged_file = match Probe::open(path).and_then(|p| p.read()) {
            Ok(file) => file,
            Err(e) => {
                if self.ignore_errors {
                    eprintln!("Warning: Could not read metadata from {:?}: {}", path, e);
                    return Ok(AudioTags { tags: tags_map });
                } else {
                    return Err(MetadataError::AudioParsingError(format!(
                        "Could not read metadata from {:?}: {}",
                        path, e
                    )));
                }
            }
        };

        if let Some(tag) = tagged_file.primary_tag() {
            for item in tag.items() {
                let key = format!("{:?}", item.key());
                let value_str = match item.value() {
                    ItemValue::Text(s) | ItemValue::Locator(s) => s.clone(),
                    ItemValue::Binary(_) => {
                        if self.ignore_errors {
                            continue; // Skip binary data
                        } else {
                            String::new()
                        }
                    }
                };

                if !value_str.is_empty() {
                    tags_map.insert(key, value_str);
                }
            }
        }

        Ok(AudioTags { tags: tags_map })
    }

    /// Extract audio properties from a file
    pub async fn extract_properties<P: AsRef<Path>>(
        &self,
        path: P,
    ) -> Result<AudioProperties, MetadataError> {
        let path = path.as_ref();

        let tagged_file = match Probe::open(path).and_then(|p| p.read()) {
            Ok(file) => file,
            Err(e) => {
                if self.ignore_errors {
                    eprintln!("Warning: Could not read properties from {:?}: {}", path, e);
                    return Ok(AudioProperties {
                        duration_seconds: None,
                        sample_rate: None,
                        channels: None,
                        bitrate: None,
                        bit_depth: None,
                    });
                } else {
                    return Err(MetadataError::AudioParsingError(format!(
                        "Could not read properties from {:?}: {}",
                        path, e
                    )));
                }
            }
        };

        let props = tagged_file.properties();

        Ok(AudioProperties {
            duration_seconds: Some(props.duration().as_secs()),
            sample_rate: props.sample_rate(),
            channels: props.channels(),
            bitrate: props.audio_bitrate(),
            bit_depth: props.bit_depth(),
        })
    }

    /// Extract file system metadata
    pub async fn extract_file_metadata<P: AsRef<Path>>(
        &self,
        path: P,
    ) -> Result<FileMetadata, MetadataError> {
        let path = path.as_ref();
        let metadata = fs::metadata(path).await?;

        let modified = metadata.modified().ok();
        let created = metadata.created().ok();

        let extension = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|s| s.to_lowercase());

        Ok(FileMetadata {
            size_bytes: metadata.len(),
            modified,
            created,
            extension,
        })
    }

    /// Get common metadata fields in a standardized format
    pub fn get_standard_fields(&self, metadata: &CompleteMetadata) -> StandardFields {
        StandardFields::from_metadata(metadata)
    }
}

impl Default for MetadataExtractor {
    fn default() -> Self {
        Self::new()
    }
}

/// Common metadata fields in a standardized format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StandardFields {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub year: Option<u32>,
    pub genre: Option<String>,
    pub duration_seconds: Option<u64>,
    pub file_size_bytes: u64,
    pub file_extension: Option<String>,
}

impl StandardFields {
    /// Extract standard fields from complete metadata
    pub fn from_metadata(metadata: &CompleteMetadata) -> Self {
        let tags = &metadata.tags.tags;

        // Helper function to get tag value case-insensitively
        let get_tag = |key: &str| -> Option<String> {
            // Try exact match first
            if let Some(value) = tags.get(key) {
                return Some(value.clone());
            }

            // Try case-insensitive match
            let key_lower = key.to_lowercase();
            for (k, v) in tags.iter() {
                if k.to_lowercase() == key_lower {
                    return Some(v.clone());
                }
            }

            None
        };

        // Parse numeric values safely
        let parse_u32 = |s: &str| -> Option<u32> {
            s.parse().ok().or_else(|| {
                // Try extracting just the number part (e.g., "1/10" -> "1")
                s.split('/').next()?.trim().parse().ok()
            })
        };

        Self {
            title: get_tag("Title"),
            artist: get_tag("Artist").or_else(|| get_tag("AlbumArtist")),
            album: get_tag("Album"),
            album_artist: get_tag("AlbumArtist"),
            track_number: get_tag("TrackNumber").and_then(|s| parse_u32(&s)),
            disc_number: get_tag("DiscNumber").and_then(|s| parse_u32(&s)),
            year: get_tag("Year")
                .or_else(|| get_tag("Date"))
                .and_then(|s| parse_u32(&s)),
            genre: get_tag("Genre"),
            duration_seconds: metadata.properties.duration_seconds,
            file_size_bytes: metadata.file_metadata.size_bytes,
            file_extension: metadata.file_metadata.extension.clone(),
        }
    }
}

/// Convenience function to extract metadata with default settings
pub async fn extract_metadata<P: AsRef<Path>>(path: P) -> Result<CompleteMetadata, MetadataError> {
    let extractor = MetadataExtractor::new();
    extractor.extract_metadata(path).await
}

/// Convenience function to extract only standard fields
pub async fn extract_standard_fields<P: AsRef<Path>>(
    path: P,
) -> Result<StandardFields, MetadataError> {
    let extractor = MetadataExtractor::new();
    let metadata = extractor.extract_metadata(path).await?;
    Ok(StandardFields::from_metadata(&metadata))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    #[tokio::test]
    async fn test_extract_file_metadata() {
        let temp_file = NamedTempFile::new().unwrap();
        let test_content = b"Hello, World!";
        fs::write(temp_file.path(), test_content).await.unwrap();

        let extractor = MetadataExtractor::new();
        let metadata = extractor
            .extract_file_metadata(temp_file.path())
            .await
            .unwrap();

        assert_eq!(metadata.size_bytes, test_content.len() as u64);
        assert!(metadata.modified.is_some());
        // Extension might be None for temp files
    }

    #[tokio::test]
    async fn test_extractor_modes() {
        let strict_extractor = MetadataExtractor::strict();
        let lenient_extractor = MetadataExtractor::new();

        assert!(!strict_extractor.ignore_errors);
        assert!(lenient_extractor.ignore_errors);
    }

    #[test]
    fn test_standard_fields_creation() {
        let mut tags = HashMap::new();
        tags.insert("Title".to_string(), "Test Song".to_string());
        tags.insert("Artist".to_string(), "Test Artist".to_string());
        tags.insert("TrackNumber".to_string(), "5/12".to_string());
        tags.insert("Year".to_string(), "2023".to_string());

        let metadata = CompleteMetadata {
            tags: AudioTags { tags },
            properties: AudioProperties {
                duration_seconds: Some(180),
                sample_rate: Some(44100),
                channels: Some(2),
                bitrate: Some(320000),
                bit_depth: Some(16),
            },
            file_metadata: FileMetadata {
                size_bytes: 5000000,
                modified: None,
                created: None,
                extension: Some("mp3".to_string()),
            },
        };

        let fields = StandardFields::from_metadata(&metadata);

        assert_eq!(fields.title, Some("Test Song".to_string()));
        assert_eq!(fields.artist, Some("Test Artist".to_string()));
        assert_eq!(fields.track_number, Some(5));
        assert_eq!(fields.year, Some(2023));
        assert_eq!(fields.duration_seconds, Some(180));
        assert_eq!(fields.file_size_bytes, 5000000);
        assert_eq!(fields.file_extension, Some("mp3".to_string()));
    }

    #[test]
    fn test_case_insensitive_tag_lookup() {
        let mut tags = HashMap::new();
        tags.insert("TITLE".to_string(), "Test Song".to_string());
        tags.insert("artist".to_string(), "Test Artist".to_string());

        let metadata = CompleteMetadata {
            tags: AudioTags { tags },
            properties: AudioProperties {
                duration_seconds: None,
                sample_rate: None,
                channels: None,
                bitrate: None,
                bit_depth: None,
            },
            file_metadata: FileMetadata {
                size_bytes: 0,
                modified: None,
                created: None,
                extension: None,
            },
        };

        let fields = StandardFields::from_metadata(&metadata);

        assert_eq!(fields.title, Some("Test Song".to_string()));
        assert_eq!(fields.artist, Some("Test Artist".to_string()));
    }

    #[test]
    fn test_track_number_parsing() {
        let mut tags = HashMap::new();
        tags.insert("TrackNumber".to_string(), "7/15".to_string());

        let metadata = CompleteMetadata {
            tags: AudioTags { tags },
            properties: AudioProperties {
                duration_seconds: None,
                sample_rate: None,
                channels: None,
                bitrate: None,
                bit_depth: None,
            },
            file_metadata: FileMetadata {
                size_bytes: 0,
                modified: None,
                created: None,
                extension: None,
            },
        };

        let fields = StandardFields::from_metadata(&metadata);
        assert_eq!(fields.track_number, Some(7));
    }
}
