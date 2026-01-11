//! Audio file import and metadata extraction
//!
//! Handles importing audio files into the music library, including:
//! - Metadata extraction using lofty
//! - Song/artist/album creation via music CRUD
//! - Analytics event recording
//! - Fallback handling when metadata extraction fails

use crate::analytics::{record_event, MediaEvent, MediaEventType};
use crate::jobs::JobError;
use crate::music::crud::{add_song, ImportSongRequest};
use lofty::{AudioFile, ItemValue, Probe, TaggedFileExt};
use std::collections::HashMap;
use std::path::Path;

/// Result of importing an audio file
#[derive(Debug, Clone)]
pub struct ImportResult {
    /// ID of the created song
    pub song_id: String,
    /// ID of the artist (if created/found)
    pub artist_id: Option<String>,
    /// ID of the album (if created/found)
    pub album_id: Option<String>,
    /// Whether metadata was successfully extracted
    pub metadata_extracted: bool,
}

/// Extract metadata from an audio file and import it as a song
///
/// This is the main import function that attempts to extract rich metadata
/// from the audio file and create a complete song record with relationships.
pub async fn extract_and_import(
    media_blob_id: &str,
    file_path: &Path,
) -> Result<ImportResult, JobError> {
    // Parse audio file with lofty with error handling
    let tagged_file = match Probe::open(file_path).and_then(|p| p.read()) {
        Ok(file) => file,
        Err(e) => {
            println!(
                "warning: could not read metadata from {:?}: {}",
                file_path, e
            );
            // Fall back to basic song record with filename
            return import_basic(media_blob_id, file_path).await;
        }
    };

    // Extract properties with fallbacks
    let properties = tagged_file.properties();
    let duration_ms = properties.duration().as_millis() as i64;

    // Extract all tag data for comprehensive parsing
    let mut tags_map = HashMap::new();
    if let Some(tag) = tagged_file.primary_tag() {
        for item in tag.items() {
            let key = format!("{:?}", item.key());
            let value_str = match item.value() {
                ItemValue::Text(s) | ItemValue::Locator(s) => s.clone(),
                ItemValue::Binary(_) => continue, // Skip binary data
            };

            if !value_str.trim().is_empty() {
                tags_map.insert(key, value_str.trim().to_string());
            }
        }
    }

    // Helper function to get tag value case-insensitively with fallbacks
    let get_tag = |preferred: &str, fallbacks: &[&str]| -> Option<String> {
        // Try preferred key first
        if let Some(value) = tags_map.get(preferred) {
            if !value.is_empty() {
                return Some(value.clone());
            }
        }

        // Try fallback keys
        for fallback in fallbacks {
            if let Some(value) = tags_map.get(*fallback) {
                if !value.is_empty() {
                    return Some(value.clone());
                }
            }
        }

        // Try case-insensitive search
        let all_keys = [&[preferred], fallbacks].concat();
        for search_key in all_keys {
            let key_lower = search_key.to_lowercase();
            for (k, v) in tags_map.iter() {
                if k.to_lowercase() == key_lower && !v.is_empty() {
                    return Some(v.clone());
                }
            }
        }

        None
    };

    // Parse numeric values safely with fraction handling
    let parse_track_number =
        |s: &str| -> Option<i64> { s.split('/').next()?.trim().parse::<i64>().ok() };

    // Extract standardized fields with comprehensive fallbacks
    let title = get_tag("TrackTitle", &["Title", "TITLE", "TIT2"]).unwrap_or_else(|| {
        file_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Unknown Title")
            .to_string()
    });

    let artist_name = get_tag(
        "TrackArtist",
        &["Artist", "ARTIST", "TPE1", "AlbumArtist", "TPE2"],
    )
    .unwrap_or_else(|| "Unknown Artist".to_string());

    let album_title = get_tag("AlbumTitle", &["Album", "ALBUM", "TALB"]);

    let track_number = get_tag("TrackNumber", &["TRCK", "Track"])
        .and_then(|s| parse_track_number(&s))
        .unwrap_or(1); // Default to track 1

    let disc_number = get_tag("DiscNumber", &["TPOS", "Disc", "PartOfSet"])
        .and_then(|s| parse_track_number(&s))
        .unwrap_or(1); // Default to disc 1

    let year = get_tag("RecordingDate", &["Year", "DATE", "TDRC", "TYER"])
        .and_then(|s| s.split('-').next()?.trim().parse::<i64>().ok());

    let genre = get_tag("Genre", &["GENRE", "TCON"]);

    let lyrics = get_tag("Lyrics", &["USLT", "lyrics", "lyrics-eng", "LYRICS"]);

    // Use existing import function to create song with metadata
    let import_request = ImportSongRequest {
        media_blob_id: media_blob_id.to_string(),
        title,
        artist_name: Some(artist_name),
        album_title,
        genre_name: genre,
        track_number,
        disc_number,
        duration: Some(duration_ms),
        year,
        bpm: None,
        key_signature: None,
        lyrics,
        created_by: Some("job_processor".to_string()),
    };

    let response = add_song(import_request).await;

    let result = if response.success {
        response.data.ok_or_else(|| JobError::ProcessingFailed {
            reason: "Song import succeeded but returned no data".to_string(),
        })?
    } else {
        let error_messages: Vec<String> =
            response.errors.iter().map(|e| e.detail.clone()).collect();
        return Err(JobError::ProcessingFailed {
            reason: format!("Failed to import song: {}", error_messages.join(", ")),
        });
    };

    // Record analytics event for song import (best-effort, don't fail if this errors)
    // Note: user_id is left null for system/automated imports
    let event_data = serde_json::json!({
        "source": "job_processor",
        "file_path": file_path.to_string_lossy(),
        "metadata_extracted": true
    });

    let media_event =
        MediaEvent::new(media_blob_id.to_string(), MediaEventType::Add).with_event_data(event_data);

    if let Err(e) = record_event(&media_event).await {
        eprintln!(
            "Warning: Failed to record analytics event for song import: {}",
            e
        );
    }

    Ok(ImportResult {
        song_id: result.song.id,
        artist_id: result.artist.map(|a| a.id),
        album_id: result.album.map(|a| a.id),
        metadata_extracted: true,
    })
}

