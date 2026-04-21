//! sync handlers - sync remote songs to local grimoire storage
//!
//! called by spume when running in charnel/tauri mode.
//! accepts song metadata + base64 audio data and writes to organized filesystem paths.

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use zod_gen_derive::ZodSchema;

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::config;
use crate::error::{ErrorDetail, GrimoireError, GrimoireResult};
use crate::media_blobz::{create_media_blob, BlobType, CreateMediaBlobRequest};
use crate::music::crud::create_or_update::import_song_with_metadata;
use crate::music::crud::ImportSongRequest;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;

/// route metadata for sync
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "sync_song",
        path: "/api/sync/song",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "SyncSongRequest",
        response_type: "SyncSongResponse",
        auth: RouteAuth::Role(UserRole::Member),
    },
    RouteInfo {
        name: "sync_playlist",
        path: "/api/sync/playlist",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "SyncPlaylistRequest",
        response_type: "SyncPlaylistResponse",
        auth: RouteAuth::Role(UserRole::Member),
    },
    RouteInfo {
        name: "synced_sha256s",
        path: "/api/sync/sha256s",
        method: Method::GET,
        domain: Domain::Music,
        request_type: "String",
        response_type: "Vec<String>",
        auth: RouteAuth::Role(UserRole::Member),
    },
    RouteInfo {
        name: "sync_album",
        path: "/api/sync/album",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "SyncAlbumRequest",
        response_type: "SyncAlbumResponse",
        auth: RouteAuth::Role(UserRole::Member),
    },
];

/// collect all route metadata from sync domain
pub fn routes() -> Vec<RouteInfo> {
    ROUTES.to_vec()
}

/// image data for sync (base64 encoded)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SyncImageData {
    /// base64-encoded image data
    pub data: String,
    /// mime type (e.g., "image/jpeg")
    pub mime_type: String,
    /// whether this is the primary image
    pub is_primary: bool,
    /// blob type (thumbnail, cover, etc.)
    #[serde(default)]
    pub blob_type: Option<String>,
}

/// request for syncing a song from remote to local
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SyncSongRequest {
    /// sha256 hash of the audio file
    pub sha256: String,
    /// optional blake3 hash for P2P verification
    pub blake3: Option<String>,
    /// song title
    pub title: String,
    /// artist name
    pub artist_name: String,
    /// album title
    pub album_title: String,
    /// track number
    pub track_number: i64,
    /// disc number
    pub disc_number: i64,
    /// duration in milliseconds
    pub duration_ms: Option<i64>,
    /// release year
    pub year: Option<i64>,
    /// bpm
    pub bpm: Option<i64>,
    /// track-specific artist (for compilations)
    pub track_artist: Option<String>,
    /// lyrics
    pub lyrics: Option<String>,
    /// additional metadata (JSON string)
    pub metadata: Option<String>,
    /// base64-encoded audio data
    pub audio_data: String,
    /// mime type of audio (e.g., "audio/mpeg")
    pub audio_mime_type: String,
    /// optional song images
    #[serde(default)]
    pub song_images: Vec<SyncImageData>,
    /// optional album images
    #[serde(default)]
    pub album_images: Vec<SyncImageData>,
    /// optional artist images
    #[serde(default)]
    pub artist_images: Vec<SyncImageData>,
    /// remote server name (for tagging)
    pub remote_name: String,
    /// tags from remote album
    #[serde(default)]
    pub album_tags: Vec<String>,
    /// genre name
    pub genre_name: Option<String>,
    /// skip creating feed events (set true when syncing as part of playlist)
    #[serde(default)]
    pub skip_feed_events: bool,
}

/// response for syncing a song
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SyncSongResponse {
    /// whether the song already existed (deduped)
    pub already_existed: bool,
    /// local song ID (sha256)
    pub song_id: String,
    /// local file path where audio was written
    pub file_path: String,
    /// local media blob ID
    pub media_blob_id: String,
}

/// request for syncing a playlist
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SyncPlaylistRequest {
    /// remote playlist ID (for reference)
    pub remote_playlist_id: String,
    /// playlist title
    pub title: String,
    /// optional description
    pub description: Option<String>,
    /// sha256 hashes of songs (must already exist locally)
    pub song_sha256s: Vec<String>,
    /// optional playlist images
    #[serde(default)]
    pub images: Vec<SyncImageData>,
    /// remote server name (for tagging)
    pub remote_name: String,
}

