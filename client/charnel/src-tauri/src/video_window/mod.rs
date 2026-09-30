// separate video window.
//
// linux only: webkitgtk cannot play video in a `<video>` element (asset:// is
// unsupported, blob: buffers the whole file, and a localhost http server was
// already tried and rejected). video therefore plays in a separate libmpv-
// backed window while spume's playerbar stays the control surface, mirroring
// how libmpv owns audio playback on linux.
//
// every other platform gets a stub: the html backend works fine there, so the
// commands exist but report unsupported.

pub mod backend;

// libmpv2 is a desktop-wide dependency (see Cargo.toml), so this compiles
// on every desktop target for build/test purposes - but is only actually
// *dispatched to* when `use_libmpv_playback` is on (see `use_libmpv` below).
#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
mod libmpv_backend;

use backend::{VideoCommand, VideoEvent};
use serde::Serialize;
use tauri::{AppHandle, Wry};

/// name of the tauri event the webview subscribes to for playback updates.
pub const VIDEO_EVENT: &str = "video-window-event";

/// startup diagnostic for the separate video window. this deliberately
/// opens no window and loads no media; it verifies only that the runtime has
/// the libmpv pieces the playback implementation will request.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoWindowDiagnostics {
    pub available: bool,
    pub gstreamer_version: Option<String>,
    pub playbin3_available: bool,
    pub gtksink_available: bool,
    pub gtkglsink_available: bool,
    pub error: Option<String>,
    /// every audio sink element factory actually registered on this
    /// system - a name from this list is what `[video].linux_audio_sink`
    /// expects. surfaced here (logged to the webview console as
    /// `[video-window] diagnostics` on every boot) so finding what's
    /// available doesn't need a separate pass on the target machine.
    #[serde(default)]
    pub available_audio_sinks: Vec<String>,
}

/// emit a `VideoEvent` to the webview. lives here rather than in the linux
/// module so the event name has a single definition. also folds
/// play/pause/position/duration into the OS media session (see
/// `media_session.rs`) - the libmpv window only knows what spume told it to
/// load, never song/artist metadata, so this is the only signal it can
/// contribute on its own.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn emit_event(app: &AppHandle<Wry>, event: &VideoEvent) {
    use tauri::Emitter;
    crate::media_session::on_video_event(app, event);
    if let Err(e) = app.emit(VIDEO_EVENT, event) {
        tracing::warn!(error = %e, "failed to emit video window event");
    }
}

/// ask libmpv to quit on app shutdown - a no-op when it was never used.
/// called from `RunEvent::Exit` in `lib.rs`.
pub fn shutdown() {
    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    libmpv_backend::shutdown();
}

/// reads the "experimental player" toggle (`FreqholeAppConfig::
/// use_libmpv_playback`) - see `docs/libmpv-experimental-player-plan.md`'s
/// "config placement decision". shared by every platform branch below.
#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
fn use_libmpv(app: &AppHandle<Wry>) -> bool {
    crate::app_config::FreqholeAppConfig::load(app)
        .map(|c| c.use_libmpv_playback)
        .unwrap_or_else(crate::app_config::default_use_libmpv_playback)
}

fn unavailable(reason: &str) -> VideoWindowDiagnostics {
    VideoWindowDiagnostics {
        available: false,
        gstreamer_version: None,
        playbin3_available: false,
        gtksink_available: false,
        gtkglsink_available: false,
        error: Some(reason.to_string()),
        available_audio_sinks: Vec::new(),
    }
}

/// true when this build can play video in a separate window right now.
/// only when the experimental player (libmpv) toggle is on - when it's
/// off the html `<video>` element is the (already-working) fallback.
#[tauri::command]
pub fn video_window_available(app: AppHandle<Wry>) -> bool {
    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    {
        use_libmpv(&app)
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        let _ = app;
        false
    }
}

#[tauri::command]
pub fn video_window_diagnostics(app: AppHandle<Wry>) -> VideoWindowDiagnostics {
    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    {
        if use_libmpv(&app) {
            libmpv_backend::diagnostics()
        } else {
            unavailable(
                "enable the experimental player in settings to use the separate video window",
            )
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        let _ = app;
        unavailable("the separate video window is desktop-only")
    }
}

/// compatibility alias for development builds made before the command rename.
#[tauri::command]
pub fn system_video_available(app: AppHandle<Wry>) -> bool {
    video_window_available(app)
}

#[tauri::command]
pub async fn video_window_command(
    app: AppHandle<Wry>,
    command: VideoCommand,
) -> Result<(), String> {
    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    {
        if use_libmpv(&app) {
            libmpv_backend::dispatch(app, command)
        } else {
            Err(
                "enable the experimental player in settings to use the separate video window"
                    .to_string(),
            )
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        let _ = (app, command);
        Err("the separate video window is desktop-only".to_string())
    }
}

/// compatibility alias for development builds made before the command rename.
#[tauri::command]
pub async fn system_video_command(
    app: AppHandle<Wry>,
    command: VideoCommand,
) -> Result<(), String> {
    video_window_command(app, command).await
}
