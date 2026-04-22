//! tauri plugin: android lock-screen / media-notification controls.
//!
//! exposes a small command surface that proxies to a native kotlin plugin
//! which owns an android `MediaSessionCompat` + foreground `MediaStyle`
//! notification. desktop and ios are no-ops so the plugin can be registered
//! unconditionally.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod commands;
mod error;
mod models;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

pub use error::{Error, Result};
pub use models::*;

#[cfg(desktop)]
use desktop::MediaSessionImpl;
#[cfg(mobile)]
use mobile::MediaSessionImpl;

pub struct MediaSession<R: Runtime>(MediaSessionImpl<R>);

impl<R: Runtime> MediaSession<R> {
    pub fn set_metadata(&self, payload: SetMetadataPayload) -> Result<()> {
        self.0.set_metadata(payload)
    }

    pub fn set_playback_state(&self, payload: SetPlaybackStatePayload) -> Result<()> {
        self.0.set_playback_state(payload)
    }

    pub fn set_position(&self, payload: SetPositionPayload) -> Result<()> {
        self.0.set_position(payload)
    }

    pub fn clear(&self) -> Result<()> {
        self.0.clear()
    }
}

pub trait MediaSessionExt<R: Runtime> {
    fn media_session(&self) -> &MediaSession<R>;
}

impl<R: Runtime, T: Manager<R>> MediaSessionExt<R> for T {
    fn media_session(&self) -> &MediaSession<R> {
        self.state::<MediaSession<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("android-media-session")
        .invoke_handler(tauri::generate_handler![
            commands::set_metadata,
            commands::set_playback_state,
            commands::set_position,
            commands::clear,
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let imp = mobile::init(app, api)?;
            #[cfg(desktop)]
            let imp = desktop::init(app, api)?;
            app.manage(MediaSession(imp));
            Ok(())
        })
        .build()
}