/// response for syncing a playlist
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SyncPlaylistResponse {
    /// local playlist ID
    pub playlist_id: String,
    /// number of songs added
    pub songs_added: i64,
    /// number of songs that were missing locally
    pub songs_missing: i64,
}

/// dispatch sync routes
pub async fn dispatch(
    path: &str,
    caller: &Caller,
    body: &JsonValue,
) -> Option<GrimoireResponse<JsonValue>> {
    match path {
        "/api/sync/song" => Some(sync_song(caller, body.clone()).await),
        "/api/sync/playlist" => Some(sync_playlist(caller, body.clone()).await),
        "/api/sync/sha256s" => Some(get_synced_sha256s(caller).await),
        "/api/sync/album" => Some(sync_album(caller, body.clone()).await),
        _ => None,
    }
}

/// get all song sha256s from local grimoire database
/// used by client to initialize synced song cache on startup
pub async fn get_synced_sha256s(_caller: &Caller) -> GrimoireResponse<JsonValue> {
    match crate::music::entities::songs::get_all_song_sha256s().await {
        Ok(sha256s) => GrimoireResponse::success("synced sha256s", serde_json::json!(sha256s)),
        Err(e) => GrimoireResponse::failure("failed to fetch sha256s", vec![e.into()]),
    }
}

/// get file extension from mime type
fn extension_from_mime(mime_type: &str) -> &'static str {
    match mime_type.to_lowercase().as_str() {
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/flac" | "audio/x-flac" => "flac",
        "audio/wav" | "audio/x-wav" => "wav",
        "audio/ogg" | "audio/vorbis" => "ogg",
        "audio/aac" | "audio/x-aac" => "aac",
        "audio/mp4" | "audio/x-m4a" => "m4a",
        _ => "mp3",
    }
}

/// sanitize a string for use in filesystem paths
/// removes or replaces characters that are problematic on various filesystems
fn sanitize_path_component(s: &str) -> String {
    let sanitized: String = s
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            '\0'..='\x1f' => '_', // control characters
            _ => c,
        })
        .collect();

    // trim leading/trailing whitespace and dots (problematic on Windows)
    let trimmed = sanitized.trim().trim_matches('.');

    // use placeholder if empty
    if trimmed.is_empty() {
        "_".to_string()
    } else {
        trimmed.to_string()
    }
}

/// generate organized path for synced song
/// pattern: {output_dir}/{artist}/{album}/{track}-{title}.{ext}
/// with disc number if > 1: {disc}-{track}-{title}.{ext}
fn synced_song_path(
    output_dir: &std::path::Path,
    artist: &str,
    album: &str,
    track: i64,
    disc: i64,
    title: &str,
    ext: &str,
) -> PathBuf {
    let artist_safe = sanitize_path_component(artist);
    let album_safe = sanitize_path_component(album);
    let title_safe = sanitize_path_component(title);

    let filename = if disc > 1 {
        format!("{:02}-{:02}-{}.{}", disc, track, title_safe, ext)
    } else {
        format!("{:02}-{}.{}", track, title_safe, ext)
    };

    output_dir
        .join(&artist_safe)
        .join(&album_safe)
        .join(filename)
}

/// ensure path is unique - if file exists, append -1, -2, etc.
/// CRITICAL: never overwrite existing files with different content
fn ensure_unique_path(path: &std::path::Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }

    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
    let parent = path.parent().unwrap_or(std::path::Path::new("."));

    // so sorry for overwriting the 667+ file :/
    for i in 1..=666 {
        let new_name = if ext.is_empty() {
            format!("{}-{}", stem, i)
        } else {
            format!("{}-{}.{}", stem, i, ext)
        };
        let new_path = parent.join(new_name);
        if !new_path.exists() {
            return new_path;
        }
    }

    // fallback: use timestamp
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let new_name = if ext.is_empty() {
        format!("{}-{}", stem, ts)
    } else {
        format!("{}-{}.{}", stem, ts, ext)
    };
    parent.join(new_name)
}

