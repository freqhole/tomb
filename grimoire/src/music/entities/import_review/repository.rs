//! import review repository - sql queries for import_blobz

use crate::database;
use crate::error::GrimoireError;
use crate::error::GrimoireResult;

use super::models::{AlbumPendingResponse, PendingReviewAlbum, PendingReviewSession};

/// record that a media blob is part of an import job session.
/// uses INSERT OR IGNORE so re-processing is idempotent and dedup hits are silent.
pub async fn insert_import_blob(media_blob_id: &str, session_id: &str) -> GrimoireResult<()> {
    let pool = database::connect().await.map_err(GrimoireError::from)?;
    sqlx::query!(
        "INSERT OR IGNORE INTO import_blobz (media_blob_id, session_id) VALUES (?, ?)",
        media_blob_id,
        session_id
    )
    .execute(&pool)
    .await
    .map_err(GrimoireError::from)?;
    Ok(())
}

/// list sessions that have pending (unreviewed) blobs.
/// admins see all sessions; members only see sessions where they are the uploader.
pub async fn list_pending_sessions(
    user_id: &str,
    is_admin: bool,
    session_id_filter: Option<&str>,
) -> GrimoireResult<Vec<PendingReviewSession>> {
    let pool = database::connect().await.map_err(GrimoireError::from)?;

    let is_admin_flag = is_admin as i64;
    let sid_filter = session_id_filter;

    // single query handles both admin (all sessions) and member (own uploads only)
    // and optional session_id filter. using (is_admin OR created_by = user) pattern.
    // uploader_username is only populated when the caller is admin.
    let sessions = sqlx::query!(
        r#"
        SELECT DISTINCT ib.session_id,
               COALESCE(js.created_at, 0) AS "created_at!: i64",
               CASE WHEN ? = 1 THEN ua.username ELSE NULL END AS "uploader_username?: String"
        FROM import_blobz ib
        LEFT JOIN job_sessionz js ON js.id = ib.session_id
        LEFT JOIN media_blobz mb ON mb.id = ib.media_blob_id
        LEFT JOIN user_accountz ua ON ua.id = js.created_by
        WHERE ib.reviewed_at IS NULL
          AND (? = 1 OR mb.created_by = ?)
          AND (? IS NULL OR ib.session_id = ?)
        ORDER BY js.created_at DESC
        "#,
        is_admin_flag,
        is_admin_flag,
        user_id,
        sid_filter,
        sid_filter
    )
    .fetch_all(&pool)
    .await
    .map_err(GrimoireError::from)?;

    // for each session, fetch pending albums
    let mut result = Vec::with_capacity(sessions.len());
    for s in sessions {
        let albums =
            list_pending_albums_for_session(&pool, &s.session_id, user_id, is_admin).await?;
        result.push(PendingReviewSession {
            session_id: s.session_id,
            created_at: s.created_at,
            uploader_username: s.uploader_username,
            albums,
        });
    }

    Ok(result)
}

async fn list_pending_albums_for_session(
    pool: &sqlx::SqlitePool,
    session_id: &str,
    user_id: &str,
    is_admin: bool,
) -> GrimoireResult<Vec<PendingReviewAlbum>> {
    let is_admin_flag = is_admin as i64;

    // single query for both admin and member - artist link goes through artist_albumz junction
    let rows = sqlx::query!(
        r#"
        SELECT
            a.id                                                    AS "album_id!: String",
            COALESCE(a.title, '')                                   AS "title!: String",
            ar.id                                                   AS "artist_id?: String",
            ar.name                                                 AS "artist_name?: String",
            (SELECT ai.media_blob_id FROM album_imagez ai
             WHERE ai.album_id = a.id AND ai.is_primary = 1
             LIMIT 1)                                               AS "artwork_blob_id?: String",
            COUNT(DISTINCT asj.song_id)                             AS "song_count!: i64",
            COUNT(DISTINCT ib.media_blob_id)                        AS "pending_blob_count!: i64"
        FROM import_blobz ib
        LEFT JOIN media_blobz mb   ON mb.id = ib.media_blob_id
        JOIN songz s               ON s.media_blob_id = ib.media_blob_id
        JOIN album_songz asj       ON asj.song_id = s.id
        JOIN albumz a              ON a.id = asj.album_id
        LEFT JOIN artist_albumz aa ON aa.album_id = a.id
        LEFT JOIN artistz ar       ON ar.id = aa.artist_id AND ar.deleted_at IS NULL
        WHERE ib.session_id = ?
          AND ib.reviewed_at IS NULL
          AND (? = 1 OR mb.created_by = ?)
        GROUP BY a.id
        ORDER BY a.title
        "#,
        session_id,
        is_admin_flag,
        user_id
    )
    .fetch_all(pool)
    .await
    .map_err(GrimoireError::from)?;

    Ok(rows
        .into_iter()
        .map(|r| PendingReviewAlbum {
            album_id: r.album_id,
            title: r.title,
            artist_id: r.artist_id,
            artist_name: r.artist_name,
            artwork_blob_id: r.artwork_blob_id,
            song_count: r.song_count,
            pending_blob_count: r.pending_blob_count,
        })
        .collect())
}

