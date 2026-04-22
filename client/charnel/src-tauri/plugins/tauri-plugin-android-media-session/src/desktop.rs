use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;
use crate::Result;

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> Result<MediaSessionImpl<R>> {
    Ok(MediaSessionImpl { _app: app.clone() })
}

pub struct MediaSessionImpl<R: Runtime> {
    _app: AppHandle<R>,
}

// desktop: rely on existing navigator.mediaSession via system webview.
// all commands are no-ops here.
impl<R: Runtime> MediaSessionImpl<R> {
    pub fn set_metadata(&self, _p: SetMetadataPayload) -> Result<()> {
        Ok(())
    }
    pub fn set_playback_state(&self, _p: SetPlaybackStatePayload) -> Result<()> {
        Ok(())
    }
    pub fn set_position(&self, _p: SetPositionPayload) -> Result<()> {
        Ok(())
    }
    pub fn clear(&self) -> Result<()> {
        Ok(())
    }
}
