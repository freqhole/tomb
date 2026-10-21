//! atomic source availability/path reconciliation and reconnect scan scheduling.

use super::{
    inventory, mounts,
    sources::{self, LibrarySource},
    sync_priority,
};
use crate::{GrimoireError, GrimoireResult};
use serde::Serialize;
use sqlx::SqlitePool;

const OFFLINE_CONFIRMATION_SECONDS: i64 = 5;
pub(super) static REFRESH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// opaque cache token: no source paths/identities are exposed to library readers.
/// routine probe timestamps do not invalidate caches.
pub async fn revision(pool: &SqlitePool) -> GrimoireResult<String> {
    let rows = sqlx::query_scalar!(
        r#"SELECT value AS "value!: String" FROM (
          SELECT json_array('source', s.id, s.last_known_path, COALESCE(a.status, 'unknown')) AS value
            FROM library_sourcez s LEFT JOIN library_source_statez a ON a.source_id = s.id
          UNION ALL
          SELECT json_array('sync', owner, device_id, volume_uuid, path)
            FROM storage_sync_targetz
        ) ORDER BY value"#
    )
    .fetch_all(pool)
    .await?;
    Ok(blake3::hash(serde_json::to_string(&rows)?.as_bytes())
        .to_hex()
        .to_string())
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow, zod_gen_derive::ZodSchema)]
pub struct SourceAvailability {
    pub source_id: String,
    pub status: String,
    pub missing_since: Option<i64>,
    pub checked_at: Option<i64>,
    pub changed_at: Option<i64>,
}

/// unprobed sources are unknown, not offline. callers must not infer that an
/// unknown source is playable, nor hide it as if absence had been confirmed.
pub async fn list_availability(pool: &SqlitePool) -> GrimoireResult<Vec<SourceAvailability>> {
    let states = sqlx::query_as!(
        SourceAvailability,
        r#"SELECT s.id AS "source_id!", COALESCE(a.status, 'unknown') AS "status!",
                a.missing_since, a.checked_at AS "checked_at?", a.changed_at AS "changed_at?"
         FROM library_sourcez s LEFT JOIN library_source_statez a ON a.source_id = s.id
         ORDER BY s.id"#,
    )
    .fetch_all(pool)
    .await?;
    let targets = sync_priority::list_targets(pool).await?;
    let sources = sources::list_sources(pool).await?;
    Ok(states
        .into_iter()
        .filter(|state| {
            !sources.iter().any(|source| {
                source.id == state.source_id && sync_priority::is_sync_source(&targets, source)
            })
        })
        .collect())
}

/// successful snapshots only: errors leave all persisted states untouched.
pub async fn refresh_availability(pool: &SqlitePool) -> GrimoireResult<Vec<SourceAvailability>> {
    let states = reconcile(pool, false).await?;
    super::events::notify_changed();
    Ok(states)
}

pub(super) async fn reconcile(
    pool: &SqlitePool,
    startup: bool,
) -> GrimoireResult<Vec<SourceAvailability>> {
    let _guard = REFRESH_LOCK.lock().await;
    let targets = sync_priority::list_targets(pool).await?;
    let sources: Vec<_> = sources::list_sources(pool)
        .await?
        .into_iter()
        .filter(|source| !sync_priority::is_sync_source(&targets, source))
        .collect();
    if sources.is_empty() {
        return list_availability(pool).await;
    }
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let volumes = inventory::list_removable_volumes().await?;
    let mounts = mounts::read_mounts()?;
    let mut observations = Vec::with_capacity(sources.len());
    for source in &sources {
        observations.push(
            sources::mounted_source_root(source, &volumes, &mounts)?
                .map(|root| root.into_os_string().into_string())
                .transpose()
                .map_err(|_| GrimoireError::Validation {
                    field: "path".into(),
                    message: "source path is not valid UTF-8".into(),
                })?,
        );
    }
    apply_snapshot(pool, &sources, &observations, now, startup).await?;
    list_availability(pool).await
}

