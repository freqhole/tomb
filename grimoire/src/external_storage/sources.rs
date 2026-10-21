//! registered removable library roots, separate from copy/sync destinations.
//! registration never mounts, scans, or rewrites media paths as a side effect.
//!
//! admin dispatch exposes list/register/browse/scan-source operations. register
//! and browse accept [`SourceSelection`]; scan-source accepts `{id}` and uses the
//! saved domain. the shared monitor reconciles availability and queues scans on
//! startup/reconnect. legacy rescan-all excludes overlapping roots.

use super::{
    inventory::{list_removable_volumes, RemovableVolume},
    mounts::{self, Mount},
    sync_priority,
};
use crate::{GrimoireError, GrimoireResult};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::{
    collections::HashSet,
    path::{Component, Path, PathBuf},
};

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceDomain {
    #[default]
    Both,
    Music,
    Video,
}

// zod_gen 1.x does not honor serde's rename_all on enum literals.
impl zod_gen::ZodSchema for SourceDomain {
    fn zod_schema() -> String {
        r#"z.union([z.literal("both"), z.literal("music"), z.literal("video")])"#.to_string()
    }
}

impl SourceDomain {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Both => "both",
            Self::Music => "music",
            Self::Video => "video",
        }
    }
}

#[derive(Debug, Deserialize, zod_gen_derive::ZodSchema)]
#[serde(deny_unknown_fields)]
pub struct SourceSelection {
    pub device_path: String,
    pub mount_path: String,
    #[serde(default)]
    pub relative_path: String,
    #[serde(default)]
    pub domain: SourceDomain,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow, zod_gen_derive::ZodSchema)]
pub struct LibrarySource {
    pub id: String,
    pub volume_key: String,
    pub volume_uuid: Option<String>,
    pub partition_uuid: Option<String>,
    pub label: Option<String>,
    pub relative_path: String,
    pub last_known_path: String,
    pub domain: String,
    pub created_at: i64,
}

#[derive(Debug, Serialize, zod_gen_derive::ZodSchema)]
pub struct SourceFolder {
    pub name: String,
    pub relative_path: String,
}

fn invalid(field: &str, message: impl Into<String>) -> GrimoireError {
    GrimoireError::Validation {
        field: field.into(),
        message: message.into(),
    }
}

fn volume_key(volume: &RemovableVolume) -> GrimoireResult<String> {
    if volume.uuid.is_none() && volume.partition_uuid.is_none() {
        return Err(invalid(
            "device_path",
            "volume has no stable UUID or partition UUID",
        ));
    }
    Ok(serde_json::to_string(&(
        &volume.uuid,
        &volume.partition_uuid,
    ))?)
}

fn unique_volume<'a>(
    volumes: &'a [RemovableVolume],
    uuid: &Option<String>,
    partition_uuid: &Option<String>,
) -> GrimoireResult<&'a RemovableVolume> {
    let mut matching = volumes
        .iter()
        .filter(|volume| &volume.uuid == uuid && &volume.partition_uuid == partition_uuid);
    let volume = matching
        .next()
        .ok_or_else(|| invalid("device_path", "registered volume is absent"))?;
    if matching.next().is_some() {
        return Err(invalid(
            "device_path",
            "multiple attached volumes share this identity; disconnect the duplicate",
        ));
    }
    Ok(volume)
}

fn relative_path(raw: &str) -> GrimoireResult<PathBuf> {
    let path = Path::new(raw);
    if path
        .components()
        .any(|component| !matches!(component, Component::Normal(_) | Component::CurDir))
    {
        return Err(invalid(
            "relative_path",
            "folder must be relative to the selected volume without parent traversal",
        ));
    }
    Ok(path
        .components()
        .filter(|component| !matches!(component, Component::CurDir))
        .collect())
}

fn utf8_path(path: &Path) -> GrimoireResult<String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| invalid("path", "folder path is not valid UTF-8"))
}

fn relative_wire_path(path: &Path) -> GrimoireResult<String> {
    let path = utf8_path(path)?;
    #[cfg(target_os = "windows")]
    return Ok(path.replace('\\', "/"));
    #[cfg(not(target_os = "windows"))]
    Ok(path)
}

