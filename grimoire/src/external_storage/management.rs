//! host-side source settings, scan discovery and library-only removal.

use crate::{GrimoireError, GrimoireResult};
use serde::Serialize;
use sqlx::{FromRow, SqlitePool};
use zod_gen_derive::ZodSchema;

#[derive(Debug, Serialize, ZodSchema)]
pub struct LibrarySourceSummary {
    pub source_id: String,
    pub music_count: i64,
    pub video_count: i64,
    pub tags: Vec<String>,
    pub generate_renditions: bool,
}

#[derive(Debug, Serialize, FromRow, ZodSchema)]
pub struct ActiveLibraryScan {
    pub session_id: String,
    pub path: String,
}

#[derive(Debug, Serialize, ZodSchema)]
pub struct LibraryRenditionSettings {
    pub enabled: bool,
    pub directory: String,
}

pub fn rendition_settings() -> LibraryRenditionSettings {
    let config = crate::config::get_config();
    LibraryRenditionSettings {
        enabled: config.media.transcode_video_enabled
            && !config.media.video_transcode_renditions.is_empty(),
        directory: config.renditions_dir().to_string_lossy().into_owned(),
    }
}

pub async fn summaries(pool: &SqlitePool) -> GrimoireResult<Vec<LibrarySourceSummary>> {
    let mut result = Vec::new();
    let targets = super::sync_priority::list_targets(pool).await?;
    for source in super::sources::list_sources(pool).await? {
        if super::sync_priority::is_sync_source(&targets, &source) {
            continue;
        }
        let music_count = sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM songz s JOIN library_source_mediaz m ON m.blob_id=s.media_blob_id
             WHERE m.source_id=? AND s.deleted_at IS NULL",
        )
        .bind(&source.id)
        .fetch_one(pool)
        .await?;
        let video_count = sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM videoz v JOIN library_source_mediaz m ON m.blob_id=v.media_blob_id
             WHERE m.source_id=? AND v.deleted_at IS NULL",
        ).bind(&source.id).fetch_one(pool).await?;
        let tags = sqlx::query_scalar::<_, String>(
            "SELECT DISTINCT t.name FROM directory_tag_rules r JOIN tagz t ON t.id=r.tag_id
             WHERE r.directory_path=? ORDER BY t.name",
        )
        .bind(&source.last_known_path)
        .fetch_all(pool)
        .await?;
        let generate_renditions = sqlx::query_scalar::<_, bool>(
            "SELECT generate_renditions FROM library_sourcez WHERE id=?",
        )
        .bind(&source.id)
        .fetch_one(pool)
        .await?;
        result.push(LibrarySourceSummary {
            source_id: source.id,
            music_count,
            video_count,
            tags,
            generate_renditions,
        });
    }
    Ok(result)
}

pub async fn active_scans(pool: &SqlitePool) -> GrimoireResult<Vec<ActiveLibraryScan>> {
    Ok(sqlx::query_as::<_, ActiveLibraryScan>(
        "SELECT j.session_id, COALESCE(json_extract(j.parameters,'$.directory_path'),
                   json_extract(j.parameters,'$.directory'),json_extract(j.parameters,'$.path'),
                   json_extract(j.parameters,'$.file_path'),'') AS path
         FROM jobz j WHERE j.session_id IS NOT NULL AND j.job_type IN ('ScanDirectory','ProcessDirectory','ProcessFile')
           AND EXISTS (SELECT 1 FROM jobz a WHERE a.session_id=j.session_id AND a.status IN ('Pending','Running'))
           AND NOT EXISTS (SELECT 1 FROM jobz r WHERE r.session_id=j.session_id AND r.job_type IN ('RescanDirectories','RepairLibraryImages'))
         GROUP BY j.session_id ORDER BY min(j.scheduled_at), j.session_id",
    ).fetch_all(pool).await?)
}

pub async fn set_renditions(pool: &SqlitePool, id: &str, enabled: bool) -> GrimoireResult<()> {
    super::sources::get_source(pool, id).await?;
    sqlx::query("UPDATE library_sourcez SET generate_renditions=? WHERE id=?")
        .bind(enabled)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// checks every job, including reprocessing and queued jobs from before disconnect.
pub async fn transcode_allowed(pool: &SqlitePool, blob_id: &str) -> GrimoireResult<bool> {
    let blocked = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM library_source_mediaz m
         JOIN library_sourcez s ON s.id=m.source_id
         WHERE m.blob_id=? AND s.generate_renditions=0)
         OR EXISTS(SELECT 1 FROM library_offline_blob_view WHERE blob_id=?)",
    )
    .bind(blob_id)
    .bind(blob_id)
    .fetch_one(pool)
    .await?;
    Ok(!blocked)
}

