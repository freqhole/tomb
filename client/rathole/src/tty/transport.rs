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

    async fn toggle_favorite(&self, target_type: &str, target_id: &str) -> Result<bool, String> {
        use grimoire::music::users::FavoritesService;
        let target = parse_favorite_target(target_type)?;
        let service = FavoritesService::new();
        let resp = service
            .toggle_favorite(&self.caller.user_id, target, target_id)
            .await;
        if !resp.success {
            return Err(resp.message);
        }
        resp.data
            .ok_or_else(|| "favorites toggle returned no data".to_string())
    }

    async fn is_favorited(&self, target_type: &str, target_id: &str) -> Result<bool, String> {
        use grimoire::music::users::FavoritesService;
        let target = parse_favorite_target(target_type)?;
        let service = FavoritesService::new();
        let resp = service
            .is_favorited(&self.caller.user_id, target, target_id)
            .await;
        if !resp.success {
            return Err(resp.message);
        }
        Ok(resp.data.unwrap_or(false))
    }

    async fn library_query(&self, kind: &str, query: Option<&str>) -> DispatchResponse {
        library_query_impl(self, kind, query).await
    }

    async fn unified_search(&self, query: &str) -> DispatchResponse {
        unified_search_impl(self, query).await
    }
}

async fn library_query_impl(
    t: &LocalTransport,
    kind: &str,
    query: Option<&str>,
) -> DispatchResponse {
    use grimoire::music::crud::{query_albums, query_artists, QueryParams};

    let limit: u32 = 50;
    let q = query
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    match kind {
        "album" => {
            let params = QueryParams {
                limit: Some(limit),
                offset: Some(0),
                q: q.clone(),
                ..Default::default()
            };
            let resp = query_albums(params).await;
            wrap_grimoire_paged(resp, "albums")
        }
        "artist" => {
            let params = QueryParams {
                limit: Some(limit),
                offset: Some(0),
                q,
                ..Default::default()
            };
            let resp = query_artists(params).await;
            wrap_grimoire_paged(resp, "artists")
        }
        "playlist" => {
            // playlists don't yet expose a search; list-recent works.
            let resp = grimoire::music::list_playlists().await;
            wrap_grimoire_simple(resp, "playlists")
        }
        "favorites" => {
            let resp = grimoire::music::query_favorites(&t.caller.user_id, None, 100, 0).await;
            wrap_grimoire_simple(resp, "favorites")
        }
        "radio" => {
            let result = grimoire::radio::stations::repository::list_stations().await;
            wrap_grimoire_result(result, "radio stations")
        }
        other => DispatchResponse {
            success: false,
            message: format!("unknown library kind: {other}"),
            data: None,
        },
    }
}

