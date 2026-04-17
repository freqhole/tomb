use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;
use crate::Result;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "net.freqhole.plugin.mediasession";

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> Result<MediaSessionImpl<R>> {
    #[cfg(target_os = "android")]
    let handle = api
        .register_android_plugin(PLUGIN_IDENTIFIER, "MediaSessionPlugin")
        .map_err(crate::Error::PluginInvoke)?;
    #[cfg(target_os = "ios")]
    let handle: PluginHandle<R> = {
        let _ = api;
        return Err(crate::Error::NotSupported);
    };
    Ok(MediaSessionImpl { handle })
}

pub struct MediaSessionImpl<R: Runtime> {
    handle: PluginHandle<R>,
}

impl<R: Runtime> MediaSessionImpl<R> {
    pub fn set_metadata(&self, payload: SetMetadataPayload) -> Result<()> {
        self.handle
            .run_mobile_plugin::<serde_json::Value>("setMetadata", payload)
            .map(|_| ())
            .map_err(Into::into)
    }

    pub fn set_playback_state(&self, payload: SetPlaybackStatePayload) -> Result<()> {
        self.handle
            .run_mobile_plugin::<serde_json::Value>("setPlaybackState", payload)
            .map(|_| ())
            .map_err(Into::into)
    }

    pub fn set_position(&self, payload: SetPositionPayload) -> Result<()> {
        self.handle
            .run_mobile_plugin::<serde_json::Value>("setPosition", payload)
            .map(|_| ())
            .map_err(Into::into)
    }

    pub fn clear(&self) -> Result<()> {
        self.handle
            .run_mobile_plugin::<serde_json::Value>("clear", ())
            .map(|_| ())
            .map_err(Into::into)
    }
}