/// sync a song to local grimoire storage
///
/// path: POST /api/sync/song
pub async fn sync_song(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: SyncSongRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    // decode audio data
    let audio_data = match base64::engine::general_purpose::STANDARD.decode(&req.audio_data) {
        Ok(d) => d,
        Err(e) => {
            return GrimoireResponse::failure(
                "invalid audio data",
                vec![ErrorDetail::new(
                    "bad_request",
                    "invalid base64",
                    &format!("failed to decode audio: {}", e),
                )],
            )
        }
    };

    // verify sha256 matches
    let mut hasher = Sha256::new();
    hasher.update(&audio_data);
    let computed_hash = format!("{:x}", hasher.finalize());

    if computed_hash != req.sha256 {
        return GrimoireResponse::failure(
            "sha256 mismatch",
            vec![ErrorDetail::new(
                "bad_request",
                "sha256 mismatch",
                &format!("provided: {}, computed: {}", req.sha256, computed_hash),
            )],
        );
    }

    // get output directory from config
    let cfg = config::get_config();
    let output_dir = cfg
        .server
        .as_ref()
        .and_then(|s| s.fetch_music.as_ref())
        .and_then(|f| f.output_dir.as_ref())
        .map(PathBuf::from)
        .unwrap_or_else(|| cfg.data_dir.join("synced"));

    let ext = extension_from_mime(&req.audio_mime_type);

    // generate organized path
    let target_path = synced_song_path(
        &output_dir,
        &req.artist_name,
        &req.album_title,
        req.track_number,
        req.disc_number,
        &req.title,
        ext,
    );

    // ensure unique (NEVER overwrite)
    let final_path = ensure_unique_path(&target_path);

    // create directory structure
    if let Some(parent) = final_path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return GrimoireResponse::failure(
                "failed to create directory",
                vec![ErrorDetail::new(
                    "internal_error",
                    "failed to create directory",
                    &e.to_string(),
                )],
            );
        }
    }

    // write audio file
    if let Err(e) = std::fs::write(&final_path, &audio_data) {
        return GrimoireResponse::failure(
            "failed to write audio file",
            vec![ErrorDetail::new(
                "internal_error",
                "failed to write file",
                &e.to_string(),
            )],
        );
    }

    tracing::info!(
        "synced audio to: {:?} ({} bytes)",
        final_path,
        audio_data.len()
    );

    // create media blob record
    let blob_result = create_media_blob(CreateMediaBlobRequest {
        sha256: req.sha256.clone(),
        size: Some(audio_data.len() as i64),
        mime: Some(req.audio_mime_type.clone()),
        source_client_id: None,
        local_path: Some(final_path.to_string_lossy().to_string()),
        filename: Some(
            final_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
        ),
        parent_blob_id: None,
        blob_type: Some(BlobType::Original),
        metadata: serde_json::json!({
            "synced_from": req.remote_name,
            "original_title": req.title,
        }),
        created_by: None,
        data: None,
        width: None,
        height: None,
        blake3: req.blake3.clone(),
    })
    .await;

    let blob = match blob_result {
        Ok(b) => b,
        Err(e) => {
            // clean up the file we wrote
            let _ = std::fs::remove_file(&final_path);
            return GrimoireResponse::failure(
                "failed to create blob record",
                vec![ErrorDetail::new(
                    "internal_error",
                    "failed to create blob",
                    &e.to_string(),
                )],
            );
        }
    };

    // check if song already exists (regardless of blob dedup)
    // if song exists, skip import entirely
    if let Ok(Some(_existing_song_id)) =
        crate::music::entities::songs::get_song_by_sha256(&req.sha256).await
    {
        tracing::info!(
            "song already synced: {} (sha256: {})",
            req.title,
            &req.sha256[..8]
        );
        let response = SyncSongResponse {
            already_existed: true,
            song_id: req.sha256.clone(),
            file_path: final_path.to_string_lossy().to_string(),
            media_blob_id: blob.id,
        };
        return GrimoireResponse::success(
            "song already existed",
            serde_json::to_value(response).unwrap_or_default(),
        );
    }

    // at this point, song is NEW (blob may have been deduplicated but song doesn't exist)
    let song_is_new = true;

    // import song with metadata
    let import_response = import_song_with_metadata(ImportSongRequest {
        media_blob_id: blob.id.clone(),
        title: req.title.clone(),
        artist_name: Some(req.artist_name.clone()),
        album_title: Some(req.album_title.clone()),
        genre_name: req.genre_name.clone(),
        track_number: req.track_number,
        disc_number: req.disc_number,
        duration: req.duration_ms,
        year: req.year,
        bpm: req.bpm,
        track_artist: req.track_artist.clone(),
        metadata: req.metadata.clone(),
        lyrics: req.lyrics.clone(),
        created_by: None,
        is_compilation: false,
    })
    .await;

    if !import_response.success {
        // clean up the file we wrote
        let _ = std::fs::remove_file(&final_path);
        return GrimoireResponse::failure("failed to import song", import_response.errors);
    }

    let import_result = match import_response.data {
        Some(r) => r,
        None => {
            let _ = std::fs::remove_file(&final_path);
            return GrimoireResponse::failure(
                "import returned no data",
                vec![ErrorDetail::new(
                    "internal_error",
                    "import failed",
                    "no import result returned",
                )],
            );
        }
    };

    // get song and album IDs from import result
    let song_id = import_result.song.id.clone();
    let album_id = import_result.album.as_ref().map(|a| a.id.clone());

    // store song images
    tracing::debug!(
        "sync_song: {} - storing {} song images, {} album images, {} artist images",
        req.title,
        req.song_images.len(),
        req.album_images.len(),
        req.artist_images.len()
    );

    for (idx, img_data) in req.song_images.iter().enumerate() {
        if let Some(blob_id) =
            store_sync_image(img_data, &format!("song-{}-{}", song_id, idx)).await
        {
            let is_primary = img_data.is_primary || idx == 0;
            let _ =
                crate::music::entities::songs::add_song_image(&song_id, &blob_id, is_primary, None)
                    .await;
        }
    }

    // store album images (if we have an album)
    if let Some(ref aid) = album_id {
        for (idx, img_data) in req.album_images.iter().enumerate() {
            if let Some(blob_id) =
                store_sync_image(img_data, &format!("album-{}-{}", aid, idx)).await
            {
                let is_primary = img_data.is_primary || idx == 0;
                let add_result = crate::music::entities::albums::add_album_image(
                    aid, &blob_id, is_primary, None,
                )
                .await;
                if add_result.success {
                    tracing::debug!(
                        "sync_song: stored album image {} (primary: {}) for album {}",
                        blob_id,
                        is_primary,
                        aid
                    );
                } else {
                    tracing::warn!(
                        "failed to add album image {} to {}: {}",
                        blob_id,
                        aid,
                        add_result.message
                    );
                }
            }
        }

        // tag album with remote name and synced tags
        let mut tag_names = Vec::new();
        tag_names.push(req.remote_name.clone());
        tag_names.extend(req.album_tags.iter().cloned());

        if !tag_names.is_empty() {
            let tag_result = crate::music::entities::tags::add_albums_tags(
                crate::music::entities::tags::AddAlbumsTagsRequest {
                    album_ids: vec![aid.clone()],
                    tag_ids: vec![],
                    tag_names,
                },
            )
            .await;

            if !tag_result.success {
                tracing::warn!(
                    "failed to add tags to album {}: {}",
                    aid,
                    tag_result.message
                );
            }
        }

        // create album feed event if this is a standalone sync (not part of playlist)
        if !req.skip_feed_events {
            let _ = crate::music::analytics::feed_events::upsert_album_feed_event(
                aid,
                &caller.user_id,
                &caller.username,
                1, // 1 song added
            )
            .await;
        }
    }

    // store artist images if we have an artist and images
    if let Some(ref artist) = import_result.artist {
        for (idx, img_data) in req.artist_images.iter().enumerate() {
            let name_prefix = format!("artist-{}-img{}", artist.id, idx);
            if let Some(blob_id) = store_sync_image(img_data, &name_prefix).await {
                // add image to artist (no feed event during sync)
                let add_result = crate::music::entities::artists::add_artist_image(
                    &artist.id,
                    &blob_id,
                    idx == 0, // first image is primary
                    None,     // no created_by = no feed event
                )
                .await;

                if !add_result.success {
                    tracing::warn!(
                        "failed to add artist image {} to artist {}: {}",
                        blob_id,
                        artist.id,
                        add_result.message
                    );
                }
            }
        }
    }

    let response = SyncSongResponse {
        already_existed: !song_is_new,
        song_id: req.sha256.clone(),
        file_path: final_path.to_string_lossy().to_string(),
        media_blob_id: blob.id,
    };

    GrimoireResponse::success(
        if song_is_new {
            "song synced successfully"
        } else {
            "song already existed"
        },
        serde_json::to_value(response).unwrap_or_default(),
    )
}

