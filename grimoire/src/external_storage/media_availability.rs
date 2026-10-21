//! shared, non-destructive offline rule for music and video blob references.
//!
//! migration 098 maintains indexed source membership on blob/path writes,
//! including existing imports and historical source roots. reads use
//! `library_offline_blob_view`, not filesystem probes or scans of media paths.
//! query builders can correlate that view by `blob_id` before LIMIT/count,
//! or use it to annotate/order results without dropping search/playlist rows.
//! unknown and untracked blobs are not confirmed offline; this is not a
//! guarantee that a file is locally playable. deleted flags are independent.
//!
//! media_blobz currently has one local_path per content hash. importing an
//! identical file elsewhere repoints that path; this index follows it rather
//! than claiming the database already tracks multiple physical file copies.

use crate::GrimoireResult;
use sqlx::SqlitePool;

pub async fn is_blob_offline(pool: &SqlitePool, blob_id: &str) -> GrimoireResult<bool> {
    Ok(sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM library_offline_blob_view WHERE blob_id = ?) AS "is_offline!: bool""#,
        blob_id
    )
    .fetch_one(pool)
    .await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn fixture() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::database::run_schema_migrations(&pool).await.unwrap();
        pool
    }

    async fn source(pool: &SqlitePool, id: &str, root: &str, relative: &str) {
        sqlx::query!(
            "INSERT INTO library_sourcez (id, volume_key, relative_path, last_known_path)
             VALUES (?, ?, ?, ?)",
            id,
            id,
            relative,
            root
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query!(
            "INSERT INTO library_source_pathz (source_id, path) VALUES (?, ?)",
            id,
            root
        )
        .execute(pool)
        .await
        .unwrap();
    }

    async fn blob(pool: &SqlitePool, id: &str, path: Option<&str>) {
        sqlx::query!(
            "INSERT INTO media_blobz (id, local_path) VALUES (?, ?)",
            id,
            path
        )
        .execute(pool)
        .await
        .unwrap();
    }

    async fn status(pool: &SqlitePool, source: &str, status: &str) {
        sqlx::query!(
            "INSERT INTO library_source_statez (source_id, status, checked_at, changed_at)
             VALUES (?, ?, 100, 100)
             ON CONFLICT(source_id) DO UPDATE SET status = excluded.status",
            source,
            status
        )
        .execute(pool)
        .await
        .unwrap();
    }

    async fn memberships(pool: &SqlitePool, id: &str) -> Vec<String> {
        sqlx::query_scalar!(
            "SELECT source_id FROM library_source_mediaz WHERE blob_id = ? ORDER BY source_id",
            id
        )
        .fetch_all(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn registration_indexes_existing_music_video_and_literal_paths() {
        let pool = fixture().await;
        blob(&pool, "music001", Some("/mnt/音楽_%/song.flac")).await;
        blob(&pool, "video001", Some("/mnt/音楽_%/video/film.mp4")).await;
        blob(&pool, "outside1", Some("/mnt/音楽_XX/song.flac")).await;
        blob(&pool, "outside2", Some("/mnt/音楽_%-other/song.flac")).await;
        blob(&pool, "outside3", Some("/mnt/音楽_%\\other/song.flac")).await;
        blob(&pool, "remotely", None).await;
        sqlx::query!(
            "INSERT INTO songz (id, media_blob_id, title) VALUES ('song0001', 'music001', 'song')"
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query!(
            "INSERT INTO videoz (id, media_blob_id, title) VALUES ('video001', 'video001', 'film')"
        )
        .execute(&pool)
        .await
        .unwrap();
        source(&pool, "disk", "/mnt/音楽_%", "").await;
        status(&pool, "disk", "offline").await;
        for id in ["music001", "video001"] {
            assert_eq!(memberships(&pool, id).await, ["disk"]);
            assert!(is_blob_offline(&pool, id).await.unwrap());
        }
        for id in ["outside1", "outside2", "outside3", "remotely"] {
            assert!(memberships(&pool, id).await.is_empty());
            assert!(!is_blob_offline(&pool, id).await.unwrap());
        }
        let rows = sqlx::query_scalar!(
            r#"SELECT id AS "id!" FROM media_blobz WHERE EXISTS
             (SELECT 1 FROM library_offline_blob_view o WHERE o.blob_id = media_blobz.id)
             ORDER BY id"#,
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(rows, ["music001", "video001"]);
        let counts = sqlx::query!(
            r#"SELECT
               (SELECT COUNT(*) FROM songz) AS "songs!",
               (SELECT COUNT(*) FROM videoz) AS "videos!",
               (SELECT COUNT(*) FROM songz e WHERE EXISTS
                 (SELECT 1 FROM library_offline_blob_view o WHERE o.blob_id = e.media_blob_id)) AS "offline_songs!",
               (SELECT COUNT(*) FROM videoz e WHERE EXISTS
                 (SELECT 1 FROM library_offline_blob_view o WHERE o.blob_id = e.media_blob_id)) AS "offline_videos!""#
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(
            (
                counts.songs,
                counts.videos,
                counts.offline_songs,
                counts.offline_videos
            ),
            (1, 1, 1, 1)
        );
    }

    #[tokio::test]
    async fn blob_writes_reconcile_membership_without_changing_deletion_flags() {
        let pool = fixture().await;
        source(&pool, "disk", "/mnt/disk", "").await;
        status(&pool, "disk", "offline").await;
        blob(&pool, "content1", Some("/mnt/disk/song.flac")).await;
        sqlx::query!("UPDATE media_blobz SET deleted_at = 42 WHERE id = 'content1'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(is_blob_offline(&pool, "content1").await.unwrap());
        for path in [
            Some("/internal/song.flac"),
            None,
            Some("/mnt/disk/song.flac"),
        ] {
            sqlx::query!(
                "UPDATE media_blobz SET local_path = ? WHERE id = 'content1'",
                path
            )
            .execute(&pool)
            .await
            .unwrap();
            assert_eq!(
                is_blob_offline(&pool, "content1").await.unwrap(),
                path == Some("/mnt/disk/song.flac")
            );
        }
        status(&pool, "disk", "online").await;
        assert!(!is_blob_offline(&pool, "content1").await.unwrap());
        let deleted: i64 = sqlx::query_scalar!(
            r#"SELECT deleted_at AS "deleted_at!" FROM media_blobz WHERE id = 'content1'"#
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(deleted, 42);
        sqlx::query!("DELETE FROM media_blobz WHERE id = 'content1'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(memberships(&pool, "content1").await.is_empty());
    }

    #[tokio::test]
    async fn historical_and_overlapping_roots_are_deduplicated_and_reconciled() {
        let pool = fixture().await;
        source(&pool, "disk", "/mnt/old", "").await;
        blob(&pool, "content1", Some("/mnt/old/Music/song.flac")).await;
        source(&pool, "folder", "/mnt/old/Music", "Music").await;
        sqlx::query!("INSERT INTO library_source_pathz VALUES ('disk', '/mnt/old/Music')")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(memberships(&pool, "content1").await, ["disk", "folder"]);
        status(&pool, "disk", "offline").await;
        // an unprobed overlapping source is not confirmed offline.
        assert!(!is_blob_offline(&pool, "content1").await.unwrap());
        status(&pool, "folder", "offline").await;
        assert!(is_blob_offline(&pool, "content1").await.unwrap());
        status(&pool, "folder", "online").await;
        assert!(!is_blob_offline(&pool, "content1").await.unwrap());
        sqlx::query!("DELETE FROM library_sourcez WHERE id = 'folder'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(is_blob_offline(&pool, "content1").await.unwrap());
        sqlx::query!("UPDATE library_source_pathz SET path = '/mnt/new' WHERE source_id = 'disk' AND path = '/mnt/old'")
            .execute(&pool).await.unwrap();
        assert_eq!(memberships(&pool, "content1").await, ["disk"]);
        sqlx::query!(
            "DELETE FROM library_source_pathz WHERE source_id = 'disk' AND path = '/mnt/old/Music'",
        )
        .execute(&pool)
        .await
        .unwrap();
        assert!(memberships(&pool, "content1").await.is_empty());
        assert!(!is_blob_offline(&pool, "content1").await.unwrap());
        sqlx::query!("DELETE FROM library_sourcez WHERE id = 'disk'")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar!("SELECT COUNT(*) FROM media_blobz")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn registration_indexes_existing_blobs_including_deleted_records() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::database::run_schema_migrations(&pool).await.unwrap();
        blob(&pool, "content1", Some("/mnt/disk/song.flac")).await;
        sqlx::query!("UPDATE media_blobz SET deleted_at = 42")
            .execute(&pool)
            .await
            .unwrap();
        source(&pool, "disk", "/mnt/disk", "").await;
        status(&pool, "disk", "offline").await;
        assert_eq!(memberships(&pool, "content1").await, ["disk"]);
        assert!(is_blob_offline(&pool, "content1").await.unwrap());
        assert_eq!(
            sqlx::query_scalar!(r#"SELECT deleted_at AS "deleted_at!" FROM media_blobz"#)
                .fetch_one(&pool)
                .await
                .unwrap(),
            42
        );
    }

    #[tokio::test]
    async fn sync_registration_suspends_offline_rule_and_matches_shared_source_checks() {
        let pool = fixture().await;
        source(&pool, "disk", "/mnt/disk/Video", "Video").await;
        sqlx::query!("UPDATE library_sourcez SET volume_uuid = 'ABCD-1234'")
            .execute(&pool)
            .await
            .unwrap();
        status(&pool, "disk", "offline").await;
        blob(&pool, "content1", Some("/mnt/disk/Video/film.mp4")).await;
        let sources = crate::external_storage::sources::list_sources(&pool)
            .await
            .unwrap();
        for (uuid, path) in [
            (Some("abcd-1234"), "/mnt/changed/Music"),
            (None, "/mnt/disk/Music"),
            (None, "/mnt/disk"),
            (None, "/mnt"),
            (None, "/"),
            (None, "/mnt/disk-other"),
            (None, "/mnt/disk\\other"),
            (None, "/internal"),
        ] {
            let target = crate::external_storage::sync_priority::SyncTarget {
                device_id: "inactive".into(),
                volume_uuid: uuid.map(str::to_owned),
                path: path.into(),
            };
            let reserved = crate::external_storage::sync_priority::is_sync_source(
                std::slice::from_ref(&target),
                &sources[0],
            );
            crate::external_storage::sync_priority::replace_targets(&pool, "charnel", &[target])
                .await
                .unwrap();
            let sql_reserved = sqlx::query_scalar!(
                r#"SELECT EXISTS (SELECT 1 FROM library_sync_source_view WHERE source_id = 'disk') AS "reserved!: bool""#,
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(sql_reserved, reserved, "{uuid:?} {path}");
            assert_eq!(is_blob_offline(&pool, "content1").await.unwrap(), !reserved);
        }
        crate::external_storage::sync_priority::replace_targets(&pool, "charnel", &[])
            .await
            .unwrap();
        assert!(is_blob_offline(&pool, "content1").await.unwrap());
    }

    #[tokio::test]
    async fn correlated_offline_lookup_uses_the_blob_membership_index() {
        let pool = fixture().await;
        let plan = sqlx::query!(
            "EXPLAIN QUERY PLAN SELECT EXISTS
             (SELECT 1 FROM library_offline_blob_view WHERE blob_id = 'content1')",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        let detail = plan
            .iter()
            .map(|row| row.detail.as_deref().expect("query plan detail"))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            detail.contains("SEARCH m USING PRIMARY KEY (blob_id=?)"),
            "{detail}"
        );
        assert!(!detail.contains("SCAN m"), "{detail}");
        assert!(
            !detail.contains("library_source_blob_path_view"),
            "{detail}"
        );
    }

    #[tokio::test]
    async fn lookup_errors_are_not_reported_as_available_media() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        assert!(is_blob_offline(&pool, "content1").await.is_err());
    }

    #[tokio::test]
    async fn read_views_annotate_without_hiding_media_or_changing_playlist_order() {
        let pool = fixture().await;
        source(&pool, "disk", "/mnt/disk", "").await;
        blob(&pool, "music001", Some("/mnt/disk/song.flac")).await;
        blob(&pool, "music002", Some("/internal/song.flac")).await;
        blob(&pool, "video001", Some("/mnt/disk/film.mp4")).await;
        sqlx::query!(
            "INSERT INTO songz (id, media_blob_id, title) VALUES
            ('song0001', 'music001', 'external'), ('song0002', 'music002', 'internal')"
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query!(
            "INSERT INTO videoz (id, media_blob_id, title) VALUES ('video001', 'video001', 'film')"
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query!("INSERT INTO playlistz (id, title) VALUES ('playlist', 'mixed')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query!(
            "INSERT INTO playlist_itemz (playlist_id, entity_type, entity_id, position) VALUES
            ('playlist', 'song', 'song0001', 1), ('playlist', 'song', 'song0002', 2)"
        )
        .execute(&pool)
        .await
        .unwrap();
        for (state, expected) in [
            ("unknown", false),
            ("online", false),
            ("offline", true),
            ("online", false),
        ] {
            status(&pool, "disk", state).await;
            let songs = sqlx::query!(
                r#"SELECT song_id AS "song_id!", is_offline AS "is_offline!: bool"
                   FROM song_query_view ORDER BY song_id"#
            )
            .fetch_all(&pool)
            .await
            .unwrap();
            assert_eq!(songs.len(), 2);
            assert_eq!(songs[0].song_id, "song0001");
            assert_eq!(songs[0].is_offline, expected);
            assert!(!songs[1].is_offline);
            let playlist = sqlx::query!(
                r#"SELECT song_id AS "song_id!", position AS "position!",
                          is_offline AS "is_offline!: bool"
                   FROM playlist_song_query_view WHERE playlist_id = 'playlist' ORDER BY position"#
            )
            .fetch_all(&pool)
            .await
            .unwrap();
            assert_eq!(playlist.len(), 2);
            assert_eq!(
                (
                    &*playlist[0].song_id,
                    playlist[0].position,
                    playlist[0].is_offline
                ),
                ("song0001", 1, expected)
            );
            assert_eq!(
                (
                    &*playlist[1].song_id,
                    playlist[1].position,
                    playlist[1].is_offline
                ),
                ("song0002", 2, false)
            );
            assert_eq!(sqlx::query_scalar!(
                r#"SELECT is_offline AS "is_offline!: bool" FROM video_query_view WHERE id = 'video001'"#
            ).fetch_one(&pool).await.unwrap(), expected);
        }
    }

    #[tokio::test]
    async fn equally_relevant_search_matches_prefer_available_before_limit_and_offset() {
        let pool = fixture().await;
        source(&pool, "disk", "/mnt/disk", "").await;
        status(&pool, "disk", "offline").await;
        for index in 0..102 {
            let blob_id = format!("blob{index:04}");
            let song_id = format!("song{index:04}");
            let video_id = format!("video{index:04}");
            let path = format!("/mnt/disk/{index}.mp4");
            blob(&pool, &blob_id, Some(&path)).await;
            sqlx::query!(
                "INSERT INTO songz (id, media_blob_id, title) VALUES (?, ?, 'needle')",
                song_id,
                blob_id
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query!(
                "INSERT INTO videoz (id, media_blob_id, title) VALUES (?, ?, 'needle')",
                video_id,
                blob_id
            )
            .execute(&pool)
            .await
            .unwrap();
        }
        blob(&pool, "online01", Some("/internal/film.mp4")).await;
        sqlx::query!(
            "INSERT INTO songz (id, media_blob_id, title) VALUES
            ('songlive', 'online01', 'needle')"
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query!(
            "INSERT INTO videoz (id, media_blob_id, title) VALUES
            ('vidolive', 'online01', 'needle')"
        )
        .execute(&pool)
        .await
        .unwrap();

        let songs = crate::search::queries::search_songs(&pool, "needle", None, None, 1, 0)
            .await
            .unwrap();
        let videos = crate::video::search::search_videos(&pool, "needle", None, 1, 0)
            .await
            .unwrap();
        assert_eq!(songs[0].id, "songlive");
        assert!(!songs[0].is_offline);
        assert_eq!(videos[0].id, "vidolive");
        assert!(!videos[0].is_offline);
        let songs = crate::search::queries::search_songs(&pool, "needle", None, None, 200, 1)
            .await
            .unwrap();
        let videos = crate::video::search::search_videos(&pool, "needle", None, 200, 1)
            .await
            .unwrap();
        assert_eq!(songs.len(), 102);
        assert_eq!(videos.len(), 102);
        assert!(songs.iter().all(|row| row.is_offline));
        assert!(videos.iter().all(|row| row.is_offline));
        for suggestions in [
            crate::search::suggestions::get_song_suggestions(&pool, "needle", None)
                .await
                .unwrap(),
            crate::video::search::get_video_suggestions(&pool, "needle", None)
                .await
                .unwrap(),
        ] {
            assert_eq!(suggestions.len(), 100);
            assert!(!suggestions[0].is_offline);
            assert!(suggestions[1..].iter().all(|row| row.is_offline));
        }
        status(&pool, "disk", "online").await;
        let songs = crate::search::queries::search_songs(&pool, "needle", None, None, 200, 0)
            .await
            .unwrap();
        assert_eq!(songs.len(), 103);
        assert!(songs.iter().all(|row| !row.is_offline));
        assert_ne!(songs[0].id, "songlive");
        let videos = crate::video::search::search_videos(&pool, "needle", None, 200, 0)
            .await
            .unwrap();
        assert_eq!(videos.len(), 103);
        assert!(videos.iter().all(|row| !row.is_offline));
        assert_ne!(videos[0].id, "vidolive");
    }

    async fn container(pool: &SqlitePool, id: &str, title: &str) {
        sqlx::query!("INSERT INTO albumz (id, title) VALUES (?, ?)", id, title)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query!("INSERT INTO artistz (id, name) VALUES (?, ?)", id, title)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query!(
            "INSERT INTO video_seriez (id, title) VALUES (?, ?)",
            id,
            title
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query!(
            "INSERT INTO playlistz (id, title, created_by) VALUES (?, ?, 'tester')",
            id,
            title
        )
        .execute(pool)
        .await
        .unwrap();
    }

    async fn attach(pool: &SqlitePool, container_id: &str, song_id: &str, video_id: &str) {
        sqlx::query!(
            "INSERT INTO album_songz (album_id, song_id) VALUES (?, ?)",
            container_id,
            song_id
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query!(
            "INSERT INTO artist_songz (artist_id, song_id) VALUES (?, ?)",
            container_id,
            song_id
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query!(
            "UPDATE videoz SET series_id = ? WHERE id = ?",
            container_id,
            video_id
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query!(
            "INSERT INTO playlist_itemz (playlist_id, entity_type, entity_id, position) VALUES
            (?, 'song', ?, 0), (?, 'video', ?, 0)",
            container_id,
            song_id,
            container_id,
            video_id
        )
        .execute(pool)
        .await
        .unwrap();
    }

    async fn container_flags(pool: &SqlitePool, id: &str) -> Vec<String> {
        sqlx::query_scalar!(
            r#"SELECT entity_type AS "entity_type!: String" FROM library_offline_container_view
               WHERE entity_id = ? ORDER BY entity_type"#,
            id
        )
        .fetch_all(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn container_rule_handles_empty_mixed_deleted_unknown_and_sync_media() {
        let pool = fixture().await;
        source(&pool, "disk", "/mnt/disk", "").await;
        source(&pool, "unknown", "/mnt/unknown", "").await;
        status(&pool, "disk", "offline").await;
        for id in ["offline1", "empty001", "mixed001", "unknown1"] {
            container(&pool, id, "needle").await;
        }
        for (id, path) in [
            ("offline1", "/mnt/disk/media"),
            ("local001", "/internal/media"),
            ("unknown1", "/mnt/unknown/media"),
        ] {
            blob(&pool, id, Some(path)).await;
            sqlx::query!(
                "INSERT INTO songz (id, media_blob_id, title) VALUES (?, ?, 'needle')",
                id,
                id
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query!(
                "INSERT INTO videoz (id, media_blob_id, title) VALUES (?, ?, 'needle')",
                id,
                id
            )
            .execute(&pool)
            .await
            .unwrap();
        }
        attach(&pool, "offline1", "offline1", "offline1").await;
        attach(&pool, "mixed001", "offline1", "local001").await;
        attach(&pool, "unknown1", "unknown1", "unknown1").await;
        // attach repoints each video's series; restore the offline series.
        sqlx::query!("UPDATE videoz SET series_id = 'offline1' WHERE id = 'offline1'")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            container_flags(&pool, "offline1").await,
            ["album", "artist", "playlist", "video_series"]
        );
        assert!(container_flags(&pool, "empty001").await.is_empty());
        // artist/album need an actual available member, not only a series relation.
        sqlx::query!("INSERT INTO album_songz VALUES ('mixed001', 'local001')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query!("INSERT INTO artist_songz VALUES ('mixed001', 'local001')")
            .execute(&pool)
            .await
            .unwrap();
        assert!(container_flags(&pool, "mixed001").await.is_empty());
        assert!(container_flags(&pool, "unknown1").await.is_empty());
        sqlx::query!("UPDATE songz SET deleted_at = 1 WHERE id = 'local001'")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query!("UPDATE videoz SET deleted_at = 1 WHERE id = 'local001'")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            container_flags(&pool, "mixed001").await,
            ["album", "artist", "playlist"]
        );
        sqlx::query!(
            "INSERT INTO playlist_itemz (playlist_id, entity_type, entity_id, position)
            VALUES ('offline1', 'future_kind', 'unresolved', 0)"
        )
        .execute(&pool)
        .await
        .unwrap();
        assert!(!container_flags(&pool, "offline1")
            .await
            .contains(&"playlist".into()));
        crate::external_storage::sync_priority::replace_targets(
            &pool,
            "charnel",
            &[crate::external_storage::sync_priority::SyncTarget {
                device_id: "sync".into(),
                volume_uuid: None,
                path: "/mnt/disk".into(),
            }],
        )
        .await
        .unwrap();
        assert!(container_flags(&pool, "offline1").await.is_empty());
        assert!(container_flags(&pool, "mixed001").await.is_empty());
    }

    #[tokio::test]
    async fn video_only_music_containers_use_live_media_not_artwork_or_deleted_members() {
        let pool = fixture().await;
        source(&pool, "disk", "/mnt/disk", "").await;
        status(&pool, "disk", "offline").await;
        container(&pool, "videoalb", "music videos").await;
        blob(&pool, "videoblb", Some("/mnt/disk/video.mp4")).await;
        blob(&pool, "artwork1", Some("/internal/poster.jpg")).await;
        sqlx::query!(
            "INSERT INTO videoz (id, title, media_blob_id, content_type, album_id, poster_blob_id)
            VALUES ('video001', 'video', 'videoblb', 'music_video', 'videoalb', 'artwork1')"
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query!("INSERT INTO artist_albumz VALUES ('videoalb', 'videoalb')")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            container_flags(&pool, "videoalb").await,
            ["album", "artist"]
        );
        sqlx::query!("UPDATE videoz SET artist_id = 'videoalb', album_id = NULL")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(container_flags(&pool, "videoalb").await, ["artist"]);
        sqlx::query!("UPDATE videoz SET deleted_at = 1")
            .execute(&pool)
            .await
            .unwrap();
        assert!(container_flags(&pool, "videoalb").await.is_empty());
    }

    #[tokio::test]
    async fn artist_album_membership_ignores_deleted_albums_and_containers() {
        let pool = fixture().await;
        source(&pool, "disk", "/mnt/disk", "").await;
        status(&pool, "disk", "offline").await;
        container(&pool, "music001", "music").await;
        blob(&pool, "songblob", Some("/mnt/disk/song.flac")).await;
        sqlx::query!(
            "INSERT INTO songz (id, media_blob_id, title) VALUES ('song0001', 'songblob', 'song')"
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query!("INSERT INTO album_songz VALUES ('music001', 'song0001')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query!("INSERT INTO artist_albumz VALUES ('music001', 'music001')")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            container_flags(&pool, "music001").await,
            ["album", "artist"]
        );
        sqlx::query!("UPDATE albumz SET deleted_at = 1 WHERE id = 'music001'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(container_flags(&pool, "music001").await.is_empty());
        sqlx::query!("INSERT INTO artist_songz VALUES ('music001', 'song0001')")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(container_flags(&pool, "music001").await, ["artist"]);
        sqlx::query!("UPDATE artistz SET deleted_at = 1 WHERE id = 'music001'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(container_flags(&pool, "music001").await.is_empty());
        assert_eq!(
            sqlx::query_scalar!("SELECT COUNT(*) FROM songz WHERE deleted_at IS NULL")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn container_read_views_survive_restarts_and_repair_missing_dependencies() {
        let pool = fixture().await;
        source(&pool, "disk", "/mnt/disk", "").await;
        container(&pool, "offline1", "offline").await;
        container(&pool, "empty001", "empty").await;
        blob(&pool, "blob0001", Some("/mnt/disk/media")).await;
        sqlx::query!(
            "INSERT INTO songz (id, title, media_blob_id) VALUES ('song0001', 'song', 'blob0001')"
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query!(
            "INSERT INTO videoz (id, title, media_blob_id) VALUES ('video001', 'video', 'blob0001')"
        )
        .execute(&pool)
        .await
        .unwrap();
        attach(&pool, "offline1", "song0001", "video001").await;
        // reproduce an already-migrated database damaged by the old startup path.
        sqlx::raw_sql(
            "DROP VIEW library_offline_container_view;
             DROP VIEW library_container_media_view;
             DROP VIEW library_offline_blob_view;
             DROP VIEW library_sync_source_view;
             DROP VIEW library_source_blob_path_view;",
        )
        .execute(&pool)
        .await
        .unwrap();
        for (state, expected) in [("unknown", false), ("offline", true), ("online", false)] {
            crate::database::run_schema_migrations(&pool).await.unwrap();
            // membership triggers must still work after each restart, not just reads.
            let id = format!("blob-{state}");
            blob(&pool, &id, Some("/mnt/disk/new-media")).await;
            assert_eq!(memberships(&pool, &id).await, ["disk"]);
            sqlx::query!(
                "UPDATE media_blobz SET local_path = '/internal/media' WHERE id = ?",
                id
            )
            .execute(&pool)
            .await
            .unwrap();
            assert!(memberships(&pool, &id).await.is_empty());
            status(&pool, "disk", state).await;
            let response = crate::music::crud::query_playlists_with_pool(
                pool.clone(),
                crate::music::crud::QueryParams::default(),
            )
            .await;
            assert!(response.success, "{response:?}");
            let playlists = response.data.unwrap().items;
            assert_eq!(playlists.len(), 2);
            assert_eq!(
                playlists
                    .iter()
                    .find(|p| p.playlist.id == "offline1")
                    .unwrap()
                    .is_offline,
                expected
            );
            let albums = sqlx::query!(
                r#"SELECT album_id AS "id!", is_offline AS "is_offline!: bool"
                   FROM album_query_view ORDER BY album_id"#
            )
            .fetch_all(&pool)
            .await
            .unwrap();
            let artists = sqlx::query!(
                r#"SELECT artist_id AS "id!", is_offline AS "is_offline!: bool"
                   FROM artist_query_view ORDER BY artist_id"#
            )
            .fetch_all(&pool)
            .await
            .unwrap();
            let playlists = sqlx::query!(
                r#"SELECT playlist_id AS "id!", is_offline AS "is_offline!: bool",
                          playlist_song_count AS "song_count!"
                   FROM playlist_query_view ORDER BY playlist_id"#
            )
            .fetch_all(&pool)
            .await
            .unwrap();
            assert_eq!(
                albums
                    .iter()
                    .map(|r| (&*r.id, r.is_offline))
                    .collect::<Vec<_>>(),
                [("offline1", expected)]
            );
            assert_eq!(
                artists
                    .iter()
                    .map(|r| (&*r.id, r.is_offline))
                    .collect::<Vec<_>>(),
                [("offline1", expected)]
            );
            assert_eq!(
                playlists
                    .iter()
                    .map(|r| (&*r.id, r.is_offline, r.song_count))
                    .collect::<Vec<_>>(),
                [("empty001", false, 0), ("offline1", expected, 1)]
            );
            let series = sqlx::query_as!(
                crate::video::entities::series::VideoSeries,
                r#"SELECT id AS "id!", title AS "title!", description, poster_blob_id,
                   created_at AS "created_at!", updated_at AS "updated_at!",
                   deleted_at, deleted_by, created_by, updated_by,
                   EXISTS (SELECT 1 FROM library_offline_container_view o
                           WHERE o.entity_type = 'video_series' AND o.entity_id = video_seriez.id)
                           AS "is_offline!: bool"
                   FROM video_seriez ORDER BY id"#
            )
            .fetch_all(&pool)
            .await
            .unwrap();
            assert_eq!(
                series
                    .iter()
                    .map(|r| (&*r.id, r.is_offline))
                    .collect::<Vec<_>>(),
                [("empty001", false), ("offline1", expected)]
            );
        }
        status(&pool, "disk", "offline").await;
        assert!(sqlx::query_scalar!(
            r#"UPDATE video_seriez SET title = 'edited' WHERE id = 'offline1'
               RETURNING EXISTS (SELECT 1 FROM library_offline_container_view o
                   WHERE o.entity_type = 'video_series' AND o.entity_id = video_seriez.id)
                   AS "is_offline!: bool""#
        )
        .fetch_one(&pool)
        .await
        .unwrap());
        assert!(!sqlx::query_scalar!(
            r#"INSERT INTO video_seriez (id, title) VALUES ('created1', 'new')
               RETURNING EXISTS (SELECT 1 FROM library_offline_container_view o
                   WHERE o.entity_type = 'video_series' AND o.entity_id = video_seriez.id)
                   AS "is_offline!: bool""#
        )
        .fetch_one(&pool)
        .await
        .unwrap());
    }

    #[tokio::test]
    async fn browse_filters_apply_before_counts_and_pages_without_affecting_default_reads() {
        use crate::music::crud::{self, QueryParams};
        use crate::video::crud::query as video;
        let pool = fixture().await;
        source(&pool, "disk", "/mnt/disk", "").await;
        source(&pool, "unknown", "/mnt/unknown", "").await;
        status(&pool, "disk", "offline").await;
        for (id, path) in [
            ("aoffline", "/mnt/disk/media"),
            ("bunknown", "/mnt/unknown/media"),
            ("conline1", "/internal/media"),
        ] {
            container(&pool, id, id).await;
            blob(&pool, id, Some(path)).await;
            sqlx::query!(
                "INSERT INTO songz (id, title, media_blob_id) VALUES (?, ?, ?)",
                id,
                id,
                id
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query!(
                "INSERT INTO videoz (id, title, media_blob_id) VALUES (?, ?, ?)",
                id,
                id,
                id
            )
            .execute(&pool)
            .await
            .unwrap();
            attach(&pool, id, id, id).await;
        }
        for hide in [None, Some(false), Some(true)] {
            let mut params = QueryParams {
                limit: Some(1),
                offset: Some(1),
                sort_by: Some("title".into()),
                sort_direction: Some("asc".into()),
                ..Default::default()
            };
            if let Some(hide) = hide {
                params
                    .filters
                    .insert("hide_offline".into(), serde_json::json!(hide));
            }
            let expected_count = if hide == Some(true) { 2 } else { 3 };
            let expected_id = if hide == Some(true) {
                "conline1"
            } else {
                "bunknown"
            };
            let expected_more = hide != Some(true);
            let songs = crud::query_songs_with_pool(pool.clone(), params.clone()).await;
            assert!(songs.success, "{songs:?}");
            let songs = songs.data.unwrap();
            let albums = crud::query_albums_with_pool(pool.clone(), params.clone()).await;
            assert!(albums.success, "{albums:?}");
            let albums = albums.data.unwrap();
            let artists = crud::query_artists_with_pool(pool.clone(), params.clone()).await;
            assert!(artists.success, "{artists:?}");
            let artists = artists.data.unwrap();
            let videos =
                video::query_videos_with_pool(pool.clone(), params.clone(), None, None, false)
                    .await;
            assert!(videos.success, "{videos:?}");
            let videos = videos.data.unwrap();
            let series = video::query_video_seriez_with_pool(pool.clone(), params.clone()).await;
            assert!(series.success, "{series:?}");
            let series = series.data.unwrap();
            for (count, more, ids) in [
                (
                    songs.total_count,
                    songs.has_more,
                    songs.items.iter().map(|s| &*s.song.id).collect::<Vec<_>>(),
                ),
                (
                    albums.total_count,
                    albums.has_more,
                    albums.items.iter().map(|s| &*s.album.id).collect(),
                ),
                (
                    artists.total_count,
                    artists.has_more,
                    artists.items.iter().map(|s| &*s.artist.id).collect(),
                ),
                (
                    videos.total_count,
                    videos.has_more,
                    videos.items.iter().map(|s| &*s.id).collect(),
                ),
                (
                    series.total_count,
                    series.has_more,
                    series.items.iter().map(|s| &*s.id).collect(),
                ),
            ] {
                assert_eq!(
                    (count, more, ids),
                    (expected_count, expected_more, vec![expected_id])
                );
            }
            let counts = crud::query_album_status_counts_with_pool(pool.clone(), params).await;
            assert!(counts.success, "{counts:?}");
            assert_eq!(counts.data.unwrap().total, expected_count);
        }
        status(&pool, "disk", "online").await;
        let mut params = QueryParams::default();
        params
            .filters
            .insert("hide_offline".into(), serde_json::json!(true));
        let songs = crud::query_songs_with_pool(pool.clone(), params)
            .await
            .data
            .unwrap();
        assert_eq!(songs.total_count, 3);
        assert_eq!(songs.items.len(), 3);
    }

    #[tokio::test]
    async fn radio_selection_and_direct_fetch_exclude_offline_media_without_losing_candidates() {
        use crate::radio::playlist::{
            fetch_track_with_pool, pick_random_song_with_pool, retain_available_candidates,
            RadioItemKind,
        };
        let pool = fixture().await;
        source(&pool, "disk", "/mnt/disk", "").await;
        blob(&pool, "songblob", Some("/mnt/disk/song")).await;
        blob(&pool, "videoblb", Some("/mnt/disk/video")).await;
        sqlx::query!(
            "INSERT INTO songz (id, title, media_blob_id) VALUES ('song0001', 'song', 'songblob')"
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query!(
            "INSERT INTO videoz (id, title, media_blob_id) VALUES ('video001', 'video', 'videoblb')"
        )
        .execute(&pool)
        .await
        .unwrap();

        for state in ["unknown", "offline", "online"] {
            status(&pool, "disk", state).await;
            let available = state != "offline";
            for (kind, id) in [
                (RadioItemKind::Song, "song0001"),
                (RadioItemKind::Video, "video001"),
            ] {
                assert_eq!(
                    fetch_track_with_pool(&pool, kind, id).await.is_ok(),
                    available,
                    "{state}: {kind:?}"
                );
            }
            assert_eq!(pick_random_song_with_pool(&pool).await.is_ok(), available);
            let mut songs = vec!["song0001".to_string()];
            let mut videos = vec!["video001".to_string()];
            retain_available_candidates(&pool, &mut songs, &mut videos)
                .await
                .unwrap();
            assert_eq!(songs.len(), usize::from(available));
            assert_eq!(videos.len(), usize::from(available));
        }

        status(&pool, "disk", "offline").await;
        source(&pool, "unknown", "/mnt/unknown", "").await;
        for (id, path) in [
            ("unknown1", "/mnt/unknown/media"),
            ("internal", "/internal/media"),
        ] {
            blob(&pool, id, Some(path)).await;
            sqlx::query!(
                "INSERT INTO songz (id, title, media_blob_id) VALUES (?, ?, ?)",
                id,
                id,
                id
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query!(
                "INSERT INTO videoz (id, title, media_blob_id) VALUES (?, ?, ?)",
                id,
                id,
                id
            )
            .execute(&pool)
            .await
            .unwrap();
        }
        let original = vec![
            "internal".to_string(),
            "song0001".to_string(),
            "unknown1".to_string(),
            "internal".to_string(),
        ];
        let mut songs = original.clone();
        let mut videos = vec!["video001".to_string(), "unknown1".to_string()];
        retain_available_candidates(&pool, &mut songs, &mut videos)
            .await
            .unwrap();
        assert_eq!(songs, ["internal", "unknown1", "internal"]);
        assert_eq!(videos, ["unknown1"]);
        // never widen an explicit source to unrelated available library media.
        let mut only_offline = vec!["song0001".to_string()];
        retain_available_candidates(&pool, &mut only_offline, &mut Vec::new())
            .await
            .unwrap();
        assert!(only_offline.is_empty());
        for _ in 0..10 {
            assert_ne!(
                pick_random_song_with_pool(&pool).await.unwrap().song_id,
                "song0001"
            );
        }

        sqlx::query!(
            "INSERT INTO storage_sync_targetz (owner, device_id, path) VALUES ('test', 'disk', '/mnt/disk')"
        )
        .execute(&pool)
        .await
        .unwrap();
        let mut songs = original.clone();
        retain_available_candidates(&pool, &mut songs, &mut Vec::new())
            .await
            .unwrap();
        assert_eq!(songs, original);
        assert!(
            fetch_track_with_pool(&pool, RadioItemKind::Video, "video001")
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn offline_only_probes_find_confirmed_offline_across_music_and_video() {
        use crate::music::crud::{self, QueryParams};
        use crate::video::crud::query as video;
        let pool = fixture().await;
        source(&pool, "disk", "/mnt/disk", "").await;
        container(&pool, "offline1", "offline").await;
        blob(&pool, "blob0001", Some("/mnt/disk/media")).await;
        sqlx::query!(
            "INSERT INTO songz (id, title, media_blob_id) VALUES ('song0001', 'song', 'blob0001')"
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query!("INSERT INTO videoz (id, title, media_blob_id) VALUES ('video001', 'video', 'blob0001')")
            .execute(&pool).await.unwrap();
        attach(&pool, "offline1", "song0001", "video001").await;
        for state in ["unknown", "offline", "online"] {
            status(&pool, "disk", state).await;
            let mut params = QueryParams {
                limit: Some(1),
                ..Default::default()
            };
            params
                .filters
                .insert("offline_only".into(), serde_json::json!(true));
            let songs = crud::query_songs_with_pool(pool.clone(), params.clone())
                .await
                .data
                .unwrap();
            let albums = crud::query_albums_with_pool(pool.clone(), params.clone())
                .await
                .data
                .unwrap();
            let artists = crud::query_artists_with_pool(pool.clone(), params.clone())
                .await
                .data
                .unwrap();
            let videos =
                video::query_videos_with_pool(pool.clone(), params.clone(), None, None, false)
                    .await
                    .data
                    .unwrap();
            let series = video::query_video_seriez_with_pool(pool.clone(), params)
                .await
                .data
                .unwrap();
            let expected = usize::from(state == "offline");
            for size in [
                songs.items.len(),
                albums.items.len(),
                artists.items.len(),
                videos.items.len(),
                series.items.len(),
            ] {
                assert_eq!(size, expected, "{state}");
            }
        }
    }

    #[tokio::test]
    async fn container_lookup_uses_member_indexes_instead_of_full_library_scans() {
        let pool = fixture().await;
        let plan = sqlx::query!(
            "EXPLAIN QUERY PLAN SELECT EXISTS (SELECT 1 FROM library_offline_container_view
             WHERE entity_type = 'album' AND entity_id = 'album001')"
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        let details = plan
            .iter()
            .map(|row| row.detail.as_deref().unwrap())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(details.contains("(album_id=?)"), "{details}");
        assert!(details.contains("idx_videoz_album_id"), "{details}");
        for row in &plan {
            let words = row
                .detail
                .as_deref()
                .unwrap()
                .split_whitespace()
                .collect::<Vec<_>>();
            if words.first() == Some(&"SCAN") {
                assert!(
                    !["albumz", "songz", "videoz", "a", "s", "v", "p"].contains(&words[1]),
                    "{details}"
                );
            }
        }
    }

    #[tokio::test]
    async fn container_search_and_suggestions_rank_before_limits_without_dropping_offline_matches()
    {
        let pool = fixture().await;
        source(&pool, "disk", "/mnt/disk", "").await;
        status(&pool, "disk", "offline").await;
        blob(&pool, "blob0001", Some("/mnt/disk/media")).await;
        sqlx::query!(
            "INSERT INTO songz (id, media_blob_id, title) VALUES ('song0001', 'blob0001', 'song')"
        )
        .execute(&pool)
        .await
        .unwrap();
        for index in 0..102 {
            let id = format!("item{index:04}");
            let video_id = format!("vid{index:05}");
            container(&pool, &id, "needle").await;
            // videoz requires unique blob references.
            let blob_id = format!("blob{index:05}");
            blob(&pool, &blob_id, Some("/mnt/disk/film")).await;
            sqlx::query!(
                "INSERT INTO videoz (id, media_blob_id, title) VALUES (?, ?, 'film')",
                video_id,
                blob_id
            )
            .execute(&pool)
            .await
            .unwrap();
            attach(&pool, &id, "song0001", &video_id).await;
        }
        container(&pool, "available", "needle").await;
        let albums = crate::search::queries::search_albums(&pool, "needle", None, None, 1, 0)
            .await
            .unwrap();
        let artists = crate::search::queries::search_artists(&pool, "needle", None, None, 1, 0)
            .await
            .unwrap();
        let playlists = crate::search::queries::search_playlists(&pool, "needle", None, None, 1, 0)
            .await
            .unwrap();
        let series = crate::video::search::search_video_seriez(&pool, "needle", 1, 0)
            .await
            .unwrap();
        assert_eq!((&*albums[0].id, albums[0].is_offline), ("available", false));
        assert_eq!(
            (&*artists[0].id, artists[0].is_offline),
            ("available", false)
        );
        assert_eq!(
            (&*playlists[0].id, playlists[0].is_offline),
            ("available", false)
        );
        assert_eq!((&*series[0].id, series[0].is_offline), ("available", false));
        let albums = crate::search::queries::search_albums(&pool, "needle", None, None, 200, 1)
            .await
            .unwrap();
        let artists = crate::search::queries::search_artists(&pool, "needle", None, None, 200, 1)
            .await
            .unwrap();
        let playlists =
            crate::search::queries::search_playlists(&pool, "needle", None, None, 200, 1)
                .await
                .unwrap();
        let series = crate::video::search::search_video_seriez(&pool, "needle", 200, 1)
            .await
            .unwrap();
        for flags in [
            albums.iter().map(|row| row.is_offline).collect::<Vec<_>>(),
            artists.iter().map(|row| row.is_offline).collect(),
            playlists.iter().map(|row| row.is_offline).collect(),
            series.iter().map(|row| row.is_offline).collect(),
        ] {
            assert_eq!(flags.len(), 102);
            assert!(flags.iter().all(|flag| *flag));
        }
        for rows in [
            crate::search::suggestions::get_album_suggestions(&pool, "needle", None)
                .await
                .unwrap(),
            crate::search::suggestions::get_artist_suggestions(&pool, "needle", None)
                .await
                .unwrap(),
            crate::search::suggestions::get_playlist_suggestions(&pool, "needle", None)
                .await
                .unwrap(),
            crate::video::search::get_video_series_suggestions(&pool, "needle")
                .await
                .unwrap(),
        ] {
            assert_eq!(rows.len(), 100);
            assert_eq!(rows[0].entity_id, "available");
            assert!(!rows[0].is_offline);
            assert!(rows[1..].iter().all(|row| row.is_offline));
        }
        status(&pool, "disk", "online").await;
        assert!(container_flags(&pool, "item0000").await.is_empty());
    }

    #[tokio::test]
    async fn offline_exact_matches_beat_weak_available_matches_across_search_and_candidates() {
        let pool = fixture().await;
        source(&pool, "disk", "/mnt/disk", "").await;
        status(&pool, "disk", "offline").await;
        for (id, title, path) in [
            ("offline1", "needle", "/mnt/disk/offline"),
            ("equal001", "needle", "/internal/equal"),
            (
                "weak0001",
                "needle in a much longer title with several other words",
                "/internal/weak",
            ),
        ] {
            container(&pool, id, title).await;
            blob(&pool, id, Some(path)).await;
            sqlx::query!(
                "INSERT INTO songz (id, title, media_blob_id) VALUES (?, ?, ?)",
                id,
                title,
                id
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query!(
                "INSERT INTO videoz (id, title, media_blob_id) VALUES (?, ?, ?)",
                id,
                title,
                id
            )
            .execute(&pool)
            .await
            .unwrap();
            attach(&pool, id, id, id).await;
        }
        let songs = crate::search::queries::search_songs(&pool, "needle", None, None, 2, 0)
            .await
            .unwrap();
        let albums = crate::search::queries::search_albums(&pool, "needle", None, None, 2, 0)
            .await
            .unwrap();
        let artists = crate::search::queries::search_artists(&pool, "needle", None, None, 2, 0)
            .await
            .unwrap();
        let playlists = crate::search::queries::search_playlists(&pool, "needle", None, None, 2, 0)
            .await
            .unwrap();
        let videos = crate::video::search::search_videos(&pool, "needle", None, 2, 0)
            .await
            .unwrap();
        let series = crate::video::search::search_video_seriez(&pool, "needle", 2, 0)
            .await
            .unwrap();
        for rows in [
            songs
                .iter()
                .map(|s| (&*s.id, s.is_offline))
                .collect::<Vec<_>>(),
            albums.iter().map(|s| (&*s.id, s.is_offline)).collect(),
            artists.iter().map(|s| (&*s.id, s.is_offline)).collect(),
            playlists.iter().map(|s| (&*s.id, s.is_offline)).collect(),
            videos.iter().map(|s| (&*s.id, s.is_offline)).collect(),
            series.iter().map(|s| (&*s.id, s.is_offline)).collect(),
        ] {
            assert_eq!(rows, [("equal001", false), ("offline1", true)]);
        }
        for rows in [
            crate::search::suggestions::get_song_suggestions(&pool, "needle", None)
                .await
                .unwrap(),
            crate::search::suggestions::get_album_suggestions(&pool, "needle", None)
                .await
                .unwrap(),
            crate::search::suggestions::get_artist_suggestions(&pool, "needle", None)
                .await
                .unwrap(),
            crate::search::suggestions::get_playlist_suggestions(&pool, "needle", None)
                .await
                .unwrap(),
            crate::video::search::get_video_suggestions(&pool, "needle", None)
                .await
                .unwrap(),
            crate::video::search::get_video_series_suggestions(&pool, "needle")
                .await
                .unwrap(),
        ] {
            assert_eq!(
                rows.iter()
                    .map(|s| (&*s.entity_id, s.is_offline))
                    .collect::<Vec<_>>(),
                [("equal001", false), ("offline1", true), ("weak0001", false)]
            );
        }
    }
}
