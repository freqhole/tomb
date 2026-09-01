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
use tauri::{AppHandle, Wry};

/// name of the tauri event the webview subscribes to for playback updates.
pub const VIDEO_EVENT: &str = "video-window-event";

/// emit a `VideoEvent` to the webview. lives here rather than in the linux
/// module so the event name has a single definition.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn emit_event(app: &AppHandle<Wry>, event: &VideoEvent) {
    use tauri::Emitter;
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