/// helper to store a sync image and return its blob_id
async fn store_sync_image(img_data: &SyncImageData, name_prefix: &str) -> Option<String> {
    // decode base64 image
    let image_bytes = match base64::engine::general_purpose::STANDARD.decode(&img_data.data) {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!("failed to decode image {}: {}", name_prefix, e);
            return None;
        }
    };

    // calculate sha256
    let mut hasher = Sha256::new();
    hasher.update(&image_bytes);
    let sha256 = format!("{:x}", hasher.finalize());

    // check if blob already exists using grimoire service
    if let Ok(existing) = crate::media_blobz::get_media_blob_by_sha256(&sha256).await {
        return Some(existing.id);
    }

    // create media blob with inline data
    let blob_result = create_media_blob(CreateMediaBlobRequest {
        sha256: sha256.clone(),
        size: Some(image_bytes.len() as i64),
        mime: Some(img_data.mime_type.clone()),
        source_client_id: None,
        local_path: None,
        filename: Some(format!("{}.jpg", name_prefix)),
        parent_blob_id: None,
        blob_type: Some(BlobType::Original),
        metadata: serde_json::json!({}),
        created_by: None,
        data: Some(crate::Bytes(image_bytes)),
        width: None,
        height: None,
        blake3: None,
    })
    .await;

    match blob_result {
        Ok(blob) => Some(blob.id),
        Err(e) => {
            tracing::warn!("failed to create blob for {}: {}", name_prefix, e);
            None
        }
    }
}

