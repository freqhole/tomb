//! Directory-based album art detection
//!
//! This module provides functionality to detect and extract album art from
//! directory images when songs don't have embedded artwork. It implements
//! smart heuristics to determine if a directory represents an album and
//! finds appropriate images to use as album art.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use thiserror::Error;
use tracing::debug;

/// Errors that can occur during directory art detection
#[derive(Error, Debug)]
pub enum DirectoryArtError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Image processing error: {0}")]
    ImageProcessing(String),
    #[error("No suitable images found")]
    NoSuitableImages,
}

/// Information about a potential album art image found in a directory
#[derive(Debug, Clone)]
pub struct DirectoryImage {
    /// Path to the image file
    pub path: PathBuf,
    /// File size in bytes
    pub size: u64,
    /// Original filename
    pub filename: String,
    /// Priority score (higher = better candidate)
    pub priority: i32,
    /// Image data (loaded lazily)
    pub data: Option<Vec<u8>>,
}

/// Information about a directory and its audio files for album detection
#[derive(Debug)]
pub struct DirectoryContext {
    /// Path to the directory
    pub path: PathBuf,
    /// Audio files in this directory
    pub audio_files: Vec<PathBuf>,
    /// Extracted metadata from audio files
    pub metadata: Vec<AudioFileMetadata>,
}

/// Simplified metadata extracted from audio files for album detection
#[derive(Debug, Clone)]
pub struct AudioFileMetadata {
    pub path: PathBuf,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<i32>,
    pub year: Option<i32>,
}

/// Configuration for directory art detection
#[derive(Debug, Clone)]
pub struct DirectoryArtConfig {
    /// Minimum file size in bytes to consider (avoid tiny icons)
    pub min_file_size: u64,
    /// Maximum file size in bytes to consider (avoid huge photos)
    pub max_file_size: u64,
    /// Supported image extensions
    pub supported_extensions: Vec<String>,
    /// Minimum number of audio files to consider a directory an album
    pub min_audio_files_for_album: usize,
    /// Priority weights for different filename patterns
    pub filename_priorities: HashMap<String, i32>,
}

impl Default for DirectoryArtConfig {
    fn default() -> Self {
        let mut filename_priorities = HashMap::new();

        // Higher scores = better candidates
        filename_priorities.insert("cover".to_string(), 100);
        filename_priorities.insert("folder".to_string(), 90);
        filename_priorities.insert("album".to_string(), 80);
        filename_priorities.insert("front".to_string(), 70);
        filename_priorities.insert("albumart".to_string(), 60);
        filename_priorities.insert("artwork".to_string(), 50);

        Self {
            min_file_size: 1024,             // 1KB minimum
            max_file_size: 50 * 1024 * 1024, // 50MB maximum
            supported_extensions: vec![
                "jpg".to_string(),
                "jpeg".to_string(),
                "png".to_string(),
                "webp".to_string(),
                "gif".to_string(),
                "bmp".to_string(),
            ],
            min_audio_files_for_album: 2,
            filename_priorities,
        }
    }
}

/// Main struct for directory album art detection
pub struct DirectoryArtDetector {
    config: DirectoryArtConfig,
}

impl DirectoryArtDetector {
    /// Create a new directory art detector with default configuration
    pub fn new() -> Self {
        Self {
            config: DirectoryArtConfig::default(),
        }
    }

    /// Create a new directory art detector with custom configuration
    pub fn with_config(config: DirectoryArtConfig) -> Self {
        Self { config }
    }

