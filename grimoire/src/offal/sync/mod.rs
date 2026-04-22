//! sync handlers - sync remote albums/songs/playlists to local grimoire storage
//!
//! all transfers ride the iroh-blobs pull model: payloads carry blake3 hashes,
//! the destination pulls blobs back over P2P via the shared
//! `pull_audio_blob_to_local_storage` helper.

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sha2::{Digest, Sha256};
use zod_gen_derive::ZodSchema;

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::{ErrorDetail, GrimoireError, GrimoireResult};
use crate::media_blobz::{create_media_blob, BlobType, CreateMediaBlobRequest};
use crate::music::crud::create_or_update::import_song_with_metadata;
use crate::music::crud::ImportSongRequest;
use crate::offal::caller::Caller;
use crate::offal::upload::pull_audio_blob_to_local_storage;
use crate::response::GrimoireResponse;
use crate::users::UserRole;

/// route metadata for sync
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "sync_song_by_blake3",
        path: "/api/sync/song-by-blake3",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "SyncSongByBlake3Request",
        response_type: "SyncSongByBlake3Response",
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

/// request for syncing a song from a source remote via iroh-blobs pull.
///
/// the destination pulls the audio blob by `blake3` from `source_node_id`
/// (verified streaming) and writes a complete songz row using the supplied
/// metadata. there is no async ImportMusic job — the request carries enough
/// metadata to persist the song stub immediately, so the blake3 → song
/// lookup is instant for the playlist sync that follows.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SyncSongByBlake3Request {
    /// blake3 hash of the audio file (used for P2P verified streaming)
    pub blake3: String,
    /// sha256 hash of the audio file (used for dedupe + verification)
    pub sha256: String,
    /// declared file size in bytes (verified after download)
    #[serde(default)]
    pub size: Option<u64>,
    /// original filename (used to derive extension + mime hint)
    pub filename: String,
    /// source iroh node id to pull the blob from
    pub source_node_id: String,
    /// optional source remote id (for provenance)
    #[serde(default)]
    pub source_remote_id: Option<String>,
    /// remote display name (used as a tag on the album for provenance)
    pub remote_name: String,
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
    #[serde(default)]
    pub duration_ms: Option<i64>,
    /// release year
    #[serde(default)]
    pub year: Option<i64>,
    /// bpm
    #[serde(default)]
    pub bpm: Option<i64>,
    /// track-specific artist (for compilations)
    #[serde(default)]
    pub track_artist: Option<String>,
    /// lyrics
    #[serde(default)]
    pub lyrics: Option<String>,
    /// additional metadata (JSON string)
    #[serde(default)]
    pub metadata: Option<String>,
    /// genre name
    #[serde(default)]
    pub genre_name: Option<String>,
    /// optional song images. each ref is either inline base64 (decoded +
    /// deduped by sha256) or a pure reference (existing blob looked up by
    /// sha256). missing referenced blobs are skipped, not fatal.
    #[serde(default)]
    pub song_images: Vec<SyncImageRef>,
    /// is this song part of a compilation
    #[serde(default)]
    pub is_compilation: bool,
}

/// response for syncing a song via blake3 pull
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SyncSongByBlake3Response {
    /// destination song id (existing or newly created)
    pub song_id: String,
    /// destination media blob id
    pub media_blob_id: String,
    /// final on-disk path of the audio file
    pub file_path: String,
    /// computed sha256 of the downloaded bytes
    pub sha256: String,
    /// blake3 hash (echoed back from the request)
    pub blake3: String,
    /// true if the song row already existed before this call
    pub existing: bool,
    /// number of song images linked (existing-by-sha256 or new-from-base64)
    pub images_linked: i64,
    /// image sha256s claimed without inline data and not present locally
    pub missing_image_sha256s: Vec<String>,
}

