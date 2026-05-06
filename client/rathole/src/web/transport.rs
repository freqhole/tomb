//! transport implementations for the web shell.
//!
//! - `NoopTransport`: returns a helpful "not connected" error. used
//!   when the page loads without a `?peer=<node_id>` query param.
//! - `MiddenTransport`: opens a `freqhole-admin/1` bi-stream to the
//!   given peer via the sibling `midden` crate (iroh-in-the-browser),
//!   serializes `AdminMessage::Request` (matching grimoire's wire
//!   format), awaits a `Response`, returns a `DispatchResponse`.
//!
//! server side is fully wired: grimoire's `AdminProtocol` registers
//! the alpn (gated by `[federation.remote_admin].enabled = true`),
//! resolves caller via peer node_id, and dispatches through
//! `admin_dispatch::handle`. see
//! `grimoire/src/federation/transport/admin_handler.rs`.

use async_trait::async_trait;
use js_sys::Uint8Array;
use midden::MiddenNode;
use serde_json::Value as JsonValue;
use std::cell::Cell;
use std::rc::Rc;
use wasm_bindgen::{JsError, JsValue};
use web_sys::console;

use crate::ratcore::app::DispatchResponse;
use crate::ratcore::transport::Transport;

pub struct NoopTransport;

#[async_trait(?Send)]
impl Transport for NoopTransport {
    async fn admin_dispatch(&self, _cmd: &str, _args: JsonValue) -> DispatchResponse {
        DispatchResponse {
            success: false,
            message: "not connected — pass `?peer=<node_id>` in the url to enable p2p".to_string(),
            data: None,
        }
    }
}

/// p2p transport backed by midden. one `MiddenNode` per page,
/// one bi-stream per dispatch (open_bi → write request → read response
/// → drop). matches grimoire's `send_admin_request` framing exactly.
///
/// max response size is 16 MiB (mirrors the server default for
/// `[federation.remote_admin].max_message_size_bytes`).
pub struct MiddenTransport {
    node: Rc<MiddenNode>,
    peer_addr: String,
    next_id: Cell<u64>,
}

impl MiddenTransport {
    pub fn new(node: Rc<MiddenNode>, peer_addr: String) -> Self {
        Self {
            node,
            peer_addr,
            next_id: Cell::new(0),
        }
    }

    /// fallback path when no blake3 is known (or verified streaming
    /// fails): pull the blob bytes via the public REST proxy as base64
    /// and decode in-place. capped by midden's `proxy_request` size
    /// limit (~96 MB raw audio after base64 inflation).
    async fn fetch_blob_via_proxy(&self, blob_id: &str) -> Result<js_sys::Uint8Array, String> {
        use base64::Engine as _;
        let route = format!("/api/blobs/{blob_id}/data");
        let resp = self.public_dispatch("GET", &route, JsonValue::Null).await;
        if !resp.success {
            return Err(resp.message);
        }
        let data = resp.data.ok_or_else(|| "empty blob response".to_string())?;
        let b64 = data
            .get("data")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "no `data` field in blob response".to_string())?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| format!("decode base64: {e}"))?;
        let arr = js_sys::Uint8Array::new_with_length(bytes.len() as u32);
        arr.copy_from(&bytes);
        Ok(arr)
    }
}

const ADMIN_ALPN: &str = "freqhole-admin/1";
const MAX_RESPONSE_BYTES: u32 = 16 * 1024 * 1024;

#[async_trait(?Send)]
impl Transport for MiddenTransport {
    async fn admin_dispatch(&self, cmd: &str, args: JsonValue) -> DispatchResponse {
        let id = self.next_id.get();
        self.next_id.set(id.wrapping_add(1));

        console::log_1(
            &format!(
                "rathole: admin_dispatch cmd={cmd} id={id} peer={}",
                short_addr(&self.peer_addr)
            )
            .into(),
        );

        let request = serde_json::json!({
            "type": "request",
            "id": id,
            "command": cmd,
            "args": args,
        });

        let req_bytes = match serde_json::to_vec(&request) {
            Ok(b) => b,
            Err(e) => return logged_fail(cmd, format!("serialize request: {e}")),
        };

        let stream = match self.node.open_bi(&self.peer_addr, ADMIN_ALPN).await {
            Ok(s) => s,
            Err(e) => return logged_fail(cmd, format!("open_bi: {}", js_err_str(e))),
        };

        if let Err(e) = stream.write_raw_and_finish(&req_bytes).await {
            return logged_fail(cmd, format!("write request: {}", js_err_str(e)));
        }

        let resp_js = match stream.read_to_end(MAX_RESPONSE_BYTES).await {
            Ok(v) => v,
            Err(e) => return logged_fail(cmd, format!("read response: {}", js_err_str(e))),
        };

        let resp_bytes = Uint8Array::new(&resp_js).to_vec();
        if resp_bytes.is_empty() {
            return logged_fail(cmd, "empty response from peer".to_string());
        }

        let resp_json: JsonValue = match serde_json::from_slice(&resp_bytes) {
            Ok(v) => v,
            Err(e) => return logged_fail(cmd, format!("parse response: {e}")),
        };

        // sanity: correlate request/response ids if present
        if let Some(resp_id) = resp_json.get("id").and_then(|v| v.as_u64()) {
            if resp_id != id {
                return logged_fail(
                    cmd,
                    format!("response id mismatch: sent {id}, got {resp_id}"),
                );
            }
        }

        let success = resp_json
            .get("success")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let message = resp_json
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let data = resp_json.get("data").cloned().filter(|v| !v.is_null());

        DispatchResponse {
            success,
            message,
            data,
        }
    }