/// sync a playlist to local grimoire storage
///
/// path: POST /api/sync/playlist
pub async fn sync_playlist(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: SyncPlaylistRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    // find song IDs by sha256, preserving original positions
    let mut songs_with_positions: Vec<(String, i64)> = Vec::new();
    let mut missing_count = 0;

    for (idx, sha256) in req.song_sha256s.iter().enumerate() {
        match crate::music::entities::songs::get_song_by_sha256(sha256).await {
            Ok(Some(id)) => songs_with_positions.push((id, idx as i64)),
            Ok(None) => missing_count += 1,
            Err(e) => {
                tracing::warn!("failed to lookup song by sha256 {}: {}", sha256, e);
                missing_count += 1;
            }
        }
    }

    if songs_with_positions.is_empty() {
        return GrimoireResponse::failure(
            "no songs found locally",
            vec![ErrorDetail::new(
                "songs_not_found",
                "no matching songs",
                "none of the provided sha256 hashes match local songs",
            )],
        );
    }

    // generate deterministic playlist ID for synced playlists
    // this allows us to find and update existing synced playlists
    let synced_playlist_id = format!("synced-{}", req.remote_playlist_id);

    // check if this synced playlist already exists
    let existing = crate::music::entities::playlists::get_playlist(&synced_playlist_id).await;

    let playlist_id = if existing.success && existing.data.is_some() {
        // update existing playlist metadata
        tracing::info!(
            "updating existing synced playlist: {} ({})",
            req.title,
            synced_playlist_id
        );

        let _update_response = crate::music::entities::playlists::update_playlist(
            &synced_playlist_id,
            crate::music::entities::playlists::UpdatePlaylistRequest {
                playlist_id: synced_playlist_id.clone(),
                title: Some(req.title.clone()),
                description: req.description.clone(),
                is_public: Some(false),
                updated_by: Some(caller.user_id.clone()),
                entity_urls: None,
            },
        )
        .await;

        synced_playlist_id
    } else {
        // create new playlist with deterministic ID
        tracing::info!(
            "creating new synced playlist: {} ({})",
            req.title,
            synced_playlist_id
        );

        let create_response = crate::music::entities::playlists::create_playlist(
            crate::music::entities::playlists::CreatePlaylistRequest {
                id: Some(synced_playlist_id.clone()),
                title: Some(req.title.clone()),
                description: req.description.clone(),
                is_public: Some(false),
                created_by_id: Some(caller.user_id.clone()),
            },
        )
        .await;

        if !create_response.success {
            return GrimoireResponse::failure("failed to create playlist", create_response.errors);
        }

        synced_playlist_id
    };

    // fetch the playlist for response
    let playlist_response = crate::music::entities::playlists::get_playlist(&playlist_id).await;
    let playlist = match playlist_response.data {
        Some(p) => p,
        None => {
            return GrimoireResponse::failure(
                "playlist not found after create/update",
                vec![ErrorDetail::new(
                    "internal_error",
                    "fetch failed",
                    "could not retrieve playlist",
                )],
            );
        }
    };

    // set songs with explicit positions using grimoire function
    // positions are the original indices from the remote playlist
    let set_result = crate::music::entities::playlists::set_playlist_songs(
        &playlist.id,
        &songs_with_positions,
        Some((caller.user_id.as_str(), caller.username.as_str())),
    )
    .await;

    if !set_result.success {
        tracing::warn!("failed to set songs on playlist: {}", set_result.message);
    }

    // store playlist images (reuse store_sync_image helper)
    // NOTE: pass None for created_by to avoid creating separate image feed events
    // the single playlist feed event at the end will include the images
    let mut images_stored = 0;
    for (idx, img_data) in req.images.iter().enumerate() {
        if let Some(blob_id) =
            store_sync_image(img_data, &format!("playlist-{}-{}", playlist.id, idx)).await
        {
            let is_primary = img_data.is_primary || idx == 0;
            let add_result = crate::music::entities::playlists::add_playlist_image(
                &playlist.id,
                &blob_id,
                is_primary,
                None, // don't create separate image feed event during sync
            )
            .await;

            if add_result.success {
                images_stored += 1;
            }
        }
    }

    if images_stored > 0 {
        tracing::info!(
            "stored {} images for playlist {}",
            images_stored,
            playlist.id
        );
    }

    // create feed event for the new playlist
    let _ = crate::music::analytics::feed_events::upsert_playlist_feed_event(
        &playlist.id,
        &caller.user_id,
        &caller.username,
    )
    .await;

    let response = SyncPlaylistResponse {
        playlist_id: playlist.id.clone(),
        songs_added: songs_with_positions.len() as i64,
        songs_missing: missing_count as i64,
    };

    GrimoireResponse::success(
        &format!(
            "playlist synced with {} songs ({} missing)",
            songs_with_positions.len(),
            missing_count
        ),
        serde_json::to_value(response).unwrap_or_default(),
    )
}

