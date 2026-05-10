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

    /// list the locally-downloaded library (most recent first). used
    /// by the `/local` slash command and as the music view's default
    /// landing content. shells without a backend return Err.
    async fn list_local_songs(&self, limit: u32) -> Result<Vec<SongRow>, String> {
        let _ = limit;
        Err("transport does not support local listing".to_string())
    }

    /// toggle favorite status for `target_id`. `target_type` is one
    /// of `"song"`, `"album"`, `"artist"`, `"playlist"`, `"genre"`.
    /// returns the new state (`true` = favorited). shells without a
    /// favorites backend (web today) return Err.
    async fn toggle_favorite(&self, target_type: &str, target_id: &str) -> Result<bool, String> {
        let _ = (target_type, target_id);
        Err("transport does not support favorites".to_string())
    }

    /// query whether `target_id` is currently favorited by the
    /// caller. defaults to `Ok(false)` so shells without a backend
    /// render the empty-heart glyph.
    async fn is_favorited(&self, target_type: &str, target_id: &str) -> Result<bool, String> {
        let _ = (target_type, target_id);
        Ok(false)
    }

    /// query a library entity by kind. used by detail-view slash
    /// commands (`/album`, `/artist`, `/playlist`, `/favorites`,
    /// `/radio`). `kind` is one of `"album"`, `"artist"`,
    /// `"playlist"`, `"favorites"`, `"radio"`. an optional `query`
    /// narrows the search; omit for a "list everything (recent)"
    /// view. result is a [`DispatchResponse`] so the existing result
    /// panel can render it like any admin dispatch.
    async fn library_query(&self, kind: &str, query: Option<&str>) -> DispatchResponse {
        let _ = (kind, query);
        DispatchResponse {
            success: false,
            message: "transport does not support library_query".to_string(),
            data: None,
        }
    }

    /// FTS-ranked unified search across songs/albums/artists/playlists.
    /// returns flattened rows tagged with `type` so the result panel
    /// can render `[song]`/`[album]`/`[artist]`/`[playlist]` badges.
    async fn unified_search(&self, query: &str) -> DispatchResponse {
        let _ = query;
        DispatchResponse {
            success: false,
            message: "transport does not support unified_search".to_string(),
            data: None,
        }
    }

    /// resolve a media-blob id into a url the audio player can `Load`.
    /// returns `(url, mime)`. tty shells return the local filesystem
    /// path; the web shell builds a `blob:` object url from base64
    /// bytes fetched via the public proxy. default returns Err so
    /// shells without a binding fail loudly.
    async fn resolve_blob_url(&self, blob_id: &str) -> Result<(String, String), String> {
        let _ = blob_id;
        Err("transport does not support resolve_blob_url".to_string())
    }

    /// fetch the songs in a playlist as `SongRow`s (ordered by
    /// playlist position). default Err so shells without a backend
    /// fail loudly.
    async fn playlist_songs(&self, playlist_id: &str) -> Result<Vec<SongRow>, String> {
        let _ = playlist_id;
        Err("transport does not support playlist_songs".to_string())
    }

    /// fetch the songs on an album as `SongRow`s (ordered by disc
    /// + track number). default Err so shells without a backend fail
    /// loudly.
    async fn album_songs(&self, album_id: &str) -> Result<Vec<SongRow>, String> {
        let _ = album_id;
        Err("transport does not support album_songs".to_string())
    }

    /// query a library entity by a parent id (e.g. songs of an
    /// album, albums of an artist) — used by the "go to album" /
    /// "go to artist" row actions to pivot deterministically by id
    /// rather than fuzzy name match. `kind` is the child entity
    /// (`"song"` or `"album"`); `parent_field` is the foreign-key
    /// column name (`"album_id"` or `"artist_id"`); `parent_id` is
    /// the value. result is shaped like a normal `library_query`
    /// dispatch so the result panel can render it identically.
    async fn library_by_id(
        &self,
        kind: &str,
        parent_field: &str,
        parent_id: &str,
    ) -> DispatchResponse {
        let _ = (kind, parent_field, parent_id);
        DispatchResponse {
            success: false,
            message: "transport does not support library_by_id".to_string(),
            data: None,
        }
    }

    /// resolve the parent ids (album_id, artist_id) for a row that
    /// might be missing them — used as a fallback by the "go to
    /// album" / "go to artist" row actions when unified-search rows
    /// don't carry both ids inline. `kind` is `"song"` or `"album"`,
    /// `id` is the song or album id. returns `(album_id, artist_id)`.
    /// either may be `None` if not applicable (e.g. an album lookup
    /// returns `(Some(album_id), Some(artist_id))` or
    /// `(Some(album_id), None)`).
    async fn resolve_parent_ids(
        &self,
        kind: &str,
        id: &str,
    ) -> Result<(Option<String>, Option<String>), String> {
        let _ = (kind, id);
        Err("transport does not support resolve_parent_ids".to_string())
    }
}

/// commands the music view sends to a backend audio player. ratcore
/// holds an `Option<Rc<dyn MusicPlayer>>`; shells fill it in if they
/// have a backend (tty: rodio via grimoire; web: noop today).
#[derive(Debug, Clone)]
pub enum PlayerCmd {
    /// load a queue of audio file paths and start from the first.
    Load(Vec<String>),
    /// append urls to the player's internal queue without
    /// interrupting the current track. backends without progressive
    /// queueing may treat this as a no-op.
    Enqueue(Vec<String>),
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
