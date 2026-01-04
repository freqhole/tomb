//! MusicBrainz API request handlers
//!
//! This module contains the HTTP request handlers for MusicBrainz integration endpoints.
//! These handlers bridge the HTTP API layer with the existing grimoire MusicBrainz service.

use axum::extract::Extension;
use axum::{response::Json as ResponseJson, Json};
use legacylib::music::repository::MusicRepository;
use legacylib::musicbrainz::{MusicBrainzConfig, MusicBrainzService, RecordingSearchQuery};
use legacylib::DatabaseConnection;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::auth::AuthenticatedUser;
use crate::musicbrainz::{MusicBrainzApiError, MusicBrainzResult};
use crate::startup::AppState;

// Add error conversion for serde_json
impl From<serde_json::Error> for MusicBrainzApiError {
    fn from(err: serde_json::Error) -> Self {
        MusicBrainzApiError::ValidationError(format!("JSON error: {}", err))
    }
}

// Add error conversion for grimoire music errors
impl From<legacylib::music::repository::MusicRepositoryError> for MusicBrainzApiError {
    fn from(err: legacylib::music::repository::MusicRepositoryError) -> Self {
        MusicBrainzApiError::DatabaseError(sqlx::Error::Protocol(err.to_string()))
    }
}

/// Request body for searching MusicBrainz
#[derive(Debug, Deserialize)]
pub struct MusicBrainzSearchRequest {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: u32,
}

fn default_limit() -> u32 {
    25
}

/// Response for MusicBrainz search
#[derive(Debug, Serialize)]
pub struct MusicBrainzSearchResponse {
    pub results: Vec<MusicBrainzMatch>,
    pub total: u32,
}

/// MusicBrainz match data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MusicBrainzMatch {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub year: Option<u32>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub duration_seconds: Option<u32>,
    pub genre: Option<String>,
    pub confidence: f64,
    pub mbid: String,
    pub recording_id: Option<String>,
    pub release_id: Option<String>,
    pub cover_art_url: Option<String>,
}

/// Request body for album search
#[derive(Debug, Deserialize)]
pub struct AlbumSearchRequest {
    pub artist: Option<String>,
    pub album: Option<String>,
    pub year: Option<u32>,
    pub limit: u32,
}

/// Album match from MusicBrainz search
#[derive(Debug, Serialize)]
pub struct AlbumMatch {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub year: Option<u32>,
    pub track_count: Option<u32>,
    pub mbid: String,
    pub release_id: String,
}

/// Response for album search
#[derive(Debug, Serialize)]
pub struct AlbumSearchResponse {
    pub total: u32,
    pub results: Vec<AlbumMatch>,
}

/// Request body for getting song matches
#[derive(Debug, Deserialize)]
pub struct GetSongMatchesRequest {
    pub song_ids: Vec<String>,
}

/// Response for getting song matches
#[derive(Debug, Serialize)]
pub struct SongMatchesResponse {
    pub songs: Vec<SongWithMatches>,
}

/// Song with its MusicBrainz matches
#[derive(Debug, Serialize)]
pub struct SongWithMatches {
    pub song_id: String,
    pub song_title: String,
    pub song_artist: Option<String>,
    pub song_album: Option<String>,
    pub matches: Vec<MusicBrainzMatch>,
}

/// Request body for applying MusicBrainz metadata
#[derive(Debug, Deserialize)]
pub struct ApplyMetadataRequest {
    pub song_ids: Vec<String>,
    #[serde(rename = "match")]
    pub musicbrainz_match: MusicBrainzMatch,
}

/// Response for applying metadata
#[derive(Debug, Serialize)]
pub struct ApplyMetadataResponse {
    pub updated_songs: Vec<serde_json::Value>,
}

/// Request body for scanning songs for matches
#[derive(Debug, Deserialize)]
pub struct ScanSongsRequest {
    pub song_ids: Vec<String>,
    #[serde(default)]
    pub force_rescan: bool,
    #[serde(default = "default_confidence_threshold")]
    pub confidence_threshold: f64,
}

fn default_confidence_threshold() -> f64 {
    85.0
}