#[cfg(test)]
async fn apply_observations(
    pool: &SqlitePool,
    sources: &[LibrarySource],
    mounted: &[bool],
    now: i64,
) -> GrimoireResult<()> {
    let roots: Vec<_> = sources
        .iter()
        .zip(mounted)
        .map(|(source, mounted)| mounted.then(|| source.last_known_path.clone()))
        .collect();
    if mounted.len() != sources.len() {
        return Err(GrimoireError::Validation {
            field: "observations".into(),
            message: "source observation count mismatch".into(),
        });
    }
    apply_snapshot(pool, sources, &roots, now, false).await
}

async fn apply_snapshot(
    pool: &SqlitePool,
    sources: &[LibrarySource],
    roots: &[Option<String>],
    now: i64,
    startup: bool,
) -> GrimoireResult<()> {
    if sources.len() != roots.len() {
        return Err(GrimoireError::Validation {
            field: "observations".into(),
            message: "source observation count mismatch".into(),
        });
    }
    let mut transaction = pool.begin().await?;
    let targets = sqlx::query_as!(
        sync_priority::SyncTarget,
        "SELECT device_id, volume_uuid, path FROM storage_sync_targetz",
    )
    .fetch_all(&mut *transaction)
    .await?;
    for (source, root) in sources.iter().zip(roots) {
        if sync_priority::is_sync_source(&targets, source) {
            continue;
        }
        let path = sqlx::query_scalar!(
            "SELECT last_known_path FROM library_sourcez WHERE id = ?",
            source.id
        )
        .fetch_optional(&mut *transaction)
        .await?;
        if path.as_deref() != Some(&source.last_known_path) {
            return Err(GrimoireError::Validation {
                field: "source".into(),
                message: "source changed during availability probe; retry refresh".into(),
            });
        }
        let previous = sqlx::query!(
            "SELECT status, missing_since, checked_at, changed_at FROM library_source_statez WHERE source_id = ?",
            source.id
        ).fetch_optional(&mut *transaction).await?;
        if previous
            .as_ref()
            .is_some_and(|state| state.checked_at > now)
        {
            // another process finished a newer observation first.
            continue;
        }
        let previous_status = previous
            .as_ref()
            .map(|state| state.status.as_str())
            .unwrap_or("unknown");
        let was_missing = previous
            .as_ref()
            .is_some_and(|state| state.missing_since.is_some());
        let relocated = root
            .as_ref()
            .is_some_and(|root| root != &source.last_known_path);
        if let Some(root) = root.as_ref().filter(|_| relocated) {
            let mut moved = source.clone();
            moved.last_known_path = root.clone();
            if sync_priority::is_sync_source(&targets, &moved) {
                continue;
            }
            relocate_source(&mut transaction, source, root).await?;
        }
        let missing_since = if root.is_some() {
            None
        } else {
            Some(
                previous
                    .as_ref()
                    .and_then(|state| state.missing_since)
                    .unwrap_or(now),
            )
        };
        let status = if root.is_some() {
            "online"
        } else if missing_since
            .is_some_and(|since| now.saturating_sub(since) >= OFFLINE_CONFIRMATION_SECONDS)
        {
            "offline"
        } else {
            previous_status
        };
        let changed_at = if status == previous_status {
            previous
                .as_ref()
                .map(|state| state.changed_at)
                .unwrap_or(now)
        } else {
            now
        };
        sqlx::query!(
            "INSERT INTO library_source_statez (source_id, status, missing_since, checked_at, changed_at)
             VALUES (?, ?, ?, ?, ?) ON CONFLICT(source_id) DO UPDATE SET
             status = excluded.status, missing_since = excluded.missing_since,
             checked_at = excluded.checked_at, changed_at = excluded.changed_at",
             source.id, status, missing_since, now, changed_at
        )
            .execute(&mut *transaction).await?;
        if let Some(root) = root
            .as_deref()
            .filter(|_| startup || previous_status != "online" || was_missing || relocated)
        {
            enqueue_source_scan(
                &mut transaction,
                source,
                root,
                now,
                startup && previous_status == "online" && !was_missing && !relocated,
            )
            .await?;
        }
    }
    transaction.commit().await?;
    Ok(())
}

