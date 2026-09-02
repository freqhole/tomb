// separate video window.
//
// linux only: webkitgtk cannot play video in a `<video>` element (asset:// is
// unsupported, blob: buffers the whole file, and a localhost http server was
// already tried and rejected). video therefore plays in a separate gstreamer
// window while spume's playerbar stays the control surface, mirroring how rodio
// owns audio playback on linux.
//
// every other platform gets a stub: the html backend works fine there, so the
// commands exist but report unsupported.

pub mod backend;

#[cfg(target_os = "linux")]
mod gst;

use backend::{VideoCommand, VideoEvent};
use serde::Serialize;
use tauri::{AppHandle, Wry};

/// name of the tauri event the webview subscribes to for playback updates.
pub const VIDEO_EVENT: &str = "video-window-event";

/// startup diagnostic for the separate Linux video window. this deliberately
/// opens no window and loads no media; it verifies only that the runtime has
/// the exact GStreamer pieces the playback implementation will request.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoWindowDiagnostics {
    pub available: bool,
    pub gstreamer_version: Option<String>,
    pub playbin3_available: bool,
    pub gtksink_available: bool,
    pub gtkglsink_available: bool,
    pub error: Option<String>,
}

/// emit a `VideoEvent` to the webview. lives here rather than in the linux
/// module so the event name has a single definition. also folds
/// play/pause/position/duration into the OS media session (see
/// `media_session.rs`) - the gst window only knows what spume told it to
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

/// true when this build can play video in a separate window.
#[tauri::command]
pub fn video_window_available() -> bool {
    cfg!(target_os = "linux")
}

#[tauri::command]
pub fn video_window_diagnostics() -> VideoWindowDiagnostics {
    #[cfg(target_os = "linux")]
    {
        gst::diagnostics()
    }
    #[cfg(not(target_os = "linux"))]
    {
        VideoWindowDiagnostics {
            available: false,
            gstreamer_version: None,
            playbin3_available: false,
            gtksink_available: false,
            gtkglsink_available: false,
            error: Some("the separate video window is linux-only".to_string()),
        }
    }
}

/// compatibility alias for development builds made before the command rename.
#[tauri::command]
pub fn native_video_available() -> bool {
    video_window_available()
}

#[tauri::command]
pub async fn video_window_command(
    app: AppHandle<Wry>,
    command: VideoCommand,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        gst::dispatch(app, command)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, command);
        Err("the separate video window is linux-only".to_string())
    }
}

/// compatibility alias for development builds made before the command rename.
#[tauri::command]
pub async fn native_video_command(
    app: AppHandle<Wry>,
    command: VideoCommand,
) -> Result<(), String> {
    video_window_command(app, command).await
}