async fn unified_search_impl(t: &LocalTransport, query: &str) -> DispatchResponse {
    use grimoire::search::models::{SearchField, SearchRequest};
    use grimoire::search::service::search;
    let req = SearchRequest {
        query: query.to_string(),
        field: Some(SearchField::All),
        page: Some(1),
        page_size: Some(50),
        context: None,
    };
    let resp = search(req, Some(&t.caller.user_id)).await;
    if !resp.success {
        return DispatchResponse {
            success: false,
            message: resp.message,
            data: None,
        };
    }
    let Some(body) = resp.data else {
        return DispatchResponse {
            success: true,
            message: "no results".to_string(),
            data: Some(serde_json::Value::Array(vec![])),
        };
    };
    // flatten into rows tagged by `type` and sorted by FTS rank.
    let mut rows: Vec<(f32, serde_json::Value)> = Vec::new();
    for s in &body.songs {
        let subtitle = if s.artist_names.is_empty() {
            s.album_title.clone().unwrap_or_default()
        } else {
            s.artist_names.join(", ")
        };
        rows.push((
            s.search_rank,
            serde_json::json!({
                "type": "song",
                "id": s.id,
                "title": s.title,
                "subtitle": subtitle,
                "score": s.search_rank,
                "is_favorite": s.is_favorite,
            }),
        ));
    }
    for a in body.albums.iter().flatten() {
        rows.push((
            a.search_rank,
            serde_json::json!({
                "type": "album",
                "id": a.id,
                "title": a.title,
                "subtitle": a.artist_names.join(", "),
                "score": a.search_rank,
                "is_favorite": a.is_favorite,
            }),
        ));
    }
    for ar in body.artists.iter().flatten() {
        rows.push((
            ar.search_rank,
            serde_json::json!({
                "type": "artist",
                "id": ar.id,
                "title": ar.name,
                "subtitle": format!("{} albums  {} songs", ar.album_count, ar.song_count),
                "score": ar.search_rank,
                "is_favorite": ar.is_favorite,
            }),
        ));
    }
    for p in body.playlists.iter().flatten() {
        rows.push((
            p.search_rank,
            serde_json::json!({
                "type": "playlist",
                "id": p.id,
                "title": p.title,
                "subtitle": format!("{} songs", p.song_count),
                "score": p.search_rank,
            }),
        ));
    }
    rows.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    let count = rows.len();
    let arr: Vec<serde_json::Value> = rows.into_iter().map(|(_, v)| v).collect();
    DispatchResponse {
        success: true,
        message: format!("found {count} results"),
        data: Some(serde_json::Value::Array(arr)),
    }
}

fn wrap_grimoire_result<T: serde::Serialize>(
    result: Result<T, grimoire::error::GrimoireError>,
    label: &str,
) -> DispatchResponse {
    match result {
        Ok(items) => {
            let data = serde_json::to_value(items).ok();
            let count = data
                .as_ref()
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            DispatchResponse {
                success: true,
                message: format!("found {count} {label}"),
                data,
            }
        }
        Err(e) => DispatchResponse {
            success: false,
            message: format!("{e}"),
            data: None,
        },
    }
}

fn wrap_grimoire_simple<T: serde::Serialize>(
    resp: grimoire::response::GrimoireResponse<T>,
    label: &str,
) -> DispatchResponse {
    if !resp.success {
        return DispatchResponse {
            success: false,
            message: resp.message,
            data: None,
        };
    }
    let data = resp.data.and_then(|d| serde_json::to_value(d).ok());
    let count = data
        .as_ref()
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    DispatchResponse {
        success: true,
        message: format!("found {count} {label}"),
        data,
    }
}

fn wrap_grimoire_paged<T: serde::Serialize>(
    resp: grimoire::response::GrimoireResponse<T>,
    label: &str,
) -> DispatchResponse {
    // paged responses wrap items inside `{ items: [...], total_count: N }`.
    // re-serialize then unwrap the items array so the result panel
    // gets a flat list to render rows against.
    if !resp.success {
        return DispatchResponse {
            success: false,
            message: resp.message,
            data: None,
        };
    }
    let raw = match resp.data.and_then(|d| serde_json::to_value(d).ok()) {
        Some(v) => v,
        None => {
            return DispatchResponse {
                success: true,
                message: format!("no {label} found"),
                data: Some(serde_json::Value::Array(vec![])),
            }
        }
    };
    let items = raw
        .get("items")
        .cloned()
        .unwrap_or(serde_json::Value::Array(vec![]));
    let count = items.as_array().map(|a| a.len()).unwrap_or(0);
    DispatchResponse {
        success: true,
        message: format!("found {count} {label}"),
        data: Some(items),
    }
}

fn parse_favorite_target(s: &str) -> Result<grimoire::music::users::FavoriteTarget, String> {
    use grimoire::music::users::FavoriteTarget;
    match s {
        "song" => Ok(FavoriteTarget::Song),
        "album" => Ok(FavoriteTarget::Album),
        "artist" => Ok(FavoriteTarget::Artist),
        "playlist" => Ok(FavoriteTarget::Playlist),
        "genre" => Ok(FavoriteTarget::Genre),
        other => Err(format!("unknown favorite target type: {other}")),
    }
}
