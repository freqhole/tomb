use serde::de::DeserializeOwned;
#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;
use crate::Result;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "net.freqhole.plugin.mediasession";

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> Result<MediaSessionImpl<R>> {
    #[cfg(target_os = "android")]
    {
        let handle = api
            .register_android_plugin(PLUGIN_IDENTIFIER, "MediaSessionPlugin")
            .map_err(crate::Error::PluginInvoke)?;
        Ok(MediaSessionImpl { handle })
    }
    #[cfg(target_os = "ios")]
    {
        // no ios-side plugin exists yet (see docs/ios.md's media-session
        // gap) - every method below is a no-op, same as desktop, so
        // `init()` never fails and this plugin stays safe to register
        // unconditionally on every platform. holds a real `AppHandle<R>`
        // (unused, same as desktop.rs's `_app` field) rather than
        // `PhantomData<R>` - tauri's `state()`/`manage()` require
        // `Send + Sync`, which `PhantomData<R>` doesn't carry for a bare
        // generic `R: Runtime`, but `AppHandle<R>` does.
        let _ = api;
        Ok(MediaSessionImpl { _app: _app.clone() })
    }
}

#[cfg(target_os = "android")]
pub struct MediaSessionImpl<R: Runtime> {
    handle: PluginHandle<R>,
}

#[cfg(target_os = "ios")]
pub struct MediaSessionImpl<R: Runtime> {
    _app: AppHandle<R>,
}

#[cfg(target_os = "android")]
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

    pub fn set_favorite(&self, payload: SetFavoritePayload) -> Result<()> {
        self.handle
            .run_mobile_plugin::<serde_json::Value>("setFavorite", payload)
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

// ios: no plugin handle to call into yet, so every command is a no-op -
// see `init()`'s doc comment above.
#[cfg(target_os = "ios")]
impl<R: Runtime> MediaSessionImpl<R> {
    pub fn set_metadata(&self, _payload: SetMetadataPayload) -> Result<()> {
        Ok(())
    }

    pub fn set_playback_state(&self, _payload: SetPlaybackStatePayload) -> Result<()> {
        Ok(())
    }

    pub fn set_position(&self, _payload: SetPositionPayload) -> Result<()> {
        Ok(())
    }

    pub fn set_favorite(&self, _payload: SetFavoritePayload) -> Result<()> {
        Ok(())
    }

    pub fn clear(&self) -> Result<()> {
        Ok(())
    }
}
