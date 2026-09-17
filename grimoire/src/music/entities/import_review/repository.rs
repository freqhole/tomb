//! import review repository - sql queries for import_blobz

use crate::database;
use crate::error::GrimoireError;
use crate::error::GrimoireResult;

use super::models::{
    AlbumPendingResponse, ImportSessionSendTarget, PendingReviewAlbum, PendingReviewSession,
};

/// record that a media blob is part of an import job session.
/// uses INSERT OR IGNORE so re-processing is idempotent and dedup hits are silent.
pub async fn insert_import_blob(media_blob_id: &str, session_id: &str) -> GrimoireResult<()> {
    let pool = database::connect().await?;
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

/// register that `session_id`'s reviewed output should be sent to
/// `target_remote_id` once review completes - written once, at
/// session-creation time (see offal/upload/music.rs), so any client
/// reading this same local grimoire db sees the same destination
/// regardless of app restarts or which device is doing the reviewing.
pub async fn set_session_send_target(
    session_id: &str,
    target_remote_id: &str,
    target_remote_name: &str,
) -> GrimoireResult<()> {
    let pool = database::connect().await?;
    sqlx::query!(
        r#"
        INSERT INTO import_session_send_targetz (session_id, target_remote_id, target_remote_name)
        VALUES (?, ?, ?)
        ON CONFLICT (session_id) DO UPDATE SET
            target_remote_id = excluded.target_remote_id,
            target_remote_name = excluded.target_remote_name
        "#,
        session_id,
        target_remote_id,
        target_remote_name
    )
    .execute(&pool)
    .await
    .map_err(GrimoireError::from)?;
    Ok(())
}

/// look up `session_id`'s send target directly against
/// import_session_send_targetz - independent of review state, unlike
/// list_pending_sessions' join (which only returns sessions that still
/// have an unreviewed blob). both fields `None` (no row at all) means a
/// purely local import.
pub async fn get_session_send_target(session_id: &str) -> GrimoireResult<ImportSessionSendTarget> {
    let pool = database::connect().await?;
    let row = sqlx::query!(
        r#"
        SELECT target_remote_id AS "target_remote_id!: String",
               target_remote_name AS "target_remote_name!: String"
        FROM import_session_send_targetz
        WHERE session_id = ?
        "#,
        session_id
    )
    .fetch_optional(&pool)
    .await
    .map_err(GrimoireError::from)?;
    Ok(ImportSessionSendTarget {
        target_remote_id: row.as_ref().map(|r| r.target_remote_id.clone()),
        target_remote_name: row.map(|r| r.target_remote_name),
    })
}

/// list sessions that have pending (unreviewed) blobs.
/// admins see all sessions; members only see sessions where they are the uploader.
pub async fn list_pending_sessions(
    user_id: &str,
    is_admin: bool,
    session_id_filter: Option<&str>,
) -> GrimoireResult<Vec<PendingReviewSession>> {
    let pool = database::connect().await?;

    let is_admin_flag = is_admin as i64;
    let sid_filter = session_id_filter;

    // single query handles both admin (all sessions) and member (own uploads only)
    // and optional session_id filter. using (is_admin OR created_by = user) pattern.
    // uploader_username is only populated when the caller is admin.
    let sessions = sqlx::query!(
        r#"
        SELECT DISTINCT ib.session_id,
               COALESCE(js.created_at, 0) AS "created_at!: i64",
               CASE WHEN ? = 1 THEN ua.username ELSE NULL END AS "uploader_username?: String",
               st.target_remote_id   AS "target_remote_id?: String",
               st.target_remote_name AS "target_remote_name?: String"
        FROM import_blobz ib
        LEFT JOIN job_sessionz js ON js.id = ib.session_id
        LEFT JOIN media_blobz mb ON mb.id = ib.media_blob_id
        LEFT JOIN user_accountz ua ON ua.id = js.created_by
        LEFT JOIN import_session_send_targetz st ON st.session_id = ib.session_id
        -- only surface sessions that still have at least one live (non-deleted) song
        JOIN songz s               ON s.media_blob_id = ib.media_blob_id AND s.deleted_at IS NULL
        JOIN album_songz asj       ON asj.song_id = s.id
        JOIN albumz a              ON a.id = asj.album_id AND a.deleted_at IS NULL
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
            target_remote_id: s.target_remote_id,
            target_remote_name: s.target_remote_name,
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
        JOIN songz s               ON s.media_blob_id = ib.media_blob_id AND s.deleted_at IS NULL
        JOIN album_songz asj       ON asj.song_id = s.id
        JOIN albumz a              ON a.id = asj.album_id AND a.deleted_at IS NULL
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
    let pool = database::connect().await?;
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

/// check if the given user uploaded the media blob backing this song.
/// used to authorise member-level moves - checked against the song being
/// moved rather than the destination album, since a move into a
/// not-yet-created album has no destination album id to check yet.
pub async fn is_song_uploader(song_id: &str, user_id: &str) -> GrimoireResult<bool> {
    let pool = database::connect().await?;
    let row = sqlx::query!(
        r#"
        SELECT COUNT(*) AS "count!: i64"
        FROM songz s
        JOIN media_blobz mb ON mb.id = s.media_blob_id
        WHERE s.id = ?
          AND mb.created_by = ?
        LIMIT 1
        "#,
        song_id,
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
    let pool = database::connect().await?;
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
    let pool = database::connect().await?;
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

#[cfg(test)]
mod tests {
    use super::*;

    async fn init_test_env(data_dir: &std::path::Path) {
        let config_toml = format!(
            r#"data_dir = "{data_dir}"

[database]
filename = "grimoire.db"

[media]
max_fs_file_size = 104857600
supported_audio_formats = ["mp3", "flac"]

[musicbrainz]
enabled = false

[logging]
level = "warn"
"#,
            data_dir = data_dir.display()
        );
        let config_path = data_dir.join("freqhole-config.toml");
        std::fs::write(&config_path, config_toml).expect("write config");
        std::fs::write(data_dir.join("grimoire.db"), b"").expect("touch grimoire.db");

        crate::config::init_config(Some(config_path)).expect("init config");
        database::run_migrations().await.expect("run migrations");
    }

    /// regression test for the exact bug that motivated `import_session_send_targetz`
    /// (§1/finding in docs/add-media-review-refactor-plan.md, tomb repo): once every
    /// blob in a session is marked reviewed, `list_pending_sessions` stops returning
    /// that session entirely (its query filters `WHERE ib.reviewed_at IS NULL`) - the
    /// send target must still be readable directly via `get_session_send_target`,
    /// independent of review completion.
    ///
    /// cargo test -p grimoire --lib -- --ignored --exact music::entities::import_review::repository::tests::test_session_send_target_survives_review_completion
    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singletons"]
    async fn test_session_send_target_survives_review_completion() {
        let tmp = tempfile::tempdir().expect("tempdir");
        init_test_env(tmp.path()).await;
        let pool = database::connect().await.expect("connect");

        // seed: uploader, one album+song backed by one media blob, all part of
        // one import session.
        sqlx::query(
            "INSERT INTO user_accountz (id, username, role) VALUES ('user1', 'uploader', 'member')",
        )
        .execute(&pool)
        .await
        .expect("insert user");

        sqlx::query(
            "INSERT INTO job_sessionz (id, job_type, created_by) VALUES ('sess1', 'music_import', 'user1')",
        )
        .execute(&pool)
        .await
        .expect("insert session");

        sqlx::query(
            "INSERT INTO media_blobz (id, sha256, blob_type, created_by) VALUES ('blob0001', ?, 'original', 'user1')",
        )
        .bind("a".repeat(64))
        .execute(&pool)
        .await
        .expect("insert media blob");

        sqlx::query(
            "INSERT INTO import_blobz (media_blob_id, session_id) VALUES ('blob0001', 'sess1')",
        )
        .execute(&pool)
        .await
        .expect("insert import_blobz row");

        sqlx::query("INSERT INTO albumz (id, title) VALUES ('album1', 'test album')")
            .execute(&pool)
            .await
            .expect("insert album");

        sqlx::query(
            "INSERT INTO songz (id, media_blob_id, title) VALUES ('song1', 'blob0001', 'test song')",
        )
        .execute(&pool)
        .await
        .expect("insert song");

        sqlx::query("INSERT INTO album_songz (album_id, song_id) VALUES ('album1', 'song1')")
            .execute(&pool)
            .await
            .expect("insert album_songz link");

        // tag the session with a send target, as offal/upload/music.rs does at
        // session-creation time.
        set_session_send_target("sess1", "remote-1", "my remote")
            .await
            .expect("set send target");

        // sanity check: the session is visible while still pending.
        let pending_before = list_pending_sessions("user1", true, None)
            .await
            .expect("list pending sessions before review");
        assert_eq!(
            pending_before.len(),
            1,
            "session should be pending before review"
        );
        assert_eq!(
            pending_before[0].target_remote_id.as_deref(),
            Some("remote-1")
        );

        // mark the only album in the session reviewed - this drains every
        // pending blob, so list_pending_sessions' join stops matching it.
        mark_album_reviewed("album1", "sess1", "user1")
            .await
            .expect("mark album reviewed");

        let pending_after = list_pending_sessions("user1", true, None)
            .await
            .expect("list pending sessions after review");
        assert_eq!(
            pending_after.len(),
            0,
            "session must no longer appear as pending once fully reviewed"
        );

        // the actual regression check: the send target must still be readable
        // directly, independent of the (now empty) pending-sessions view.
        let target = get_session_send_target("sess1")
            .await
            .expect("get session send target");
        assert_eq!(target.target_remote_id.as_deref(), Some("remote-1"));
        assert_eq!(target.target_remote_name.as_deref(), Some("my remote"));
    }

    /// a session with no send target ever set (a purely local import) must
    /// report both fields as `None`, not an error or empty strings.
    ///
    /// cargo test -p grimoire --lib -- --ignored --exact music::entities::import_review::repository::tests::test_session_send_target_absent_when_never_set
    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singletons"]
    async fn test_session_send_target_absent_when_never_set() {
        let tmp = tempfile::tempdir().expect("tempdir");
        init_test_env(tmp.path()).await;

        let target = get_session_send_target("no-such-session")
            .await
            .expect("get session send target");
        assert_eq!(target.target_remote_id, None);
        assert_eq!(target.target_remote_name, None);
    }
}