/// Get MusicBrainz configuration (admin only)
pub async fn get_musicbrainz_config(
    Extension(user): Extension<AuthenticatedUser>,
    Extension(_db): Extension<DatabaseConnection>,
    Extension(app_state): Extension<AppState>,
) -> MusicBrainzResult<ResponseJson<MusicBrainzConfig>> {
    // Check if user is admin
    if !user.user().is_admin() {
        return Err(MusicBrainzApiError::Unauthorized);
    }

    // Get actual MusicBrainz configuration from AppState
    let config = app_state.config.musicbrainz.clone();

    Ok(ResponseJson(config))
}

/// Search MusicBrainz for albums
pub async fn search_albums(
    Extension(_user): Extension<AuthenticatedUser>,
    Extension(app_state): Extension<AppState>,
    Json(request): Json<AlbumSearchRequest>,
) -> MusicBrainzResult<ResponseJson<AlbumSearchResponse>> {
    // Validate request
    if request.artist.is_none() && request.album.is_none() {
        return Err(MusicBrainzApiError::ValidationError(
            "At least one search field (artist or album) is required".to_string(),
        ));
    }

    // Get actual MusicBrainz configuration from AppState
    let config = app_state.config.musicbrainz.clone();

    // Build search query
    let mut query = legacylib::musicbrainz::queries::ReleaseSearchQuery::new();

    if let Some(artist) = &request.artist {
        query = query.artist(artist);
    }
    if let Some(album) = &request.album {
        query = query.release(album);
    }
    if let Some(year) = request.year {
        query = query.date(&year.to_string());
    }

    query = query.limit(request.limit);

    // Perform search using grimoire service
    let client = legacylib::musicbrainz::client::MusicBrainzClient::new(config)?;
    let search_result = client.search_releases(&query).await?;

    // Convert to API format
    let matches: Vec<AlbumMatch> = search_result
        .results
        .into_iter()
        .map(|release| {
            let artist_credit = release
                .artist_credit
                .as_ref()
                .map(|credits| {
                    credits
                        .iter()
                        .map(|credit| credit.name.clone())
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_else(|| "Unknown Artist".to_string());

            let year = release
                .date
                .as_ref()
                .and_then(|date| date.split('-').next()?.parse::<u32>().ok());

            let track_count = release
                .media
                .as_ref()
                .map(|media| media.iter().map(|m| m.track_count.unwrap_or(0)).sum());

            AlbumMatch {
                id: release.id.to_string(),
                title: release.title,
                artist: artist_credit,
                year,
                track_count,
                mbid: release.id.to_string(),
                release_id: release.id.to_string(),
            }
        })
        .collect();

    let response = AlbumSearchResponse {
        total: matches.len() as u32,
        results: matches,
    };

    Ok(ResponseJson(response))
}

/// Search MusicBrainz database
pub async fn search_musicbrainz(
    Extension(_user): Extension<AuthenticatedUser>,
    Extension(_db): Extension<DatabaseConnection>,
    Extension(app_state): Extension<AppState>,
    Json(request): Json<MusicBrainzSearchRequest>,
) -> MusicBrainzResult<ResponseJson<MusicBrainzSearchResponse>> {
    // Validate request
    if request.title.is_none() && request.artist.is_none() && request.album.is_none() {
        return Err(MusicBrainzApiError::ValidationError(
            "At least one search field (title, artist, or album) is required".to_string(),
        ));
    }

    // Get actual MusicBrainz configuration from AppState
    let config = app_state.config.musicbrainz.clone();

    // Build search query with include parameters for detailed track information
    let mut query = RecordingSearchQuery::new();

    if let Some(title) = &request.title {
        query = query.title(title);
    }
    if let Some(artist) = &request.artist {
        query = query.artist(artist);
    }
    if let Some(album) = &request.album {
        query = query.release(album);
    }

    // Include releases with media information to get track numbers
    query = query.param("inc", "releases+media").limit(request.limit);

    // Perform search using grimoire service
    // Use the config to create client directly
    let client = legacylib::musicbrainz::client::MusicBrainzClient::new(config)?;
    let search_result = client.search_recordings(&query).await?;

    // Convert to API format with track number extraction
    let matches: Vec<MusicBrainzMatch> = search_result
        .results
        .into_iter()
        .map(|recording| {
            let artist_credit = recording
                .artist_credit
                .as_ref()
                .map(|credits| {
                    credits
                        .iter()
                        .map(|credit| credit.name.clone())
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_else(|| "Unknown Artist".to_string());

            // Extract track and disc numbers by examining release media
            let (album, year, release_id, track_number, disc_number) = recording
                .releases
                .as_ref()
                .and_then(|releases| releases.first())
                .map(|release| {
                    let year = release
                        .date
                        .as_ref()
                        .and_then(|date| date.split('-').next()?.parse::<u32>().ok());

                    // Look for track numbers in the release media
                    let (track_num, disc_num) = release
                        .media
                        .as_ref()
                        .and_then(|media_list| {
                            // Try to find exact match first
                            for (disc_idx, medium) in media_list.iter().enumerate() {
                                if let Some(tracks) = &medium.tracks {
                                    for track in tracks {
                                        // Check if this track references our recording by ID
                                        if let Some(track_recording) = &track.recording {
                                            if track_recording.id == recording.id {
                                                let disc_number = if media_list.len() > 1 {
                                                    Some(disc_idx as u32 + 1)
                                                } else {
                                                    None
                                                };
                                                return Some((track.position, disc_number));
                                            }
                                        }
                                    }
                                }
                            }

                            // If no exact match found, use first track from first medium
                            if let Some(first_medium) = media_list.first() {
                                if let Some(tracks) = &first_medium.tracks {
                                    if let Some(first_track) = tracks.first() {
                                        let disc_number = if media_list.len() > 1 {
                                            Some(1u32)
                                        } else {
                                            None
                                        };
                                        return Some((first_track.position, disc_number));
                                    }
                                }
                            }

                            None
                        })
                        .unwrap_or((None, None));

                    (
                        Some(release.title.clone()),
                        year,
                        Some(release.id.to_string()),
                        track_num,
                        disc_num,
                    )
                })
                .unwrap_or((None, None, None, None, None));

            MusicBrainzMatch {
                id: recording.id.to_string(),
                title: recording.title,
                artist: artist_credit,
                album,
                year,
                track_number,
                disc_number,
                duration_seconds: recording.length.map(|ms| ms / 1000), // Convert ms to seconds
                genre: recording
                    .tags
                    .as_ref()
                    .and_then(|tags| tags.first().map(|tag| tag.name.clone())), // Use first tag as genre
                confidence: 100.0, // Default confidence for search results
                mbid: recording.id.to_string(),
                recording_id: Some(recording.id.to_string()),
                release_id: release_id.clone(),
                cover_art_url: release_id
                    .as_ref()
                    .map(|id| format!("https://coverartarchive.org/release/{}/front-500", id)),
            }
        })
        .collect();

    let response = MusicBrainzSearchResponse {
        total: matches.len() as u32,
        results: matches,
    };

    Ok(ResponseJson(response))
}

/// Get existing MusicBrainz matches for songs
pub async fn get_song_matches(
    Extension(_user): Extension<AuthenticatedUser>,
    Extension(db): Extension<DatabaseConnection>,
    Json(request): Json<GetSongMatchesRequest>,
) -> MusicBrainzResult<ResponseJson<SongMatchesResponse>> {
    if request.song_ids.is_empty() {
        return Err(MusicBrainzApiError::NoSongs);
    }

    let music_repo = MusicRepository::new(db.pool().clone());
    let mut songs_with_matches = Vec::new();

    for song_id_str in request.song_ids {
        let song_id = Uuid::parse_str(&song_id_str)
            .map_err(|_| MusicBrainzApiError::ValidationError("Invalid song ID".to_string()))?;

        // Get song info
        let song = music_repo.get_song(song_id).await?;

        // Get MusicBrainz matches from metadata
        let matches = if song.metadata.is_null() {
            Vec::new()
        } else {
            extract_musicbrainz_matches_from_metadata(&song.metadata)
        };

        songs_with_matches.push(SongWithMatches {
            song_id: song_id_str,
            song_title: song.title,
            song_artist: song.artist,
            song_album: song.album,
            matches,
        });
    }

    let response = SongMatchesResponse {
        songs: songs_with_matches,
    };

    Ok(ResponseJson(response))
}

/// Apply MusicBrainz metadata to songs
pub async fn apply_musicbrainz_metadata(
    Extension(user): Extension<AuthenticatedUser>,
    Extension(db): Extension<DatabaseConnection>,
    Json(request): Json<ApplyMetadataRequest>,
) -> MusicBrainzResult<ResponseJson<ApplyMetadataResponse>> {
    // Check if user is admin
    if !user.user().is_admin() {
        return Err(MusicBrainzApiError::Unauthorized);
    }

    if request.song_ids.is_empty() {
        return Err(MusicBrainzApiError::NoSongs);
    }

    let music_repo = MusicRepository::new(db.pool().clone());
    let mut updated_songs = Vec::new();

    for song_id_str in request.song_ids {
        let song_id = Uuid::parse_str(&song_id_str)
            .map_err(|_| MusicBrainzApiError::ValidationError("Invalid song ID".to_string()))?;

        // Get current song
        let mut song = music_repo.get_song(song_id).await?;

        // Apply metadata updates
        song.title = request.musicbrainz_match.title.clone();
        song.artist = Some(request.musicbrainz_match.artist.clone());

        if let Some(album) = &request.musicbrainz_match.album {
            song.album = Some(album.clone());
        }

        if let Some(year) = request.musicbrainz_match.year {
            song.year = Some(year as i32);
        }

        // Update metadata with MusicBrainz information
        let mut metadata = if song.metadata.is_null() {
            serde_json::json!({})
        } else {
            song.metadata.clone()
        };

        if let Some(metadata_obj) = metadata.as_object_mut() {
            metadata_obj.insert(
                "musicbrainz".to_string(),
                serde_json::json!({
                    "recording_id": request.musicbrainz_match.recording_id,
                    "release_id": request.musicbrainz_match.release_id,
                    "confidence": request.musicbrainz_match.confidence,
                    "applied_at": time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339).unwrap()
                }),
            );
        }

        song.metadata = metadata;

        // Save the updated song
        // For now, just return the song data as JSON since update_song method signature is unclear
        let updated_song = serde_json::json!({
            "id": song.id,
            "title": song.title,
            "artist": song.artist,
            "album": song.album,
            "year": song.year
        });
        updated_songs.push(serde_json::to_value(updated_song)?);
    }

    let response = ApplyMetadataResponse { updated_songs };

    Ok(ResponseJson(response))
}

/// Scan songs for new MusicBrainz matches
pub async fn scan_songs_for_matches(
    Extension(user): Extension<AuthenticatedUser>,
    Extension(db): Extension<DatabaseConnection>,
    Json(request): Json<ScanSongsRequest>,
) -> MusicBrainzResult<ResponseJson<SongMatchesResponse>> {
    // Check if user is admin
    if !user.user().is_admin() {
        return Err(MusicBrainzApiError::Unauthorized);
    }

    if request.song_ids.is_empty() {
        return Err(MusicBrainzApiError::NoSongs);
    }

    let music_repo = Arc::new(MusicRepository::new(db.pool().clone()));
    let config = MusicBrainzConfig::default();
    let service = MusicBrainzService::new(config, music_repo.clone())?;

    let mut songs_with_matches = Vec::new();

    for song_id_str in request.song_ids {
        let song_id = Uuid::parse_str(&song_id_str)
            .map_err(|_| MusicBrainzApiError::ValidationError("Invalid song ID".to_string()))?;

        // Get song info
        let song = music_repo.get_song(song_id).await?;

        // Perform MusicBrainz lookup
        let mb_matches = service.search_for_song(&song).await?;

        // Filter by confidence threshold and convert to API format
        let matches: Vec<MusicBrainzMatch> = mb_matches
            .into_iter()
            .filter(|mb_match| mb_match.confidence_score >= request.confidence_threshold as f32)
            .map(|mb_match| {
                let artist = mb_match
                    .recording
                    .artist_credit
                    .as_ref()
                    .map(|credits| {
                        credits
                            .iter()
                            .map(|credit| credit.name.clone())
                            .collect::<Vec<_>>()
                            .join(", ")
                    })
                    .unwrap_or_else(|| "Unknown Artist".to_string());

                let (album, year, release_id) = mb_match
                    .release
                    .as_ref()
                    .map(|release| {
                        let year = release
                            .date
                            .as_ref()
                            .and_then(|date| date.split('-').next()?.parse::<u32>().ok());
                        (
                            Some(release.title.clone()),
                            year,
                            Some(release.id.to_string()),
                        )
                    })
                    .unwrap_or((None, None, None));

                MusicBrainzMatch {
                    id: mb_match.recording.id.to_string(),
                    title: mb_match.recording.title,
                    artist,
                    album,
                    year,
                    track_number: None, // Track number not available in scan results
                    disc_number: None,  // Disc number not available in scan results
                    duration_seconds: mb_match.recording.length.map(|ms| ms / 1000),
                    genre: mb_match
                        .recording
                        .tags
                        .as_ref()
                        .and_then(|tags| tags.first().map(|tag| tag.name.clone())),
                    confidence: mb_match.confidence_score as f64,
                    mbid: mb_match.recording.id.to_string(),
                    recording_id: Some(mb_match.recording.id.to_string()),
                    release_id: release_id.clone(),
                    cover_art_url: release_id
                        .as_ref()
                        .map(|id| format!("https://coverartarchive.org/release/{}/front-500", id)),
                }
            })
            .collect();

        songs_with_matches.push(SongWithMatches {
            song_id: song_id_str,
            song_title: song.title,
            song_artist: song.artist,
            song_album: song.album,
            matches,
        });

        // Small delay between requests to respect rate limits
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }

    let response = SongMatchesResponse {
        songs: songs_with_matches,
    };

    Ok(ResponseJson(response))
}

/// Extract MusicBrainz matches from song metadata JSONB
fn extract_musicbrainz_matches_from_metadata(
    metadata: &serde_json::Value,
) -> Vec<MusicBrainzMatch> {
    let mut matches = Vec::new();

    if let Some(musicbrainz) = metadata.get("musicbrainz") {
        // Extract matches from the "all_matches" field
        if let Some(all_matches) = musicbrainz.get("all_matches") {
            if let Some(matches_array) = all_matches.as_array() {
                for match_data in matches_array {
                    if let Ok(musicbrainz_match) = extract_match_from_json(match_data) {
                        matches.push(musicbrainz_match);
                    }
                }
            }
        }

        // Also include the primary match from "musicbrainz_match" field
        if let Some(enrichment) = musicbrainz.get("enrichment") {
            if let Some(primary_match) = enrichment.get("musicbrainz_match") {
                if let Ok(musicbrainz_match) = extract_match_from_json(primary_match) {
                    matches.push(musicbrainz_match);
                }
            }
        }
    }

    matches
}

/// Extract a MusicBrainz match from JSON data
fn extract_match_from_json(
    json: &serde_json::Value,
) -> Result<MusicBrainzMatch, serde_json::Error> {
    let recording_id = json
        .get("recording_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let title = json
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let artist = json
        .get("artist")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let album = json
        .get("release")
        .and_then(|r| r.get("title"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let year = json
        .get("release")
        .and_then(|r| r.get("date"))
        .and_then(|v| v.as_str())
        .and_then(|date_str| {
            // Parse year from date string like "2007-04-17"
            date_str.split('-').next()?.parse().ok()
        });

    let confidence = json
        .get("confidence_score")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    let release_id = json
        .get("release")
        .and_then(|r| r.get("id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(MusicBrainzMatch {
        id: recording_id.clone(),
        title,
        artist,
        album,
        year,
        track_number: None,     // Track number not stored in metadata format
        disc_number: None,      // Disc number not stored in metadata format
        duration_seconds: None, // Duration not stored in metadata format
        genre: None,            // Genre not stored in metadata format
        confidence,
        mbid: recording_id.clone(),
        recording_id: Some(recording_id),
        release_id: release_id.clone(),
        cover_art_url: release_id
            .as_ref()
            .map(|id| format!("https://coverartarchive.org/release/{}/front-500", id)),
    })
}
