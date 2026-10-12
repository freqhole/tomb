//! bulk video update - applies the same field values to every id in
//! `video_ids`, mirroring the offal/cli shape of music's `update_songs`
//! (always id-list based, even for a single video).

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

use crate::database;
use crate::error::{ErrorDetail, GrimoireError};
use crate::response::GrimoireResponse;
use crate::video::crud::delete::{delete_video_season_if_unused, delete_video_series_if_unused};
use crate::video::crud::music_link::{
    cleanup_orphaned_music_links, resolve_music_link, CurrentMusicLink, MusicLinkRequest,
};
use crate::video::entities::videos::{is_music_content_type, update_video, UpdateVideoRequest};

/// request to bulk-update videos - every field besides `video_ids` is
/// applied as-is (via the same `COALESCE`-on-write semantics as a single
/// video update) to each id in the list.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema)]
pub struct UpdateVideosRequest {
    pub video_ids: Vec<String>,
    pub series_id: Option<String>,
    pub season_id: Option<String>,
    pub episode_number: Option<i64>,
    pub content_type: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub poster_blob_id: Option<String>,
    pub duration_seconds: Option<f64>,
    pub release_date: Option<String>,
    pub updated_by: Option<String>,
    /// see `Video::parent_video_id` - applied identically to every video
    /// in the list.
    pub parent_video_id: Option<String>,
    /// force `series_id`/`season_id` to `NULL` on every video in the list -
    /// see `UpdateVideoRequest::clear_series_id` for why plain `COALESCE`
    /// can't express this via `series_id: None` alone.
    #[serde(default)]
    pub clear_series_id: bool,
    /// force `season_id` to `NULL` on every video in the list.
    #[serde(default)]
    pub clear_season_id: bool,
    /// force `parent_video_id` to `NULL` on every video in the list.
    #[serde(default)]
    pub clear_parent_video_id: bool,
    /// artist for music_video/karaoke videos - an existing id. see
    /// `video::crud::music_link::resolve_music_link` for how this, the three
    /// fields below, and the default-album rule combine.
    #[serde(default)]
    pub artist_id: Option<String>,
    /// artist to find-or-create by name (case-insensitive), resolved
    /// server-side under this call's own permission - same reason
    /// `new_series_title` exists on the import-review requests. ignored when
    /// `artist_id` is set.
    #[serde(default)]
    pub artist_name: Option<String>,
    /// album for music_video/karaoke videos - an existing id.
    #[serde(default)]
    pub album_id: Option<String>,
    /// album to find-or-create by title under the video's artist. ignored
    /// when `album_id` is set. when neither is given the artist's default
    /// "music videos"/"karaoke videos" album is used.
    #[serde(default)]
    pub album_title: Option<String>,
    /// detach every video in the list from its artist (and album).
    #[serde(default)]
    pub clear_artist_id: bool,
    /// detach every video in the list from its album only, falling back to
    /// the artist's default album when the artist is kept.
    #[serde(default)]
    pub clear_album_id: bool,
}

/// a single video's failure reason within a bulk update - preserves the
/// real per-video error (rather than discarding it down to a bare id) so
/// callers/clients can surface something actionable.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct VideoUpdateFailure {
    pub video_id: String,
    pub reason: String,
}

/// result of a bulk video update operation
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UpdateVideosResult {
    pub videos_updated: u32,
    pub videos_failed: Vec<VideoUpdateFailure>,
}