/// refuses removal while library writers are active; never touches disk files.
pub async fn remove_source(pool: &SqlitePool, id: &str) -> GrimoireResult<()> {
    let _guard = super::availability::REFRESH_LOCK.lock().await;
    let source = super::sources::get_source(pool, id).await?;
    if super::sync_priority::is_sync_source(
        &super::sync_priority::list_targets(pool).await?,
        &source,
    ) {
        return Err(GrimoireError::Validation {
            field: "id".into(),
            message: "source is reserved for removable storage sync".into(),
        });
    }
    let mut tx = pool.begin().await?;
    // acquire the write lock before examining jobs or memberships.
    sqlx::query("UPDATE library_sourcez SET label=label WHERE id=?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let busy = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM jobz WHERE status IN ('Pending','Running')
         AND job_type IN ('ScanDirectory','ProcessDirectory','ProcessFile','TranscodeVideo','RescanDirectories','ReorganizeLibraryFiles'))",
    ).fetch_one(&mut *tx).await?;
    if busy {
        return Err(GrimoireError::Validation {
            field: "id".into(),
            message:
                "wait for library scans, imports and transcodes to finish before removing a disk"
                    .into(),
        });
    }
    for table in ["songz", "videoz"] {
        sqlx::query(&format!(
            "UPDATE {table} SET deleted_at=unixepoch() WHERE deleted_at IS NULL
             AND media_blob_id IN (SELECT m.blob_id FROM library_source_mediaz m WHERE m.source_id=?
               AND NOT EXISTS(SELECT 1 FROM library_source_mediaz other
                              WHERE other.blob_id=m.blob_id AND other.source_id!=?))"
        ))
        .bind(id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        "UPDATE albumz SET deleted_at=unixepoch() WHERE deleted_at IS NULL
         AND (id IN (SELECT a.album_id FROM album_songz a JOIN songz s ON s.id=a.song_id
                     JOIN library_source_mediaz m ON m.blob_id=s.media_blob_id WHERE m.source_id=?)
              OR id IN (SELECT v.album_id FROM videoz v JOIN library_source_mediaz m ON m.blob_id=v.media_blob_id WHERE m.source_id=?))
         AND NOT EXISTS(SELECT 1 FROM album_songz a JOIN songz s ON s.id=a.song_id WHERE a.album_id=albumz.id AND s.deleted_at IS NULL)
         AND NOT EXISTS(SELECT 1 FROM videoz v WHERE v.album_id=albumz.id AND v.deleted_at IS NULL)",
    ).bind(id).bind(id).execute(&mut *tx).await?;
    sqlx::query(
        "UPDATE artistz SET deleted_at=unixepoch() WHERE deleted_at IS NULL
         AND (id IN (SELECT a.artist_id FROM artist_songz a JOIN songz s ON s.id=a.song_id
                     JOIN library_source_mediaz m ON m.blob_id=s.media_blob_id WHERE m.source_id=?)
              OR id IN (SELECT v.artist_id FROM videoz v JOIN library_source_mediaz m ON m.blob_id=v.media_blob_id WHERE m.source_id=?)
              OR id IN (SELECT aa.artist_id FROM artist_albumz aa JOIN album_songz a ON a.album_id=aa.album_id
                        JOIN songz s ON s.id=a.song_id JOIN library_source_mediaz m ON m.blob_id=s.media_blob_id WHERE m.source_id=?))
         AND NOT EXISTS(SELECT 1 FROM artist_songz a JOIN songz s ON s.id=a.song_id WHERE a.artist_id=artistz.id AND s.deleted_at IS NULL)
         AND NOT EXISTS(SELECT 1 FROM artist_albumz a JOIN albumz b ON b.id=a.album_id WHERE a.artist_id=artistz.id AND b.deleted_at IS NULL)
         AND NOT EXISTS(SELECT 1 FROM videoz v WHERE v.artist_id=artistz.id AND v.deleted_at IS NULL)",
    ).bind(id).bind(id).bind(id).execute(&mut *tx).await?;
    for (table, column) in [
        ("video_seasonz", "season_id"),
        ("video_seriez", "series_id"),
    ] {
        sqlx::query(&format!(
            "UPDATE {table} SET deleted_at=unixepoch() WHERE deleted_at IS NULL
             AND id IN (SELECT v.{column} FROM videoz v JOIN library_source_mediaz m ON m.blob_id=v.media_blob_id WHERE m.source_id=?)
             AND NOT EXISTS(SELECT 1 FROM videoz v WHERE v.{column}={table}.id AND v.deleted_at IS NULL)"
        )).bind(id).execute(&mut *tx).await?;
    }
    let roots: Vec<String> =
        sqlx::query_scalar("SELECT path FROM library_source_pathz WHERE source_id=?")
            .bind(id)
            .fetch_all(&mut *tx)
            .await?;
    let other_roots: Vec<String> =
        sqlx::query_scalar("SELECT path FROM library_source_pathz WHERE source_id!=?")
            .bind(id)
            .fetch_all(&mut *tx)
            .await?;
    let directories: Vec<String> = sqlx::query_scalar("SELECT path FROM scanned_directories")
        .fetch_all(&mut *tx)
        .await?;
    for path in directories {
        let pathbuf = std::path::Path::new(&path);
        if roots.iter().any(|root| pathbuf.starts_with(root))
            && !other_roots.iter().any(|root| {
                pathbuf.starts_with(root) || std::path::Path::new(root).starts_with(pathbuf)
            })
        {
            sqlx::query("DELETE FROM scanned_directories WHERE path=?")
                .bind(&path)
                .execute(&mut *tx)
                .await?;
            sqlx::query("DELETE FROM directory_tag_rules WHERE directory_path=?")
                .bind(&path)
                .execute(&mut *tx)
                .await?;
        }
    }
    sqlx::query("DELETE FROM library_sourcez WHERE id=?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    super::events::notify_changed();
    Ok(())
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
        sqlx::query("INSERT INTO library_sourcez(id,volume_key,relative_path,last_known_path) VALUES ('disk','disk','','/disk'),('other','other','','/other')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO library_source_pathz(source_id,path) VALUES ('disk','/disk'),('other','/other')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO media_blobz(id,local_path) VALUES ('songblob','/disk/song'),('videoblob','/disk/video'),('sharedblob','/disk/shared')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO songz(id,media_blob_id,title) VALUES ('song','songblob','song'),('shared','sharedblob','shared')")
            .execute(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO videoz(id,media_blob_id,title) VALUES ('video','videoblob','video')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO library_source_mediaz(blob_id,source_id) VALUES ('sharedblob','other')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO tagz(id,name) VALUES ('test-tag','fatty')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO directory_tag_rules(directory_path,tag_id) VALUES ('/disk','test-tag')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO albumz(id,title) VALUES ('exclusive-album','exclusive'),('shared-album','shared')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO album_songz(album_id,song_id) VALUES ('exclusive-album','song'),('shared-album','shared')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO scanned_directories(path,last_scanned_at) VALUES ('/disk',1),('/disk/nested',1),('/disk-other',1)")
            .execute(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn summaries_and_rendition_policy_preserve_defaults_and_offline_override() {
        let pool = fixture().await;
        let summary = summaries(&pool)
            .await
            .unwrap()
            .into_iter()
            .find(|s| s.source_id == "disk")
            .unwrap();
        assert_eq!((summary.music_count, summary.video_count), (2, 1));
        assert_eq!(summary.tags, ["fatty"]);
        assert!(summary.generate_renditions);
        assert!(transcode_allowed(&pool, "videoblob").await.unwrap());
        set_renditions(&pool, "disk", false).await.unwrap();
        assert!(!transcode_allowed(&pool, "videoblob").await.unwrap());
        set_renditions(&pool, "disk", true).await.unwrap();
        sqlx::query("INSERT INTO library_source_statez(source_id,status,checked_at,changed_at) VALUES ('disk','offline',1,1)")
            .execute(&pool).await.unwrap();
        assert!(!transcode_allowed(&pool, "videoblob").await.unwrap());
        assert!(transcode_allowed(&pool, "untracked").await.unwrap());
    }

    #[tokio::test]
    async fn removal_keeps_shared_entries_and_blob_files_and_refuses_active_jobs() {
        let pool = fixture().await;
        sqlx::query("INSERT INTO job_sessionz(id,job_type,status,progress) VALUES ('session','ScanDirectory','Active','{}')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO jobz(id,session_id,job_type,status,parameters) VALUES ('scan','session','ScanDirectory','Pending','{\"directory_path\":\"/disk\"}')")
            .execute(&pool).await.unwrap();
        assert!(remove_source(&pool, "disk").await.is_err());
        assert!(super::super::sources::get_source(&pool, "disk")
            .await
            .is_ok());
        assert_eq!(active_scans(&pool).await.unwrap().len(), 1);
        sqlx::query("UPDATE jobz SET status='Completed'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(active_scans(&pool).await.unwrap().is_empty());
        remove_source(&pool, "disk").await.unwrap();
        assert!(super::super::sources::get_source(&pool, "disk")
            .await
            .is_err());
        let deleted: Option<i64> =
            sqlx::query_scalar("SELECT deleted_at FROM songz WHERE id='song'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(deleted.is_some());
        let kept: Option<i64> =
            sqlx::query_scalar("SELECT deleted_at FROM songz WHERE id='shared'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(kept.is_none());
        let removed_album: Option<i64> =
            sqlx::query_scalar("SELECT deleted_at FROM albumz WHERE id='exclusive-album'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(removed_album.is_some());
        let shared_album: Option<i64> =
            sqlx::query_scalar("SELECT deleted_at FROM albumz WHERE id='shared-album'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(shared_album.is_none());
        let paths: Vec<String> = sqlx::query_scalar("SELECT path FROM scanned_directories")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(paths, ["/disk-other"]);
        let blobs: i64 = sqlx::query_scalar("SELECT count(*) FROM media_blobz")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(blobs, 3);
    }
}