    async fn public_dispatch(
        &self,
        method: &str,
        route: &str,
        body: JsonValue,
    ) -> DispatchResponse {
        console::log_1(
            &format!(
                "rathole: public_dispatch {method} {route} peer={}",
                short_addr(&self.peer_addr)
            )
            .into(),
        );

        let body_str = match serde_json::to_string(&body) {
            Ok(s) => s,
            Err(e) => return logged_fail(route, format!("serialize body: {e}")),
        };
        let resp = match self
            .node
            .proxy_request(&self.peer_addr, method, route, Some(body_str))
            .await
        {
            Ok(v) => v,
            Err(e) => return logged_fail(route, format!("proxy_request: {}", js_err_str(e))),
        };

        // resp is a JS object `{ status: u16, body: Option<String> }`.
        // round-trip through JSON.stringify to bring it back into serde-land
        // without pulling in `serde_wasm_bindgen` as a dep.
        let Some(json_str) = js_sys::JSON::stringify(&resp)
            .ok()
            .and_then(|s| s.as_string())
        else {
            return logged_fail(
                route,
                "could not stringify proxy_request response".to_string(),
            );
        };
        let parsed: JsonValue = match serde_json::from_str(&json_str) {
            Ok(v) => v,
            Err(e) => return logged_fail(route, format!("parse proxy response: {e}")),
        };
        let status = parsed
            .get("status")
            .and_then(JsonValue::as_u64)
            .unwrap_or(0);
        let body_str = parsed.get("body").and_then(JsonValue::as_str).unwrap_or("");
        if !(200..300).contains(&status) {
            return logged_fail(route, format!("http {status}: {body_str}"));
        }
        // grimoire endpoints wrap everything in `{ success, message, data, errors }`.
        // try to parse that envelope; if it doesn't look like one, hand back the
        // raw body as a successful response with `data = body`.
        match serde_json::from_str::<JsonValue>(body_str) {
            Ok(envelope) => {
                let success = envelope
                    .get("success")
                    .and_then(JsonValue::as_bool)
                    .unwrap_or(true);
                let message = envelope
                    .get("message")
                    .and_then(JsonValue::as_str)
                    .unwrap_or("")
                    .to_string();
                let data = envelope.get("data").cloned().filter(|v| !v.is_null());
                DispatchResponse {
                    success,
                    message,
                    data,
                }
            }
            Err(_) => DispatchResponse {
                success: true,
                message: format!("http {status}"),
                data: Some(JsonValue::String(body_str.to_string())),
            },
        }
    }

    async fn search_songs(
        &self,
        query: &str,
        limit: u32,
    ) -> Result<Vec<crate::ratcore::app::SongRow>, String> {
        let body = serde_json::json!({
            "query": query,
            "field": "Song",
            "page": 1,
            "page_size": limit,
        });
        let resp = self
            .public_dispatch("POST", "/api/music/search", body)
            .await;
        if !resp.success {
            return Err(resp.message);
        }
        let data = resp
            .data
            .ok_or_else(|| "no data in search response".to_string())?;
        let songs = data
            .get("songs")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let rows: Vec<crate::ratcore::app::SongRow> = songs
            .into_iter()
            .map(|s| crate::ratcore::app::SongRow {
                id: s
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                title: s
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                artist: s
                    .get("artist_names")
                    .and_then(|v| v.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|n| n.as_str())
                            .collect::<Vec<_>>()
                            .join(", ")
                    })
                    .filter(|s: &String| !s.is_empty()),
                album: s
                    .get("album_title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                duration_ms: s
                    .get("duration")
                    .and_then(|v| v.as_i64())
                    .map(|d| (d as u64) * 1000),
                local_path: None,
                media_blob_id: s
                    .get("media_blob_id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
            })
            .collect();
        Ok(rows)
    }