fn selected_root(
    selection: &SourceSelection,
    volumes: &[RemovableVolume],
    mounts: &[Mount],
) -> GrimoireResult<(RemovableVolume, PathBuf, PathBuf)> {
    let volume = volumes
        .iter()
        .find(|volume| volume.device_path == selection.device_path)
        .ok_or_else(|| {
            invalid(
                "device_path",
                "selected removable volume is no longer present",
            )
        })?;
    if !volume.mount_points.contains(&selection.mount_path) {
        return Err(invalid(
            "mount_path",
            "selected volume is not mounted at this path",
        ));
    }
    let mount_path = std::fs::canonicalize(&selection.mount_path)?;
    if mount_path == Path::new("/") {
        return Err(invalid("mount_path", "system root cannot be registered"));
    }
    let root = std::fs::canonicalize(mount_path.join(relative_path(&selection.relative_path)?))?;
    if !root.starts_with(&mount_path) || !root.is_dir() {
        return Err(invalid(
            "relative_path",
            "selected folder must be inside the mounted volume",
        ));
    }
    let mount = mounts::deepest_mount(mounts, &root).ok_or_else(|| {
        invalid(
            "mount_path",
            "selected folder is not backed by a known mount",
        )
    })?;
    if mount.path != mount_path || !mounts::matches_device(mount, &volume.device_path)? {
        return Err(invalid(
            "mount_path",
            "mount changed or folder belongs to a different volume",
        ));
    }
    // probe directory access before persisting it or displaying it as selectable.
    std::fs::read_dir(&root)?;
    Ok((volume.clone(), mount_path, root))
}

async fn probe_selection(
    selection: &SourceSelection,
) -> GrimoireResult<(RemovableVolume, PathBuf, PathBuf)> {
    let volumes = list_removable_volumes().await?;
    let selected = selected_root(selection, &volumes, &mounts::read_mounts()?)?;
    let pool = crate::database::connect().await?;
    sync_priority::reject_sync_volume(&sync_priority::list_targets(&pool).await?, &selected.0)?;
    Ok(selected)
}

pub async fn list_sources(pool: &SqlitePool) -> GrimoireResult<Vec<LibrarySource>> {
    Ok(sqlx::query_as!(
        LibrarySource,
        r#"SELECT id AS "id!", volume_key, volume_uuid, partition_uuid, label,
                      relative_path, last_known_path, domain, created_at
               FROM library_sourcez ORDER BY created_at, id"#
    )
    .fetch_all(pool)
    .await?)
}

pub async fn get_source(pool: &SqlitePool, id: &str) -> GrimoireResult<LibrarySource> {
    sqlx::query_as!(
        LibrarySource,
        r#"SELECT id AS "id!", volume_key, volume_uuid, partition_uuid, label,
                  relative_path, last_known_path, domain, created_at
           FROM library_sourcez WHERE id = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| invalid("id", "library source not found"))
}

pub async fn register_source(
    pool: &SqlitePool,
    selection: &SourceSelection,
) -> GrimoireResult<LibrarySource> {
    register_source_with_renditions(pool, selection, None).await
}

/// serializes registration, removal and explicit scan enqueueing with reconciliation.
pub async fn lock_source_operations() -> tokio::sync::MutexGuard<'static, ()> {
    super::availability::REFRESH_LOCK.lock().await
}

pub async fn register_source_with_renditions(
    pool: &SqlitePool,
    selection: &SourceSelection,
    generate_renditions: Option<bool>,
) -> GrimoireResult<LibrarySource> {
    let _guard = super::availability::REFRESH_LOCK.lock().await;
    let volumes = list_removable_volumes().await?;
    let (volume, mount_path, root) = selected_root(selection, &volumes, &mounts::read_mounts()?)?;
    sync_priority::reject_sync_volume(&sync_priority::list_targets(pool).await?, &volume)?;
    let key = volume_key(&volume)?;
    unique_volume(&volumes, &volume.uuid, &volume.partition_uuid)?;
    let source = save_source(pool, &volume, &key, &mount_path, &root, selection.domain).await?;
    if let Some(enabled) = generate_renditions {
        super::management::set_renditions(pool, &source.id, enabled).await?;
    }
    Ok(source)
}

