//! Audio file import and metadata extraction
//!
//! Handles importing audio files into the music library, including:
//! - Metadata extraction using lofty
//! - Filename parsing as fallback/supplement
//! - Song/artist/album creation via music CRUD
//! - Compilation album detection and handling
//! - Analytics event recording
//! - Fallback handling when metadata extraction fails

use crate::analytics::{record_event, MediaEvent, MediaEventType};
use crate::jobs::JobError;
use crate::music::crud::{add_song, ImportSongRequest};
use lofty::{AudioFile, FileType, ItemValue, Probe, TaggedFileExt};
use std::collections::HashMap;
use std::path::Path;

use super::filename_parser::parse_filename;

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

/// Metadata extracted from tags and filename
#[derive(Debug, Clone)]
struct ExtractedMetadata {
    /// Song title
    title: String,
    /// Artist name (from artist tag or album artist for compilations)
    artist_name: Option<String>,
    /// Track artist name (for compilations where it differs from album artist)
    track_artist: Option<String>,
    /// Album title
    album_title: Option<String>,
    /// Track number
    track_number: i64,
    /// Disc number
    disc_number: i64,
    /// Duration in milliseconds
    duration_ms: Option<i64>,
    /// Year
    year: Option<i64>,
    /// Genre
    genre: Option<String>,
    /// Lyrics
    lyrics: Option<String>,
    /// BPM
    bpm: Option<i64>,
    /// Whether this is a compilation album
    is_compilation: bool,
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

    // Extract metadata from tags and filename
    let metadata = extract_metadata(&tagged_file, file_path);

    // Extract file properties for the metadata JSON
    let file_props = extract_file_properties(&tagged_file);

    // Extract all tags for the metadata JSON
    let all_tags = extract_all_tags(&tagged_file);

    // Build comprehensive metadata JSON
    let mut song_metadata = serde_json::Map::new();

    // Add file properties
    if !file_props.is_empty() {
        song_metadata.insert("file".to_string(), serde_json::json!(file_props));
    }

    // Add all tags (non-empty only)
    if !all_tags.is_empty() {
        song_metadata.insert("tags".to_string(), serde_json::json!(all_tags));
    }

    // Store compilation flag in metadata
    if metadata.is_compilation {
        song_metadata.insert("is_compilation".to_string(), serde_json::json!(true));
    }

    // Convert metadata map to JSON string if not empty
    let metadata_json = if song_metadata.is_empty() {
        None
    } else {
        Some(serde_json::to_string(&song_metadata).unwrap_or_default())
    };