    async fn unified_search(&self, query: &str) -> DispatchResponse {
        let body = serde_json::json!({
            "query": query,
            "field": "All",
            "page": 1,
            "page_size": 50,
        });
        let resp = self
            .public_dispatch("POST", "/api/music/search", body)
            .await;
        if !resp.success {
            return resp;
        }
        let Some(payload) = resp.data else {
            return DispatchResponse {
                success: true,
                message: "no results".to_string(),
                data: Some(JsonValue::Array(vec![])),
            };
        };
        flatten_search_response(payload)
    }

    async fn resolve_blob_url(&self, blob_id: &str) -> Result<(String, String), String> {
        // step 1: fetch blob metadata to get blake3 (for verified
        // streaming) and mime. metadata is small so this is fast.
        let meta = self
            .public_dispatch(
                "POST",
                "/api/blob_metadata",
                serde_json::json!({ "id": blob_id }),
            )
            .await;
        let (blake3, mime_from_meta) = if meta.success {
            let d = meta.data.unwrap_or(JsonValue::Null);
            (
                d.get("blake3").and_then(|v| v.as_str()).map(str::to_string),
                d.get("mime").and_then(|v| v.as_str()).map(str::to_string),
            )
        } else {
            (None, None)
        };

        // step 2: prefer iroh-blobs verified streaming when we have a
        // blake3 — chunks are cryptographically verified and the path
        // doesn't bottleneck on the proxy_request size cap.
        let bytes_array: js_sys::Uint8Array = if let Some(b3) = blake3.as_deref() {
            match self.node.download_verified(&self.peer_addr, b3).await {
                Ok(arr) => {
                    console::log_1(
                        &format!(
                            "rathole: download_verified ok blob={} blake3={}\u{2026}",
                            &blob_id[..blob_id.len().min(8)],
                            &b3[..b3.len().min(8)]
                        )
                        .into(),
                    );
                    arr
                }
                Err(e) => {
                    console::warn_1(
                        &format!(
                            "rathole: download_verified failed ({}) — falling back to proxy",
                            js_err_str(e)
                        )
                        .into(),
                    );
                    self.fetch_blob_via_proxy(blob_id).await?
                }
            }
        } else {
            self.fetch_blob_via_proxy(blob_id).await?
        };

        // step 3: wrap in a Blob → object url so the html-audio
        // backend can stream it from memory.
        let mime = mime_from_meta.unwrap_or_else(|| "application/octet-stream".to_string());
        let parts = js_sys::Array::new();
        parts.push(&bytes_array.buffer());
        let opts = web_sys::BlobPropertyBag::new();
        opts.set_type(&mime);
        let blob = web_sys::Blob::new_with_buffer_source_sequence_and_options(&parts, &opts)
            .map_err(|e| format!("Blob::new: {e:?}"))?;
        let url = web_sys::Url::create_object_url_with_blob(&blob)
            .map_err(|e| format!("createObjectURL: {e:?}"))?;
        Ok((url, mime))
    }

    async fn toggle_favorite(&self, target_type: &str, target_id: &str) -> Result<bool, String> {
        // SetFavorite is idempotent (not a toggle), so we read the
        // current state via list_favorites first, then flip it.
        let current = self.is_favorited(target_type, target_id).await?;
        let body = serde_json::json!({
            "target_type": target_type,
            "target_id": target_id,
            "is_favorite": !current,
        });
        let resp = self
            .public_dispatch("POST", "/api/favorites/set", body)
            .await;
        if !resp.success {
            return Err(resp.message);
        }
        Ok(!current)
    }

    async fn is_favorited(&self, target_type: &str, target_id: &str) -> Result<bool, String> {
        let body = serde_json::json!({
            "target_type": target_type,
            "limit": 1000,
            "offset": 0,
        });
        let resp = self
            .public_dispatch("POST", "/api/favorites/list", body)
            .await;
        if !resp.success {
            return Err(resp.message);
        }
        let Some(data) = resp.data else {
            return Ok(false);
        };
        let favorites = data
            .get("favorites")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        // each FavoriteItem has the inner entity nested under "song",
        // "album", etc. with an "id" field.
        let key = match target_type {
            "song" => "song",
            "album" => "album",
            "artist" => "artist",
            "playlist" => "playlist",
            _ => return Ok(false),
        };
        let found = favorites.iter().any(|item| {
            item.get(key)
                .and_then(|inner| inner.get("id"))
                .and_then(|v| v.as_str())
                == Some(target_id)
        });
        Ok(found)
    }

