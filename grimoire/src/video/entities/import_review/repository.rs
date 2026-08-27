//! video import review repository - sql queries for import_blobz, scoped
//! to the video domain's group-by-detected-series read shape. reuses the
//! shared `import_blobz`/`job_sessionz` tables (keyed on `media_blob_id`,
//! which is domain-agnostic) that the music domain already populates.

use crate::database;
use crate::error::GrimoireError;
use crate::error::GrimoireResult;

use super::models::{
    PendingReviewVideoSummary, PendingVideoReviewGroup, PendingVideoReviewSession,
    VideoPendingResponse,
};

/// list sessions that have pending (unreviewed) video blobs.
/// admins see all sessions; members only see sessions where they are the uploader.
pub async fn list_pending_sessions(
    user_id: &str,
    is_admin: bool,
    session_id_filter: Option<&str>,
) -> GrimoireResult<Vec<PendingVideoReviewSession>> {
    let pool = database::connect().await?;

    let is_admin_flag = is_admin as i64;
    let sid_filter = session_id_filter;

    // single query handles both admin (all sessions) and member (own uploads only)
    // and optional session_id filter, mirroring music's import_review query shape.
    let sessions = sqlx::query!(
        r#"
        SELECT DISTINCT ib.session_id,
               COALESCE(js.created_at, 0) AS "created_at!: i64",
               CASE WHEN ? = 1 THEN ua.username ELSE NULL END AS "uploader_username?: String"
        FROM import_blobz ib
        LEFT JOIN job_sessionz js ON js.id = ib.session_id
        LEFT JOIN media_blobz mb ON mb.id = ib.media_blob_id
        LEFT JOIN user_accountz ua ON ua.id = js.created_by
        -- only surface sessions that still have at least one live (non-deleted) video
        JOIN videoz v             ON v.media_blob_id = ib.media_blob_id AND v.deleted_at IS NULL
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

    let mut result = Vec::with_capacity(sessions.len());
    for s in sessions {
        let groups =
            list_pending_groups_for_session(&pool, &s.session_id, user_id, is_admin).await?;
        result.push(PendingVideoReviewSession {
            session_id: s.session_id,
            created_at: s.created_at,
            uploader_username: s.uploader_username,
            groups,
        });
    }

    Ok(result)
}

async fn list_pending_groups_for_session(
    pool: &sqlx::SqlitePool,
    session_id: &str,
    user_id: &str,
    is_admin: bool,
) -> GrimoireResult<Vec<PendingVideoReviewGroup>> {
    let is_admin_flag = is_admin as i64;

    // grouping key is the detected series (if any), else the video's own
    // id - so standalone movies/clips fall out as singleton groups instead
    // of being lumped into one giant "no series" bucket.
    let rows = sqlx::query!(
        r#"
        SELECT
            COALESCE(v.series_id, v.id)                   AS "group_key!: String",
            v.series_id                                    AS "series_id?: String",
            vs.title                                        AS "series_title?: String",
            COALESCE(vs.poster_blob_id, v.poster_blob_id)  AS "poster_blob_id?: String",
            v.id                                            AS "video_id!: String",
            v.title                                         AS "video_title!: String",
            v.content_type                                  AS "content_type!: String",
            v.season_id                                     AS "video_season_id?: String",
            se.season_number                                AS "season_number?: i64",
            se.title                                        AS "season_title?: String",
            v.episode_number                                AS "episode_number?: i64"
        FROM import_blobz ib
        LEFT JOIN media_blobz mb   ON mb.id = ib.media_blob_id
        JOIN videoz v               ON v.media_blob_id = ib.media_blob_id AND v.deleted_at IS NULL
        LEFT JOIN video_seriez vs  ON vs.id = v.series_id AND vs.deleted_at IS NULL
        LEFT JOIN video_seasonz se ON se.id = v.season_id AND se.deleted_at IS NULL
        WHERE ib.session_id = ?
          AND ib.reviewed_at IS NULL
          AND (? = 1 OR mb.created_by = ?)
        ORDER BY vs.title, se.season_number, v.episode_number, v.title
        "#,
        session_id,
        is_admin_flag,
        user_id
    )
    .fetch_all(pool)
    .await
    .map_err(GrimoireError::from)?;

    let mut groups: Vec<PendingVideoReviewGroup> = Vec::new();
    for r in rows {
        let summary = PendingReviewVideoSummary {
            video_id: r.video_id,
            title: r.video_title,
            content_type: r.content_type,
            season_id: r.video_season_id,
            season_number: r.season_number,
            season_title: r.season_title,
            episode_number: r.episode_number,
        };
        match groups.iter_mut().find(|g| g.group_key == r.group_key) {
            Some(group) => {
                group.videos.push(summary);
                group.pending_blob_count += 1;
            }
            None => groups.push(PendingVideoReviewGroup {
                group_key: r.group_key,
                series_id: r.series_id,
                series_title: r.series_title,
                poster_blob_id: r.poster_blob_id,
                videos: vec![summary],
                pending_blob_count: 1,
            }),
        }
    }

    Ok(groups)
}

/// check if the given user uploaded at least one video in the group (a
/// series, or the single standalone video when `group_key` is a video id
/// rather than a series id). used to authorise member-level edits.
pub async fn is_group_uploader(group_key: &str, user_id: &str) -> GrimoireResult<bool> {
    let pool = database::connect().await?;
    let row = sqlx::query!(
        r#"
        SELECT COUNT(*) AS "count!: i64"
        FROM videoz v
        JOIN media_blobz mb ON mb.id = v.media_blob_id
        WHERE (v.series_id = ? OR v.id = ?)
          AND mb.created_by = ?
        LIMIT 1
        "#,
        group_key,
        group_key,
        user_id
    )
    .fetch_one(&pool)
    .await
    .map_err(GrimoireError::from)?;
    Ok(row.count > 0)
}

/// mark all pending blobs for a group (in a session) as reviewed.
pub async fn mark_group_reviewed(
    group_key: &str,
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
            SELECT v.media_blob_id FROM videoz v
            WHERE v.series_id = ? OR v.id = ?
        )
        AND session_id = ?
        AND reviewed_at IS NULL
        "#,
        reviewed_by,
        group_key,
        group_key,
        session_id
    )
    .execute(&pool)
    .await
    .map_err(GrimoireError::from)?;
    Ok(())
}