async fn save_source(
    pool: &SqlitePool,
    volume: &RemovableVolume,
    key: &str,
    mount_path: &Path,
    root: &Path,
    domain: SourceDomain,
) -> GrimoireResult<LibrarySource> {
    let relative = root
        .strip_prefix(mount_path)
        .map_err(|_| invalid("path", "folder is outside volume"))?;
    let relative = relative_wire_path(relative)?;
    let root = utf8_path(root)?;
    let mut transaction = pool.begin().await?;
    let domain = domain.as_str();
    let source = sqlx::query_as!(LibrarySource,
        r#"INSERT INTO library_sourcez (volume_key, volume_uuid, partition_uuid, label, relative_path, last_known_path, domain)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(volume_key, relative_path) DO UPDATE SET
           label = excluded.label, last_known_path = excluded.last_known_path, domain = excluded.domain
         RETURNING id AS "id!", volume_key, volume_uuid, partition_uuid, label,
                   relative_path, last_known_path, domain, created_at"#,
         key, volume.uuid, volume.partition_uuid, volume.label, relative, root, domain)
        .fetch_one(&mut *transaction).await?;
    sqlx::query!(
        "INSERT OR IGNORE INTO library_source_pathz (source_id, path) VALUES (?, ?)",
        source.id,
        root
    )
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    super::events::notify_changed();
    Ok(source)
}

/// browses just one directory level, never following symlinks into another volume.
pub async fn browse_folders(selection: &SourceSelection) -> GrimoireResult<Vec<SourceFolder>> {
    let (_, mount_path, root) = probe_selection(selection).await?;
    browse_root(&mount_path, &root, &mounts::read_mounts()?)
}

fn browse_root(
    mount_path: &Path,
    root: &Path,
    mounts: &[Mount],
) -> GrimoireResult<Vec<SourceFolder>> {
    let mut folders = Vec::new();
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let path = std::fs::canonicalize(entry.path())?;
        if !path.starts_with(&mount_path) {
            continue;
        }
        if !mounts::deepest_mount(mounts, &path).is_some_and(|mount| mount.path == mount_path) {
            continue;
        }
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| invalid("path", "folder name is not valid UTF-8"))?;
        folders.push(SourceFolder {
            name,
            relative_path: relative_wire_path(
                path.strip_prefix(&mount_path)
                    .map_err(|_| invalid("path", "folder is outside volume"))?,
            )?,
        });
    }
    folders.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(folders)
}

/// generic legacy cleanup must not delete/restore media owned by a source.
/// include historical paths so remounting cannot expose old paths to cleanup.
pub async fn protected_roots(pool: &SqlitePool) -> GrimoireResult<Vec<PathBuf>> {
    let paths = sqlx::query_scalar!("SELECT DISTINCT path FROM library_source_pathz")
        .fetch_all(pool)
        .await?;
    Ok(paths.into_iter().map(PathBuf::from).collect())
}

pub fn contains_path(roots: &[PathBuf], path: &str) -> bool {
    roots.iter().any(|root| Path::new(path).starts_with(root))
}

/// classify a successful inventory snapshot without interpreting probe failures
/// as absence. remount relocation is deliberately not a state-only operation:
/// stored media paths must be reconciled before claiming they are playable.
#[cfg(test)]
fn source_is_mounted(
    source: &LibrarySource,
    volumes: &[RemovableVolume],
    mounts: &[Mount],
) -> GrimoireResult<bool> {
    match mounted_source_root(source, volumes, mounts)? {
        None => Ok(false),
        Some(root) if root == Path::new(&source.last_known_path) => Ok(true),
        Some(_) => Err(invalid(
            "path",
            "source mount path changed; reconcile media paths before refreshing availability",
        )),
    }
}