    async fn library_query(&self, kind: &str, query: Option<&str>) -> DispatchResponse {
        let q = query.map(str::to_string);
        match kind {
            "album" => {
                let body = serde_json::json!({ "q": q, "limit": 100, "offset": 0 });
                let resp = self
                    .public_dispatch("POST", "/api/albums/query", body)
                    .await;
                wrap_paged_web(resp, "albums")
            }
            "artist" => {
                let body = serde_json::json!({ "q": q, "limit": 100, "offset": 0 });
                let resp = self
                    .public_dispatch("POST", "/api/artists/query", body)
                    .await;
                wrap_paged_web(resp, "artists")
            }
            "playlist" => {
                let body = serde_json::json!({ "q": q, "limit": 100, "offset": 0 });
                let resp = self
                    .public_dispatch("POST", "/api/music/playlists/list", body)
                    .await;
                wrap_paged_web(resp, "playlists")
            }
            "favorites" => {
                let body = serde_json::json!({ "limit": 100, "offset": 0 });
                let resp = self
                    .public_dispatch("POST", "/api/favorites/list", body)
                    .await;
                if !resp.success {
                    return resp;
                }
                let data = resp.data.unwrap_or(JsonValue::Null);
                let favs = data
                    .get("favorites")
                    .cloned()
                    .unwrap_or(JsonValue::Array(vec![]));
                let count = favs.as_array().map(|a| a.len()).unwrap_or(0);
                DispatchResponse {
                    success: true,
                    message: format!("found {count} favorites"),
                    data: Some(favs),
                }
            }
            "radio" => {
                self.admin_dispatch("radio_stations_list", JsonValue::Null)
                    .await
            }
            _ => DispatchResponse {
                success: false,
                message: format!("unknown library kind: {kind}"),
                data: None,
            },
        }
    }

    async fn playlist_songs(
        &self,
        playlist_id: &str,
    ) -> Result<Vec<crate::ratcore::app::SongRow>, String> {
        let body = serde_json::json!({
            "playlist_id": playlist_id,
            "limit": 1000,
            "offset": 0,
            "sort_by": "position",
            "sort_direction": "asc",
        });
        let resp = self
            .public_dispatch("POST", "/api/playlists/songs", body)
            .await;
        if !resp.success {
            return Err(resp.message);
        }
        let data = resp
            .data
            .ok_or_else(|| "no data in playlist songs response".to_string())?;
        let items = data
            .get("items")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let rows = items
            .iter()
            .filter_map(|wrapper| wrapper.get("details").map(song_query_json_to_row))
            .collect();
        Ok(rows)
    }

    async fn album_songs(
        &self,
        album_id: &str,
    ) -> Result<Vec<crate::ratcore::app::SongRow>, String> {
        let body = serde_json::json!({
            "filters": { "album_id": album_id },
            "limit": 1000,
            "offset": 0,
            "sort_by": "track_number",
            "sort_direction": "asc",
        });
        let resp = self.public_dispatch("POST", "/api/songs/query", body).await;
        if !resp.success {
            return Err(resp.message);
        }
        let data = resp
            .data
            .ok_or_else(|| "no data in album songs response".to_string())?;
        let items = data
            .get("items")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let rows = items.iter().map(song_query_json_to_row).collect();
        Ok(rows)
    }
}

