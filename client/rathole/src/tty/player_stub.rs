//! non-unix stand-in for `tty::player` - see that file's own
//! `#![cfg(unix)]` doc comment for why (mpv-over-unix-socket IPC).
//! same public `MpvPlayer::spawn` signature, always errors; `run.rs`
//! already treats a failed spawn as a normal, handled case
//! (`app.player` stays `None`), same pattern as `video_player_stub.rs`.

use std::rc::Rc;
use tokio::sync::mpsc;

use crate::ratcore::app::AppAction;
use crate::ratcore::transport::{MusicPlayer, PlayerCmd};

pub struct MpvPlayer;

impl MpvPlayer {
    pub async fn spawn(_action_tx: mpsc::UnboundedSender<AppAction>) -> Result<Rc<Self>, String> {
        Err("mpv audio playback isn't supported on this platform".to_string())
    }
}

// `App.with_player` takes `Rc<dyn MusicPlayer>` - `spawn` above never
// actually constructs a `Self` (always errors first), so `send` here is
// unreachable at runtime; it only exists to satisfy the trait bound so
// this stub type-checks as a drop-in for the real `MpvPlayer`.
#[async_trait::async_trait(?Send)]
impl MusicPlayer for MpvPlayer {
    async fn send(&self, _cmd: PlayerCmd) -> Result<(), String> {
        Err("mpv audio playback isn't supported on this platform".to_string())
    }
}

// `resolve_paths` itself is pure grimoire media_blobz lookups with
// nothing unix-specific about it - it only lived in `player.rs` because
// of that file's blanket `#![cfg(unix)]`. duplicated here verbatim
// (not stubbed out) so path resolution still actually works on
// non-unix platforms, same as `tty::queue`'s callers expect.
pub async fn resolve_paths(blob_ids: &[String]) -> Vec<String> {
    let mut out = Vec::with_capacity(blob_ids.len());
    for id in blob_ids {
        match grimoire::media_blobz::get_media_blob_with_data(id).await {
            Ok((blob, _)) => {
                if let Some(path) = blob.local_path {
                    out.push(path);
                }
            }
            Err(e) => {
                tracing::warn!("media_blob {} resolve failed: {}", id, e);
            }
        }
    }
    out
}