async fn relocate_source(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    source: &LibrarySource,
    root: &str,
) -> GrimoireResult<()> {
    sqlx::query!(
        "INSERT OR IGNORE INTO library_source_pathz (source_id, path) VALUES (?, ?)",
        source.id,
        root
    )
    .execute(&mut **transaction)
    .await?;
    // indexed membership narrows the update; literal component checks avoid LIKE
    // wildcard bugs and leave other copies, metadata and tombstones untouched.
    let windows_path = !source.last_known_path.starts_with('/');
    let old_prefix = source
        .last_known_path
        .trim_end_matches(|c| c == '/' || (windows_path && c == '\\'));
    let new_prefix = root.trim_end_matches(|c| c == '/' || (windows_path && c == '\\'));
    sqlx::query!(
        "UPDATE media_blobz SET local_path = ? || substr(local_path, length(?) + 1)
         WHERE id IN (SELECT blob_id FROM library_source_mediaz WHERE source_id = ?)
           AND (local_path = ? OR substr(local_path, 1, length(?) + 1) = ? || '/'
                OR (? AND substr(local_path, 1, length(?) + 1) = ? || char(92)))",
        new_prefix,
        old_prefix,
        source.id,
        old_prefix,
        old_prefix,
        old_prefix,
        windows_path,
        old_prefix,
        old_prefix
    )
    .execute(&mut **transaction)
    .await?;
    sqlx::query!(
        "UPDATE library_sourcez SET last_known_path = ? WHERE id = ?",
        root,
        source.id
    )
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn enqueue_source_scan(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    source: &LibrarySource,
    root: &str,
    now: i64,
    startup_only: bool,
) -> GrimoireResult<()> {
    let queued = sqlx::query_scalar!(
        r#"SELECT EXISTS (
          SELECT 1 FROM jobz WHERE job_type = 'ScanDirectory'
            AND (status = 'Pending' OR (? AND status = 'Running'))
            AND json_extract(parameters, '$.directory_path') = ?
            AND (json_extract(parameters, '$.domain') IS NULL
                 OR json_extract(parameters, '$.domain') = ?)
        ) AS "queued!: bool""#,
        startup_only,
        root,
        source.domain
    )
    .fetch_one(&mut **transaction)
    .await?;
    if queued {
        return Ok(());
    }
    let progress = serde_json::to_string(&crate::jobs::JobProgress::new(0, 0))?;
    let session = sqlx::query_scalar!(
        r#"INSERT INTO job_sessionz (job_type, status, progress, batch_size)
           VALUES ('ScanDirectory', 'Active', ?, 100) RETURNING id AS "id!""#,
        progress
    )
    .fetch_one(&mut **transaction)
    .await?;
    let domain = match source.domain.as_str() {
        "both" => None,
        "music" => Some(crate::MediaDomain::Music),
        "video" => Some(crate::MediaDomain::Video),
        _ => {
            return Err(GrimoireError::Validation {
                field: "domain".into(),
                message: "invalid library source domain".into(),
            })
        }
    };
    let parameters = serde_json::to_string(&crate::jobs::ScanDirectoryParams {
        directory_path: root.into(),
        recursive: true,
        max_depth: None,
        file_extensions: None,
        skip_tracked_subdirs: false,
        domain,
    })?;
    sqlx::query!(
        "INSERT INTO jobz (session_id, job_type, status, parameters, max_retries, scheduled_at)
         VALUES (?, 'ScanDirectory', 'Pending', ?, 3, ?)",
        session,
        parameters,
        now
    )
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn fixture() -> (SqlitePool, Vec<LibrarySource>) {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::database::run_schema_migrations(&pool).await.unwrap();
        sqlx::query!("INSERT INTO library_sourcez (id, volume_key, relative_path, last_known_path) VALUES ('source', 'uuid', '', '/mnt/disk')")
            .execute(&pool).await.unwrap();
        let sources = sources::list_sources(&pool).await.unwrap();
        (pool, sources)
    }

    async fn state(pool: &SqlitePool) -> SourceAvailability {
        list_availability(pool).await.unwrap().remove(0)
    }

    async fn scans(pool: &SqlitePool) -> Vec<crate::jobs::ScanDirectoryParams> {
        sqlx::query_scalar!(
            "SELECT parameters FROM jobz WHERE job_type = 'ScanDirectory' ORDER BY rowid"
        )
        .fetch_all(pool)
        .await
        .unwrap()
        .iter()
        .map(|json| serde_json::from_str(json).unwrap())
        .collect()
    }

    #[tokio::test]
    async fn startup_reconnect_scans_are_atomic_deduplicated_and_keep_the_saved_domain() {
        let (pool, _) = fixture().await;
        sqlx::query!("UPDATE library_sourcez SET domain = 'video'")
            .execute(&pool)
            .await
            .unwrap();
        let sources = sources::list_sources(&pool).await.unwrap();
        let online = [Some("/mnt/disk".into())];
        apply_snapshot(&pool, &sources, &online, 100, true)
            .await
            .unwrap();
        let queued = scans(&pool).await;
        assert_eq!(queued.len(), 1);
        assert_eq!(queued[0].domain, Some(crate::MediaDomain::Video));
        assert!(queued[0].recursive);
        assert!(!queued[0].skip_tracked_subdirs);
        assert_eq!(queued[0].directory_path, "/mnt/disk");
        apply_snapshot(&pool, &sources, &online, 101, true)
            .await
            .unwrap();
        apply_snapshot(&pool, &sources, &online, 102, false)
            .await
            .unwrap();
        assert_eq!(scans(&pool).await.len(), 1);
        sqlx::query!("UPDATE jobz SET status = 'Running'")
            .execute(&pool)
            .await
            .unwrap();
        apply_snapshot(&pool, &sources, &online, 103, true)
            .await
            .unwrap();
        assert_eq!(scans(&pool).await.len(), 1);
        apply_snapshot(&pool, &sources, &[None], 104, false)
            .await
            .unwrap();
        apply_snapshot(&pool, &sources, &[None], 109, false)
            .await
            .unwrap();
        assert_eq!(state(&pool).await.status, "offline");
        apply_snapshot(&pool, &sources, &online, 110, false)
            .await
            .unwrap();
        assert_eq!(state(&pool).await.status, "online");
        // an in-flight scan may have raced the disconnect: retain one follow-up.
        assert_eq!(scans(&pool).await.len(), 2);
        apply_snapshot(&pool, &sources, &online, 111, false)
            .await
            .unwrap();
        assert_eq!(scans(&pool).await.len(), 2);
        let sessions = sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM job_sessionz"#)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(sessions, 2);
    }

    #[tokio::test]
    async fn changed_mount_relocates_literal_member_paths_and_preserves_deleted_records() {
        let (pool, sources) = fixture().await;
        sqlx::query!(
            "INSERT INTO library_source_pathz (source_id, path) VALUES ('source', '/mnt/disk')"
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query!(
            "INSERT INTO media_blobz (id, local_path, deleted_at) VALUES
            ('liveblob', '/mnt/disk/music/song.flac', NULL),
            ('deadblob', '/mnt/disk/deleted.mp4', 42),
            ('internal', '/mnt/disk-other/song.flac', NULL)"
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query!("INSERT INTO songz (id, media_blob_id, title, deleted_at) VALUES ('song', 'deadblob', 'retained', 42)")
            .execute(&pool).await.unwrap();
        apply_snapshot(&pool, &sources, &[None], 100, false)
            .await
            .unwrap();
        apply_snapshot(&pool, &sources, &[None], 105, false)
            .await
            .unwrap();
        assert!(
            super::super::media_availability::is_blob_offline(&pool, "liveblob")
                .await
                .unwrap()
        );
        apply_snapshot(&pool, &sources, &[Some("/mnt/new_%".into())], 106, false)
            .await
            .unwrap();
        assert_eq!(state(&pool).await.status, "online");
        assert!(
            !super::super::media_availability::is_blob_offline(&pool, "liveblob")
                .await
                .unwrap()
        );
        let blobs = sqlx::query!("SELECT id, local_path, deleted_at FROM media_blobz ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(
            blobs[0].local_path.as_deref(),
            Some("/mnt/new_%/deleted.mp4")
        );
        assert_eq!(blobs[0].deleted_at, Some(42));
        assert_eq!(
            blobs[1].local_path.as_deref(),
            Some("/mnt/disk-other/song.flac")
        );
        assert_eq!(
            blobs[2].local_path.as_deref(),
            Some("/mnt/new_%/music/song.flac")
        );
        let roots = sources::protected_roots(&pool).await.unwrap();
        assert!(roots.contains(&std::path::PathBuf::from("/mnt/disk")));
        assert!(roots.contains(&std::path::PathBuf::from("/mnt/new_%")));
        assert_eq!(scans(&pool).await[0].directory_path, "/mnt/new_%");
        assert!(sources::deleted_source_paths(&pool)
            .await
            .unwrap()
            .contains("/mnt/new_%/deleted.mp4"));
        assert_eq!(
            sources::list_sources(&pool).await.unwrap()[0].last_known_path,
            "/mnt/new_%"
        );
    }

    #[tokio::test]
    async fn windows_drive_roots_and_subfolders_relocate_without_losing_separators() {
        for (old, new) in [
            (r"\\?\E:\", r"\\?\F:\"),
            (r"\\?\E:\", r"\\?\C:\USB music"),
            (r"\\?\E:\music", r"\\?\F:\music"),
        ] {
            let (pool, _) = fixture().await;
            sqlx::query("UPDATE library_sourcez SET last_known_path = ? WHERE id = 'source'")
                .bind(old)
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("INSERT INTO library_source_pathz (source_id, path) VALUES ('source', ?)")
                .bind(old)
                .execute(&pool)
                .await
                .unwrap();
            let input = format!("{}\\album\\song.flac", old.trim_end_matches('\\'));
            sqlx::query("INSERT INTO media_blobz (id, local_path) VALUES ('windows-song', ?)")
                .bind(&input)
                .execute(&pool)
                .await
                .unwrap();
            let membership: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM library_source_mediaz WHERE blob_id = 'windows-song'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(membership, 1);
            let source = sources::list_sources(&pool).await.unwrap().remove(0);
            let mut transaction = pool.begin().await.unwrap();
            relocate_source(&mut transaction, &source, new)
                .await
                .unwrap();
            transaction.commit().await.unwrap();
            let path: String =
                sqlx::query_scalar("SELECT local_path FROM media_blobz WHERE id = 'windows-song'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(
                path,
                format!("{}\\album\\song.flac", new.trim_end_matches('\\'))
            );
        }
    }

    #[tokio::test]
    async fn scan_enqueue_failure_rolls_back_availability_and_path_relocation() {
        let (pool, sources) = fixture().await;
        sqlx::raw_sql("CREATE TRIGGER reject_scan BEFORE INSERT ON jobz BEGIN SELECT RAISE(ABORT, 'scan rejected'); END;")
            .execute(&pool).await.unwrap();
        assert!(
            apply_snapshot(&pool, &sources, &[Some("/mnt/new".into())], 100, false)
                .await
                .is_err()
        );
        assert_eq!(state(&pool).await.status, "unknown");
        assert_eq!(
            sources::list_sources(&pool).await.unwrap()[0].last_known_path,
            "/mnt/disk"
        );
        assert!(sources::protected_roots(&pool).await.unwrap().is_empty());
        assert!(scans(&pool).await.is_empty());
        assert_eq!(
            sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM job_sessionz"#)
                .fetch_one(&pool)
                .await
                .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn revision_changes_only_for_effective_state_roots_or_sync_registration() {
        let (pool, sources) = fixture().await;
        let unknown = revision(&pool).await.unwrap();
        apply_observations(&pool, &sources, &[true], 100)
            .await
            .unwrap();
        let online = revision(&pool).await.unwrap();
        assert_ne!(unknown, online);
        apply_observations(&pool, &sources, &[false], 101)
            .await
            .unwrap();
        assert_eq!(revision(&pool).await.unwrap(), online);
        apply_observations(&pool, &sources, &[false], 106)
            .await
            .unwrap();
        let offline = revision(&pool).await.unwrap();
        assert_ne!(offline, online);
        apply_observations(&pool, &sources, &[false], 110)
            .await
            .unwrap();
        assert_eq!(revision(&pool).await.unwrap(), offline);
        apply_snapshot(&pool, &sources, &[Some("/mnt/new".into())], 111, false)
            .await
            .unwrap();
        let relocated = revision(&pool).await.unwrap();
        assert_ne!(relocated, online);
        assert_ne!(relocated, offline);
        sync_priority::replace_targets(
            &pool,
            "test",
            &[sync_priority::SyncTarget {
                device_id: "device".into(),
                volume_uuid: None,
                path: "/mnt/new".into(),
            }],
        )
        .await
        .unwrap();
        assert_ne!(revision(&pool).await.unwrap(), relocated);
        assert_eq!(relocated.len(), 64);
        assert!(!relocated.contains("/mnt"));
    }

    #[tokio::test]
    async fn starts_unknown_confirms_offline_at_five_seconds_and_restores_immediately() {
        let (pool, sources) = fixture().await;
        assert_eq!(state(&pool).await.status, "unknown");
        assert_eq!(state(&pool).await.checked_at, None);
        apply_observations(&pool, &sources, &[true], 100)
            .await
            .unwrap();
        assert_eq!(state(&pool).await.status, "online");
        apply_observations(&pool, &sources, &[false], 101)
            .await
            .unwrap();
        assert_eq!(state(&pool).await.missing_since, Some(101));
        apply_observations(&pool, &sources, &[false], 105)
            .await
            .unwrap();
        assert_eq!(state(&pool).await.status, "online");
        apply_observations(&pool, &sources, &[false], 106)
            .await
            .unwrap();
        assert_eq!(state(&pool).await.status, "offline");
        assert_eq!(state(&pool).await.changed_at, Some(106));
        apply_observations(&pool, &sources, &[true], 107)
            .await
            .unwrap();
        assert_eq!(state(&pool).await.status, "online");
        assert_eq!(state(&pool).await.missing_since, None);
        assert_eq!(state(&pool).await.changed_at, Some(107));
    }

    #[tokio::test]
    async fn short_disconnect_cancels_pending_offline_and_preserves_change_timestamp() {
        let (pool, sources) = fixture().await;
        apply_observations(&pool, &sources, &[true], 100)
            .await
            .unwrap();
        sqlx::query!("UPDATE jobz SET status = 'Completed'")
            .execute(&pool)
            .await
            .unwrap();
        apply_observations(&pool, &sources, &[false], 101)
            .await
            .unwrap();
        apply_observations(&pool, &sources, &[true], 104)
            .await
            .unwrap();
        assert_eq!(state(&pool).await.missing_since, None);
        assert_eq!(state(&pool).await.changed_at, Some(100));
        assert_eq!(scans(&pool).await.len(), 2);
        apply_observations(&pool, &sources, &[false], 105)
            .await
            .unwrap();
        assert_eq!(state(&pool).await.missing_since, Some(105));
        assert_eq!(state(&pool).await.status, "online");
    }

    #[tokio::test]
    async fn initially_absent_source_needs_confirmation_and_stale_snapshots_do_not_win() {
        let (pool, sources) = fixture().await;
        apply_observations(&pool, &sources, &[false], 100)
            .await
            .unwrap();
        assert_eq!(state(&pool).await.status, "unknown");
        apply_observations(&pool, &sources, &[false], 105)
            .await
            .unwrap();
        assert_eq!(state(&pool).await.status, "offline");
        apply_observations(&pool, &sources, &[true], 104)
            .await
            .unwrap();
        assert_eq!(state(&pool).await.status, "offline");
        assert_eq!(state(&pool).await.checked_at, Some(105));
    }

    #[tokio::test]
    async fn changed_source_or_invalid_batch_leaves_state_untouched() {
        let (pool, sources) = fixture().await;
        apply_observations(&pool, &sources, &[true], 100)
            .await
            .unwrap();
        sqlx::query!("UPDATE library_sourcez SET last_known_path = '/mnt/other'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(apply_observations(&pool, &sources, &[false], 110)
            .await
            .is_err());
        assert!(apply_observations(&pool, &sources, &[], 110).await.is_err());
        assert_eq!(state(&pool).await.checked_at, Some(100));
    }

    #[tokio::test]
    async fn sync_priority_suspends_existing_sources_without_changing_state_or_metadata() {
        let (pool, sources) = fixture().await;
        apply_observations(&pool, &sources, &[true], 100)
            .await
            .unwrap();
        sync_priority::replace_targets(
            &pool,
            "charnel",
            &[sync_priority::SyncTarget {
                device_id: "inactive-sync".into(),
                volume_uuid: None,
                path: "/mnt/disk".into(),
            }],
        )
        .await
        .unwrap();
        assert!(list_availability(&pool).await.unwrap().is_empty());
        // no OS probe is needed when every source is reserved for sync.
        assert!(refresh_availability(&pool).await.unwrap().is_empty());
        apply_observations(&pool, &sources, &[false], 110)
            .await
            .unwrap();
        assert_eq!(sources::list_sources(&pool).await.unwrap().len(), 1);
        sync_priority::replace_targets(&pool, "charnel", &[])
            .await
            .unwrap();
        let restored = state(&pool).await;
        assert_eq!(restored.status, "online");
        assert_eq!(restored.checked_at, Some(100));
        assert_eq!(restored.missing_since, None);
    }

    #[tokio::test]
    async fn sync_subfolder_reserves_the_whole_disk_including_other_source_folders() {
        let (pool, _) = fixture().await;
        sqlx::query!("UPDATE library_sourcez SET relative_path = 'Video', last_known_path = '/mnt/disk/Video'")
            .execute(&pool).await.unwrap();
        sync_priority::replace_targets(
            &pool,
            "charnel",
            &[sync_priority::SyncTarget {
                device_id: "path-only".into(),
                volume_uuid: None,
                path: "/mnt/disk/Music".into(),
            }],
        )
        .await
        .unwrap();
        assert!(list_availability(&pool).await.unwrap().is_empty());
        assert!(refresh_availability(&pool).await.unwrap().is_empty());
        assert_eq!(sources::list_sources(&pool).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn invalid_source_rolls_back_earlier_updates_in_the_same_snapshot() {
        let (pool, _) = fixture().await;
        sqlx::query!("INSERT INTO library_sourcez (id, volume_key, relative_path, last_known_path) VALUES ('second', 'second-uuid', '', '/mnt/second')")
            .execute(&pool).await.unwrap();
        let sources = sources::list_sources(&pool).await.unwrap();
        apply_observations(&pool, &sources, &[true, true], 100)
            .await
            .unwrap();
        sqlx::query!(
            "UPDATE library_sourcez SET last_known_path = '/moved' WHERE id = ?",
            sources[1].id
        )
        .execute(&pool)
        .await
        .unwrap();
        assert!(apply_observations(&pool, &sources, &[false, false], 110)
            .await
            .is_err());
        for state in list_availability(&pool).await.unwrap() {
            assert_eq!(state.checked_at, Some(100));
            assert_eq!(state.missing_since, None);
        }
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    #[tokio::test]
    async fn failed_real_probe_preserves_last_known_state() {
        let (pool, sources) = fixture().await;
        apply_observations(&pool, &sources, &[true], 100)
            .await
            .unwrap();
        assert!(refresh_availability(&pool).await.is_err());
        assert_eq!(state(&pool).await.status, "online");
        assert_eq!(state(&pool).await.checked_at, Some(100));
    }
}