/// request for syncing a playlist from a source remote.
///
/// playlist members are addressed by `song_blake3s` (resolved on the
/// destination via `media_blobz.blake3 → songz.media_blob_id`). the
/// destination is expected to have already received each song via
/// `POST /api/sync/song-by-blake3` (or to have a pre-existing row keyed
/// by the same blake3). missing blake3s are reported in the response but
/// are not fatal — a partial playlist is created.
///
/// the destination playlist id is deterministic:
/// `synced-{source_remote_id}-{remote_playlist_id}` (or
/// `synced-{remote_playlist_id}` when `source_remote_id` is omitted).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SyncPlaylistRequest {
    /// optional source remote id (for deterministic destination playlist id)
    #[serde(default)]
    pub source_remote_id: Option<String>,
    /// remote playlist id (for deterministic destination playlist id)
    pub remote_playlist_id: String,
    /// playlist title
    pub title: String,
    /// optional description
    #[serde(default)]
    pub description: Option<String>,
    /// blake3 hashes of songs in playlist order
    pub song_blake3s: Vec<String>,
    /// optional playlist images (sha256-addressed)
    #[serde(default)]
    pub images: Vec<SyncImageRef>,
    /// remote display name (used as a tag on the playlist for provenance)
    pub remote_name: String,
}

/// response for syncing a playlist
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SyncPlaylistResponse {
    /// destination playlist id
    pub playlist_id: String,
    /// number of songs added (resolved by blake3)
    pub songs_added: i64,
    /// blake3s with no media_blob (and therefore no song row) on the
    /// destination — caller may retry after pushing those songs.
    pub missing_song_blake3s: Vec<String>,
    /// number of song stubs that were created on the fly because a media_blob
    /// existed for the blake3 but no song row was linked yet.
    pub song_stubs_created: i64,
    /// number of images linked
    pub images_linked: i64,
    /// image sha256s claimed without inline data and not present locally
    pub missing_image_sha256s: Vec<String>,
}