// ============================================================================
// sync_album: receive an album shell with metadata + cover images.
// see docs/SEND_TO_REMOTE_PLAN.md.
// ============================================================================

/// hash-addressed image payload used by the new send-to-remote pipeline.
///
/// `data_base64` is omitted when the destination already has a media_blob with
/// matching `content_sha256` (negotiated up-front via `POST /api/blobz/has`).
/// when omitted, the destination links the existing blob by sha256 instead of
/// writing new bytes.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SyncImageRef {
    /// sha256 hash of the image bytes (always set). this is the dedupe key.
    pub content_sha256: String,
    /// base64-encoded image bytes. omitted when the destination already has
    /// the blob (negotiated via /api/blobz/has).
    #[serde(default)]
    pub data_base64: Option<String>,
    /// mime type (e.g. "image/jpeg")
    pub mime_type: String,
    /// whether this is the primary image
    pub is_primary: bool,
    /// blob type ("thumbnail" | "original"). defaults to "original" when None.
    #[serde(default)]
    pub blob_type: Option<String>,
}

/// request for syncing an album shell from a source remote to local grimoire.
///
/// the album row is created on the destination if missing; otherwise the
/// existing row is reused (idempotent). songs are not transferred here —
/// the caller follows up with one `POST /api/sync/song-by-blake3` per song.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SyncAlbumRequest {
    /// optional source remote id (for provenance / future logging)
    #[serde(default)]
    pub source_remote_id: Option<String>,
    /// optional source iroh node id (the destination uses it later to pull songs)
    #[serde(default)]
    pub source_node_id: Option<String>,
    /// the source's album id. used purely for provenance / deterministic mapping.
    pub remote_album_id: String,
    /// album title
    pub title: String,
    /// canonical "album artist" name (the artist linked to the album on s).
    /// used as part of the destination dedupe key.
    pub artist_name: String,
    /// album type ("album" | "single" | "compilation" | "ep" | ...).
    /// defaults to "album" when None.
    #[serde(default)]
    pub album_type: Option<String>,
    /// release date string (YYYY, YYYY-MM, or YYYY-MM-DD)
    #[serde(default)]
    pub release_date: Option<String>,
    /// label / publisher
    #[serde(default)]
    pub label: Option<String>,
    /// genre names. resolved/created by name on the destination.
    #[serde(default)]
    pub genres: Vec<String>,
    /// external urls (e.g. bandcamp/discogs/musicbrainz). currently informational only.
    #[serde(default)]
    pub urls: Vec<String>,
    /// musicbrainz release id (informational only — not persisted yet)
    #[serde(default)]
    pub mb_release_id: Option<String>,
    /// musicbrainz release-group id (informational only — not persisted yet)
    #[serde(default)]
    pub mb_release_group_id: Option<String>,
    /// tag names to attach to the album on the destination
    #[serde(default)]
    pub tags: Vec<String>,
    /// album cover images (with optional inline base64 per blobz/has negotiation)
    #[serde(default)]
    pub images_base64: Vec<SyncImageRef>,
    /// blake3 hashes of the songs the source plans to send next. hint only;
    /// the destination does not enforce or pre-create song rows here.
    #[serde(default)]
    pub expected_song_blake3s: Vec<String>,
    /// remote display name (used as a tag on the album for provenance)
    pub remote_name: String,
}

