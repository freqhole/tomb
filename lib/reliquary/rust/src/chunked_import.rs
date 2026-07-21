//! chunked_import: accumulate an upload's bytes into a temp file on disk
//! across multiple calls, then adopt the finished file into a `BlobStore`.
//!
//! bytes arrive incrementally (e.g. one http request body chunk at a time)
//! and never need to fit in memory all at once: `begin` creates an empty
//! temp file, `append` streams chunks onto it, and `finish` adopts the
//! finished file into a store via [`BlobStore::adopt_local_file`] (streamed
//! hash, no double buffering).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use tokio::io::AsyncWriteExt;

use crate::blobz::{BlobRecord, BlobStore, BlobStoreError, NewBlobMeta};

/// tracks in-flight chunked uploads: bytes arrive incrementally (e.g. one
/// http request body chunk at a time) and accumulate into a temp file on
/// disk, so a large upload never needs to fit in memory at once. finishing
/// an upload adopts the finished temp file into a `BlobStore` via
/// `adopt_local_file` - streamed hash, no double buffering.
pub struct ChunkedImport {
    dir: PathBuf,
    uploads: Mutex<HashMap<String, PathBuf>>,
    counter: AtomicU64,
}

impl ChunkedImport {
    /// uploads accumulate under `dir` (created if missing) before being
    /// adopted into a store.
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            uploads: Mutex::new(HashMap::new()),
            counter: AtomicU64::new(0),
        }
    }

    /// begin a new upload: creates an empty temp file, returns an id the
    /// caller passes to the other methods.
    pub async fn begin(&self) -> Result<String, BlobStoreError> {
        tokio::fs::create_dir_all(&self.dir).await?;

        let seq = self.counter.fetch_add(1, Ordering::Relaxed);
        let upload_id = format!("upload-{}-{seq}", std::process::id());
        let path = self.dir.join(format!("{upload_id}.part"));

        // create (or truncate) the temp file so appends start clean.
        tokio::fs::File::create(&path).await?;

        self.uploads.lock().unwrap().insert(upload_id.clone(), path);

        Ok(upload_id)
    }

    /// append a chunk of bytes to an in-flight upload. returns the total
    /// number of bytes written so far.
    pub async fn append(&self, upload_id: &str, data: &[u8]) -> Result<u64, BlobStoreError> {
        let path = self.path_for(upload_id)?;

        let mut file = tokio::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .await?;
        file.write_all(data).await?;
        file.flush().await?;

        Ok(tokio::fs::metadata(&path).await?.len())
    }

    /// finish an upload: adopts the accumulated file into `store` via
    /// `adopt_local_file`, clearing the in-flight session either way.
    pub async fn finish(
        &self,
        upload_id: &str,
        store: &dyn BlobStore,
        meta: NewBlobMeta,
    ) -> Result<BlobRecord, BlobStoreError> {
        let path = self.take(upload_id)?;
        store.adopt_local_file(&path, meta).await
    }

    /// abort an in-flight upload: deletes the temp file and clears the
    /// session. safe to call with an unknown id (no-op).
    pub async fn abort(&self, upload_id: &str) {
        let path = self.uploads.lock().unwrap().remove(upload_id);
        if let Some(path) = path {
            if let Err(e) = tokio::fs::remove_file(&path).await {
                tracing::warn!(
                    path = %path.display(),
                    error = %e,
                    "chunked_import: failed to remove aborted upload's temp file"
                );
            }
        }
    }

    /// the temp file path for an in-flight upload id, without removing the
    /// session.
    fn path_for(&self, upload_id: &str) -> Result<PathBuf, BlobStoreError> {
        self.uploads
            .lock()
            .unwrap()
            .get(upload_id)
            .cloned()
            .ok_or_else(|| unknown_upload(upload_id))
    }

    /// the temp file path for an in-flight upload id, removing the session
    /// so it can't be finished or appended to twice.
    fn take(&self, upload_id: &str) -> Result<PathBuf, BlobStoreError> {
        self.uploads
            .lock()
            .unwrap()
            .remove(upload_id)
            .ok_or_else(|| unknown_upload(upload_id))
    }
}

fn unknown_upload(upload_id: &str) -> BlobStoreError {
    BlobStoreError::NotFound(format!("unknown chunked upload id: {upload_id}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blobz::SqliteBlobStore;

    async fn test_store(data_dir: &std::path::Path) -> SqliteBlobStore {
        let pool = crate::db::open_in_memory().await;
        SqliteBlobStore::new(pool, data_dir)
    }

    #[tokio::test]
    async fn begin_append_finish_adopts_the_right_bytes() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let store = test_store(tmp.path()).await;
        let import = ChunkedImport::new(tmp.path().join("uploads"));

        let upload_id = import.begin().await.expect("begin");

        let total_after_first = import
            .append(&upload_id, b"hello, ")
            .await
            .expect("append first chunk");
        assert_eq!(total_after_first, 7);
        let total_after_second = import
            .append(&upload_id, b"chunked world!")
            .await
            .expect("append second chunk");
        assert_eq!(total_after_second, 7 + 14);

        let record = import
            .finish(&upload_id, &store, NewBlobMeta::default())
            .await
            .expect("finish");

        let expected_bytes = b"hello, chunked world!";
        assert_eq!(record.size, expected_bytes.len() as u64);
        assert_eq!(
            record.blake3,
            blake3::hash(expected_bytes).to_hex().to_string()
        );
        assert!(!record.external);

        let read_back = store
            .read_bytes(&record.blake3)
            .await
            .expect("read_bytes")
            .expect("bytes present");
        assert_eq!(read_back, expected_bytes);
    }

    #[tokio::test]
    async fn abort_removes_the_temp_file_and_invalidates_the_id() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let store = test_store(tmp.path()).await;
        let import = ChunkedImport::new(tmp.path().join("uploads"));

        let upload_id = import.begin().await.expect("begin");
        import
            .append(&upload_id, b"will be aborted")
            .await
            .expect("append");

        import.abort(&upload_id).await;

        let append_err = import
            .append(&upload_id, b"too late")
            .await
            .expect_err("append after abort must fail");
        assert!(matches!(append_err, BlobStoreError::NotFound(_)));

        let finish_err = import
            .finish(&upload_id, &store, NewBlobMeta::default())
            .await
            .expect_err("finish after abort must fail");
        assert!(matches!(finish_err, BlobStoreError::NotFound(_)));
    }

    #[tokio::test]
    async fn finishing_or_aborting_an_unknown_id_does_not_panic() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let store = test_store(tmp.path()).await;
        let import = ChunkedImport::new(tmp.path().join("uploads"));

        // never called begin() at all.
        import.abort("never-existed").await;

        let finish_err = import
            .finish("never-existed", &store, NewBlobMeta::default())
            .await
            .expect_err("finish on an unknown id must fail, not panic");
        assert!(matches!(finish_err, BlobStoreError::NotFound(_)));
    }
}
