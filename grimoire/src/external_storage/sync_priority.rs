//! sync-target registrations take priority over library-source discovery.
//! the app owning sync configuration mirrors its registrations, not just the
//! currently active or mounted target. no sync content/history is changed here.

use super::{inventory::RemovableVolume, sources::LibrarySource};
use crate::{GrimoireError, GrimoireResult};
use serde::Serialize;
use sqlx::SqlitePool;
use std::path::Path;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct SyncTarget {
    pub device_id: String,
    pub volume_uuid: Option<String>,
    pub path: String,
}

pub async fn mirror_targets(owner: &str, targets: &[SyncTarget]) -> GrimoireResult<()> {
    replace_targets(&crate::database::connect().await?, owner, targets).await
}

pub async fn replace_targets(
    pool: &SqlitePool,
    owner: &str,
    targets: &[SyncTarget],
) -> GrimoireResult<()> {
    if owner.is_empty()
        || targets.iter().any(|target| {
            target.device_id.is_empty()
                || !Path::new(&target.path).is_absolute()
                || target
                    .volume_uuid
                    .as_ref()
                    .is_some_and(|uuid| uuid.is_empty())
        })
    {
        return Err(GrimoireError::Validation {
            field: "sync_targets".into(),
            message: "sync targets need an owner, device id and absolute path".into(),
        });
    }
    let mut transaction = pool.begin().await?;
    sqlx::query!("DELETE FROM storage_sync_targetz WHERE owner = ?", owner)
        .execute(&mut *transaction)
        .await?;
    for target in targets {
        sqlx::query!("INSERT INTO storage_sync_targetz (owner, device_id, volume_uuid, path) VALUES (?, ?, ?, ?)",
            owner, target.device_id, target.volume_uuid, target.path)
            .execute(&mut *transaction).await?;
    }
    transaction.commit().await?;
    super::events::notify_changed();
    Ok(())
}

pub async fn list_targets(pool: &SqlitePool) -> GrimoireResult<Vec<SyncTarget>> {
    Ok(sqlx::query_as!(
        SyncTarget,
        "SELECT device_id, volume_uuid, path FROM storage_sync_targetz",
    )
    .fetch_all(pool)
    .await?)
}

fn overlapping_paths(first: &str, second: &str) -> bool {
    Path::new(first).starts_with(second) || Path::new(second).starts_with(first)
}

fn same_uuid(first: Option<&str>, second: Option<&str>) -> bool {
    matches!((first, second), (Some(first), Some(second)) if first.eq_ignore_ascii_case(second))
}

pub fn is_sync_volume(targets: &[SyncTarget], volume: &RemovableVolume) -> bool {
    targets.iter().any(|target| {
        same_uuid(target.volume_uuid.as_deref(), volume.uuid.as_deref())
            || volume
                .mount_points
                .iter()
                .any(|mount| overlapping_paths(&target.path, mount))
    })
}

pub fn is_sync_source(targets: &[SyncTarget], source: &LibrarySource) -> bool {
    let mount = Path::new(&source.last_known_path)
        .ancestors()
        .nth(Path::new(&source.relative_path).components().count())
        .unwrap_or_else(|| Path::new(&source.last_known_path));
    targets.iter().any(|target| {
        same_uuid(target.volume_uuid.as_deref(), source.volume_uuid.as_deref())
            || Path::new(&target.path).starts_with(mount)
            || mount.starts_with(&target.path)
    })
}

pub fn reject_sync_volume(targets: &[SyncTarget], volume: &RemovableVolume) -> GrimoireResult<()> {
    if is_sync_volume(targets, volume) {
        return Err(GrimoireError::Validation {
            field: "device_path".into(),
            message: "this volume is registered for removable storage sync; remove its sync registration before using it as a library source".into(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target() -> SyncTarget {
        SyncTarget {
            device_id: "sync".into(),
            volume_uuid: Some("ABCD-1234".into()),
            path: "/media/old/Music".into(),
        }
    }

    fn volume() -> RemovableVolume {
        RemovableVolume {
            device_path: "/dev/sdb1".into(),
            uuid: Some("abcd-1234".into()),
            partition_uuid: Some("partition".into()),
            label: Some("portable".into()),
            filesystem: "exfat".into(),
            mount_points: vec!["/media/new".into()],
            read_only: false,
            size_bytes: 100,
        }
    }

    #[test]
    fn sync_uuid_takes_priority_after_remount_and_path_fallback_covers_whole_volume() {
        assert!(reject_sync_volume(&[target()], &volume()).is_err());
        let mut unknown = volume();
        unknown.uuid = None;
        unknown.mount_points = vec!["/media/old".into()];
        assert!(is_sync_volume(&[target()], &unknown));
        unknown.mount_points = vec!["/media/old-other".into()];
        assert!(!is_sync_volume(&[target()], &unknown));
        assert!(!is_sync_volume(&[], &volume()));
    }

    #[tokio::test]
    async fn mirrors_all_targets_atomically_and_only_replaces_the_owner() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::database::run_schema_migrations(&pool).await.unwrap();
        replace_targets(&pool, "charnel", &[target()])
            .await
            .unwrap();
        replace_targets(&pool, "another", &[target()])
            .await
            .unwrap();
        assert_eq!(list_targets(&pool).await.unwrap().len(), 2);
        assert!(replace_targets(&pool, "charnel", &[target(), target()])
            .await
            .is_err());
        assert_eq!(list_targets(&pool).await.unwrap().len(), 2);
        replace_targets(&pool, "charnel", &[]).await.unwrap();
        assert_eq!(list_targets(&pool).await.unwrap().len(), 1);
        let mut invalid = target();
        invalid.path = "relative".into();
        assert!(replace_targets(&pool, "another", &[invalid]).await.is_err());
        assert_eq!(list_targets(&pool).await.unwrap().len(), 1);
    }
}