/// response for syncing an album shell.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SyncAlbumResponse {
    /// destination album id (existing or newly created)
    pub album_id: String,
    /// destination artist id (existing or newly created)
    pub artist_id: String,
    /// true if the album row already existed on d, false if it was just created
    pub existing: bool,
    /// number of images that were linked (existing blob found by sha256 or
    /// newly written from inline base64)
    pub images_linked: i64,
    /// sha256s the request claimed had inline data but were missing from
    /// `data_base64` and not present locally — these are skipped, not fatal.
    pub missing_image_sha256s: Vec<String>,
}

/// sync an album shell to local grimoire storage.
///
/// path: POST /api/sync/album
pub async fn sync_album(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    use crate::music::crud::create_or_update::{
        find_or_create_album_for_artist, find_or_create_artist, find_or_create_genre,
    };
    use crate::music::crud::{AlbumImportRequest, ArtistImportRequest};

    let req: SyncAlbumRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    // 1. resolve / create the album artist by name (case-insensitive)
    let artist_resp = find_or_create_artist(ArtistImportRequest {
        name: req.artist_name.clone(),
        created_by: Some(caller.user_id.clone()),
    })
    .await;
    if !artist_resp.success {
        return GrimoireResponse::failure("failed to resolve artist", artist_resp.errors);
    }
    let (artist, _artist_was_new) = match artist_resp.data {
        Some(d) => d,
        None => {
            return GrimoireResponse::failure(
                "artist resolve returned no data",
                vec![ErrorDetail::new(
                    "internal_error",
                    "artist resolve",
                    "no artist returned",
                )],
            )
        }
    };

    // 2. resolve genre names → genre_ids (best-effort; skip any that fail)
    let mut genre_ids: Vec<String> = Vec::new();
    for name in &req.genres {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            continue;
        }
        let resp = find_or_create_genre(trimmed.to_string()).await;
        if let Some((genre, _)) = resp.data {
            genre_ids.push(genre.id);
        } else {
            tracing::warn!(
                "sync_album: failed to resolve genre {}: {}",
                trimmed,
                resp.message
            );
        }
    }
    let genre_ids_opt = if genre_ids.is_empty() {
        None
    } else {
        Some(genre_ids)
    };

    // 3. dedupe / create album by (artist_id, lower(title)).
    //    find_or_create_album_for_artist also auto-updates album_type if it differs.
    let album_req = AlbumImportRequest {
        title: req.title.clone(),
        album_type: req.album_type.clone(),
        release_date: req.release_date.clone(),
        label: req.label.clone(),
        genre_ids: genre_ids_opt,
        created_by: Some(caller.user_id.clone()),
    };
    let (album, was_created) = match find_or_create_album_for_artist(album_req, &artist.id).await {
        Ok(t) => t,
        Err(e) => {
            return GrimoireResponse::failure("failed to find or create album", vec![e.into()])
        }
    };
    let existing = !was_created;

    // TODO: when existing=true, merge missing fields (release_date, label, urls)
    // into the existing row. for now we leave existing rows untouched to keep
    // step 3 small. mb_release_id / mb_release_group_id / urls aren't persisted
    // on the album row at all yet.

    // 4. import album cover images.
    //    each ref is either inline base64 (decode + dedupe by sha256) or a
    //    pure reference (look up existing blob by sha256). missing referenced
    //    blobs are skipped, not fatal.
    let mut images_linked: i64 = 0;
    let mut missing_image_sha256s: Vec<String> = Vec::new();
    for (idx, img) in req.images_base64.iter().enumerate() {
        let blob_id_opt =
            match resolve_sync_image_ref(img, &format!("album-{}-{}", album.id, idx)).await {
                Ok(Some(id)) => Some(id),
                Ok(None) => {
                    missing_image_sha256s.push(img.content_sha256.clone());
                    None
                }
                Err(e) => {
                    tracing::warn!(
                        "sync_album: failed to import image {} for album {}: {}",
                        img.content_sha256,
                        album.id,
                        e
                    );
                    None
                }
            };
        if let Some(blob_id) = blob_id_opt {
            let is_primary = img.is_primary || idx == 0;
            let add_result = crate::music::entities::albums::add_album_image(
                &album.id, &blob_id, is_primary, None,
            )
            .await;
            if add_result.success {
                images_linked += 1;
            } else {
                tracing::warn!(
                    "sync_album: failed to add image {} to album {}: {}",
                    blob_id,
                    album.id,
                    add_result.message
                );
            }
        }
    }

    // 5. attach tags (provenance + caller-supplied). idempotent.
    let mut tag_names: Vec<String> = Vec::with_capacity(1 + req.tags.len());
    tag_names.push(req.remote_name.clone());
    tag_names.extend(req.tags.iter().cloned());
    let tag_names: Vec<String> = tag_names
        .into_iter()
        .filter(|n| !n.trim().is_empty())
        .collect();
    if !tag_names.is_empty() {
        let tag_result = crate::music::entities::tags::add_albums_tags(
            crate::music::entities::tags::AddAlbumsTagsRequest {
                album_ids: vec![album.id.clone()],
                tag_ids: vec![],
                tag_names,
            },
        )
        .await;
        if !tag_result.success {
            tracing::warn!(
                "sync_album: failed to add tags to album {}: {}",
                album.id,
                tag_result.message
            );
        }
    }

    let response = SyncAlbumResponse {
        album_id: album.id.clone(),
        artist_id: artist.id,
        existing,
        images_linked,
        missing_image_sha256s,
    };

    GrimoireResponse::success(
        if existing {
            "album already existed"
        } else {
            "album synced successfully"
        },
        serde_json::to_value(response).unwrap_or_default(),
    )
}

