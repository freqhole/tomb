use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::MediaSessionExt;

#[command]
pub async fn set_metadata<R: Runtime>(
    app: AppHandle<R>,
    payload: SetMetadataPayload,
) -> Result<(), String> {
    app.media_session()
        .set_metadata(payload)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn set_playback_state<R: Runtime>(
    app: AppHandle<R>,
    payload: SetPlaybackStatePayload,
) -> Result<(), String> {
    app.media_session()
        .set_playback_state(payload)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn set_position<R: Runtime>(
    app: AppHandle<R>,
    payload: SetPositionPayload,
) -> Result<(), String> {
    app.media_session()
        .set_position(payload)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn clear<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    app.media_session().clear().map_err(|e| e.to_string())
}