/// check if the given user uploaded at least one song in the album.
/// used to authorise member-level edits.
pub async fn is_uploader(album_id: &str, user_id: &str) -> GrimoireResult<bool> {
    let pool = database::connect().await.map_err(GrimoireError::from)?;
    let row = sqlx::query!(
        r#"
        SELECT COUNT(*) AS "count!: i64"
        FROM album_songz asj
        JOIN songz s     ON s.id = asj.song_id
        JOIN media_blobz mb ON mb.id = s.media_blob_id
        WHERE asj.album_id = ?
          AND mb.created_by = ?
        LIMIT 1
        "#,
        album_id,
        user_id
    )
    .fetch_one(&pool)
    .await
    .map_err(GrimoireError::from)?;
    Ok(row.count > 0)
}

/// mark all pending blobs for an album in a session as reviewed.
pub async fn mark_album_reviewed(
    album_id: &str,
    session_id: &str,
    reviewed_by: &str,
) -> GrimoireResult<()> {
    let pool = database::connect().await.map_err(GrimoireError::from)?;
    sqlx::query!(
        r#"
        UPDATE import_blobz
        SET reviewed_at = unixepoch(),
            reviewed_by = ?
        WHERE media_blob_id IN (
            SELECT s.media_blob_id
            FROM album_songz asj
            JOIN songz s ON s.id = asj.song_id
            WHERE asj.album_id = ?
        )
        AND session_id = ?
        AND reviewed_at IS NULL
        "#,
        reviewed_by,
        album_id,
        session_id
    )
    .execute(&pool)
    .await
    .map_err(GrimoireError::from)?;
    Ok(())
}

/// check whether an album has any pending (unreviewed) import blobs.
/// returns the most recent session that has pending blobs for the album.
/// members only see their own uploads; admins see all.
pub async fn album_pending(
    album_id: &str,
    user_id: &str,
    is_admin: bool,
) -> GrimoireResult<AlbumPendingResponse> {
    let pool = database::connect().await.map_err(GrimoireError::from)?;
    let is_admin_flag = is_admin as i64;

    let row = sqlx::query!(
        r#"
        SELECT ib.session_id                            AS "session_id?: String",
               COUNT(DISTINCT ib.media_blob_id)         AS "pending_count!: i64",
               MAX(js.created_at)                       AS "created_at?: i64"
        FROM import_blobz ib
        LEFT JOIN media_blobz mb   ON mb.id = ib.media_blob_id
        LEFT JOIN job_sessionz js  ON js.id = ib.session_id
        JOIN songz s               ON s.media_blob_id = ib.media_blob_id
        JOIN album_songz asj       ON asj.song_id = s.id
        WHERE asj.album_id = ?
          AND ib.reviewed_at IS NULL
          AND (? = 1 OR mb.created_by = ?)
        ORDER BY js.created_at DESC
        LIMIT 1
        "#,
        album_id,
        is_admin_flag,
        user_id
    )
    .fetch_optional(&pool)
    .await
    .map_err(GrimoireError::from)?;

    match row {
        None => Ok(AlbumPendingResponse {
            session_id: None,
            pending_count: 0,
            created_at: None,
        }),
        Some(r) => Ok(AlbumPendingResponse {
            session_id: r.session_id,
            pending_count: r.pending_count,
            created_at: r.created_at,
        }),
    }
}