/// Import an audio file with minimal metadata (fallback when extraction fails)
///
/// Creates a basic song record using the filename as the title and
/// default values for other fields.
pub async fn import_basic(media_blob_id: &str, file_path: &Path) -> Result<ImportResult, JobError> {
    let title = file_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown Title")
        .to_string();

    let import_request = ImportSongRequest {
        media_blob_id: media_blob_id.to_string(),
        title,
        artist_name: Some("Unknown Artist".to_string()),
        album_title: None,
        genre_name: None,
        track_number: 1, // Default values for unknown songs
        disc_number: 1,
        duration: None,
        year: None,
        bpm: None,
        key_signature: None,
        lyrics: None,
        created_by: Some("job_processor".to_string()),
    };

    let response = add_song(import_request).await;

    let result = if response.success {
        response.data.ok_or_else(|| JobError::ProcessingFailed {
            reason: "Song import succeeded but returned no data".to_string(),
        })?
    } else {
        let error_messages: Vec<String> =
            response.errors.iter().map(|e| e.detail.clone()).collect();
        return Err(JobError::ProcessingFailed {
            reason: format!(
                "Failed to create basic song record: {}",
                error_messages.join(", ")
            ),
        });
    };

    // Record analytics event for song import (best-effort, don't fail if this errors)
    // Note: user_id is left null for system/automated imports
    let event_data = serde_json::json!({
        "source": "job_processor",
        "file_path": file_path.to_string_lossy(),
        "metadata_extracted": false
    });

    let media_event =
        MediaEvent::new(media_blob_id.to_string(), MediaEventType::Add).with_event_data(event_data);

    if let Err(e) = record_event(&media_event).await {
        eprintln!(
            "Warning: Failed to record analytics event for song import: {}",
            e
        );
    }

    Ok(ImportResult {
        song_id: result.song.id,
        artist_id: result.artist.map(|a| a.id),
        album_id: result.album.map(|a| a.id),
        metadata_extracted: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_import_result_creation() {
        let result = ImportResult {
            song_id: "song123".to_string(),
            artist_id: Some("artist456".to_string()),
            album_id: Some("album789".to_string()),
            metadata_extracted: true,
        };

        assert_eq!(result.song_id, "song123");
        assert!(result.metadata_extracted);
    }
}
