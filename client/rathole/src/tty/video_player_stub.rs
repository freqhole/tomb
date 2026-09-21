//! non-unix stand-in for `tty::video_player` - see that file's own
//! `#![cfg(unix)]` doc comment for why. same public `MpvPlayer::spawn`
//! signature, always errors; `run.rs` already treats a failed spawn as
//! a normal, handled case (`app.video_player` stays `None`, same as
//! "mpv isn't installed"), so no other call site needs to change.

use std::rc::Rc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::mpsc;

use crate::ratcore::app::{AppAction, VideoCommand};
use crate::ratcore::transport::VideoPlayer;

pub struct MpvPlayer;

impl MpvPlayer {
    pub async fn spawn(_action_tx: mpsc::UnboundedSender<AppAction>) -> Result<Rc<Self>, String> {
        Err("mpv video playback isn't supported on this platform".to_string())
    }
}

// `App.with_video_player` takes `Rc<dyn VideoPlayer>` - `spawn` above
// never actually constructs a `Self` (always errors first), so `send`
// here is unreachable at runtime; it only exists to satisfy the trait
// bound so this stub type-checks as a drop-in for the real `MpvPlayer`.
#[async_trait::async_trait(?Send)]
impl VideoPlayer for MpvPlayer {
    async fn send(&self, _cmd: VideoCommand) -> Result<(), String> {
        Err("mpv video playback isn't supported on this platform".to_string())
    }
}

// non-unix counterparts of the real video_player.rs helpers - `tty::radio`
// spawns its own dedicated mpv process directly (not through `MpvPlayer`)
// and calls these regardless of platform, so they need to exist here too
// even though mpv itself isn't expected to be available/supported here.
pub(super) fn default_video_output() -> &'static str {
    "gpu-next"
}

pub(super) async fn log_mpv_output(
    stream: impl tokio::io::AsyncRead + Unpin,
    stream_name: &'static str,
) {
    let mut lines = BufReader::new(stream).lines();
    loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                tracing::warn!(target: "video_player", mpv_stream = stream_name, %line, "mpv output")
            }
            Ok(None) => break,
            Err(e) => {
                tracing::warn!(target: "video_player", mpv_stream = stream_name, error = %e, "mpv output stream read error");
                break;
            }
        }
    }
}
