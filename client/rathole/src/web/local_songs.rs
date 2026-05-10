//! browser-side reader for spume's locally-stored songs.
//!
//! schema mirrors `client/spume/src/music/services/storage/db/init.ts`:
//!
//! - database: `freqhole_music`
//! - object store: `songs` (keyPath: `id`, autoincrement)
//! - record: see `Song` type in spume's storage module — the fields
//!   we care about here are `id`, `title`, `artist_name`,
//!   `album_title`, `album_id`, `artist_id`, `duration_seconds`,
//!   `media_blob_id`, `opfs_path`, `added_at`.
//!
//! when rathole is served from the same origin as spume the two
//! shells transparently share the same library. otherwise this
//! returns an empty list (the db simply doesn't exist yet).
//!
//! we open the db with **no version specified** (passing `None`),
//! which avoids triggering a downgrade if spume bumped past
//! whatever fixed version we'd hardcode. if the database (or the
//! `songs` store) doesn't exist we return an empty list rather than
//! creating an incompatible schema.

use idb::{Factory, TransactionMode};
use wasm_bindgen::JsValue;

use crate::ratcore::app::SongRow;

const DB_NAME: &str = "freqhole_music";
const STORE: &str = "songs";

/// list locally-downloaded songs from spume's IndexedDB, most-recent
/// first. returns an empty list (not an error) when no library exists.
pub async fn list_local_songs(limit: u32) -> Result<Vec<SongRow>, String> {
    match read(limit).await {
        Ok(rows) => Ok(rows),
        Err(e) => Err(format!("local songs read failed: {e:?}")),
    }
}

async fn read(limit: u32) -> Result<Vec<SongRow>, idb::Error> {
    let factory = Factory::new()?;
    // open without specifying a version: idb returns whatever the
    // current on-disk version is. if the db doesn't exist a fresh
    // empty one would be created, so we bail out without writing
    // anything by checking `store_names` first.
    let mut req = factory.open(DB_NAME, None)?;
    // no upgrade handler: we never want to migrate spume's schema
    // from underneath it. if `songs` store is missing we just return
    // empty.
    req.on_upgrade_needed(|_ev| {});
    let db = match req.await {
        Ok(db) => db,
        Err(_) => return Ok(vec![]),
    };

    if !db.store_names().iter().any(|n| n == STORE) {
        return Ok(vec![]);
    }

    let tx = db.transaction(&[STORE], TransactionMode::ReadOnly)?;
    let store = tx.object_store(STORE)?;
    // grab everything then sort by added_at desc and truncate. spume
    // uses `by_added_at` index but iterating the whole store is fine
    // for a tui of typical library sizes (and sidesteps cursor api
    // quirks in the idb crate version we're pinned to).
    let all: Vec<JsValue> = store.get_all(None, None)?.await?;

    let mut rows: Vec<(f64, SongRow)> = Vec::with_capacity(all.len());
    for v in all {
        if let Some(row) = decode_song(&v) {
            let added_at = js_sys::Reflect::get(&v, &"added_at".into())
                .ok()
                .and_then(|x| x.as_f64())
                .unwrap_or(0.0);
            rows.push((added_at, row));
        }
    }
    // newest first
    rows.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    let out = rows
        .into_iter()
        .take(limit as usize)
        .map(|(_, r)| r)
        .collect();
    Ok(out)
}

fn decode_song(v: &JsValue) -> Option<SongRow> {
    if v.is_undefined() || v.is_null() {
        return None;
    }
    let id = js_string(v, "id").unwrap_or_default();
    let title = js_string(v, "title").unwrap_or_default();
    if id.is_empty() && title.is_empty() {
        return None;
    }
    let artist = js_string(v, "track_artist")
        .filter(|s| !s.is_empty())
        .or_else(|| js_string(v, "artist_name"));
    let album = js_string(v, "album_title");
    let album_id = js_string(v, "album_id");
    let artist_id = js_string(v, "artist_id");
    let media_blob_id = js_string(v, "media_blob_id");
    let local_path = js_string(v, "opfs_path");
    // spume stores `duration_seconds` (number, may be float). convert
    // to ms for our row shape; ratcore's fmt_ms divides by 1000 for
    // display.
    let duration_ms = js_sys::Reflect::get(v, &"duration_seconds".into())
        .ok()
        .and_then(|x| x.as_f64())
        .filter(|d| d.is_finite() && *d > 0.0)
        .map(|d| (d * 1000.0).round() as u64);

    Some(SongRow {
        id,
        title,
        artist,
        album,
        album_id,
        artist_id,
        duration_ms,
        media_blob_id,
        local_path,
    })
}

fn js_string(v: &JsValue, key: &str) -> Option<String> {
    js_sys::Reflect::get(v, &key.into())
        .ok()
        .and_then(|x| x.as_string())
}