    /// Analyze a directory context to determine if it likely represents an album
    pub fn is_likely_album(&self, context: &DirectoryContext) -> bool {
        let audio_count = context.audio_files.len();

        // Need minimum number of audio files
        if audio_count < self.config.min_audio_files_for_album {
            debug!(
                "Directory {} has too few audio files ({}) to be considered an album",
                context.path.display(),
                audio_count
            );
            return false;
        }

        // Check for consistent album metadata
        let albums: Vec<_> = context
            .metadata
            .iter()
            .filter_map(|m| m.album.as_ref())
            .collect();

        let artists: Vec<_> = context
            .metadata
            .iter()
            .filter_map(|m| m.artist.as_ref().or(m.album_artist.as_ref()))
            .collect();

        // Calculate consistency scores
        let album_consistency = self.calculate_consistency(&albums);
        let artist_consistency = self.calculate_consistency(&artists);

        // Check for sequential track numbers
        let track_numbers: Vec<_> = context
            .metadata
            .iter()
            .filter_map(|m| m.track_number)
            .collect();

        let has_sequential_tracks = self.has_sequential_tracks(&track_numbers);

        debug!(
            "Album analysis for {}: albums={:.2}, artists={:.2}, sequential_tracks={}",
            context.path.display(),
            album_consistency,
            artist_consistency,
            has_sequential_tracks
        );

        // Consider it an album if we have good consistency or sequential tracks
        album_consistency > 0.7 || artist_consistency > 0.7 || has_sequential_tracks
    }

    /// Find potential album art images in a directory
    pub async fn find_directory_images(
        &self,
        directory: &Path,
    ) -> Result<Vec<DirectoryImage>, DirectoryArtError> {
        let mut images = Vec::new();

        let entries = std::fs::read_dir(directory)?;

        for entry in entries {
            let entry = entry?;
            let path = entry.path();

            if !path.is_file() {
                continue;
            }

            if let Some(extension) = path.extension().and_then(|e| e.to_str()) {
                let ext_lower = extension.to_lowercase();

                if self.config.supported_extensions.contains(&ext_lower) {
                    let metadata = entry.metadata()?;
                    let size = metadata.len();

                    // Check size constraints
                    if size < self.config.min_file_size || size > self.config.max_file_size {
                        debug!(
                            "Skipping image {} due to size constraints ({})",
                            path.display(),
                            size
                        );
                        continue;
                    }

                    let filename = path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_lowercase();

                    let priority = self.calculate_image_priority(&filename, size);

                    images.push(DirectoryImage {
                        path: path.clone(),
                        size,
                        filename: filename.clone(),
                        priority,
                        data: None, // Load lazily
                    });

                    debug!(
                        "Found potential album art: {} (priority: {})",
                        path.display(),
                        priority
                    );
                }
            }
        }

        // Sort by priority (highest first)
        images.sort_by(|a, b| b.priority.cmp(&a.priority));

        Ok(images)
    }

    /// Load image data for a directory image
    pub async fn load_image_data(
        &self,
        image: &mut DirectoryImage,
    ) -> Result<(), DirectoryArtError> {
        if image.data.is_none() {
            let data = std::fs::read(&image.path)?;
            image.data = Some(data);
        }
        Ok(())
    }

    /// Calculate consistency score for a list of strings (0.0 = all different, 1.0 = all same)
    fn calculate_consistency(&self, values: &[&String]) -> f64 {
        if values.is_empty() {
            return 0.0;
        }

        let mut counts = HashMap::new();
        for value in values {
            *counts.entry(value).or_insert(0) += 1;
        }

        let max_count = counts.values().max().unwrap_or(&0);
        *max_count as f64 / values.len() as f64
    }

    /// Check if track numbers are roughly sequential
    fn has_sequential_tracks(&self, track_numbers: &[i32]) -> bool {
        if track_numbers.len() < 2 {
            return false;
        }

        let mut sorted_tracks = track_numbers.to_vec();
        sorted_tracks.sort();

        // Check if we have a reasonable sequence (allowing some gaps)
        let first = sorted_tracks[0];
        let last = sorted_tracks[sorted_tracks.len() - 1];
        let expected_range = last - first + 1;
        let actual_count = sorted_tracks.len() as i32;

        // Allow up to 50% gaps in track numbering
        actual_count as f64 >= (expected_range as f64 * 0.5)
    }

