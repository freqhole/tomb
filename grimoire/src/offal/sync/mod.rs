//! sync handlers - sync remote albums/songs/playlists/videos to local
//! grimoire storage.
//!
//! all transfers ride the iroh-blobs pull model: payloads carry blake3 hashes,
//! the destination pulls blobs back over P2P via the shared
//! `pull_audio_blob_to_local_storage` helper. one submodule per synced entity;
//! shared payload types live in `models`, shared image handling in `images`.

use serde_json::Value as JsonValue;

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;

mod album;
mod images;
mod job_notify;
mod models;
mod playlist;
mod song;
mod video;

pub use album::sync_album;
pub use job_notify::sync_job_notify;
pub use models::*;
pub use playlist::sync_playlist;
pub use song::{get_synced_sha256s, sync_song_by_blake3, sync_song_by_blake3_impl};
pub use video::{sync_video_by_blake3, sync_video_by_blake3_impl};

/// route metadata for sync
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "sync_song_by_blake3",
        path: "/api/sync/song-by-blake3",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "SyncSongByBlake3Request",
        response_type: "SyncJobQueuedResponse",
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
    RouteInfo {
        name: "sync_video_by_blake3",
        path: "/api/sync/video-by-blake3",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "SyncVideoByBlake3Request",
        response_type: "SyncJobQueuedResponse",
        auth: RouteAuth::Role(UserRole::Member),
    },
    RouteInfo {
        name: "sync_job_notify",
        path: "/api/sync/job-notify",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "SyncJobNotify",
        response_type: "bool",
        // best-effort completion push between peers - see SyncJobNotify's
        // doc comment. public: the peer sending this isn't necessarily
        // symmetrically registered as a known peer of the recipient (the
        // recipient dialed the sender first, not the other way around).
        auth: RouteAuth::Public,
    },
];

/// collect all route metadata from sync domain
pub fn routes() -> Vec<RouteInfo> {
    ROUTES.to_vec()
}

/// dispatch sync routes
pub async fn dispatch(
    path: &str,
    caller: &Caller,
    body: &JsonValue,
) -> Option<GrimoireResponse<JsonValue>> {
    match path {
        "/api/sync/song-by-blake3" => Some(sync_song_by_blake3(caller, body.clone()).await),
        "/api/sync/job-notify" => Some(sync_job_notify(caller, body.clone()).await),
        "/api/sync/playlist" => Some(sync_playlist(caller, body.clone()).await),
        "/api/sync/sha256s" => Some(get_synced_sha256s(caller).await),
        "/api/sync/album" => Some(sync_album(caller, body.clone()).await),
        "/api/sync/video-by-blake3" => Some(sync_video_by_blake3(caller, body.clone()).await),
        _ => None,
    }
}