/// check whether a video's review group (its series, if any, else just
/// itself) has any pending unreviewed import blobs. returns the most
/// recent session that has pending blobs for the group. members only see
/// their own uploads; admins see all.
pub async fn video_pending(
    video_id: &str,
    user_id: &str,
    is_admin: bool,
) -> GrimoireResult<VideoPendingResponse> {
    let pool = database::connect().await?;
    let is_admin_flag = is_admin as i64;

    // group membership follows the same COALESCE(series_id, video_id) rule
    // used everywhere else in this module - resolve it once up front.
    let series_id: Option<String> = sqlx::query_scalar!(
        r#"SELECT series_id AS "series_id?: String" FROM videoz WHERE id = ?"#,
        video_id
    )
    .fetch_optional(&pool)
    .await
    .map_err(GrimoireError::from)?
    .flatten();

    let group_key = series_id.as_deref().unwrap_or(video_id);

    let row = sqlx::query!(
        r#"
        SELECT ib.session_id                    AS "session_id?: String",
               COUNT(DISTINCT ib.media_blob_id) AS "pending_count!: i64",
               MAX(js.created_at)                AS "created_at?: i64"
        FROM import_blobz ib
        LEFT JOIN media_blobz mb  ON mb.id = ib.media_blob_id
        LEFT JOIN job_sessionz js ON js.id = ib.session_id
        JOIN videoz v              ON v.media_blob_id = ib.media_blob_id AND v.deleted_at IS NULL
        WHERE (v.series_id = ? OR v.id = ?)
          AND ib.reviewed_at IS NULL
          AND (? = 1 OR mb.created_by = ?)
        ORDER BY js.created_at DESC
        LIMIT 1
        "#,
        group_key,
        group_key,
        is_admin_flag,
        user_id
    )
    .fetch_optional(&pool)
    .await
    .map_err(GrimoireError::from)?;

    match row {
        None => Ok(VideoPendingResponse {
            session_id: None,
            pending_count: 0,
            created_at: None,
        }),
        Some(r) => Ok(VideoPendingResponse {
            session_id: r.session_id,
            pending_count: r.pending_count,
            created_at: r.created_at,
        }),
    }
}