/// resolve a `SyncImageRef` to a media_blob id.
///
/// - inline `data_base64`: decode, verify sha256 matches `content_sha256`,
///   then create the blob (or dedupe to an existing one). returns `Ok(Some(id))`.
/// - omitted `data_base64`: look up an existing blob by sha256.
///     - found → `Ok(Some(id))`.
///     - missing → `Ok(None)` (caller treats as "skipped, not fatal").
/// - decode/hash mismatch → `Err`.
async fn resolve_sync_image_ref(
    img: &SyncImageRef,
    name_prefix: &str,
) -> GrimoireResult<Option<String>> {
    if let Some(data_b64) = &img.data_base64 {
        // inline path: decode, verify, create-or-dedupe
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data_b64)
            .map_err(|e| GrimoireError::ProcessingFailed {
                message: format!("invalid base64 image data for {}: {}", name_prefix, e),
            })?;

        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let computed = format!("{:x}", hasher.finalize());
        if computed != img.content_sha256 {
            return Err(GrimoireError::ProcessingFailed {
                message: format!(
                    "image sha256 mismatch for {}: claimed {}, computed {}",
                    name_prefix, img.content_sha256, computed
                ),
            });
        }

        // dedupe via create_media_blob (sha256 unique constraint)
        let blob = create_media_blob(CreateMediaBlobRequest {
            sha256: img.content_sha256.clone(),
            size: Some(bytes.len() as i64),
            mime: Some(img.mime_type.clone()),
            source_client_id: None,
            local_path: None,
            filename: Some(format!("{}.bin", name_prefix)),
            parent_blob_id: None,
            blob_type: Some(match img.blob_type.as_deref() {
                Some("thumbnail") => BlobType::Thumbnail,
                _ => BlobType::Original,
            }),
            metadata: serde_json::json!({}),
            created_by: None,
            data: Some(crate::Bytes(bytes)),
            width: None,
            height: None,
            blake3: None,
        })
        .await?;
        Ok(Some(blob.id))
    } else {
        // reference-only path: look up by sha256
        match crate::media_blobz::get_media_blob_by_sha256(&img.content_sha256).await {
            Ok(blob) => Ok(Some(blob.id)),
            Err(_) => Ok(None),
        }
    }
}