/// bulk-update videos. best-effort - a failed id is recorded but doesn't
/// stop the rest from being updated.
pub async fn update_videos(req: UpdateVideosRequest) -> GrimoireResponse<UpdateVideosResult> {
    if req.video_ids.is_empty() {
        return GrimoireResponse::failure(
            "Validation failed",
            vec![GrimoireError::Validation {
                field: "video_ids".to_string(),
                message: "video_ids cannot be empty".to_string(),
            }
            .into()],
        );
    }

    let mut videos_updated: u32 = 0;
    let mut videos_failed = Vec::new();

    // snapshot every video's current series/season/artist/album before
    // touching anything - needed both to resolve "keep what it has" for the
    // music link and to know which series/season/album/artist a video moved
    // away from, so orphans can be cleaned up afterward. collected
    // unconditionally (rather than only when the request names a new
    // series/album) because a clear flag or a content type change detaches
    // a video just as surely as naming a different target does - the
    // `*_if_unused` helpers below re-check usage, so listing an id that is
    // still in use is harmless.
    struct Before {
        content_type: String,
        artist_id: Option<String>,
        album_id: Option<String>,
    }
    let mut before: std::collections::HashMap<String, Before> = std::collections::HashMap::new();
    let mut old_series_ids: Vec<String> = Vec::new();
    let mut old_season_ids: Vec<String> = Vec::new();
    let mut old_album_ids: Vec<String> = Vec::new();
    let mut old_artist_ids: Vec<String> = Vec::new();

    if let Ok(pool) = database::connect().await {
        for video_id in &req.video_ids {
            if let Ok(Some(row)) = sqlx::query!(
                r#"SELECT series_id, season_id, content_type as "content_type!", artist_id, album_id
                   FROM videoz WHERE id = ?"#,
                video_id
            )
            .fetch_optional(&pool)
            .await
            {
                old_series_ids.extend(row.series_id);
                old_season_ids.extend(row.season_id);
                old_album_ids.extend(row.album_id.clone());
                old_artist_ids.extend(row.artist_id.clone());
                before.insert(
                    video_id.clone(),
                    Before {
                        content_type: row.content_type,
                        artist_id: row.artist_id,
                        album_id: row.album_id,
                    },
                );
            }
        }
    }

    for video_id in &req.video_ids {
        let mut artist_id = req.artist_id.clone();
        let mut album_id = req.album_id.clone();
        let clear_artist_id = req.clear_artist_id;
        let mut clear_album_id = req.clear_album_id;

        // the type this video ends up as - series-attached videos are
        // implicitly "series", never a music type.
        let effective_content_type = if req.series_id.is_some() {
            "series".to_string()
        } else {
            req.content_type
                .clone()
                .or_else(|| before.get(video_id).map(|b| b.content_type.clone()))
                .unwrap_or_default()
        };

        if is_music_content_type(&effective_content_type) && !clear_artist_id {
            let current = before
                .get(video_id)
                .map(|b| CurrentMusicLink {
                    artist_id: b.artist_id.clone(),
                    // `clear_album_id` drops the current album from
                    // consideration, so the default-album rule applies.
                    album_id: b.album_id.clone().filter(|_| !clear_album_id),
                })
                .unwrap_or_default();
            let link_req = MusicLinkRequest {
                artist_id: req.artist_id.clone(),
                artist_name: req.artist_name.clone(),
                album_id: req.album_id.clone(),
                album_title: req.album_title.clone(),
            };
            match resolve_music_link(
                &effective_content_type,
                &link_req,
                &current,
                req.updated_by.as_deref(),
            )
            .await
            {
                Ok(link) => {
                    artist_id = link.artist_id;
                    album_id = link.album_id;
                    // resolved values are the literal final state, so they
                    // replace (never merely COALESCE with) the old ones.
                    clear_album_id = album_id.is_none();
                }
                Err(e) => {
                    videos_failed.push(VideoUpdateFailure {
                        video_id: video_id.clone(),
                        reason: e.to_string(),
                    });
                    continue;
                }
            }
        }

        let response = update_video(UpdateVideoRequest {
            video_id: video_id.clone(),
            series_id: req.series_id.clone(),
            season_id: req.season_id.clone(),
            episode_number: req.episode_number,
            content_type: req.content_type.clone(),
            title: req.title.clone(),
            description: req.description.clone(),
            poster_blob_id: req.poster_blob_id.clone(),
            duration_seconds: req.duration_seconds,
            release_date: req.release_date.clone(),
            updated_by: req.updated_by.clone(),
            clear_series_id: req.clear_series_id,
            clear_season_id: req.clear_season_id,
            parent_video_id: req.parent_video_id.clone(),
            clear_parent_video_id: req.clear_parent_video_id,
            artist_id,
            album_id,
            clear_artist_id,
            clear_album_id,
        })
        .await;

        if response.success {
            videos_updated += 1;
        } else {
            // preserve the real per-video reason (the underlying
            // `update_video()` response's own error detail, falling back
            // to its message) instead of discarding it down to just the id.
            let reason = response
                .errors
                .first()
                .map(|e| e.detail.clone())
                .unwrap_or_else(|| response.message.clone());
            videos_failed.push(VideoUpdateFailure {
                video_id: video_id.clone(),
                reason,
            });
        }
    }

    // cleanup orphaned series/seasons/albums/artists - mirrors music's
    // `update_songs()`/`delete_artist_if_unused` pattern: any old
    // series/season/album/artist a video moved away from that no longer has
    // any non-deleted video (or, for albums/artists, song) attached gets
    // soft-deleted. best-effort - a failure here doesn't fail the overall
    // update, since the videos themselves already updated successfully.
    let mut seen = std::collections::HashSet::new();
    for old_series_id in old_series_ids.iter().filter(|id| seen.insert(id.as_str())) {
        let _ = delete_video_series_if_unused(old_series_id).await;
    }
    let mut seen = std::collections::HashSet::new();
    for old_season_id in old_season_ids.iter().filter(|id| seen.insert(id.as_str())) {
        let _ = delete_video_season_if_unused(old_season_id).await;
    }
    cleanup_orphaned_music_links(&old_album_ids, &old_artist_ids).await;

    let success = videos_failed.is_empty();
    let message = if success {
        format!("updated {} video(s)", videos_updated)
    } else if videos_failed.len() == 1 {
        // the common single-video-edit-modal case: surface the real
        // reason directly in the top-level message, since that's what
        // `createCallFn`'s synthetic client-side error prioritizes.
        format!("failed to update video: {}", videos_failed[0].reason)
    } else {
        format!(
            "updated {} video(s), {} failed",
            videos_updated,
            videos_failed.len()
        )
    };

    if success {
        GrimoireResponse::success(
            message,
            UpdateVideosResult {
                videos_updated,
                videos_failed,
            },
        )
    } else {
        GrimoireResponse {
            success: false,
            message,
            data: Some(UpdateVideosResult {
                videos_updated,
                videos_failed,
            }),
            errors: vec![ErrorDetail::new(
                "partial_update_failure",
                "Some videos failed to update",
                "one or more video_ids failed to update - see videos_failed",
            )],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database;
    use crate::video::CreateVideoRequest;

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
        crate::database::run_migrations()
            .await
            .expect("run migrations");
    }

    async fn new_video(pool: &sqlx::SqlitePool, n: u32) -> String {
        let blob_id = format!("blob-id-{n}");
        sqlx::query(
            "INSERT INTO media_blobz (id, size, mime, blob_type, blake3)
             VALUES (?, 1, 'video/mp4', 'original', ?)",
        )
        .bind(&blob_id)
        .bind(reliquary::hash_bytes(blob_id.as_bytes()))
        .execute(pool)
        .await
        .expect("insert blob");

        crate::video::create_video(CreateVideoRequest {
            title: format!("video {n}"),
            media_blob_id: blob_id,
            content_type: Some("clip".to_string()),
            ..Default::default()
        })
        .await
        .data
        .expect("create video")
        .id
    }

    async fn video(id: &str) -> crate::video::Video {
        crate::video::get_video(id).await.data.expect("get video")
    }

    async fn album_title(pool: &sqlx::SqlitePool, id: &str) -> (String, bool) {
        let row: (String, Option<i64>) =
            sqlx::query_as("SELECT title, deleted_at FROM albumz WHERE id = ?")
                .bind(id)
                .fetch_one(pool)
                .await
                .expect("album row");
        (row.0, row.1.is_some())
    }

    async fn deleted(pool: &sqlx::SqlitePool, table: &str, id: &str) -> bool {
        let row: (Option<i64>,) =
            sqlx::query_as(&format!("SELECT deleted_at FROM {table} WHERE id = ?"))
                .bind(id)
                .fetch_one(pool)
                .await
                .expect("row");
        row.0.is_some()
    }

    // touches the real db pool singleton - run one at a time, own process:
    // cargo test -p grimoire --lib -- --ignored --exact video::crud::update::tests::test_music_video_artist_album_lifecycle
    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singleton"]
    async fn test_music_video_artist_album_lifecycle() {
        let tmp = tempfile::tempdir().expect("tempdir");
        init_test_env(tmp.path()).await;
        let pool = database::connect().await.expect("connect");

        let v1 = new_video(&pool, 1).await;
        let v2 = new_video(&pool, 2).await;

        // karaoke + a typed artist -> default "karaoke videos" album
        let r = update_videos(UpdateVideosRequest {
            video_ids: vec![v1.clone()],
            content_type: Some("karaoke".to_string()),
            artist_name: Some("Test Artist".to_string()),
            ..Default::default()
        })
        .await;
        assert!(r.success, "{}", r.message);
        let video1 = video(&v1).await;
        let artist_id = video1.artist_id.clone().expect("artist set");
        let default_album = video1.album_id.clone().expect("default album set");
        assert_eq!(album_title(&pool, &default_album).await.0, "karaoke videos");

        // the same artist typed in a different case resolves to the same row
        let r = update_videos(UpdateVideosRequest {
            video_ids: vec![v2.clone()],
            content_type: Some("music_video".to_string()),
            artist_name: Some("test artist".to_string()),
            ..Default::default()
        })
        .await;
        assert!(r.success, "{}", r.message);
        let video2 = video(&v2).await;
        assert_eq!(video2.artist_id.as_deref(), Some(artist_id.as_str()));
        let mv_album = video2.album_id.clone().expect("default album set");
        assert_eq!(album_title(&pool, &mv_album).await.0, "music videos");
        assert_ne!(mv_album, default_album);

        // picking a new album moves v1 and orphans (soft-deletes) the old
        // default album; the artist is still in use
        let r = update_videos(UpdateVideosRequest {
            video_ids: vec![v1.clone()],
            album_title: Some("Custom".to_string()),
            ..Default::default()
        })
        .await;
        assert!(r.success, "{}", r.message);
        let custom_album = video(&v1).await.album_id.expect("album set");
        assert_eq!(album_title(&pool, &custom_album).await.0, "Custom");
        assert!(
            album_title(&pool, &default_album).await.1,
            "old album orphaned"
        );
        assert!(!deleted(&pool, "artistz", &artist_id).await);

        // detail-view listings
        let by_artist = crate::video::list_videos_by_artist(&artist_id)
            .await
            .data
            .expect("list by artist");
        assert_eq!(by_artist.len(), 2);
        let by_album = crate::video::list_videos_by_album(&custom_album)
            .await
            .data
            .expect("list by album");
        assert_eq!(by_album.len(), 1);

        // flipping v2 to karaoke moves it out of the "music videos" album
        // and into "karaoke videos"
        let r = update_videos(UpdateVideosRequest {
            video_ids: vec![v2.clone()],
            content_type: Some("karaoke".to_string()),
            ..Default::default()
        })
        .await;
        assert!(r.success, "{}", r.message);
        let moved = video(&v2).await.album_id.expect("album set");
        assert_eq!(album_title(&pool, &moved).await.0, "karaoke videos");
        assert!(
            album_title(&pool, &mv_album).await.1,
            "music videos album orphaned"
        );

        // reclassifying v1 as a clip detaches it from artist + album and
        // cleans up the now-empty custom album; v2 still holds the artist
        let r = update_videos(UpdateVideosRequest {
            video_ids: vec![v1.clone()],
            content_type: Some("clip".to_string()),
            ..Default::default()
        })
        .await;
        assert!(r.success, "{}", r.message);
        let video1 = video(&v1).await;
        assert_eq!(video1.artist_id, None);
        assert_eq!(video1.album_id, None);
        assert!(album_title(&pool, &custom_album).await.1);
        assert!(!deleted(&pool, "artistz", &artist_id).await);

        // an explicit clear on the last video orphans the album and artist
        let r = update_videos(UpdateVideosRequest {
            video_ids: vec![v2.clone()],
            clear_artist_id: true,
            ..Default::default()
        })
        .await;
        assert!(r.success, "{}", r.message);
        assert_eq!(video(&v2).await.album_id, None);
        assert!(album_title(&pool, &moved).await.1);
        assert!(deleted(&pool, "artistz", &artist_id).await);

        // an album with no artist is rejected, not silently dropped
        let r = update_videos(UpdateVideosRequest {
            video_ids: vec![v1.clone()],
            content_type: Some("music_video".to_string()),
            album_title: Some("Nope".to_string()),
            ..Default::default()
        })
        .await;
        assert!(!r.success);
    }

    // see above for how to run
    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singleton"]
    async fn test_detaching_from_series_cleans_up_orphaned_series() {
        let tmp = tempfile::tempdir().expect("tempdir");
        init_test_env(tmp.path()).await;
        let pool = database::connect().await.expect("connect");

        let v1 = new_video(&pool, 1).await;
        let series = crate::video::find_or_create_video_series("Some Show", None)
            .await
            .data
            .expect("series");
        let season = crate::video::find_or_create_video_season(&series.id, 1, None)
            .await
            .data
            .expect("season");

        let r = update_videos(UpdateVideosRequest {
            video_ids: vec![v1.clone()],
            series_id: Some(series.id.clone()),
            season_id: Some(season.id.clone()),
            content_type: Some("series".to_string()),
            ..Default::default()
        })
        .await;
        assert!(r.success, "{}", r.message);
        assert!(!deleted(&pool, "video_seriez", &series.id).await);

        // moving the last episode out to a standalone movie (series_id
        // None + clear flag, exactly what the review panel sends) used to
        // leave the series and season behind
        let r = update_videos(UpdateVideosRequest {
            video_ids: vec![v1.clone()],
            content_type: Some("movie".to_string()),
            clear_series_id: true,
            clear_season_id: true,
            ..Default::default()
        })
        .await;
        assert!(r.success, "{}", r.message);
        assert!(deleted(&pool, "video_seriez", &series.id).await);
        assert!(deleted(&pool, "video_seasonz", &season.id).await);
    }
}