pub(super) fn mounted_source_root(
    source: &LibrarySource,
    volumes: &[RemovableVolume],
    mounts: &[Mount],
) -> GrimoireResult<Option<PathBuf>> {
    let matching: Vec<_> = volumes
        .iter()
        .filter(|volume| {
            volume.uuid == source.volume_uuid && volume.partition_uuid == source.partition_uuid
        })
        .collect();
    let volume = match matching.as_slice() {
        [] => return Ok(None),
        [volume] => *volume,
        _ => {
            return Err(invalid(
                "device_path",
                "multiple attached volumes share the registered identity",
            ))
        }
    };
    if volume.mount_points.is_empty() {
        return Ok(None);
    }
    let mut mount_paths: Vec<_> = volume.mount_points.iter().collect();
    // retain the current root when a volume has several valid bind mounts.
    mount_paths.sort_by_key(|path| {
        Path::new(path).join(&source.relative_path) != Path::new(&source.last_known_path)
    });
    for mount_path in mount_paths {
        // confirm the mount itself before examining a possibly missing subfolder.
        let selection = SourceSelection {
            device_path: volume.device_path.clone(),
            mount_path: mount_path.clone(),
            relative_path: String::new(),
            domain: SourceDomain::Both,
        };
        let (_, mount_path, _) = selected_root(&selection, volumes, mounts)?;
        let root = mount_path.join(relative_path(&source.relative_path)?);
        match std::fs::metadata(&root) {
            Ok(metadata) if metadata.is_dir() => {
                let selection = SourceSelection {
                    relative_path: source.relative_path.clone(),
                    ..selection
                };
                let (_, _, root) = selected_root(&selection, volumes, mounts)?;
                return Ok(Some(root));
            }
            Ok(_) => continue,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        }
    }
    Ok(None)
}

/// avoid reimporting tombstones when a registered volume is scanned again.
pub async fn deleted_source_paths(pool: &SqlitePool) -> GrimoireResult<HashSet<String>> {
    let roots = protected_roots(pool).await?;
    if roots.is_empty() {
        return Ok(HashSet::new());
    }
    let paths = sqlx::query_scalar!(
        r#"SELECT mb.local_path AS "local_path!" FROM media_blobz mb WHERE mb.local_path IS NOT NULL AND
         (mb.deleted_at IS NOT NULL
          OR EXISTS (SELECT 1 FROM songz s WHERE s.media_blob_id = mb.id AND s.deleted_at IS NOT NULL)
          OR EXISTS (SELECT 1 FROM videoz v WHERE v.media_blob_id = mb.id AND v.deleted_at IS NOT NULL))"#
    ).fetch_all(pool).await?;
    Ok(paths
        .into_iter()
        .filter(|path| contains_path(&roots, path))
        .collect())
}