/// dispatch sync routes
pub async fn dispatch(
    path: &str,
    caller: &Caller,
    body: &JsonValue,
) -> Option<GrimoireResponse<JsonValue>> {
    match path {
        "/api/sync/song-by-blake3" => Some(sync_song_by_blake3(caller, body.clone()).await),
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

/// sync a song from a source remote via iroh-blobs pull.
///
/// path: POST /api/sync/song-by-blake3
///
/// flow:
///   1. parse + validate request
///   2. shortcut: if a song row already exists keyed by `blake3`, skip the pull entirely
///   3. otherwise, call `pull_audio_blob_to_local_storage` (verified streaming + dedupe)
///   4. write a complete song row via `import_song_with_metadata` (no async ImportMusic job)
///   5. attach song images by `SyncImageRef` (inline base64 OR existing-by-sha256)
pub async fn sync_song_by_blake3(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: SyncSongByBlake3Request = match serde_json::from_value(body) {
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

    // 2. shortcut: song already linked to this blake3 -> idempotent success
    if let Ok(Some(existing_song_id)) =
        crate::music::entities::songs::get_song_by_blake3(&req.blake3).await
    {
        tracing::info!(
            "sync_song_by_blake3: song already exists for blake3 {} -> {}",
            &req.blake3[..16],
            existing_song_id
        );
        let media_blob_id = crate::media_blobz::get_media_blob_by_blake3(&req.blake3)
            .await
            .map(|b| b.id)
            .unwrap_or_default();
        let local_path = crate::media_blobz::get_media_blob_by_blake3(&req.blake3)
            .await
            .ok()
            .and_then(|b| b.local_path)
            .unwrap_or_default();
        let response = SyncSongByBlake3Response {
            song_id: existing_song_id,
            media_blob_id,
            file_path: local_path,
            sha256: req.sha256.clone(),
            blake3: req.blake3.clone(),
            existing: true,
            images_linked: 0,
            missing_image_sha256s: Vec::new(),
        };
        return GrimoireResponse::success(
            "song already existed",
            serde_json::to_value(response).unwrap_or_default(),
        );
    }

    // 3. pull the audio blob (verified streaming + sha256 verify + dedupe)
    let pulled = match pull_audio_blob_to_local_storage(
        &req.source_node_id,
        &req.blake3,
        Some(&req.sha256),
        req.size,
        &req.filename,
        caller,
    )
    .await
    {
        Ok(r) => r,
        Err(e) => return e.into_grimoire_response(),
    };

    // 4. write the song row immediately with the supplied metadata.
    //    no async ImportMusic job — sync trusts the source's tags.
    let import_response = import_song_with_metadata(ImportSongRequest {
        media_blob_id: pulled.blob.id.clone(),
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
        created_by: Some(caller.user_id.clone()),
        is_compilation: req.is_compilation,
    })
    .await;

    if !import_response.success {
        return GrimoireResponse::failure("failed to import song", import_response.errors);
    }
    let import_result = match import_response.data {
        Some(r) => r,
        None => {
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
    let song_id = import_result.song.id.clone();

    // 5. link song images. each ref is either inline base64 (decode + dedupe by
    //    sha256) or a pure reference (look up existing blob by sha256). missing
    //    referenced blobs are recorded but not fatal.
    let mut images_linked: i64 = 0;
    let mut missing_image_sha256s: Vec<String> = Vec::new();
    for (idx, img) in req.song_images.iter().enumerate() {
        let blob_id_opt =
            match resolve_sync_image_ref(img, &format!("song-{}-{}", song_id, idx)).await {
                Ok(Some(id)) => Some(id),
                Ok(None) => {
                    missing_image_sha256s.push(img.content_sha256.clone());
                    None
                }
                Err(e) => {
                    tracing::warn!(
                        "sync_song_by_blake3: failed to import image {} for song {}: {}",
                        img.content_sha256,
                        song_id,
                        e
                    );
                    None
                }
            };
        if let Some(blob_id) = blob_id_opt {
            let is_primary = img.is_primary || idx == 0;
            let add_result =
                crate::music::entities::songs::add_song_image(&song_id, &blob_id, is_primary, None)
                    .await;
            if add_result.success {
                images_linked += 1;
            }
        }
    }

    let response = SyncSongByBlake3Response {
        song_id,
        media_blob_id: pulled.blob.id,
        file_path: pulled.local_path.to_string_lossy().to_string(),
        sha256: pulled.sha256,
        blake3: req.blake3.clone(),
        existing: false,
        images_linked,
        missing_image_sha256s,
    };

    GrimoireResponse::success(
        "song synced successfully",
        serde_json::to_value(response).unwrap_or_default(),
    )
}

/// sync a playlist to local grimoire storage.
///
/// path: POST /api/sync/playlist
///
/// resolves each `song_blake3` via `media_blobz.blake3 -> songz.media_blob_id`.
/// when a media_blob exists for the blake3 but no song row is linked yet
/// (race with `/api/upload/music-by-blake3`'s ImportMusic job), creates a
/// minimal song stub from the blob's filename so the playlist still gets a
/// row at the right position. blake3s with no media_blob at all are reported
/// in `missing_song_blake3s` and skipped (caller may retry later).
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

    // resolve each blake3 -> song_id, preserving original positions.
    // if no song row exists yet but a media_blob does, create a stub so the
    // playlist member still anchors at the right position.
    let mut songs_with_positions: Vec<(String, i64)> = Vec::new();
    let mut missing_song_blake3s: Vec<String> = Vec::new();
    let mut song_stubs_created: i64 = 0;

    for (idx, blake3) in req.song_blake3s.iter().enumerate() {
        match crate::music::entities::songs::get_song_by_blake3(blake3).await {
            Ok(Some(id)) => songs_with_positions.push((id, idx as i64)),
            Ok(None) => {
                // no song row yet — see if a media_blob exists for this blake3.
                // if so, create a stub song row from the blob's filename.
                match crate::media_blobz::get_media_blob_by_blake3(blake3).await {
                    Ok(blob) => {
                        let stub_title = blob
                            .filename
                            .clone()
                            .unwrap_or_else(|| format!("(unknown {})", &blake3[..8]));
                        let stub_resp = import_song_with_metadata(ImportSongRequest {
                            media_blob_id: blob.id.clone(),
                            title: stub_title,
                            artist_name: None,
                            album_title: None,
                            genre_name: None,
                            track_number: 0,
                            disc_number: 0,
                            duration: None,
                            year: None,
                            bpm: None,
                            track_artist: None,
                            metadata: None,
                            lyrics: None,
                            created_by: Some(caller.user_id.clone()),
                            is_compilation: false,
                        })
                        .await;
                        if let Some(result) = stub_resp.data {
                            songs_with_positions.push((result.song.id, idx as i64));
                            song_stubs_created += 1;
                        } else {
                            tracing::warn!(
                                "sync_playlist: failed to create stub song for blake3 {}: {}",
                                &blake3[..16],
                                stub_resp.message
                            );
                            missing_song_blake3s.push(blake3.clone());
                        }
                    }
                    Err(_) => missing_song_blake3s.push(blake3.clone()),
                }
            }
            Err(e) => {
                tracing::warn!(
                    "sync_playlist: failed to lookup song by blake3 {}: {}",
                    &blake3[..16],
                    e
                );
                missing_song_blake3s.push(blake3.clone());
            }
        }
    }

    // deterministic synced playlist id (idempotent across replays).
    // includes source_remote_id when supplied so the same remote_playlist_id
    // from two different remotes maps to two distinct destination playlists.
    let synced_playlist_id = match &req.source_remote_id {
        Some(rid) if !rid.is_empty() => format!("synced-{}-{}", rid, req.remote_playlist_id),
        _ => format!("synced-{}", req.remote_playlist_id),
    };

    let existing = crate::music::entities::playlists::get_playlist(&synced_playlist_id).await;

    let playlist_id = if existing.success && existing.data.is_some() {
        tracing::info!(
            "sync_playlist: updating existing synced playlist {} ({})",
            req.title,
            synced_playlist_id
        );
        let _ = crate::music::entities::playlists::update_playlist(
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
        tracing::info!(
            "sync_playlist: creating new synced playlist {} ({})",
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

    // set songs with explicit positions (blake3 order from request)
    if !songs_with_positions.is_empty() {
        let set_result = crate::music::entities::playlists::set_playlist_songs(
            &playlist.id,
            &songs_with_positions,
            Some((caller.user_id.as_str(), caller.username.as_str())),
        )
        .await;
        if !set_result.success {
            tracing::warn!(
                "sync_playlist: failed to set songs on playlist {}: {}",
                playlist.id,
                set_result.message
            );
        }
    }

    // link playlist images (sha256-addressed; existing blobs reused)
    let mut images_linked: i64 = 0;
    let mut missing_image_sha256s: Vec<String> = Vec::new();
    for (idx, img) in req.images.iter().enumerate() {
        let blob_id_opt =
            match resolve_sync_image_ref(img, &format!("playlist-{}-{}", playlist.id, idx)).await {
                Ok(Some(id)) => Some(id),
                Ok(None) => {
                    missing_image_sha256s.push(img.content_sha256.clone());
                    None
                }
                Err(e) => {
                    tracing::warn!(
                        "sync_playlist: failed to import image {} for playlist {}: {}",
                        img.content_sha256,
                        playlist.id,
                        e
                    );
                    None
                }
            };
        if let Some(blob_id) = blob_id_opt {
            let is_primary = img.is_primary || idx == 0;
            let add_result = crate::music::entities::playlists::add_playlist_image(
                &playlist.id,
                &blob_id,
                is_primary,
                None,
            )
            .await;
            if add_result.success {
                images_linked += 1;
            }
        }
    }

    // single feed event for the playlist (idempotent upsert)
    let _ = crate::music::analytics::feed_events::upsert_playlist_feed_event(
        &playlist.id,
        &caller.user_id,
        &caller.username,
    )
    .await;

    let response = SyncPlaylistResponse {
        playlist_id: playlist.id.clone(),
        songs_added: songs_with_positions.len() as i64,
        missing_song_blake3s,
        song_stubs_created,
        images_linked,
        missing_image_sha256s,
    };

    GrimoireResponse::success(
        &format!(
            "playlist synced with {} songs ({} missing, {} stubbed)",
            songs_with_positions.len(),
            response.missing_song_blake3s.len(),
            song_stubs_created,
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
