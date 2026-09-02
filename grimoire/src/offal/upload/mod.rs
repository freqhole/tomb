//! upload handlers for IPC/CLI transports
//!
//! accepts base64-encoded file data or local file paths.
//! used by Tauri local transport and CLI.
//!
//! optimizations for tauri local transport:
//! - `file_path`: skip base64 encoding, read directly from filesystem
//! - `wait_for_completion`: block until job completes instead of returning job_id
//!
//! one submodule per uploaded media kind; `pull` holds the shared iroh-blobs
//! fetch, `mime` the shared content sniffing, `models` the payload types.

use serde_json::Value as JsonValue;
use tokio::time::Duration;

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;

mod image;
mod mime;
mod models;
mod music;
mod pull;
mod video;

pub use image::upload_image;
pub use mime::detect_extension;
pub use models::*;
pub use music::{import_music_paths, upload_music, upload_music_by_blake3};
pub use pull::{pull_audio_blob_to_local_storage, PullAudioBlobError, PullAudioBlobResult};
pub use video::{upload_video, upload_video_by_blake3};

/// route metadata for upload
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "upload_music",
        path: "/api/upload/music",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "String",
        response_type: "MusicUploadResponse",
        auth: RouteAuth::Role(UserRole::Member),
    },
    RouteInfo {
        name: "upload_image",
        path: "/api/upload/image",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "String",
        response_type: "ImageUploadResponse",
        auth: RouteAuth::Role(UserRole::Member),
    },
    RouteInfo {
        name: "delete_image",
        path: "/api/music/images/delete",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "DeleteImageRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "set_primary_image",
        path: "/api/music/images/set-primary",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "SetPrimaryImageRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "upload_music_by_blake3",
        path: "/api/upload/music-by-blake3",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "UploadMusicByBlake3Request",
        response_type: "MusicUploadResponse",
        auth: RouteAuth::Role(UserRole::Member),
    },
    RouteInfo {
        name: "upload_video",
        path: "/api/upload/video",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "String",
        response_type: "VideoUploadResponse",
        auth: RouteAuth::Role(UserRole::Member),
    },
    RouteInfo {
        name: "upload_video_by_blake3",
        path: "/api/upload/video-by-blake3",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "UploadVideoByBlake3Request",
        response_type: "VideoUploadResponse",
        auth: RouteAuth::Role(UserRole::Member),
    },
];

/// collect all route metadata from upload domain
pub fn routes() -> Vec<RouteInfo> {
    ROUTES.to_vec()
}

/// max time to wait for job completion (30 seconds)
pub(super) const MAX_WAIT_DURATION: Duration = Duration::from_secs(30);

/// poll interval when waiting for job completion
pub(super) const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// dispatch upload routes
pub async fn dispatch(
    path: &str,
    caller: &Caller,
    body: &JsonValue,
) -> Option<GrimoireResponse<JsonValue>> {
    match path {
        "/api/upload/music" => Some(upload_music(caller, body.clone()).await),
        "/api/upload/image" => Some(upload_image(caller, body.clone()).await),
        "/api/upload/music-paths" => Some(import_music_paths(caller, body.clone()).await),
        "/api/upload/music-by-blake3" => Some(upload_music_by_blake3(caller, body.clone()).await),
        "/api/upload/video" => Some(upload_video(caller, body.clone()).await),
        "/api/upload/video-by-blake3" => Some(upload_video_by_blake3(caller, body.clone()).await),
        _ => None,
    }
}