/// build a `SongRow` from a `SongQueryResult`-shaped json blob
/// (`{ song, artist, album, media_blob, ... }`). shared by
/// `playlist_songs` and `album_songs`.
fn song_query_json_to_row(item: &JsonValue) -> crate::ratcore::app::SongRow {
    let song = item.get("song").cloned().unwrap_or(JsonValue::Null);
    let artist_obj = item.get("artist");
    let album_obj = item.get("album");
    let media_blob = item.get("media_blob");
    let track_artist = song
        .get("track_artist")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty());
    let artist = track_artist.or_else(|| {
        artist_obj
            .and_then(|a| a.get("name"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    });
    let album = album_obj
        .and_then(|a| a.get("title"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let local_path = media_blob
        .and_then(|b| b.get("local_path"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    crate::ratcore::app::SongRow {
        id: song
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        title: song
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        artist,
        album,
        duration_ms: song
            .get("duration")
            .and_then(|v| v.as_i64())
            .map(|d| (d as u64) * 1000),
        media_blob_id: song
            .get("media_blob_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        local_path,
    }
}

/// flatten a `SearchResponse` (with `songs`, `albums`, `artists`,
/// `playlists`) into the same row shape `unified_search_impl` produces
/// in the tty shell. keeps the result-panel rendering identical
/// across shells.
fn flatten_search_response(body: JsonValue) -> DispatchResponse {
    let mut rows: Vec<(f64, JsonValue)> = Vec::new();
    let push_song = |rows: &mut Vec<(f64, JsonValue)>, s: &JsonValue| {
        let title = s.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let artist = s
            .get("artist_names")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|n| n.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default();
        let subtitle = if artist.is_empty() {
            s.get("album_title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        } else {
            artist
        };
        let rank = s.get("search_rank").and_then(|v| v.as_f64()).unwrap_or(0.0);
        rows.push((
            rank,
            serde_json::json!({
                "type": "song",
                "id": s.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                "title": title,
                "subtitle": subtitle,
                "score": rank,
            }),
        ));
    };
    if let Some(songs) = body.get("songs").and_then(|v| v.as_array()) {
        for s in songs {
            push_song(&mut rows, s);
        }
    }
    if let Some(albums) = body.get("albums").and_then(|v| v.as_array()) {
        for a in albums {
            let title = a.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let artists = a
                .get("artist_names")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|n| n.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            let rank = a.get("search_rank").and_then(|v| v.as_f64()).unwrap_or(0.0);
            rows.push((
                rank,
                serde_json::json!({
                    "type": "album",
                    "id": a.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                    "title": title,
                    "subtitle": artists,
                    "score": rank,
                }),
            ));
        }
    }
    if let Some(artists) = body.get("artists").and_then(|v| v.as_array()) {
        for ar in artists {
            let name = ar.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let songs = ar.get("song_count").and_then(|v| v.as_i64()).unwrap_or(0);
            let albums = ar.get("album_count").and_then(|v| v.as_i64()).unwrap_or(0);
            let rank = ar
                .get("search_rank")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            rows.push((
                rank,
                serde_json::json!({
                    "type": "artist",
                    "id": ar.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                    "title": name,
                    "subtitle": format!("{albums} albums  {songs} songs"),
                    "score": rank,
                }),
            ));
        }
    }
    if let Some(playlists) = body.get("playlists").and_then(|v| v.as_array()) {
        for p in playlists {
            let title = p.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let count = p.get("song_count").and_then(|v| v.as_i64()).unwrap_or(0);
            let rank = p.get("search_rank").and_then(|v| v.as_f64()).unwrap_or(0.0);
            rows.push((
                rank,
                serde_json::json!({
                    "type": "playlist",
                    "id": p.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                    "title": title,
                    "subtitle": format!("{count} songs"),
                    "score": rank,
                }),
            ));
        }
    }
    rows.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    let count = rows.len();
    let arr: Vec<JsonValue> = rows.into_iter().map(|(_, v)| v).collect();
    DispatchResponse {
        success: true,
        message: format!("found {count} results"),
        data: Some(JsonValue::Array(arr)),
    }
}

/// unwrap a paged-result envelope: server returns `{ items: [...],
/// total, ... }`; the result panel only needs the items array. on
/// failure preserve message.
fn wrap_paged_web(resp: DispatchResponse, label: &str) -> DispatchResponse {
    if !resp.success {
        return resp;
    }
    let Some(data) = resp.data else {
        return DispatchResponse {
            success: true,
            message: format!("found 0 {label}"),
            data: Some(JsonValue::Array(vec![])),
        };
    };
    let items = data
        .get("items")
        .cloned()
        .unwrap_or(JsonValue::Array(vec![]));
    let count = items.as_array().map(|a| a.len()).unwrap_or(0);
    DispatchResponse {
        success: true,
        message: format!("found {count} {label}"),
        data: Some(items),
    }
}

fn fail(message: String) -> DispatchResponse {
    DispatchResponse {
        success: false,
        message,
        data: None,
    }
}

/// `fail` + console.error so transport errors surface in devtools
/// (the tui collapses long messages into a single line).
fn logged_fail(cmd: &str, message: String) -> DispatchResponse {
    console::error_1(&format!("rathole: admin_dispatch cmd={cmd} FAILED: {message}").into());
    fail(message)
}

fn short_addr(addr: &str) -> String {
    let n = addr.len().min(16);
    format!("{}…", &addr[..n])
}

/// best-effort stringify for `JsError` — converts to `JsValue`, then to
/// String if possible, else uses Debug.
fn js_err_str(e: JsError) -> String {
    let v: JsValue = e.into();
    v.as_string().unwrap_or_else(|| format!("{v:?}"))
}
