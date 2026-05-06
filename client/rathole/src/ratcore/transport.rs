//! transport seam — abstracts "where to dispatch admin commands".
//!
//! shells provide concrete impls:
//! - `tty::transport::LocalTransport` — in-process grimoire calls
//! - `web::transport::NoopTransport` — m0 spike stub
//! - future `MiddenTransport` — iroh p2p via skein/midden

use async_trait::async_trait;
use serde_json::Value as JsonValue;

use super::app::{DispatchResponse, SongRow};

#[async_trait(?Send)]
pub trait Transport {
    /// dispatch an admin command. mirrors the shape of
    /// `grimoire::admin_dispatch::handle(cmd, args, &caller)`.
    async fn admin_dispatch(&self, cmd: &str, args: JsonValue) -> DispatchResponse;

    /// dispatch a public/anonymous request to a route on the peer.
    /// `route` is the http-style path (e.g. `"/api/knock"`); `method`
    /// is `"GET"`, `"POST"`, etc. transports that don't have a public
    /// channel return a `DispatchResponse` with `success = false`.
    async fn public_dispatch(
        &self,
        method: &str,
        route: &str,
        body: JsonValue,
    ) -> DispatchResponse {
        let _ = (method, route, body);
        DispatchResponse {
            success: false,
            message: "transport does not support public_dispatch".to_string(),
            data: None,
        }
    }

    /// search the music library. default impl returns an error so
    /// shells without a music backend (web, today) fail loudly rather
    /// than silently returning empty.
    async fn search_songs(&self, query: &str, limit: u32) -> Result<Vec<SongRow>, String> {
        let _ = (query, limit);
        Err("transport does not support music search".to_string())
    }
}

/// commands the music view sends to a backend audio player. ratcore
/// holds an `Option<Rc<dyn MusicPlayer>>`; shells fill it in if they
/// have a backend (tty: rodio via grimoire; web: noop today).
#[derive(Debug, Clone)]
pub enum PlayerCmd {
    /// load a queue of audio file paths and start from the first.
    Load(Vec<String>),
    Play,
    Pause,
    Stop,
    Next,
    Previous,
    /// absolute seek in milliseconds.
    Seek(u64),
    /// volume, 0.0..=2.0.
    SetVolume(f32),
}

#[async_trait(?Send)]
pub trait MusicPlayer {
    async fn send(&self, cmd: PlayerCmd) -> Result<(), String>;
}
