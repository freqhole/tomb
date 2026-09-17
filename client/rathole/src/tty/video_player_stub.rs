//! non-unix stand-in for `tty::video_player` - see that file's own
//! `#![cfg(unix)]` doc comment for why. same public `MpvPlayer::spawn`
//! signature, always errors; `run.rs` already treats a failed spawn as
//! a normal, handled case (`app.video_player` stays `None`, same as
//! "mpv isn't installed"), so no other call site needs to change.

use std::rc::Rc;
use tokio::sync::mpsc;

use crate::ratcore::app::AppAction;

pub struct MpvPlayer;

impl MpvPlayer {
    pub async fn spawn(_action_tx: mpsc::UnboundedSender<AppAction>) -> Result<Rc<Self>, String> {
        Err("mpv video playback isn't supported on this platform".to_string())
    }
}
