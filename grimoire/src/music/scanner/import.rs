//! Audio file import and metadata extraction
//!
//! Handles importing audio files into the music library, including:
//! - Metadata extraction using lofty
//! - Filename parsing as fallback/supplement
//! - Song/artist/album creation via music CRUD
//! - Compilation album detection and handling
//! - Analytics event recording
//! - Fallback handling when metadata extraction fails
//! - URL extraction from comment tags

use crate::analytics::{record_event, MediaEvent, MediaEventType};
use crate::config::get_config;
use crate::error::GrimoireError;
use crate::jobs::JobError;
use crate::music::crud::{
    add_entity_url, add_song, extract_url_domain_label, extract_urls_from_text, ImportSongRequest,
};
use lofty::{AudioFile, FileType, ItemValue, Probe, TaggedFileExt};
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

use super::filename_parser::{parse_filename, parse_filename_str};

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
    /// URLs extracted from comment tag
    comment_urls: Vec<String>,
}

/// Extract metadata from an audio file and import it as a song
///
/// This is the main import function that attempts to extract rich metadata
/// from the audio file and create a complete song record with relationships.
///
/// # Arguments
/// * `media_blob_id` - ID of the media blob for this file
/// * `file_path` - Path to the audio file
/// * `created_by` - Optional user ID that created/uploaded this file
/// * `original_filename` - Optional original filename (for uploads where file is stored with blob_id)
pub async fn extract_and_import(
    media_blob_id: &str,
    file_path: &Path,
    created_by: Option<String>,
    original_filename: Option<&str>,
) -> Result<ImportResult, JobError> {
    // Parse audio file with lofty with error handling
    let tagged_file = match Probe::open(file_path).and_then(|p| p.read()) {
        Ok(file) => file,
        Err(e) => {
            tracing::info!(
                "warning: could not read metadata from {:?}: {}",
                file_path,
                e
            );
            // Fall back to basic song record with filename
            return import_basic(media_blob_id, file_path, created_by, original_filename).await;
        }
    };

    // Extract metadata from tags and filename
    let metadata = extract_metadata(&tagged_file, file_path, original_filename);

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
        created_by,
        is_compilation: metadata.is_compilation,
    };

    let response = add_song(import_request).await;

    let result = if response.success {
        response.data.ok_or_else(|| JobError::ProcessingFailed {
            reason: "Song import succeeded but returned no data".to_string(),
        })?
    } else {
        // check if this is a duplicate song error and return proper error type
        let is_duplicate = response
            .errors
            .iter()
            .any(|e| e.error_type == "duplicate_song");

        if is_duplicate {
            return Err(JobError::Grimoire(GrimoireError::DuplicateSong {
                blob_id: media_blob_id.to_string(),
            }));
        }

        let error_messages: Vec<String> =
            response.errors.iter().map(|e| e.detail.clone()).collect();

        return Err(JobError::ProcessingFailed {
            reason: format!("failed to import song: {}", error_messages.join(", ")),
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
        tracing::warn!(
            "Warning: Failed to record analytics event for song import: {}",
            e
        );
    }

    // add URLs from comment tag to the album (best-effort, don't fail import)
    if let Some(album) = &result.album {
        for url in &metadata.comment_urls {
            let label = extract_url_domain_label(url);
            if let Err(e) = add_entity_url("album", &album.id, label, url).await {
                tracing::warn!(
                    "failed to add URL '{}' to album '{}': {}",
                    url,
                    album.title,
                    e
                );
            }
        }
    }

    Ok(ImportResult {
        song_id: result.song.id,
        artist_id: result.artist.map(|a| a.id),
        album_id: result.album.map(|a| a.id),
        metadata_extracted: true,
    })
}

/// Extract and merge metadata from tags and filename
fn extract_metadata(
    tagged_file: &lofty::TaggedFile,
    file_path: &Path,
    original_filename: Option<&str>,
) -> ExtractedMetadata {
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

    // Parse filename for fallback data - use original filename if available
    let filename_data = if let Some(orig) = original_filename {
        parse_filename_str(orig)
    } else {
        parse_filename(file_path)
    };

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

    // Build title: prefer tag, fallback to filename parsing, then original filename
    let title = tag_title
        .or_else(|| filename_data.track.clone())
        .unwrap_or_else(|| {
            // prefer original filename over file_path.file_stem() (which is blob_id for uploads)
            if let Some(orig) = original_filename {
                // remove extension from original filename
                orig.rsplit_once('.')
                    .map(|(name, _)| name.to_string())
                    .unwrap_or_else(|| orig.to_string())
            } else {
                file_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Unknown Title")
                    .to_string()
            }
        });

    // Build album title: prefer tag, fallback to filename parsing
    // skip folder name fallback for upload paths (date-like folders are not useful)
    let album_title = tag_album
        .or_else(|| filename_data.album.clone())
        .or_else(|| extract_folder_name_if_useful(file_path));

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

    // extract URLs from comment tag
    let comment = get_tag("Comment", &["COMM", "COMMENT", "comment"]);
    let comment_urls = comment
        .map(|c| extract_urls_from_text(&c))
        .unwrap_or_default();

    ExtractedMetadata {
        title,
        artist_name,
        track_artist,
        album_title,
        track_number,
        disc_number,
        duration_ms: if duration_ms > 0 {
            Some(duration_ms)
        } else {
            // lofty returned 0 duration - try ffprobe fallback
            match get_duration_via_ffprobe(file_path) {
                Some(ms) => {
                    tracing::debug!(
                        "info: used ffprobe fallback for duration of {:?} ({}ms)",
                        file_path,
                        ms
                    );
                    Some(ms)
                }
                None => Some(duration_ms),
            }
        },
        year,
        genre,
        lyrics,
        bpm,
        is_compilation,
        comment_urls,
    }
}

/// Import an audio file with minimal metadata (fallback when extraction fails)
///
/// Creates a basic song record using the filename as the title and
/// default values for other fields.
///
/// # Arguments
/// * `media_blob_id` - ID of the media blob for this file
/// * `file_path` - Path to the audio file
/// * `created_by` - Optional user ID that created/uploaded this file
/// * `original_filename` - Optional original filename (for uploads where file is stored with blob_id)
pub async fn import_basic(
    media_blob_id: &str,
    file_path: &Path,
    created_by: Option<String>,
    original_filename: Option<&str>,
) -> Result<ImportResult, JobError> {
    // Try to parse filename for any available data - use original filename if available
    let filename_data = if let Some(orig) = original_filename {
        parse_filename_str(orig)
    } else {
        parse_filename(file_path)
    };
    let has_filename_data = filename_data.has_data();

    // For title fallback, prefer original_filename over file_path
    let title = filename_data.track.clone().unwrap_or_else(|| {
        if let Some(orig) = original_filename {
            // strip extension from original filename
            orig.rsplit_once('.')
                .map(|(name, _)| name.to_string())
                .unwrap_or_else(|| orig.to_string())
        } else {
            file_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Unknown Title")
                .to_string()
        }
    });

    let artist_name = filename_data.artist.clone();
    let album_title = filename_data.album.clone();
    let track_number = filename_data.track_number.unwrap_or(1);

    // try to get file properties via ffprobe (duration, bitrate, sample rate, etc.)
    let ffprobe = get_ffprobe_properties(file_path);
    let duration = ffprobe.as_ref().and_then(|p| p.duration_ms);
    let metadata_json = ffprobe.as_ref().and_then(|p| {
        if p.file_props.is_empty() {
            None
        } else {
            let mut meta = serde_json::Map::new();
            meta.insert("file".to_string(), serde_json::json!(p.file_props));
            serde_json::to_string(&meta).ok()
        }
    });

    let import_request = ImportSongRequest {
        media_blob_id: media_blob_id.to_string(),
        title,
        artist_name,
        album_title,
        genre_name: None,
        track_number,
        disc_number: 1,
        duration,
        year: None,
        bpm: None,
        track_artist: None,
        metadata: metadata_json,
        lyrics: None,
        created_by,
        is_compilation: false,
    };

    let used_ffprobe = ffprobe.is_some();
    let response = add_song(import_request).await;

    let result = if response.success {
        response.data.ok_or_else(|| JobError::ProcessingFailed {
            reason: "Song import succeeded but returned no data".to_string(),
        })?
    } else {
        // check if this is a duplicate song error and return proper error type
        let is_duplicate = response
            .errors
            .iter()
            .any(|e| e.error_type == "duplicate_song");

        if is_duplicate {
            return Err(JobError::Grimoire(GrimoireError::DuplicateSong {
                blob_id: media_blob_id.to_string(),
            }));
        }

        let error_messages: Vec<String> =
            response.errors.iter().map(|e| e.detail.clone()).collect();

        return Err(JobError::ProcessingFailed {
            reason: format!(
                "failed to create basic song record: {}",
                error_messages.join(", ")
            ),
        });
    };

    // Record analytics event for song import (best-effort, don't fail if this errors)
    let event_data = serde_json::json!({
        "source": "job_processor",
        "file_path": file_path.to_string_lossy(),
        "metadata_extracted": false,
        "used_filename_parsing": has_filename_data,
        "used_ffprobe": used_ffprobe
    });

    let media_event =
        MediaEvent::new(media_blob_id.to_string(), MediaEventType::Add).with_event_data(event_data);

    if let Err(e) = record_event(&media_event).await {
        tracing::warn!(
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

/// extract folder name if it's a useful album name (not a date-like folder)
/// returns None for folders like "01", "2026", "03" which are used in upload paths
fn extract_folder_name_if_useful(file_path: &Path) -> Option<String> {
    let folder_name = extract_folder_name_from_path(file_path)?;

    // skip if folder name looks like a date component (pure numbers, year-like, month-like)
    // this handles paths like data/fetch/2026/03/ used for uploads
    let trimmed = folder_name.trim();

    // skip purely numeric folders (month numbers, year numbers, etc.)
    if trimmed.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }

    // skip "fetch" folder name (common in upload paths)
    if trimmed.eq_ignore_ascii_case("fetch") || trimmed.eq_ignore_ascii_case("media") {
        return None;
    }

    // skip hex-like folder names (e.g., blob id subfolders)
    if trimmed.len() >= 8 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }

    Some(folder_name)
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
/// try to get audio duration using ffprobe as a fallback.
/// returns duration in milliseconds, or None if ffprobe is not configured or fails.
fn get_duration_via_ffprobe(file_path: &Path) -> Option<i64> {
    let config = get_config();
    let ffprobe_path = config.media.ffprobe_path.as_ref()?;

    let mut args = shell_words::split(&config.media.ffprobe_duration_args).ok()?;

    // replace {input} placeholder in parsed args
    for arg in args.iter_mut() {
        if arg.contains("{input}") {
            *arg = arg.replace("{input}", &file_path.to_string_lossy());
        }
    }

    let output = Command::new(ffprobe_path).args(&args).output().ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let seconds: f64 = stdout.trim().parse().ok()?;
    let ms = (seconds * 1000.0) as i64;

    if ms > 0 {
        Some(ms)
    } else {
        None
    }
}

/// file properties extracted via ffprobe (used when lofty can't read the file)
#[derive(Debug, Clone)]
struct FfprobeProperties {
    duration_ms: Option<i64>,
    file_props: HashMap<String, serde_json::Value>,
}

/// get full file properties via ffprobe JSON output.
/// returns duration and file properties (bitrate, sample rate, channels, format, etc.)
/// or None if ffprobe is not configured or fails.
fn get_ffprobe_properties(file_path: &Path) -> Option<FfprobeProperties> {
    let config = get_config();
    let ffprobe_path = config.media.ffprobe_path.as_ref()?;

    let mut args = shell_words::split(&config.media.ffprobe_properties_args).ok()?;

    // replace {input} placeholder in parsed args
    for arg in args.iter_mut() {
        if arg.contains("{input}") {
            *arg = arg.replace("{input}", &file_path.to_string_lossy());
        }
    }

    let output = Command::new(ffprobe_path).args(&args).output().ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&stdout).ok()?;

    let mut file_props = HashMap::new();

    // extract from format section
    let format = json.get("format")?;

    // duration
    let duration_ms = format
        .get("duration")
        .and_then(|d| d.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .map(|s| (s * 1000.0) as i64)
        .filter(|&ms| ms > 0);

    if let Some(ms) = duration_ms {
        file_props.insert("duration_ms".to_string(), serde_json::json!(ms));
    }

    // overall bitrate (bps -> kbps)
    if let Some(bitrate) = format
        .get("bit_rate")
        .and_then(|b| b.as_str())
        .and_then(|s| s.parse::<u64>().ok())
    {
        file_props.insert(
            "bitrate_kbps".to_string(),
            serde_json::json!(bitrate / 1000),
        );
    }

    // format name
    if let Some(format_name) = format.get("format_long_name").and_then(|f| f.as_str()) {
        file_props.insert("format".to_string(), serde_json::json!(format_name));
    } else if let Some(format_name) = format.get("format_name").and_then(|f| f.as_str()) {
        file_props.insert("format".to_string(), serde_json::json!(format_name));
    }

    // extract from first audio stream
    if let Some(streams) = json.get("streams").and_then(|s| s.as_array()) {
        if let Some(audio_stream) = streams
            .iter()
            .find(|s| s.get("codec_type").and_then(|t| t.as_str()) == Some("audio"))
        {
            // codec name (e.g. "aac", "mp3", "flac")
            if let Some(codec) = audio_stream.get("codec_name").and_then(|c| c.as_str()) {
                file_props.insert("codec".to_string(), serde_json::json!(codec));
            }

            // sample rate
            if let Some(sample_rate) = audio_stream
                .get("sample_rate")
                .and_then(|s| s.as_str())
                .and_then(|s| s.parse::<u64>().ok())
            {
                file_props.insert("sample_rate_hz".to_string(), serde_json::json!(sample_rate));
            }

            // channels
            if let Some(channels) = audio_stream.get("channels").and_then(|c| c.as_u64()) {
                file_props.insert("channels".to_string(), serde_json::json!(channels));
            }

            // audio stream bitrate (bps -> kbps)
            if let Some(audio_bitrate) = audio_stream
                .get("bit_rate")
                .and_then(|b| b.as_str())
                .and_then(|s| s.parse::<u64>().ok())
            {
                file_props.insert(
                    "audio_bitrate_kbps".to_string(),
                    serde_json::json!(audio_bitrate / 1000),
                );
            }

            // bit depth (bits_per_raw_sample or bits_per_sample)
            let bit_depth = audio_stream
                .get("bits_per_raw_sample")
                .and_then(|b| b.as_str())
                .and_then(|s| s.parse::<u64>().ok())
                .or_else(|| audio_stream.get("bits_per_sample").and_then(|b| b.as_u64()));
            if let Some(bd) = bit_depth {
                if bd > 0 {
                    file_props.insert("bit_depth".to_string(), serde_json::json!(bd));
                }
            }
        }
    }

    // mark that properties came from ffprobe
    file_props.insert("source".to_string(), serde_json::json!("ffprobe"));

    Some(FfprobeProperties {
        duration_ms,
        file_props,
    })
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
        let artist = Some("The Weasels".to_string());
        let album_artist = Some("The Weasels".to_string());

        let is_comp = match (&artist, &album_artist) {
            (Some(a), Some(aa)) => !a.is_empty() && !aa.is_empty() && a != aa,
            _ => false,
        };

        assert!(!is_comp);
    }

    #[test]
    fn test_not_compilation_when_only_artist() {
        // not a compilation when only artist is present
        let artist = Some("The Weasels".to_string());
        let album_artist: Option<String> = None;

        let is_comp = match (&artist, &album_artist) {
            (Some(a), Some(aa)) => !a.is_empty() && !aa.is_empty() && a != aa,
            _ => false,
        };

        assert!(!is_comp);
    }
}