    /// Calculate priority score for an image based on filename and size
    fn calculate_image_priority(&self, filename: &str, size: u64) -> i32 {
        let mut priority = 0;

        // Check filename patterns
        for (pattern, score) in &self.config.filename_priorities {
            if filename.contains(pattern) {
                priority += score;
                break; // Take the first match to avoid double-scoring
            }
        }

        // Bonus for reasonable size (prefer larger images, but not too large)
        let size_score = match size {
            0..=10_000 => -10,           // Very small, probably not album art
            10_001..=100_000 => 10,      // Small but reasonable
            100_001..=1_000_000 => 20,   // Good size range
            1_000_001..=5_000_000 => 15, // Large but still good
            _ => 5,                      // Very large, might be a photo
        };

        priority += size_score;

        // If no specific pattern matched, give a base score
        if priority <= size_score {
            priority += 10; // Base score for any image
        }

        priority
    }
}

impl Default for DirectoryArtDetector {
    fn default() -> Self {
        Self::new()
    }
}

/// Helper function to extract basic metadata from an audio file for album detection
pub async fn extract_basic_metadata(path: &Path) -> Result<AudioFileMetadata, DirectoryArtError> {
    // This is a simplified version that just extracts what we need for album detection
    // We could use lofty here directly, or reuse existing extraction logic

    use lofty::{Accessor, Probe, TaggedFileExt};

    let tagged_file = Probe::open(path).and_then(|p| p.read()).map_err(|e| {
        DirectoryArtError::ImageProcessing(format!("Could not read audio file: {}", e))
    })?;

    let tag = tagged_file.primary_tag();

    let metadata = if let Some(tag) = tag {
        let artist = tag.artist().map(|s| s.to_string());
        let album = tag.album().map(|s| s.to_string());
        let album_artist = tag
            .get_string(&lofty::ItemKey::AlbumArtist)
            .map(|s| s.to_string());
        let track_number = tag.track().map(|t| t as i32);
        let year = tag.year().map(|y| y as i32);

        AudioFileMetadata {
            path: path.to_path_buf(),
            artist,
            album,
            album_artist,
            track_number,
            year,
        }
    } else {
        // No tags found
        AudioFileMetadata {
            path: path.to_path_buf(),
            artist: None,
            album: None,
            album_artist: None,
            track_number: None,
            year: None,
        }
    };

    Ok(metadata)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_consistency_calculation() {
        let detector = DirectoryArtDetector::new();

        // All same
        let same_values = vec![
            "album1".to_string(),
            "album1".to_string(),
            "album1".to_string(),
        ];
        let same_refs: Vec<&String> = same_values.iter().collect();
        assert_eq!(detector.calculate_consistency(&same_refs), 1.0);

        // All different
        let diff_values = vec![
            "album1".to_string(),
            "album2".to_string(),
            "album3".to_string(),
        ];
        let diff_refs: Vec<&String> = diff_values.iter().collect();
        assert_eq!(detector.calculate_consistency(&diff_refs), 1.0 / 3.0);

        // Mixed
        let mixed_values = vec![
            "album1".to_string(),
            "album1".to_string(),
            "album2".to_string(),
        ];
        let mixed_refs: Vec<&String> = mixed_values.iter().collect();
        assert_eq!(detector.calculate_consistency(&mixed_refs), 2.0 / 3.0);
    }

    #[test]
    fn test_sequential_tracks() {
        let detector = DirectoryArtDetector::new();

        // Perfect sequence
        assert!(detector.has_sequential_tracks(&[1, 2, 3, 4, 5]));

        // Sequence with gaps
        assert!(detector.has_sequential_tracks(&[1, 3, 5, 7]));

        // Too few tracks
        assert!(!detector.has_sequential_tracks(&[1]));

        // Too many gaps
        assert!(!detector.has_sequential_tracks(&[1, 10]));
    }

    #[test]
    fn test_image_priority_calculation() {
        let detector = DirectoryArtDetector::new();

        // Cover image should get high priority
        let cover_priority = detector.calculate_image_priority("cover", 500_000);
        let random_priority = detector.calculate_image_priority("random", 500_000);

        assert!(cover_priority > random_priority);

        // Size should matter
        let small_priority = detector.calculate_image_priority("cover", 5_000);
        let good_priority = detector.calculate_image_priority("cover", 500_000);

        assert!(good_priority > small_priority);
    }
}