    // Build import request - track_artist now goes directly on song row for compilations
    let import_request = ImportSongRequest {
        media_blob_id: media_blob_id.to_string(),
        title: metadata.title,
        artist_name: metadata.artist_name,
        album_title: metadata.album_title,
        genre_name: metadata.genre,
        track_number: metadata.track_number,
        disc_number: metadata.disc_number,
        duration: metadata.duration_ms,
        year: metadata.year,
        bpm: metadata.bpm,
        track_artist: if metadata.is_compilation {
            metadata.track_artist
        } else {
            None
        },
        metadata: metadata_json,
        lyrics: metadata.lyrics,
        created_by: Some("job_processor".to_string()),
        is_compilation: metadata.is_compilation,
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
    let event_data = serde_json::json!({
        "source": "job_processor",
        "file_path": file_path.to_string_lossy(),
        "metadata_extracted": true,
        "is_compilation": metadata.is_compilation
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

/// Extract and merge metadata from tags and filename
fn extract_metadata(tagged_file: &lofty::TaggedFile, file_path: &Path) -> ExtractedMetadata {
    // Extract properties
    let properties = tagged_file.properties();
    let duration_ms = properties.duration().as_millis() as i64;

    // Extract all tag data
    let mut tags_map = HashMap::new();
    if let Some(tag) = tagged_file.primary_tag() {
        for item in tag.items() {
            let key = format!("{:?}", item.key());
            let value_str = match item.value() {
                ItemValue::Text(s) | ItemValue::Locator(s) => s.clone(),
                ItemValue::Binary(_) => continue, // skip binary data
            };

            if !value_str.trim().is_empty() {
                tags_map.insert(key, value_str.trim().to_string());
            }
        }
    }

    // Helper function to get tag value case-insensitively with fallbacks
    let get_tag = |preferred: &str, fallbacks: &[&str]| -> Option<String> {
        // try preferred key first
        if let Some(value) = tags_map.get(preferred) {
            if !value.is_empty() {
                return Some(value.clone());
            }
        }

        // try fallback keys
        for fallback in fallbacks {
            if let Some(value) = tags_map.get(*fallback) {
                if !value.is_empty() {
                    return Some(value.clone());
                }
            }
        }

        // try case-insensitive search
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

    // Parse filename for fallback data
    let filename_data = parse_filename(file_path);

    // Extract standardized fields from tags
    let tag_title = get_tag("TrackTitle", &["Title", "TITLE", "TIT2"]);
    let tag_artist = get_tag("TrackArtist", &["Artist", "ARTIST", "TPE1"]);
    let tag_album_artist = get_tag("AlbumArtist", &["ALBUMARTIST", "TPE2"]);
    let tag_album = get_tag("AlbumTitle", &["Album", "ALBUM", "TALB"]);
    let tag_track_number =
        get_tag("TrackNumber", &["TRCK", "Track"]).and_then(|s| parse_track_number(&s));

    // Detect compilation: different artist and album_artist both present and non-empty
    // use case-insensitive comparison to avoid false positives from tag case differences
    let is_compilation = match (&tag_artist, &tag_album_artist) {
        (Some(artist), Some(album_artist)) => {
            !artist.is_empty()
                && !album_artist.is_empty()
                && artist.to_lowercase() != album_artist.to_lowercase()
        }
        _ => false,
    };

    // Determine final artist name and track artist
    let (artist_name, track_artist) = if is_compilation {
        // use album artist for the main artist, store track artist separately
        (tag_album_artist.clone(), tag_artist.clone())
    } else {
        // use artist or album artist, whichever is available
        let artist = tag_artist
            .or_else(|| tag_album_artist.clone())
            .or_else(|| filename_data.artist.clone());
        (artist, None)
    };

    // Build title: prefer tag, fallback to filename
    let title = tag_title
        .or_else(|| filename_data.track.clone())
        .unwrap_or_else(|| {
            file_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Unknown Title")
                .to_string()
        });

    // Build album title: prefer tag, fallback to filename, then folder name
    let album_title = tag_album
        .or_else(|| filename_data.album.clone())
        .or_else(|| extract_folder_name_from_path(file_path));

    // Build track number: prefer tag, fallback to filename, default to 1
    let track_number = tag_track_number.or(filename_data.track_number).unwrap_or(1);

    // Extract other metadata fields
    let disc_number = get_tag("DiscNumber", &["TPOS", "Disc", "PartOfSet"])
        .and_then(|s| parse_track_number(&s))
        .unwrap_or(1);

    let year = get_tag("RecordingDate", &["Year", "DATE", "TDRC", "TYER"])
        .and_then(|s| s.split('-').next()?.trim().parse::<i64>().ok());

    let genre = get_tag("Genre", &["GENRE", "TCON"]);

    let lyrics = get_tag("Lyrics", &["USLT", "lyrics", "lyrics-eng", "LYRICS"]);

    let bpm = get_tag("BPM", &["TBPM", "bpm"])
        .and_then(|s| s.parse::<i64>().ok())
        .filter(|&b| b > 0 && b < 1000);

    ExtractedMetadata {
        title,
        artist_name,
        track_artist,
        album_title,
        track_number,
        disc_number,
        duration_ms: Some(duration_ms),
        year,
        genre,
        lyrics,
        bpm,
        is_compilation,
    }
}

/// Import an audio file with minimal metadata (fallback when extraction fails)
///
/// Creates a basic song record using the filename as the title and
/// default values for other fields.
pub async fn import_basic(media_blob_id: &str, file_path: &Path) -> Result<ImportResult, JobError> {
    // Try to parse filename for any available data
    let filename_data = parse_filename(file_path);
    let has_filename_data = filename_data.has_data();

    let title = filename_data.track.clone().unwrap_or_else(|| {
        file_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Unknown Title")
            .to_string()
    });

    let artist_name = filename_data.artist.clone();
    let album_title = filename_data.album.clone();
    let track_number = filename_data.track_number.unwrap_or(1);

    let import_request = ImportSongRequest {
        media_blob_id: media_blob_id.to_string(),
        title,
        artist_name,
        album_title,
        genre_name: None,
        track_number,
        disc_number: 1,
        duration: None,
        year: None,
        bpm: None,
        track_artist: None,
        metadata: None,
        lyrics: None,
        created_by: Some("job_processor".to_string()),
        is_compilation: false,
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
    let event_data = serde_json::json!({
        "source": "job_processor",
        "file_path": file_path.to_string_lossy(),
        "metadata_extracted": false,
        "used_filename_parsing": has_filename_data
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

/// extract folder name from file path as fallback album name
fn extract_folder_name_from_path(file_path: &Path) -> Option<String> {
    let parent = file_path.parent()?;
    let folder_name = parent.file_name()?.to_str()?;

    if folder_name.is_empty() {
        return None;
    }

    Some(folder_name.to_string())
}

/// extract file properties like bitrate, sample rate, channels, format
fn extract_file_properties(tagged_file: &lofty::TaggedFile) -> HashMap<String, serde_json::Value> {
    let mut props = HashMap::new();
    let properties = tagged_file.properties();

    // bitrate (kbps)
    if let Some(bitrate) = properties.overall_bitrate() {
        props.insert("bitrate_kbps".to_string(), serde_json::json!(bitrate));
    }
    if let Some(audio_bitrate) = properties.audio_bitrate() {
        props.insert(
            "audio_bitrate_kbps".to_string(),
            serde_json::json!(audio_bitrate),
        );
    }

    // sample rate (Hz)
    if let Some(sample_rate) = properties.sample_rate() {
        props.insert("sample_rate_hz".to_string(), serde_json::json!(sample_rate));
    }

    // channels
    if let Some(channels) = properties.channels() {
        props.insert("channels".to_string(), serde_json::json!(channels));
    }

    // bit depth
    if let Some(bit_depth) = properties.bit_depth() {
        props.insert("bit_depth".to_string(), serde_json::json!(bit_depth));
    }

    // duration in milliseconds
    let duration_ms = properties.duration().as_millis();
    if duration_ms > 0 {
        props.insert("duration_ms".to_string(), serde_json::json!(duration_ms));
    }

    // file format/type
    let file_type = tagged_file.file_type();
    props.insert(
        "format".to_string(),
        serde_json::json!(format_file_type(file_type)),
    );

    props
}

/// format lofty FileType to a human-readable string
fn format_file_type(file_type: FileType) -> String {
    match file_type {
        FileType::Aac => "AAC".to_string(),
        FileType::Aiff => "AIFF".to_string(),
        FileType::Ape => "APE".to_string(),
        FileType::Flac => "FLAC".to_string(),
        FileType::Mpeg => "MPEG".to_string(),
        FileType::Mp4 => "MP4".to_string(),
        FileType::Mpc => "Musepack".to_string(),
        FileType::Opus => "Opus".to_string(),
        FileType::Vorbis => "Vorbis".to_string(),
        FileType::Speex => "Speex".to_string(),
        FileType::Wav => "WAV".to_string(),
        FileType::WavPack => "WavPack".to_string(),
        _ => format!("{:?}", file_type),
    }
}

/// extract all non-empty tags from the tagged file
fn extract_all_tags(tagged_file: &lofty::TaggedFile) -> HashMap<String, String> {
    let mut tags = HashMap::new();

    if let Some(tag) = tagged_file.primary_tag() {
        for item in tag.items() {
            let key = format!("{:?}", item.key());
            let value_str = match item.value() {
                ItemValue::Text(s) | ItemValue::Locator(s) => s.clone(),
                ItemValue::Binary(_) => continue, // skip binary data like embedded images
            };

            // only include non-empty values
            let trimmed = value_str.trim();
            if !trimmed.is_empty() {
                tags.insert(key, trimmed.to_string());
            }
        }
    }

    tags
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

    #[test]
    fn test_compilation_detection() {
        // compilation should be detected when artist != album_artist
        let artist = Some("Track Artist".to_string());
        let album_artist = Some("Various Artists".to_string());

        let is_comp = match (&artist, &album_artist) {
            (Some(a), Some(aa)) => !a.is_empty() && !aa.is_empty() && a != aa,
            _ => false,
        };

        assert!(is_comp);
    }

    #[test]
    fn test_not_compilation_when_same() {
        // not a compilation when artist == album_artist
        let artist = Some("The Beatles".to_string());
        let album_artist = Some("The Beatles".to_string());

        let is_comp = match (&artist, &album_artist) {
            (Some(a), Some(aa)) => !a.is_empty() && !aa.is_empty() && a != aa,
            _ => false,
        };

        assert!(!is_comp);
    }

    #[test]
    fn test_not_compilation_when_only_artist() {
        // not a compilation when only artist is present
        let artist = Some("The Beatles".to_string());
        let album_artist: Option<String> = None;

        let is_comp = match (&artist, &album_artist) {
            (Some(a), Some(aa)) => !a.is_empty() && !aa.is_empty() && a != aa,
            _ => false,
        };

        assert!(!is_comp);
    }
}
