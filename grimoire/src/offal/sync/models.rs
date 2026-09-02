//! request/response payloads for the sync routes.
//!
//! kept together rather than beside each handler: the codegen type registry
//! references them by name, and several are shared across handlers.

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

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
    /// optional album images. linked to the song's album row on import.
    /// same inline-or-reference shape as `song_images`. used when syncing
    /// individual songs from a remote so the album row gets cover art on
    /// the destination without a separate `/api/sync/album` round-trip.
    #[serde(default)]
    pub album_images: Vec<SyncImageRef>,
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

// pulls the video blob from the source peer via iroh-blobs, then writes the
// full video row plus its series/season shell and any poster images, so a
// charnel desktop app can mirror a remote video into its own library.
// ============================================================================

/// request for syncing a video from a source remote via iroh-blobs pull.
///
/// series/season are addressed by title/number rather than by remote id -
/// `find_or_create_video_series`/`find_or_create_video_season` resolve them
/// on the destination, so repeated syncs of episodes from the same show all
/// land under one local series.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SyncVideoByBlake3Request {
    /// blake3 hash of the video file (used for P2P verified streaming)
    pub blake3: String,
    /// sha256 of the video file, when the source knows it (verified after
    /// download). videos carry no sha256 of their own client-side, so this
    /// is optional - unlike the song route.
    #[serde(default)]
    pub sha256: Option<String>,
    /// declared file size in bytes
    #[serde(default)]
    pub size: Option<u64>,
    /// original filename (used to derive extension + mime hint)
    pub filename: String,
    /// source iroh node id to pull the blob from
    pub source_node_id: String,
    /// optional source remote id (for provenance)
    #[serde(default)]
    pub source_remote_id: Option<String>,
    /// remote display name (provenance)
    #[serde(default)]
    pub remote_name: Option<String>,
    /// video title
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    /// "series" | "movie" | "clip" - defaults per `CreateVideoRequest`
    #[serde(default)]
    pub content_type: Option<String>,
    #[serde(default)]
    pub episode_number: Option<i64>,
    #[serde(default)]
    pub duration_seconds: Option<f64>,
    #[serde(default)]
    pub release_date: Option<String>,
    /// series title - when set, the destination finds or creates a matching
    /// series and attaches the video to it
    #[serde(default)]
    pub series_title: Option<String>,
    #[serde(default)]
    pub series_description: Option<String>,
    /// season number within the series - requires `series_title`
    #[serde(default)]
    pub season_number: Option<i64>,
    #[serde(default)]
    pub season_title: Option<String>,
    /// poster/thumbnail images for the video itself
    #[serde(default)]
    pub video_images: Vec<SyncImageRef>,
    /// poster images for the series row
    #[serde(default)]
    pub series_images: Vec<SyncImageRef>,
    /// poster images for the season row
    #[serde(default)]
    pub season_images: Vec<SyncImageRef>,
}

/// response for syncing a video via blake3 pull
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SyncVideoByBlake3Response {
    pub video_id: String,
    pub media_blob_id: String,
    /// final on-disk path of the video file
    pub file_path: String,
    pub blake3: String,
    /// destination series id, when the video was attached to one
    pub series_id: Option<String>,
    /// destination season id, when the video was attached to one
    pub season_id: Option<String>,
    /// true if the video row already existed before this call
    pub existing: bool,
    /// number of images linked across video/series/season
    pub images_linked: i64,
    /// image sha256s claimed without inline data and not present locally
    pub missing_image_sha256s: Vec<String>,
}
