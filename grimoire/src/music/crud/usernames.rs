//! batch username resolution for music-domain query results.
//!
//! song/album/playlist-song query results used to carry
//! `created_by_username`/`updated_by_username` straight off a sql view join
//! against `user_accountz`. a view can only join tables that live in the
//! same database file, so the join was removed from the views themselves;
//! callers now resolve usernames here as an explicit second step after
//! fetching rows, using whichever id -> username source currently backs
//! `user_accountz`.

use std::collections::HashMap;

use sqlx::{Row, SqlitePool};

use crate::error::GrimoireResult;
use crate::music::entities::{Album, Song};

/// batch-resolve usernames for a set of user ids.
///
/// returns a map of id -> username for every id that resolves to a live
/// account; ids with no matching row are simply absent from the map rather
/// than treated as an error. duplicate/blank ids are deduped before the
/// lookup so a large batch never issues more binds than distinct ids.
///
/// takes an already-collected `Vec` rather than a generic `impl
/// IntoIterator` - an `async fn` taking an `impl Trait` parameter can trip
/// a rustc inference edge case that leaks into unrelated `Send` checks
/// elsewhere in the crate (e.g. spawned tasks in the job runner);
/// collecting at the call site avoids that entirely.
pub async fn usernames_for(
    pool: &SqlitePool,
    ids: Vec<String>,
) -> GrimoireResult<HashMap<String, String>> {
    let mut unique_ids: Vec<String> = ids.into_iter().filter(|id| !id.is_empty()).collect();
    unique_ids.sort();
    unique_ids.dedup();

    if unique_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let placeholders = unique_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!("SELECT id, username FROM user_accountz WHERE id IN ({placeholders})");

    let mut query = sqlx::query(&sql);
    for id in &unique_ids {
        query = query.bind(id);
    }

    let rows = query.fetch_all(pool).await?;
    let mut map = HashMap::with_capacity(rows.len());
    for row in rows {
        let id: String = row.try_get("id")?;
        let username: String = row.try_get("username")?;
        map.insert(id, username);
    }
    Ok(map)
}

/// resolves and fills in `created_by_username`/`updated_by_username` on a
/// batch of songs, using each song's `created_by`/`updated_by` id.
///
/// takes an already-collected `Vec` rather than a generic iterator - an
/// `async fn` with an explicit lifetime tied to a generic `impl Iterator`
/// parameter can trip a rustc inference edge case that leaks into unrelated
/// `Send` checks elsewhere in the crate (e.g. spawned tasks in the job
/// runner); collecting at the call site avoids that entirely.
pub async fn enrich_song_usernames(pool: &SqlitePool, songs: Vec<&mut Song>) -> GrimoireResult<()> {
    let ids: Vec<String> = songs
        .iter()
        .flat_map(|s| [s.created_by.clone(), s.updated_by.clone()])
        .flatten()
        .collect();
    let map = usernames_for(pool, ids).await?;
    for song in songs {
        song.created_by_username = song.created_by.as_ref().and_then(|id| map.get(id).cloned());
        song.updated_by_username = song.updated_by.as_ref().and_then(|id| map.get(id).cloned());
    }
    Ok(())
}

/// resolves and fills in `created_by_username`/`updated_by_username` on a
/// batch of albums, using each album's `created_by`/`updated_by` id.
///
/// takes an already-collected `Vec` for the same reason as
/// `enrich_song_usernames` above - see its doc comment.
pub async fn enrich_album_usernames(
    pool: &SqlitePool,
    albums: Vec<&mut Album>,
) -> GrimoireResult<()> {
    let ids: Vec<String> = albums
        .iter()
        .flat_map(|a| [a.created_by.clone(), a.updated_by.clone()])
        .flatten()
        .collect();
    let map = usernames_for(pool, ids).await?;
    for album in albums {
        album.created_by_username = album.created_by.as_ref().and_then(|id| map.get(id).cloned());
        album.updated_by_username = album.updated_by.as_ref().and_then(|id| map.get(id).cloned());
    }
    Ok(())
}
