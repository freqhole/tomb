//! in-process transport: calls grimoire functions directly.
//!
//! caller construction follows the same pattern
//! [cli/src/plumbing/dispatch.rs](../../../../cli/src/plumbing/dispatch.rs)
//! uses: `UserService::get_first_root_user()` for the bootstrap
//! caller. m1 adds an admin-picker on top so the user can switch.

use async_trait::async_trait;
use grimoire::offal::Caller;
use grimoire::users::UserService;
use serde_json::Value as JsonValue;

use crate::ratcore::app::{DispatchResponse, SongRow};
use crate::ratcore::transport::Transport;

pub struct LocalTransport {
    caller: Caller,
}

impl LocalTransport {
    /// build a `LocalTransport` using the first root user as caller.
    /// fails if no root user exists (the setup wizard, m0+, will
    /// handle that case before we get here).
    pub async fn from_first_root() -> color_eyre::Result<Self> {
        let service = UserService::new();
        let resp = service.get_first_root_user().await;
        match resp.data {
            Some(user) => Ok(Self {
                caller: Caller::new(&user.id, &user.username, user.role),
            }),
            None => Err(color_eyre::eyre::eyre!(
                "no root user in freqhole — run `freqhole setup` (or the rathole setup wizard, m0+) first"
            )),
        }
    }

    pub fn caller(&self) -> &Caller {
        &self.caller
    }
}

#[async_trait(?Send)]
impl Transport for LocalTransport {
    async fn admin_dispatch(&self, cmd: &str, args: JsonValue) -> DispatchResponse {
        let resp = grimoire::admin_dispatch::handle(cmd, args, &self.caller).await;
        DispatchResponse {
            success: resp.success,
            message: resp.message,
            data: resp.data,
        }
    }

    async fn search_songs(&self, query: &str, limit: u32) -> Result<Vec<SongRow>, String> {
        let resp = grimoire::music::search_songs(query, Some(limit), Some(0)).await;
        if !resp.success {
            return Err(resp.message);
        }
        let Some(result) = resp.data else {
            return Ok(vec![]);
        };
        let mut out = Vec::with_capacity(result.items.len());
        for item in result.items {
            let artist = if !item.song.track_artist.as_deref().unwrap_or("").is_empty() {
                item.song.track_artist.clone()
            } else {
                item.artist.as_ref().map(|a| a.name.clone())
            };
            let album = item.album.as_ref().map(|a| a.title.clone());
            let local_path = item.media_blob.as_ref().and_then(|b| b.local_path.clone());
            out.push(SongRow {
                id: item.song.id.clone(),
                title: item.song.title.clone(),
                artist,
                album,
                duration_ms: item.song.duration.map(|d| d as u64),
                media_blob_id: Some(item.song.media_blob_id.clone()),
                local_path,
            });
        }
        Ok(out)
    }
}