/// rejects stale mount directories and disk swaps, including scans of an ancestor
/// that would otherwise walk into a registered source.
pub async fn validate_scan_path(pool: &SqlitePool, path: &str) -> GrimoireResult<()> {
    let path = crate::paths::canonical_path(Path::new(path));
    let roots = protected_roots(pool).await?;
    if !roots
        .iter()
        .any(|root| path.starts_with(root) || root.starts_with(&path))
    {
        return Ok(());
    }
    let sources = list_sources(pool).await?;
    let volumes = list_removable_volumes().await?;
    let sync_targets = sync_priority::list_targets(pool).await?;
    let mounts = mounts::read_mounts()?;
    for root in roots
        .iter()
        .filter(|root| path.starts_with(root) || root.starts_with(&path))
    {
        let root_path = utf8_path(root)?;
        let source_ids = sqlx::query_scalar!(
            "SELECT source_id FROM library_source_pathz WHERE path = ?",
            root_path
        )
        .fetch_all(pool)
        .await?;
        for source in sources
            .iter()
            .filter(|source| source_ids.contains(&source.id))
        {
            if sync_priority::is_sync_source(&sync_targets, source) {
                return Err(invalid(
                    "path",
                    "registered source is now reserved for removable storage sync",
                ));
            }
            let volume = unique_volume(&volumes, &source.volume_uuid, &source.partition_uuid)?;
            sync_priority::reject_sync_volume(&sync_targets, volume)?;
            let mut found = false;
            for mount_path in &volume.mount_points {
                let selection = SourceSelection {
                    device_path: volume.device_path.clone(),
                    mount_path: mount_path.clone(),
                    relative_path: source.relative_path.clone(),
                    domain: SourceDomain::Both,
                };
                let (_, _, current_root) = selected_root(&selection, &volumes, &mounts)?;
                if current_root == *root {
                    found = true;
                    break;
                }
            }
            if !found {
                return Err(invalid("path", "registered volume is unmounted or its mount path changed; source relocation is required"));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn domain_schema_matches_wire_literals() {
        let schema = <SourceDomain as zod_gen::ZodSchema>::zod_schema();
        for domain in [SourceDomain::Both, SourceDomain::Music, SourceDomain::Video] {
            let literal = serde_json::to_string(&domain).unwrap();
            assert!(schema.contains(&format!("z.literal({literal})")));
        }
    }

    async fn pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::database::run_schema_migrations(&pool).await.unwrap();
        pool
    }

    fn volume(device: &Path, mount: &Path) -> RemovableVolume {
        RemovableVolume {
            device_path: utf8_path(device).unwrap(),
            uuid: Some("test-uuid".into()),
            partition_uuid: Some("partition-1".into()),
            label: Some("music".into()),
            filesystem: "exfat".into(),
            mount_points: vec![utf8_path(mount).unwrap()],
            read_only: true,
            size_bytes: 100,
        }
    }

    #[tokio::test]
    async fn registration_is_idempotent_and_preserves_historical_roots_and_domain() {
        let pool = pool().await;
        let mount = Path::new("/media/pi/disk");
        let volume = volume(Path::new("/dev/sda1"), mount);
        let key = volume_key(&volume).unwrap();
        let source = save_source(
            &pool,
            &volume,
            &key,
            mount,
            &mount.join("music"),
            SourceDomain::Both,
        )
        .await
        .unwrap();
        assert_eq!(source.relative_path, "music");
        assert_eq!(source.domain, "both");
        let again = save_source(
            &pool,
            &volume,
            &key,
            mount,
            &mount.join("music"),
            SourceDomain::Video,
        )
        .await
        .unwrap();
        assert_eq!(source.id, again.id);
        let new_mount = Path::new("/media/pi/renamed");
        let moved = save_source(
            &pool,
            &volume,
            &key,
            new_mount,
            &new_mount.join("music"),
            SourceDomain::Video,
        )
        .await
        .unwrap();
        assert_eq!(source.id, moved.id);
        assert_eq!(list_sources(&pool).await.unwrap().len(), 1);
        let roots = protected_roots(&pool).await.unwrap();
        assert_eq!(roots.len(), 2);
        assert!(contains_path(
            &roots,
            "/media/pi/disk/music/album/song.flac"
        ));
        assert!(contains_path(&roots, "/media/pi/renamed/music/film.mp4"));
        assert!(!contains_path(
            &roots,
            "/media/pi/disk/music-other/song.flac"
        ));
        assert_eq!(get_source(&pool, &source.id).await.unwrap().domain, "video");
        assert!(get_source(&pool, "missing").await.is_err());
    }

    #[tokio::test]
    async fn multiple_subfolders_are_separate_sources_and_plain_scans_need_no_linux_probe() {
        let pool = pool().await;
        let mount = Path::new("/mnt/disk");
        let volume = volume(Path::new("/dev/sda1"), mount);
        let key = volume_key(&volume).unwrap();
        for folder in ["music", "videos"] {
            save_source(
                &pool,
                &volume,
                &key,
                mount,
                &mount.join(folder),
                SourceDomain::Both,
            )
            .await
            .unwrap();
        }
        assert_eq!(list_sources(&pool).await.unwrap().len(), 2);
        validate_scan_path(&pool, "/unrelated/library")
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn source_schema_applies_after_existing_migrations() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("../migrations").run(&pool).await.unwrap();
        assert!(list_sources(&pool).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn source_scans_skip_deleted_music_video_and_blob_paths_only_on_sources() {
        let pool = pool().await;
        sqlx::raw_sql(
            "INSERT INTO media_blobz (id, local_path, deleted_at) VALUES ('blob0001', '/mnt/disk/deleted.flac', 1),
               ('song0001', '/mnt/disk/song.flac', NULL),
               ('video001', '/mnt/disk/video.mp4', NULL),
               ('live0001', '/mnt/disk/live.mp4', NULL),
               ('other001', '/mnt/disk-other/deleted.flac', 1);
             INSERT INTO songz (id, media_blob_id, title, deleted_at) VALUES ('song0001', 'song0001', 'song', 1);
             INSERT INTO videoz (id, media_blob_id, title, deleted_at) VALUES ('video001', 'video001', 'video', 1);",
        )
        .execute(&pool)
        .await
        .unwrap();
        let mount = Path::new("/mnt/disk");
        let volume = volume(Path::new("/dev/sda1"), mount);
        save_source(
            &pool,
            &volume,
            &volume_key(&volume).unwrap(),
            mount,
            mount,
            SourceDomain::Both,
        )
        .await
        .unwrap();
        let skipped = deleted_source_paths(&pool).await.unwrap();
        assert_eq!(skipped.len(), 3);
        for path in [
            "/mnt/disk/deleted.flac",
            "/mnt/disk/song.flac",
            "/mnt/disk/video.mp4",
        ] {
            assert!(skipped.contains(path));
        }
        assert!(!skipped.contains("/mnt/disk/live.mp4"));
        assert!(!skipped.contains("/mnt/disk-other/deleted.flac"));
    }

    #[test]
    fn defaults_to_both_and_rejects_invalid_folder_inputs() {
        let selection: SourceSelection =
            serde_json::from_str(r#"{"device_path":"/dev/sda1","mount_path":"/mnt/disk"}"#)
                .unwrap();
        assert_eq!(selection.domain.as_str(), "both");
        assert_eq!(
            relative_path("./music/./albums").unwrap(),
            Path::new("music/albums")
        );
        assert!(relative_path("../music").is_err());
        assert!(relative_path("/etc").is_err());
        assert!(relative_path("music/../videos").is_err());
        assert!(serde_json::from_str::<SourceSelection>(
            r#"{"device_path":"x","mount_path":"x","domain":"bogus"}"#
        )
        .is_err());
        let mut anonymous = volume(Path::new("/dev/sda1"), Path::new("/mnt/disk"));
        anonymous.uuid = None;
        anonymous.partition_uuid = None;
        assert!(volume_key(&anonymous).is_err());
    }

    #[test]
    fn duplicate_disk_identities_are_not_guessed_but_partitions_are_distinct() {
        let first = volume(Path::new("/dev/sda1"), Path::new("/mnt/first"));
        let mut clone = first.clone();
        clone.device_path = "/dev/sdb1".into();
        assert!(unique_volume(
            &[first.clone(), clone.clone()],
            &first.uuid,
            &first.partition_uuid
        )
        .is_err());
        assert!(unique_volume(&[], &first.uuid, &first.partition_uuid).is_err());
        clone.partition_uuid = Some("partition-2".into());
        let volumes = [first.clone(), clone];
        assert_eq!(
            unique_volume(&volumes, &first.uuid, &first.partition_uuid)
                .unwrap()
                .device_path,
            first.device_path
        );
    }

    #[test]
    fn source_presence_requires_matching_identity_and_real_mount_not_leftover_directory() {
        let temp = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(temp.path()).unwrap();
        let device = root.join("device");
        std::fs::write(&device, "").unwrap();
        let volume = volume(&device, &root);
        let source = LibrarySource {
            id: "source".into(),
            volume_key: volume_key(&volume).unwrap(),
            volume_uuid: volume.uuid.clone(),
            partition_uuid: volume.partition_uuid.clone(),
            label: volume.label.clone(),
            relative_path: "music".into(),
            last_known_path: utf8_path(&root.join("music")).unwrap(),
            domain: "both".into(),
            created_at: 0,
        };
        let mounts = [Mount {
            device: utf8_path(&device).unwrap(),
            path: root.clone(),
        }];
        std::fs::create_dir(root.join("music")).unwrap();
        let mut relocated = source.clone();
        relocated.last_known_path = "/previous/location/music".into();
        assert_eq!(
            mounted_source_root(&relocated, &[volume.clone()], &mounts).unwrap(),
            Some(root.join("music"))
        );
        assert!(source_is_mounted(&source, &[volume.clone()], &mounts).unwrap());
        assert!(!source_is_mounted(&source, &[], &mounts).unwrap());
        let mut unmounted = volume.clone();
        unmounted.mount_points.clear();
        assert!(!source_is_mounted(&source, &[unmounted], &mounts).unwrap());
        assert!(source_is_mounted(&source, &[volume.clone()], &[]).is_err());
        assert!(source_is_mounted(&source, &[volume.clone(), volume.clone()], &mounts).is_err());
        let mut moved = volume.clone();
        moved.mount_points = vec!["/elsewhere".into()];
        assert!(source_is_mounted(&source, &[moved], &mounts).is_err());
        let mut multiple_mounts = volume.clone();
        multiple_mounts
            .mount_points
            .insert(0, "/another/bind/mount".into());
        assert!(source_is_mounted(&source, &[multiple_mounts], &mounts).unwrap());
        std::fs::remove_dir(root.join("music")).unwrap();
        assert!(!source_is_mounted(&source, &[volume], &mounts).unwrap());
    }

    #[test]
    fn verifies_actual_mount_and_rejects_disk_swaps_nested_mounts_and_symlink_escape() {
        let temp = tempfile::tempdir().unwrap();
        let mount = std::fs::canonicalize(temp.path()).unwrap();
        let device = mount.join("device");
        std::fs::write(&device, "").unwrap();
        let folder = mount.join("music");
        std::fs::create_dir(&folder).unwrap();
        let volume = volume(&device, &mount);
        let selection = SourceSelection {
            device_path: utf8_path(&device).unwrap(),
            mount_path: utf8_path(&mount).unwrap(),
            relative_path: "music".into(),
            domain: SourceDomain::Both,
        };
        let mounted = vec![Mount {
            device: utf8_path(&device).unwrap(),
            path: mount.clone(),
        }];
        assert!(selected_root(&selection, &[volume.clone()], &mounted).is_ok());
        assert!(selected_root(&selection, &[volume.clone()], &[]).is_err());
        let wrong = mount.join("other-device");
        std::fs::write(&wrong, "").unwrap();
        let swapped = vec![Mount {
            device: utf8_path(&wrong).unwrap(),
            path: mount.clone(),
        }];
        assert!(selected_root(&selection, &[volume.clone()], &swapped).is_err());
        let mut nested = mounted.clone();
        nested.push(Mount {
            device: utf8_path(&wrong).unwrap(),
            path: folder.clone(),
        });
        assert!(selected_root(&selection, &[volume.clone()], &nested).is_err());
        #[cfg(unix)]
        {
            let outside = tempfile::tempdir().unwrap();
            std::os::unix::fs::symlink(outside.path(), mount.join("escape")).unwrap();
            let escaping = SourceSelection {
                relative_path: "escape".into(),
                ..selection
            };
            assert!(selected_root(&escaping, &[volume], &mounted).is_err());
        }
    }

    #[test]
    fn folder_browser_is_one_level_and_omits_files_symlinks_and_nested_volumes() {
        let temp = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(temp.path()).unwrap();
        for path in ["a", "b", "nested-disk", "a/album"] {
            std::fs::create_dir(root.join(path)).unwrap();
        }
        std::fs::write(root.join("song.flac"), "").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.join("a"), root.join("alias")).unwrap();
        let mounts = vec![
            Mount {
                device: "/dev/sda1".into(),
                path: root.clone(),
            },
            Mount {
                device: "/dev/sdb1".into(),
                path: root.join("nested-disk"),
            },
        ];
        let folders = browse_root(&root, &root, &mounts).unwrap();
        assert_eq!(
            folders
                .iter()
                .map(|folder| folder.name.as_str())
                .collect::<Vec<_>>(),
            vec!["a", "b"]
        );
        assert_eq!(folders[0].relative_path, "a");
    }
}
