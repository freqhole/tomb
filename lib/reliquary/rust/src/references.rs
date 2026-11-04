//! verified registration of external files and recovery from stale transport paths.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use iroh_blobs::api::blobs::{AddPathOptions, ImportMode};
use iroh_blobs::store::fs::FsStore;
use iroh_blobs::{BlobFormat, Hash};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

#[derive(Debug, thiserror::Error)]
pub enum ReferenceError {
    #[error("file access failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("transport reference failed: {0}")]
    Store(String),
    #[error("file content does not match expected hash {expected}: {path}")]
    ContentChanged { expected: Hash, path: PathBuf },
    #[error(
        "transport entry does not serve the expected bytes for {0}; no source files were deleted"
    )]
    Unreadable(Hash),
}

#[derive(Debug, PartialEq, Eq)]
struct Stamp {
    path: PathBuf,
    size: u64,
    modified: SystemTime,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
    #[cfg(unix)]
    changed: (i64, i64),
}

impl Stamp {
    async fn read(path: &Path) -> Result<Self, ReferenceError> {
        let path = tokio::fs::canonicalize(path).await?;
        let meta = tokio::fs::metadata(&path).await?;
        if !meta.is_file() {
            return Err(std::io::Error::other("reference path is not a regular file").into());
        }
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;
        Ok(Self {
            path,
            size: meta.len(),
            modified: meta.modified()?,
            #[cfg(unix)]
            device: meta.dev(),
            #[cfg(unix)]
            inode: meta.ino(),
            #[cfg(unix)]
            changed: (meta.ctime(), meta.ctime_nsec()),
        })
    }
}

#[derive(Default)]
pub struct ReferenceRepair {
    entries: Mutex<HashMap<Hash, Arc<Mutex<Option<Stamp>>>>>,
}

impl ReferenceRepair {
    /// hash once per file version, serialize concurrent repairs, and never trust `has()`.
    pub async fn ensure(
        &self,
        store: &FsStore,
        hash: Hash,
        path: &Path,
    ) -> Result<(), ReferenceError> {
        let entry = self.entries.lock().await.entry(hash).or_default().clone();
        let mut verified = entry.lock().await;
        let before = Stamp::read(path).await?;
        if verified.as_ref() == Some(&before) {
            // force the transport to open its own source, even on a cached registration.
            let mut reader = store.blobs().reader(hash);
            let mut byte = [0];
            if matches!(reader.read(&mut byte).await, Ok(n) if n > 0 || before.size == 0) {
                return Ok(());
            }
        }
        *verified = None;
        let actual = crate::hash_file(&before.path)
            .await
            .map_err(|e| ReferenceError::Store(e.to_string()))?;
        if actual != hash.to_hex().as_str() {
            return Err(ReferenceError::ContentChanged {
                expected: hash,
                path: before.path,
            });
        }
        let tag = store
            .blobs()
            .add_path_with_opts(AddPathOptions {
                path: before.path.clone(),
                format: BlobFormat::Raw,
                mode: ImportMode::TryReference,
            })
            .await
            .map_err(|e| ReferenceError::Store(e.to_string()))?;
        if tag.hash != hash {
            return Err(ReferenceError::ContentChanged {
                expected: hash,
                path: before.path,
            });
        }
        verify_read(store, hash).await?;
        if Stamp::read(path).await? != before {
            return Err(ReferenceError::ContentChanged {
                expected: hash,
                path: before.path,
            });
        }
        store
            .sync_db()
            .await
            .map_err(|e| ReferenceError::Store(e.to_string()))?;
        *verified = Some(before);
        Ok(())
    }
}

/// use the fixed reader when upstream's path export still selects a missing path.
/// publication is no-clobber; failed exports never delete an existing target.
pub async fn export_from_reader(
    store: &FsStore,
    hash: Hash,
    target: &Path,
) -> Result<(), ReferenceError> {
    let parent = target
        .parent()
        .ok_or_else(|| std::io::Error::other("export has no parent"))?;
    let temporary = tempfile::NamedTempFile::new_in(parent)?.into_temp_path();
    let mut output = tokio::fs::OpenOptions::new()
        .write(true)
        .open(&temporary)
        .await?;
    let mut input = store.blobs().reader(hash);
    let mut hasher = blake3::Hasher::new();
    let mut buffer = vec![0; 128 * 1024];
    loop {
        let n = input.read(&mut buffer).await?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
        output.write_all(&buffer[..n]).await?;
    }
    if hasher.finalize().as_bytes() != hash.as_bytes() {
        return Err(ReferenceError::Unreadable(hash));
    }
    output.sync_all().await?;
    drop(output);
    temporary.persist_noclobber(target).map_err(|e| e.error)?;
    #[cfg(unix)]
    tokio::fs::File::open(parent).await?.sync_all().await?;
    Ok(())
}

pub async fn verify_read(store: &FsStore, hash: Hash) -> Result<(), ReferenceError> {
    let mut reader = store.blobs().reader(hash);
    let mut hasher = blake3::Hasher::new();
    let mut buffer = vec![0; 128 * 1024];
    loop {
        let read = reader.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    if hasher.finalize().as_bytes() != hash.as_bytes() {
        return Err(ReferenceError::Unreadable(hash));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn repairs_missing_first_path_and_persists_without_media_copy() {
        let temp = tempfile::tempdir().unwrap();
        let root = tokio::fs::canonicalize(temp.path()).await.unwrap();
        let old = root.join("a-old");
        let new = root.join("z-new");
        let bytes = vec![3; 1024 * 1024];
        let hash = Hash::new(&bytes);
        tokio::fs::write(&old, &bytes).await.unwrap();
        let store = FsStore::load(root.join("store")).await.unwrap();
        let repair = ReferenceRepair::default();
        repair.ensure(&store, hash, &old).await.unwrap();
        store.shutdown().await.unwrap();
        drop(store);
        tokio::fs::rename(&old, &new).await.unwrap();
        let store = FsStore::load(root.join("store")).await.unwrap();
        assert!(store.blobs().has(hash).await.unwrap());
        assert!(verify_read(&store, hash).await.is_err());
        let repair = ReferenceRepair::default();
        let (one, two) = tokio::join!(
            repair.ensure(&store, hash, &new),
            repair.ensure(&store, hash, &new)
        );
        one.unwrap();
        two.unwrap();
        store.shutdown().await.unwrap();
        drop(store);
        let store = FsStore::load(root.join("store")).await.unwrap();
        verify_read(&store, hash).await.unwrap();
        let export = root.join("export");
        export_from_reader(&store, hash, &export).await.unwrap();
        assert_eq!(tokio::fs::read(&export).await.unwrap(), bytes);
        tokio::fs::remove_file(&new).await.unwrap();
        store.shutdown().await.unwrap();
        drop(store);
        let store = FsStore::load(root.join("store")).await.unwrap();
        assert!(
            verify_read(&store, hash).await.is_err(),
            "repair must not silently copy media into the store"
        );
        store.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn rejects_changed_content_and_does_not_cache_failure() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("media");
        let store = FsStore::load(temp.path().join("store")).await.unwrap();
        let repair = ReferenceRepair::default();
        let bytes = vec![1; 1024 * 1024];
        let hash = Hash::new(&bytes);
        tokio::fs::write(&path, &bytes).await.unwrap();
        repair.ensure(&store, hash, &path).await.unwrap();
        tokio::fs::write(&path, vec![2; bytes.len()]).await.unwrap();
        assert!(matches!(
            repair.ensure(&store, hash, &path).await,
            Err(ReferenceError::ContentChanged { .. })
        ));
        tokio::fs::write(&path, &bytes).await.unwrap();
        repair.ensure(&store, hash, &path).await.unwrap();
        tokio::fs::remove_file(&path).await.unwrap();
        assert!(repair.ensure(&store, hash, &path).await.is_err());
        store.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn reader_export_never_overwrites_an_existing_file() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("existing");
        tokio::fs::write(&target, b"keep me").await.unwrap();
        let store = FsStore::load(temp.path().join("store")).await.unwrap();
        let tag = store.blobs().add_bytes(vec![9; 100]).await.unwrap();
        assert!(export_from_reader(&store, tag.hash, &target).await.is_err());
        assert_eq!(tokio::fs::read(target).await.unwrap(), b"keep me");
        store.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn canonical_export_reopens_large_owned_bytes_after_staging_cleanup() {
        let temp = tempfile::tempdir().unwrap();
        let root = tokio::fs::canonicalize(temp.path()).await.unwrap();
        let store_path = root.join("store");
        let store = FsStore::load(&store_path).await.unwrap();
        let bytes = vec![5; 2 * 1024 * 1024];
        let tag = store.blobs().add_bytes(bytes.clone()).await.unwrap();
        let blobz: Arc<dyn crate::blobz::BlobStore> = Arc::new(crate::blobz::SqliteBlobStore::new(
            crate::db::open_in_memory().await,
            &root,
        ));
        let target = crate::node::export_try_reference(&store, tag.hash, &blobz)
            .await
            .unwrap();
        assert_eq!(tokio::fs::read(&target).await.unwrap(), bytes);
        assert!(std::fs::read_dir(target.parent().unwrap())
            .unwrap()
            .all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".freqhole-export-")));
        store.shutdown().await.unwrap();
        drop(store);
        let store = FsStore::load(&store_path).await.unwrap();
        verify_read(&store, tag.hash).await.unwrap();
        store.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn canonical_export_recovers_missing_first_path_and_keeps_conflicts() {
        let temp = tempfile::tempdir().unwrap();
        let root = tokio::fs::canonicalize(temp.path()).await.unwrap();
        let old = root.join("a-old");
        let new = root.join("z-new");
        let bytes = vec![6; 1024 * 1024];
        let hash = Hash::new(&bytes);
        tokio::fs::write(&old, &bytes).await.unwrap();
        let store = FsStore::load(root.join("store")).await.unwrap();
        crate::node::import_try_reference(&store, &old)
            .await
            .unwrap();
        store.sync_db().await.unwrap();
        store.shutdown().await.unwrap();
        drop(store);
        tokio::fs::rename(old, &new).await.unwrap();
        let store = FsStore::load(root.join("store")).await.unwrap();
        ReferenceRepair::default()
            .ensure(&store, hash, &new)
            .await
            .unwrap();
        store.shutdown().await.unwrap();
        drop(store);
        let store = FsStore::load(root.join("store")).await.unwrap();
        let blobz: Arc<dyn crate::blobz::BlobStore> = Arc::new(crate::blobz::SqliteBlobStore::new(
            crate::db::open_in_memory().await,
            &root,
        ));
        let target = crate::node::export_try_reference(&store, hash, &blobz)
            .await
            .unwrap();
        assert_eq!(tokio::fs::read(&target).await.unwrap(), bytes);
        tokio::fs::write(&target, b"keep conflicting bytes")
            .await
            .unwrap();
        assert!(crate::node::export_try_reference(&store, hash, &blobz)
            .await
            .is_err());
        assert_eq!(
            tokio::fs::read(&target).await.unwrap(),
            b"keep conflicting bytes"
        );
        store.shutdown().await.unwrap();
    }
}
