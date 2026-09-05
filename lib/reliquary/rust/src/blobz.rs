//! blobz: reliquary's sqlite-backed content-addressed blob store.
//!
//! keyed by blake3 (hex). each blob has a filesystem copy (managed, under
//! `data_dir/blob-files/<prefix>/<rest>`, or external, an absolute path the
//! store doesn't own) and a row in the `blobz` table with metadata. no
//! entity_id, no domain - a blob is a blob. `SqliteBlobStore` implements the
//! `BlobStore` trait from `docs/storage-traits.md` - callers should hold
//! `Arc<dyn BlobStore>`, not the concrete struct, except at the point of
//! construction where sqlite-specific inherent methods (like `blob_dir()`)
//! are needed.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::SqlitePool;
use thiserror::Error;

const BLOB_FILES_DIR: &str = "blob-files";

#[derive(Debug, Error)]
pub enum BlobStoreError {
    #[error("storage backend error: {0}")]
    Storage(String),

    #[error("io error: {0}")]
    Io(String),

    #[error("blake3 mismatch: expected {expected}, got {actual}")]
    HashMismatch { expected: String, actual: String },

    #[error("operation cancelled")]
    Cancelled,

    #[error("not found: {0}")]
    NotFound(String),
}

impl From<sqlx::Error> for BlobStoreError {
    fn from(e: sqlx::Error) -> Self {
        BlobStoreError::Storage(e.to_string())
    }
}

impl From<std::io::Error> for BlobStoreError {
    fn from(e: std::io::Error) -> Self {
        BlobStoreError::Io(e.to_string())
    }
}

/// original | thumbnail | waveform | preview.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum BlobType {
    #[default]
    Original,
    Thumbnail,
    Waveform,
    Preview,
}

impl BlobType {
    fn as_str(self) -> &'static str {
        match self {
            BlobType::Original => "original",
            BlobType::Thumbnail => "thumbnail",
            BlobType::Waveform => "waveform",
            BlobType::Preview => "preview",
        }
    }

    /// parse a db-stored blob_type string. any unrecognized value falls back
    /// to `Original` rather than erroring - the column always originates
    /// from `as_str()` above, so this only matters for hand-edited rows.
    fn from_db(s: &str) -> Self {
        match s {
            "thumbnail" => BlobType::Thumbnail,
            "waveform" => BlobType::Waveform,
            "preview" => BlobType::Preview,
            _ => BlobType::Original,
        }
    }
}

/// sort field for `list_filtered` - deliberately a closed enum (not a raw
/// column name string) so the resulting `ORDER BY` clause is always built
/// from a fixed, safe set of column names, never user input.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum BlobSortField {
    #[default]
    CreatedAt,
    Size,
    Filename,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SortDirection {
    #[default]
    Desc,
    Asc,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlobRecord {
    pub blake3: String,
    pub iroh_hash: Option<String>,
    pub sha256: Option<String>,
    pub old_grimoire_id: Option<String>,
    pub filename: Option<String>,
    pub mime: Option<String>,
    pub size: u64,
    pub path: String,
    pub external: bool,
    pub blob_type: BlobType,
    pub parent_blake3: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub metadata: Option<JsonValue>,
    pub created_at: i64,
    pub soft_deleted_at: Option<i64>,
    pub soft_deleted_by: Option<String>,
}

/// ingest metadata as one struct, not a growing list of positional args.
#[derive(Debug, Clone, Default)]
pub struct NewBlobMeta {
    pub filename: Option<String>,
    pub mime: Option<String>,
    pub blob_type: BlobType,
    pub parent_blake3: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub metadata: Option<JsonValue>,
}

#[derive(Debug, Clone, Default)]
pub struct SoftDeleteOutcome {
    pub affected: u64,
    pub failed: Vec<String>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct UsageStats {
    pub total_bytes: u64,
    pub count: u64,
}

/// the reliquary `BlobStore` contract - see `docs/storage-traits.md` in the
/// reliquary repo for the full design rationale. `SqliteBlobStore` is the
/// only implementation in this crate; consumers should hold `Arc<dyn
/// BlobStore>` wherever practical.
#[async_trait]
pub trait BlobStore: Send + Sync {
    /// hash `bytes`, write them to the canonical content-addressed path, and
    /// record a row. dedupes on blake3 - if the content is already present,
    /// returns the existing record without rewriting anything.
    async fn insert(&self, bytes: &[u8], meta: NewBlobMeta) -> Result<BlobRecord, BlobStoreError>;

    /// the canonical absolute path for a blake3 hash, creating parent
    /// directories as needed. used by callers that place bytes themselves
    /// (e.g. a streamed export from an iroh-blobs store) before calling
    /// `register_ingested`.
    async fn prepare_canonical_path(&self, blake3: &str) -> Result<PathBuf, BlobStoreError>;

    /// record metadata for a blob whose bytes are already at the canonical
    /// path (see `prepare_canonical_path`). no hashing pass runs - the
    /// caller vouches for the blake3 (e.g. it came out of a verified
    /// iroh-blobs transfer). dedupes on blake3.
    async fn register_ingested(
        &self,
        blake3: &str,
        meta: NewBlobMeta,
    ) -> Result<BlobRecord, BlobStoreError>;

    /// register an existing on-disk file without copying its bytes; only
    /// metadata is recorded, and the file stays where it is. streams the
    /// file through blake3 so large files never load fully into memory.
    /// `on_progress` is throttled internally (roughly every 4MB plus once at
    /// completion); `cancel` allows aborting mid-hash. dedupes on blake3 -
    /// if a matching row already exists but is `external` and its recorded
    /// path no longer resolves to a real file (moved/renamed/deleted since
    /// registration), the row is repaired to point at `abs_path` instead of
    /// silently returning a row known to be stale.
    async fn register_external_path(
        &self,
        abs_path: &Path,
        meta: NewBlobMeta,
        on_progress: Option<&(dyn Fn(u64, u64) + Send + Sync)>,
        cancel: Option<&AtomicBool>,
    ) -> Result<BlobRecord, BlobStoreError>;

    /// take ownership of a file already on disk into managed (canonical,
    /// content-addressed) storage: streams the file through blake3 (never
    /// loads it fully into memory - the same streaming approach
    /// `register_external_path` already uses), then moves it into the
    /// store's canonical `<blake3-prefix>/<blake3-rest>` location instead of
    /// leaving it where it was. unlike `register_external_path`, the source
    /// file is consumed - gone from its original location on success (an
    /// atomic rename when possible, falling back to copy-then-delete across
    /// filesystem boundaries), untouched if the call fails. dedupes on
    /// blake3 like every other insert path: if matching content is already
    /// stored, the source file is still removed (its bytes are now
    /// redundant) and the existing record is returned unchanged.
    async fn adopt_local_file(
        &self,
        path: &Path,
        meta: NewBlobMeta,
    ) -> Result<BlobRecord, BlobStoreError>;

    /// resolve by blake3, excluding soft-deleted rows.
    async fn get(&self, blake3: &str) -> Result<Option<BlobRecord>, BlobStoreError>;

    /// resolve by blake3, including soft-deleted rows. used by callers (like
    /// the snatch engine) that must not re-fetch something an admin
    /// soft-deleted.
    async fn get_any(&self, blake3: &str) -> Result<Option<BlobRecord>, BlobStoreError>;

    /// resolve by the legacy iroh content hash (kept while iroh_hash and
    /// blake3 could diverge during migration; usually equal to blake3 today).
    async fn get_by_iroh_hash(&self, iroh_hash: &str)
        -> Result<Option<BlobRecord>, BlobStoreError>;

    /// resolve by the legacy sha256 secondary index. never a lookup
    /// requirement for new code - exists for migration-era resolution only.
    async fn get_by_sha256(&self, sha256: &str) -> Result<Option<BlobRecord>, BlobStoreError>;

    /// resolve by tomb's pre-migration short-hex grimoire blob id.
    async fn get_by_old_id(
        &self,
        old_grimoire_id: &str,
    ) -> Result<Option<BlobRecord>, BlobStoreError>;

    /// batch resolve: the app-level join helper referenced in the phase doc.
    /// default impl loops `get_any`; the sqlite impl overrides this with one
    /// `WHERE blake3 IN (...)` query.
    async fn blobs_for(
        &self,
        blake3s: &[String],
    ) -> Result<HashMap<String, BlobRecord>, BlobStoreError> {
        let mut out = HashMap::with_capacity(blake3s.len());
        for hash in blake3s {
            if let Some(record) = self.get_any(hash).await? {
                out.insert(hash.clone(), record);
            }
        }
        Ok(out)
    }

    /// read the full bytes of a (non-soft-deleted) blob.
    async fn read_bytes(&self, blake3: &str) -> Result<Option<Vec<u8>>, BlobStoreError>;

    /// the absolute path for a record (external records return `record.path`
    /// verbatim; managed records resolve it under the store's blob dir).
    fn path_for(&self, record: &BlobRecord) -> PathBuf;

    /// mark hashes soft-deleted, stamped with `actor`. never touches files.
    /// hashes that don't exist or are already soft-deleted land in
    /// `SoftDeleteOutcome::failed`.
    async fn soft_delete(
        &self,
        blake3s: &[String],
        actor: &str,
    ) -> Result<SoftDeleteOutcome, BlobStoreError>;

    /// clear soft-delete markers. hashes not currently soft-deleted land in
    /// `failed`.
    async fn restore(&self, blake3s: &[String]) -> Result<SoftDeleteOutcome, BlobStoreError>;

    /// permanently delete soft-deleted rows (and their managed files;
    /// external files are never touched). `None` purges every soft-deleted
    /// row; `Some` only qualifies rows that are currently soft-deleted.
    async fn hard_delete_soft_deleted(
        &self,
        blake3s: Option<&[String]>,
    ) -> Result<SoftDeleteOutcome, BlobStoreError>;

    /// paginated, non-soft-deleted, most recent first.
    async fn list(&self, limit: i64, offset: i64)
        -> Result<(Vec<BlobRecord>, u64), BlobStoreError>;

    /// paginated, non-soft-deleted, sortable by `sort`/`direction`, and
    /// optionally filtered to filenames containing `search` (case-sensitive
    /// substring, sqlite `LIKE`). returns `(page, total_count, total_size)`
    /// where the latter two reflect every row matching `search` (not just
    /// this page) - lets a caller show "N files, X total" without a
    /// separate round trip. used by the filez widget's local-files tab.
    async fn list_filtered(
        &self,
        limit: i64,
        offset: i64,
        sort: BlobSortField,
        direction: SortDirection,
        search: Option<&str>,
    ) -> Result<(Vec<BlobRecord>, u64, u64), BlobStoreError>;

    /// paginated soft-deleted rows with total count.
    async fn list_soft_deleted(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<BlobRecord>, u64), BlobStoreError>;

    /// every blake3 hash in the store, including soft-deleted rows. used by
    /// the iroh-blobs gc protect callback (soft-deleted blobs keep their
    /// files until hard-deleted, so gc must not sweep them).
    async fn list_all_iroh_hashes(&self) -> Result<Vec<String>, BlobStoreError>;

    /// total bytes + row count, excluding soft-deleted.
    async fn total_usage(&self) -> Result<UsageStats, BlobStoreError>;

    /// total bytes + row count, soft-deleted rows only.
    async fn soft_deleted_usage(&self) -> Result<UsageStats, BlobStoreError>;

    /// blobs whose `parent_blake3` is `parent`, optionally filtered to one
    /// `blob_type`.
    async fn children_of(
        &self,
        parent_blake3: &str,
        blob_type: Option<BlobType>,
    ) -> Result<Vec<BlobRecord>, BlobStoreError>;

    /// the single derived blob of `blob_type` for `parent`, if any (e.g. "the
    /// thumbnail for this blake3", where the relation is 1:1 per type).
    async fn derived(
        &self,
        parent_blake3: &str,
        blob_type: BlobType,
    ) -> Result<Option<BlobRecord>, BlobStoreError>;

    /// record that `canvas_doc_id` currently has a widget referencing
    /// `blake3` - lets a widget-delete cleanup check whether purging the
    /// blob's local bytes would break another widget still using it,
    /// without iterating every canvas. idempotent: re-adding an existing
    /// ref is a no-op, not an error.
    async fn add_canvas_ref(&self, blake3: &str, canvas_doc_id: &str)
        -> Result<(), BlobStoreError>;

    /// remove a single canvas/blob reference (e.g. the widget was deleted,
    /// or its blobId changed). removing a ref that doesn't exist is a
    /// no-op.
    async fn remove_canvas_ref(
        &self,
        blake3: &str,
        canvas_doc_id: &str,
    ) -> Result<(), BlobStoreError>;

    /// every canvas doc id currently referencing `blake3`.
    async fn canvas_refs_for_blob(&self, blake3: &str) -> Result<Vec<String>, BlobStoreError>;

    /// remove every ref row for `canvas_doc_id` (e.g. the whole canvas was
    /// deleted) - bulk cleanup, not per-blob.
    async fn remove_all_canvas_refs(&self, canvas_doc_id: &str) -> Result<(), BlobStoreError>;
}

/// the sqlite-backed `BlobStore` impl, against reliquary's own `reliquary.db`.
#[derive(Clone)]
pub struct SqliteBlobStore {
    pool: SqlitePool,
    blob_dir: PathBuf,
}

impl SqliteBlobStore {
    /// `data_dir` is absolutized (lexically, via `std::path::absolute` -
    /// joined against the current process cwd if relative, no filesystem
    /// access, no requirement that it already exist) before being joined
    /// into `blob_dir`.
    ///
    /// this matters because `iroh_blobs::store::fs`'s `export_path_impl`
    /// hard-requires `target.is_absolute()` and returns `io::ErrorKind::
    /// InvalidInput` ("path is not absolute") otherwise - a relative
    /// `data_dir` (e.g. a relative path straight out of a toml config,
    /// which is exactly what tumulus passes in) used to make every single
    /// `download_blob()` export fail with that error, permanently, for
    /// every blob (confirmed via `tumulus.log`: `target=tumulus/hub-dev-
    /// data/blob-files/...` - a path relative to whatever cwd tumulus
    /// happened to be launched from, not an absolute one) - see
    /// `/memories/repo/blob-fetch-linux-bug.md`-adjacent
    /// `/memories/repo/skein-tumulus-*` notes for the broader hub sync
    /// bug hunt this was found during.
    pub fn new(pool: SqlitePool, data_dir: &Path) -> Self {
        let blob_dir = std::path::absolute(data_dir.join(BLOB_FILES_DIR))
            .unwrap_or_else(|_| data_dir.join(BLOB_FILES_DIR));
        tracing::info!(
            data_dir = %data_dir.display(),
            blob_dir = %blob_dir.display(),
            is_absolute = blob_dir.is_absolute(),
            "SqliteBlobStore::new: resolved blob_dir"
        );
        Self { pool, blob_dir }
    }

    /// the absolute path to the managed blob-files directory. sqlite-impl
    /// specific (e.g. for admin disk-usage reporting that stats the
    /// filesystem directly) - not part of the `BlobStore` trait.
    pub fn blob_dir(&self) -> &Path {
        &self.blob_dir
    }

    /// shared insert-or-ignore-then-reread path used by `insert`,
    /// `register_ingested`, and `register_external_path`. the dedup check
    /// happens against `get_any` (not `get`) so re-registering content whose
    /// prior row was soft-deleted resolves the existing row instead of
    /// racing an `ON CONFLICT DO NOTHING` against a row `get` can't see.
    async fn insert_row(
        &self,
        blake3: &str,
        iroh_hash: &str,
        path: &str,
        size: i64,
        external: bool,
        meta: NewBlobMeta,
    ) -> Result<BlobRecord, BlobStoreError> {
        let external_flag: i64 = external as i64;
        let blob_type_str = meta.blob_type.as_str();
        let width = meta.width.map(|w| w as i64);
        let height = meta.height.map(|h| h as i64);
        let metadata_json = match meta.metadata {
            Some(v) => Some(
                serde_json::to_string(&v).map_err(|e| BlobStoreError::Storage(e.to_string()))?,
            ),
            None => None,
        };
        let created_at = now_secs();

        // `ON CONFLICT DO NOTHING`: blake3 is the primary key, so two tasks
        // racing to insert the same content (both having missed the
        // `get_any` check above) must not surface a unique-constraint error
        // to either caller - the loser's insert silently no-ops and both
        // callers read back the same canonical row below.
        sqlx::query(
            r#"
            INSERT INTO blobz (
                blake3, iroh_hash, filename, mime, size, path, external,
                blob_type, parent_blake3, width, height, metadata, created_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
            ON CONFLICT (blake3) DO NOTHING
            "#,
        )
        .bind(blake3)
        .bind(iroh_hash)
        .bind(meta.filename)
        .bind(meta.mime)
        .bind(size)
        .bind(path)
        .bind(external_flag)
        .bind(blob_type_str)
        .bind(meta.parent_blake3)
        .bind(width)
        .bind(height)
        .bind(metadata_json)
        .bind(created_at)
        .execute(&self.pool)
        .await?;

        self.get_any(blake3).await?.ok_or_else(|| {
            BlobStoreError::Storage("row must exist immediately after insert-or-ignore".to_string())
        })
    }
}

#[async_trait]
impl BlobStore for SqliteBlobStore {
    async fn insert(&self, bytes: &[u8], meta: NewBlobMeta) -> Result<BlobRecord, BlobStoreError> {
        let blake3 = blake3::hash(bytes).to_hex().to_string();

        // fast path: avoid the disk write below if we already have this
        // content. this is only an optimization, not a correctness
        // guarantee - two callers can both miss here and race into
        // `insert_row`, which is safe against a concurrent duplicate.
        if let Some(existing) = self.get_any(&blake3).await? {
            return Ok(existing);
        }

        let (prefix, rest) = blake3.split_at(2);
        let dir = self.blob_dir.join(prefix);
        tokio::fs::create_dir_all(&dir).await?;
        let abs_path = dir.join(rest);
        // same content -> same bytes at the same content-addressed path, so
        // a second concurrent writer clobbering this file is harmless.
        tokio::fs::write(&abs_path, bytes).await?;

        let rel_path = format!("{prefix}/{rest}");
        self.insert_row(&blake3, &blake3, &rel_path, bytes.len() as i64, false, meta)
            .await
    }

    async fn prepare_canonical_path(&self, blake3: &str) -> Result<PathBuf, BlobStoreError> {
        let (prefix, rest) = blake3.split_at(2);
        let dir = self.blob_dir.join(prefix);
        tokio::fs::create_dir_all(&dir).await?;
        Ok(dir.join(rest))
    }

    async fn register_ingested(
        &self,
        blake3: &str,
        meta: NewBlobMeta,
    ) -> Result<BlobRecord, BlobStoreError> {
        let (prefix, rest) = blake3.split_at(2);
        let rel_path = format!("{prefix}/{rest}");
        let abs_path = self.blob_dir.join(prefix).join(rest);

        if let Some(existing) = self.get_any(blake3).await? {
            // a previously-ingested row can be stale: a prior snatch may
            // have treated a truncated/0-byte export as complete (see
            // reliquary's snatch engine's "no data transferred, but
            // fs_store already has this blob" resume path), registering a
            // row whose `size` doesn't match what's actually on disk. if
            // the file has SINCE been re-exported with real bytes (e.g. a
            // later successful re-download after the caller detected the
            // mismatch and retried), repair the row instead of handing back
            // a permanently-wrong size forever - otherwise every future
            // caller that trusts this row's size to validate its own copy
            // (see `SnatchEngine::local_blob_presence`) would treat it as
            // corrupt again and re-download in an endless loop.
            if !existing.external {
                if let Ok(actual_meta) = tokio::fs::metadata(&abs_path).await {
                    let actual_size = actual_meta.len() as i64;
                    if actual_size > 0 && actual_size != existing.size as i64 {
                        tracing::warn!(
                            blake3,
                            recorded_size = existing.size,
                            actual_size,
                            "register_ingested: existing row's size didn't \
                             match the file on disk - repairing"
                        );
                        sqlx::query("UPDATE blobz SET size = ?1 WHERE blake3 = ?2")
                            .bind(actual_size)
                            .bind(blake3)
                            .execute(&self.pool)
                            .await?;
                        return self.get_any(blake3).await?.ok_or_else(|| {
                            BlobStoreError::Storage(
                                "row vanished immediately after repair update".to_string(),
                            )
                        });
                    }
                }
            }
            return Ok(existing);
        }

        let size = tokio::fs::metadata(&abs_path).await?.len() as i64;

        self.insert_row(blake3, blake3, &rel_path, size, false, meta)
            .await
    }

    async fn register_external_path(
        &self,
        abs_path: &Path,
        meta: NewBlobMeta,
        on_progress: Option<&(dyn Fn(u64, u64) + Send + Sync)>,
        cancel: Option<&AtomicBool>,
    ) -> Result<BlobRecord, BlobStoreError> {
        if !abs_path.is_absolute() {
            return Err(BlobStoreError::Io(format!(
                "register_external_path requires an absolute path, got {abs_path:?}"
            )));
        }

        let total_size = tokio::fs::metadata(abs_path).await?.len();

        // stream the file through blake3 + count bytes.
        use tokio::io::AsyncReadExt;
        let mut file = tokio::fs::File::open(abs_path).await?;
        let mut hasher = blake3::Hasher::new();
        let mut size: i64 = 0;
        let mut since_last_report: u64 = 0;
        const PROGRESS_REPORT_BYTES: u64 = 4 * 1024 * 1024;
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            if let Some(c) = cancel {
                if c.load(Ordering::Relaxed) {
                    return Err(BlobStoreError::Cancelled);
                }
            }
            let n = file.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            size += n as i64;
            since_last_report += n as u64;
            if since_last_report >= PROGRESS_REPORT_BYTES {
                since_last_report = 0;
                if let Some(cb) = on_progress {
                    cb(size as u64, total_size);
                }
            }
        }
        drop(file);
        if let Some(cb) = on_progress {
            cb(size as u64, total_size);
        }
        let blake3_hex = hasher.finalize().to_hex().to_string();
        let path_str = abs_path.to_string_lossy().to_string();

        // see `insert()` for why a racing duplicate here is expected and
        // must not surface as an error - same reasoning applies. an
        // existing EXTERNAL row can go stale though: the file it points at
        // may since have been moved, renamed, or deleted (the store never
        // owned it - that's the whole point of "external"), which silently
        // breaks every later local-disk read of this blob (thumbnail/
        // waveform generation, transcode, etc: "No such file or
        // directory") until the row is corrected. this caller just proved
        // (by hashing it above) that `abs_path` has the exact same content
        // right now, so if the recorded path no longer resolves to a real
        // file, repair the row to point at this one instead of silently
        // handing back a row that's known to be wrong - mirrors
        // `register_ingested()`'s own stale-`size` repair above.
        if let Some(existing) = self.get_any(&blake3_hex).await? {
            if existing.external {
                let recorded_path_ok = tokio::fs::metadata(&existing.path)
                    .await
                    .map(|m| m.is_file())
                    .unwrap_or(false);
                if !recorded_path_ok && existing.path != path_str {
                    tracing::warn!(
                        blake3 = %blake3_hex,
                        recorded_path = %existing.path,
                        new_path = %path_str,
                        "register_external_path: existing external row's path no \
                         longer resolves to a file - repairing"
                    );
                    sqlx::query("UPDATE blobz SET path = ?1 WHERE blake3 = ?2")
                        .bind(&path_str)
                        .bind(&blake3_hex)
                        .execute(&self.pool)
                        .await?;
                    return self.get_any(&blake3_hex).await?.ok_or_else(|| {
                        BlobStoreError::Storage(
                            "row vanished immediately after repair update".to_string(),
                        )
                    });
                }
            }
            return Ok(existing);
        }

        self.insert_row(&blake3_hex, &blake3_hex, &path_str, size, true, meta)
            .await
    }

    async fn adopt_local_file(
        &self,
        path: &Path,
        meta: NewBlobMeta,
    ) -> Result<BlobRecord, BlobStoreError> {
        // stream the file through blake3 + count bytes, same approach as
        // `register_external_path`.
        use tokio::io::AsyncReadExt;
        let mut file = tokio::fs::File::open(path).await?;
        let mut hasher = blake3::Hasher::new();
        let mut size: i64 = 0;
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let n = file.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            size += n as i64;
        }
        drop(file);
        let blake3_hex = hasher.finalize().to_hex().to_string();

        // see `insert()` for why a racing duplicate here is expected and
        // must not surface as an error - same reasoning applies. the source
        // file's bytes are already safely stored under the existing record,
        // so it's just redundant now - remove it (best-effort) and hand
        // back the existing record.
        if let Some(existing) = self.get_any(&blake3_hex).await? {
            if let Err(e) = tokio::fs::remove_file(path).await {
                tracing::warn!(
                    path = %path.display(),
                    error = %e,
                    "adopt_local_file: failed to remove duplicate source file after dedup"
                );
            }
            return Ok(existing);
        }

        let dest = self.prepare_canonical_path(&blake3_hex).await?;
        if let Err(rename_err) = tokio::fs::rename(path, &dest).await {
            tracing::debug!(
                path = %path.display(),
                dest = %dest.display(),
                error = %rename_err,
                "adopt_local_file: rename failed, falling back to copy-then-delete"
            );
            tokio::fs::copy(path, &dest).await?;
            if let Err(e) = tokio::fs::remove_file(path).await {
                tracing::warn!(
                    path = %path.display(),
                    error = %e,
                    "adopt_local_file: failed to remove source file after copy fallback"
                );
            }
        }

        let (prefix, rest) = blake3_hex.split_at(2);
        let rel_path = format!("{prefix}/{rest}");
        self.insert_row(&blake3_hex, &blake3_hex, &rel_path, size, false, meta)
            .await
    }

    async fn get(&self, blake3: &str) -> Result<Option<BlobRecord>, BlobStoreError> {
        let row: Option<BlobRow> = sqlx::query_as(
            r#"
            SELECT blake3, iroh_hash, sha256, old_grimoire_id, filename, mime,
                   size, path, external,
                   blob_type, parent_blake3, width, height, metadata,
                   created_at, soft_deleted_at, soft_deleted_by
            FROM blobz WHERE blake3 = ?1 AND soft_deleted_at IS NULL
            "#,
        )
        .bind(blake3)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(Into::into))
    }

    async fn get_any(&self, blake3: &str) -> Result<Option<BlobRecord>, BlobStoreError> {
        let row: Option<BlobRow> = sqlx::query_as(
            r#"
            SELECT blake3, iroh_hash, sha256, old_grimoire_id, filename, mime,
                   size, path, external,
                   blob_type, parent_blake3, width, height, metadata,
                   created_at, soft_deleted_at, soft_deleted_by
            FROM blobz WHERE blake3 = ?1
            "#,
        )
        .bind(blake3)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(Into::into))
    }

    async fn get_by_iroh_hash(
        &self,
        iroh_hash: &str,
    ) -> Result<Option<BlobRecord>, BlobStoreError> {
        let row: Option<BlobRow> = sqlx::query_as(
            r#"
            SELECT blake3, iroh_hash, sha256, old_grimoire_id, filename, mime,
                   size, path, external,
                   blob_type, parent_blake3, width, height, metadata,
                   created_at, soft_deleted_at, soft_deleted_by
            FROM blobz WHERE iroh_hash = ?1
            "#,
        )
        .bind(iroh_hash)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(Into::into))
    }

    async fn get_by_sha256(&self, sha256: &str) -> Result<Option<BlobRecord>, BlobStoreError> {
        let row: Option<BlobRow> = sqlx::query_as(
            r#"
            SELECT blake3, iroh_hash, sha256, old_grimoire_id, filename, mime,
                   size, path, external,
                   blob_type, parent_blake3, width, height, metadata,
                   created_at, soft_deleted_at, soft_deleted_by
            FROM blobz WHERE sha256 = ?1
            "#,
        )
        .bind(sha256)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(Into::into))
    }

    async fn get_by_old_id(
        &self,
        old_grimoire_id: &str,
    ) -> Result<Option<BlobRecord>, BlobStoreError> {
        let row: Option<BlobRow> = sqlx::query_as(
            r#"
            SELECT blake3, iroh_hash, sha256, old_grimoire_id, filename, mime,
                   size, path, external,
                   blob_type, parent_blake3, width, height, metadata,
                   created_at, soft_deleted_at, soft_deleted_by
            FROM blobz WHERE old_grimoire_id = ?1
            "#,
        )
        .bind(old_grimoire_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(Into::into))
    }

    async fn blobs_for(
        &self,
        blake3s: &[String],
    ) -> Result<HashMap<String, BlobRecord>, BlobStoreError> {
        if blake3s.is_empty() {
            return Ok(HashMap::new());
        }

        // dynamic IN(...) list - sqlx's compile-time macros need a literal
        // query string, so this one query is built and checked at runtime.
        let placeholders = blake3s.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let sql = format!(
            r#"SELECT blake3, iroh_hash, sha256, old_grimoire_id, filename, mime,
                      size, path, external, blob_type, parent_blake3, width, height,
                      metadata, created_at, soft_deleted_at, soft_deleted_by
               FROM blobz
               WHERE blake3 IN ({placeholders}) AND soft_deleted_at IS NULL"#
        );

        let mut query = sqlx::query_as::<_, BlobRow>(&sql);
        for hash in blake3s {
            query = query.bind(hash.as_str());
        }
        let rows = query.fetch_all(&self.pool).await?;

        Ok(rows
            .into_iter()
            .map(|row| {
                let record: BlobRecord = row.into();
                (record.blake3.clone(), record)
            })
            .collect())
    }

    async fn read_bytes(&self, blake3: &str) -> Result<Option<Vec<u8>>, BlobStoreError> {
        // uses get() which already excludes soft-deleted rows.
        let Some(record) = self.get(blake3).await? else {
            return Ok(None);
        };
        let bytes = tokio::fs::read(self.path_for(&record)).await?;
        Ok(Some(bytes))
    }

    fn path_for(&self, record: &BlobRecord) -> PathBuf {
        if record.external {
            PathBuf::from(&record.path)
        } else {
            self.blob_dir.join(&record.path)
        }
    }

    async fn soft_delete(
        &self,
        blake3s: &[String],
        actor: &str,
    ) -> Result<SoftDeleteOutcome, BlobStoreError> {
        let now = now_secs();
        let mut affected = 0u64;
        let mut failed = Vec::new();

        for hash in blake3s {
            let result = sqlx::query(
                r#"UPDATE blobz
                   SET soft_deleted_at = ?1, soft_deleted_by = ?2
                   WHERE blake3 = ?3 AND soft_deleted_at IS NULL"#,
            )
            .bind(now)
            .bind(actor)
            .bind(hash)
            .execute(&self.pool)
            .await?;

            if result.rows_affected() == 0 {
                failed.push(hash.clone());
            } else {
                affected += 1;
            }
        }

        Ok(SoftDeleteOutcome { affected, failed })
    }

    async fn restore(&self, blake3s: &[String]) -> Result<SoftDeleteOutcome, BlobStoreError> {
        let mut affected = 0u64;
        let mut failed = Vec::new();

        for hash in blake3s {
            let result = sqlx::query(
                r#"UPDATE blobz
                   SET soft_deleted_at = NULL, soft_deleted_by = NULL
                   WHERE blake3 = ?1 AND soft_deleted_at IS NOT NULL"#,
            )
            .bind(hash)
            .execute(&self.pool)
            .await?;

            if result.rows_affected() == 0 {
                failed.push(hash.clone());
            } else {
                affected += 1;
            }
        }

        Ok(SoftDeleteOutcome { affected, failed })
    }

    async fn hard_delete_soft_deleted(
        &self,
        blake3s: Option<&[String]>,
    ) -> Result<SoftDeleteOutcome, BlobStoreError> {
        let mut deleted = 0u64;
        let mut failed: Vec<String> = Vec::new();

        if let Some(hashes) = blake3s {
            for hash in hashes {
                // only qualify rows that ARE soft-deleted.
                let maybe_row: Option<BlobRow> = sqlx::query_as(
                    r#"SELECT blake3, iroh_hash, sha256, old_grimoire_id, filename, mime,
                              size, path, external,
                              blob_type, parent_blake3, width, height, metadata,
                              created_at, soft_deleted_at, soft_deleted_by
                       FROM blobz
                       WHERE blake3 = ?1 AND soft_deleted_at IS NOT NULL"#,
                )
                .bind(hash)
                .fetch_optional(&self.pool)
                .await?;

                match maybe_row {
                    None => failed.push(hash.clone()),
                    Some(row) => {
                        let record: BlobRecord = row.into();
                        if !record.external {
                            let _ = tokio::fs::remove_file(self.path_for(&record)).await;
                        }
                        sqlx::query("DELETE FROM blobz WHERE blake3 = ?1")
                            .bind(hash)
                            .execute(&self.pool)
                            .await?;
                        deleted += 1;
                    }
                }
            }
        } else {
            // purge ALL soft-deleted rows.
            let rows: Vec<BlobRow> = sqlx::query_as(
                r#"SELECT blake3, iroh_hash, sha256, old_grimoire_id, filename, mime,
                          size, path, external,
                          blob_type, parent_blake3, width, height, metadata,
                          created_at, soft_deleted_at, soft_deleted_by
                   FROM blobz
                   WHERE soft_deleted_at IS NOT NULL"#,
            )
            .fetch_all(&self.pool)
            .await?;

            for row in rows {
                let record: BlobRecord = row.into();
                if !record.external {
                    let _ = tokio::fs::remove_file(self.path_for(&record)).await;
                }
                sqlx::query("DELETE FROM blobz WHERE blake3 = ?1")
                    .bind(record.blake3)
                    .execute(&self.pool)
                    .await?;
                deleted += 1;
            }
        }

        Ok(SoftDeleteOutcome {
            affected: deleted,
            failed,
        })
    }

    async fn list(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<BlobRecord>, u64), BlobStoreError> {
        let total: i64 =
            sqlx::query_scalar(r#"SELECT COUNT(*) FROM blobz WHERE soft_deleted_at IS NULL"#)
                .fetch_one(&self.pool)
                .await?;
        let total = total as u64;

        let rows: Vec<BlobRow> = sqlx::query_as(
            r#"SELECT blake3, iroh_hash, sha256, old_grimoire_id, filename, mime,
                      size, path, external,
                      blob_type, parent_blake3, width, height, metadata,
                      created_at, soft_deleted_at, soft_deleted_by
               FROM blobz
               WHERE soft_deleted_at IS NULL
               ORDER BY created_at DESC
               LIMIT ?1 OFFSET ?2"#,
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;

        Ok((rows.into_iter().map(Into::into).collect(), total))
    }

    async fn list_filtered(
        &self,
        limit: i64,
        offset: i64,
        sort: BlobSortField,
        direction: SortDirection,
        search: Option<&str>,
    ) -> Result<(Vec<BlobRecord>, u64, u64), BlobStoreError> {
        let order_col = match sort {
            BlobSortField::CreatedAt => "created_at",
            BlobSortField::Size => "size",
            BlobSortField::Filename => "filename",
        };
        let order_dir = match direction {
            SortDirection::Desc => "DESC",
            SortDirection::Asc => "ASC",
        };
        // `search` is never interpolated into the query string itself (only
        // bound as a parameter) - `order_col`/`order_dir` are the only
        // pieces of runtime-built SQL, and both come from the closed enums
        // above, never from caller-supplied text.
        let has_search = search.is_some_and(|s| !s.is_empty());
        let where_clause = if has_search {
            "WHERE soft_deleted_at IS NULL AND filename LIKE ?"
        } else {
            "WHERE soft_deleted_at IS NULL"
        };

        let count_sql = format!("SELECT COUNT(*) FROM blobz {where_clause}");
        let size_sql = format!("SELECT COALESCE(SUM(size), 0) FROM blobz {where_clause}");
        let list_sql = format!(
            r#"SELECT blake3, iroh_hash, sha256, old_grimoire_id, filename, mime,
                      size, path, external,
                      blob_type, parent_blake3, width, height, metadata,
                      created_at, soft_deleted_at, soft_deleted_by
               FROM blobz
               {where_clause}
               ORDER BY {order_col} {order_dir}
               LIMIT ? OFFSET ?"#
        );

        let pattern = search.map(|s| format!("%{s}%"));

        let mut count_query = sqlx::query_scalar::<_, i64>(&count_sql);
        let mut size_query = sqlx::query_scalar::<_, i64>(&size_sql);
        let mut list_query = sqlx::query_as::<_, BlobRow>(&list_sql);
        if let Some(pattern) = &pattern {
            count_query = count_query.bind(pattern.clone());
            size_query = size_query.bind(pattern.clone());
            list_query = list_query.bind(pattern.clone());
        }
        list_query = list_query.bind(limit).bind(offset);

        let total_count = count_query.fetch_one(&self.pool).await? as u64;
        let total_size = size_query.fetch_one(&self.pool).await? as u64;
        let rows: Vec<BlobRow> = list_query.fetch_all(&self.pool).await?;

        Ok((
            rows.into_iter().map(Into::into).collect(),
            total_count,
            total_size,
        ))
    }

    async fn list_soft_deleted(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<BlobRecord>, u64), BlobStoreError> {
        let total: i64 =
            sqlx::query_scalar(r#"SELECT COUNT(*) FROM blobz WHERE soft_deleted_at IS NOT NULL"#)
                .fetch_one(&self.pool)
                .await?;
        let total = total as u64;

        let rows: Vec<BlobRow> = sqlx::query_as(
            r#"SELECT blake3, iroh_hash, sha256, old_grimoire_id, filename, mime,
                      size, path, external,
                      blob_type, parent_blake3, width, height, metadata,
                      created_at, soft_deleted_at, soft_deleted_by
               FROM blobz
               WHERE soft_deleted_at IS NOT NULL
               ORDER BY soft_deleted_at DESC
               LIMIT ?1 OFFSET ?2"#,
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;

        Ok((rows.into_iter().map(Into::into).collect(), total))
    }

    async fn list_all_iroh_hashes(&self) -> Result<Vec<String>, BlobStoreError> {
        let rows: Vec<String> = sqlx::query_scalar(r#"SELECT blake3 FROM blobz"#)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows)
    }

    async fn total_usage(&self) -> Result<UsageStats, BlobStoreError> {
        let row: UsageRow = sqlx::query_as(
            r#"SELECT COALESCE(SUM(size), 0) as total_bytes,
                      COUNT(*)              as count
               FROM blobz
               WHERE soft_deleted_at IS NULL"#,
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(UsageStats {
            total_bytes: row.total_bytes as u64,
            count: row.count as u64,
        })
    }

    async fn soft_deleted_usage(&self) -> Result<UsageStats, BlobStoreError> {
        let row: UsageRow = sqlx::query_as(
            r#"SELECT COALESCE(SUM(size), 0) as total_bytes,
                      COUNT(*)              as count
               FROM blobz
               WHERE soft_deleted_at IS NOT NULL"#,
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(UsageStats {
            total_bytes: row.total_bytes as u64,
            count: row.count as u64,
        })
    }

    async fn children_of(
        &self,
        parent_blake3: &str,
        blob_type: Option<BlobType>,
    ) -> Result<Vec<BlobRecord>, BlobStoreError> {
        let rows: Vec<BlobRow> = if let Some(bt) = blob_type {
            let bt_str = bt.as_str();
            sqlx::query_as(
                r#"SELECT blake3, iroh_hash, sha256, old_grimoire_id, filename, mime,
                          size, path, external,
                          blob_type, parent_blake3, width, height, metadata,
                          created_at, soft_deleted_at, soft_deleted_by
                   FROM blobz
                   WHERE parent_blake3 = ?1 AND blob_type = ?2 AND soft_deleted_at IS NULL
                   ORDER BY created_at DESC"#,
            )
            .bind(parent_blake3)
            .bind(bt_str)
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query_as(
                r#"SELECT blake3, iroh_hash, sha256, old_grimoire_id, filename, mime,
                          size, path, external,
                          blob_type, parent_blake3, width, height, metadata,
                          created_at, soft_deleted_at, soft_deleted_by
                   FROM blobz
                   WHERE parent_blake3 = ?1 AND soft_deleted_at IS NULL
                   ORDER BY created_at DESC"#,
            )
            .bind(parent_blake3)
            .fetch_all(&self.pool)
            .await?
        };

        Ok(rows.into_iter().map(Into::into).collect())
    }

    async fn derived(
        &self,
        parent_blake3: &str,
        blob_type: BlobType,
    ) -> Result<Option<BlobRecord>, BlobStoreError> {
        let bt_str = blob_type.as_str();
        let row: Option<BlobRow> = sqlx::query_as(
            r#"SELECT blake3, iroh_hash, sha256, old_grimoire_id, filename, mime,
                      size, path, external,
                      blob_type, parent_blake3, width, height, metadata,
                      created_at, soft_deleted_at, soft_deleted_by
               FROM blobz
               WHERE parent_blake3 = ?1 AND blob_type = ?2 AND soft_deleted_at IS NULL
               ORDER BY created_at DESC
               LIMIT 1"#,
        )
        .bind(parent_blake3)
        .bind(bt_str)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(Into::into))
    }

    async fn add_canvas_ref(
        &self,
        blake3: &str,
        canvas_doc_id: &str,
    ) -> Result<(), BlobStoreError> {
        sqlx::query(
            r#"INSERT INTO blobz_canvas_refs (blake3, canvas_doc_id, created_at)
               VALUES (?1, ?2, ?3)
               ON CONFLICT (blake3, canvas_doc_id) DO NOTHING"#,
        )
        .bind(blake3)
        .bind(canvas_doc_id)
        .bind(now_secs())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn remove_canvas_ref(
        &self,
        blake3: &str,
        canvas_doc_id: &str,
    ) -> Result<(), BlobStoreError> {
        sqlx::query("DELETE FROM blobz_canvas_refs WHERE blake3 = ?1 AND canvas_doc_id = ?2")
            .bind(blake3)
            .bind(canvas_doc_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn canvas_refs_for_blob(&self, blake3: &str) -> Result<Vec<String>, BlobStoreError> {
        let rows: Vec<(String,)> =
            sqlx::query_as("SELECT canvas_doc_id FROM blobz_canvas_refs WHERE blake3 = ?1")
                .bind(blake3)
                .fetch_all(&self.pool)
                .await?;
        Ok(rows.into_iter().map(|(id,)| id).collect())
    }

    async fn remove_all_canvas_refs(&self, canvas_doc_id: &str) -> Result<(), BlobStoreError> {
        sqlx::query("DELETE FROM blobz_canvas_refs WHERE canvas_doc_id = ?1")
            .bind(canvas_doc_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[derive(Debug, sqlx::FromRow)]
struct UsageRow {
    total_bytes: i64,
    count: i64,
}

#[derive(Debug, sqlx::FromRow)]
struct BlobRow {
    blake3: String,
    iroh_hash: Option<String>,
    sha256: Option<String>,
    old_grimoire_id: Option<String>,
    filename: Option<String>,
    mime: Option<String>,
    size: i64,
    path: String,
    external: i64,
    blob_type: String,
    parent_blake3: Option<String>,
    width: Option<i64>,
    height: Option<i64>,
    metadata: Option<String>,
    created_at: i64,
    soft_deleted_at: Option<i64>,
    soft_deleted_by: Option<String>,
}

impl From<BlobRow> for BlobRecord {
    fn from(r: BlobRow) -> Self {
        Self {
            blake3: r.blake3,
            iroh_hash: r.iroh_hash,
            sha256: r.sha256,
            old_grimoire_id: r.old_grimoire_id,
            filename: r.filename,
            mime: r.mime,
            size: r.size as u64,
            path: r.path,
            external: r.external != 0,
            blob_type: BlobType::from_db(&r.blob_type),
            parent_blake3: r.parent_blake3,
            width: r.width.map(|w| w as u32),
            height: r.height.map(|h| h as u32),
            metadata: r.metadata.and_then(|s| serde_json::from_str(&s).ok()),
            created_at: r.created_at,
            soft_deleted_at: r.soft_deleted_at,
            soft_deleted_by: r.soft_deleted_by,
        }
    }
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn make_store() -> (SqliteBlobStore, SqlitePool, tempfile::TempDir) {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pool = crate::db::open_in_memory().await;
        let store = SqliteBlobStore::new(pool.clone(), tmp.path());
        (store, pool, tmp)
    }

    #[tokio::test]
    async fn insert_then_get_round_trips() {
        let (store, _pool, _tmp) = make_store().await;
        let bytes = b"hello blobz";
        let blob = store
            .insert(
                bytes,
                NewBlobMeta {
                    filename: Some("hello.txt".to_string()),
                    mime: Some("text/plain".to_string()),
                    ..Default::default()
                },
            )
            .await
            .expect("insert");

        let expected_blake3 = blake3::hash(bytes).to_hex().to_string();
        assert_eq!(blob.blake3, expected_blake3);
        assert_eq!(blob.iroh_hash.as_deref(), Some(expected_blake3.as_str()));
        assert_eq!(blob.size, bytes.len() as u64);
        assert_eq!(blob.blob_type, BlobType::Original);
        assert!(blob.path.starts_with(&blob.blake3[..2]));

        let got = store.get(&blob.blake3).await.unwrap().expect("found");
        assert_eq!(got.blake3, blob.blake3);
        assert_eq!(got.filename.as_deref(), Some("hello.txt"));
    }

    #[tokio::test]
    async fn insert_is_idempotent_on_duplicate_blake3() {
        let (store, _pool, _tmp) = make_store().await;
        let first = store
            .insert(b"same bytes", NewBlobMeta::default())
            .await
            .unwrap();
        // second insert with different metadata should still dedupe to the
        // existing row (blake3 is the canonical id) and keep the first
        // insert's metadata.
        let second = store
            .insert(
                b"same bytes",
                NewBlobMeta {
                    filename: Some("ignored.txt".into()),
                    mime: Some("text/plain".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(first.blake3, second.blake3);
        assert_eq!(first.filename, second.filename);

        let (rows, total) = store.list(100, 0).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(total, 1);
    }

    #[tokio::test]
    async fn register_ingested_records_the_file_already_at_the_canonical_path() {
        let (store, _pool, _tmp) = make_store().await;
        let bytes = b"ingested content";
        let blake3 = blake3::hash(bytes).to_hex().to_string();

        let target = store.prepare_canonical_path(&blake3).await.unwrap();
        tokio::fs::write(&target, bytes).await.unwrap();

        let record = store
            .register_ingested(&blake3, NewBlobMeta::default())
            .await
            .unwrap();
        assert_eq!(record.size, bytes.len() as u64);
    }

    #[tokio::test]
    async fn register_ingested_repairs_a_stale_size_once_real_bytes_are_on_disk() {
        // simulates the bug this fixes: an earlier snatch ingested a
        // truncated/0-byte export (a bad resume race), leaving a row with
        // size=0. a later successful re-download replaces the file on disk
        // with the real bytes; re-registering must repair the row's size
        // instead of handing back the stale one forever.
        let (store, _pool, _tmp) = make_store().await;
        let blake3 = "deadbeef".repeat(8); // 64 hex chars, arbitrary test hash

        let target = store.prepare_canonical_path(&blake3).await.unwrap();
        tokio::fs::write(&target, b"").await.unwrap();
        let stale = store
            .register_ingested(&blake3, NewBlobMeta::default())
            .await
            .unwrap();
        assert_eq!(stale.size, 0);

        // a later re-download overwrites the file with real bytes.
        let real_bytes = b"the real, complete content";
        tokio::fs::write(&target, real_bytes).await.unwrap();

        let repaired = store
            .register_ingested(&blake3, NewBlobMeta::default())
            .await
            .unwrap();
        assert_eq!(repaired.size, real_bytes.len() as u64);

        // the repair persisted, not just returned for this one call.
        let refetched = store.get_any(&blake3).await.unwrap().unwrap();
        assert_eq!(refetched.size, real_bytes.len() as u64);
    }

    #[tokio::test]
    async fn read_bytes_returns_payload() {
        let (store, _pool, _tmp) = make_store().await;
        let payload = b"some bytes here";
        let blob = store.insert(payload, NewBlobMeta::default()).await.unwrap();
        let read = store.read_bytes(&blob.blake3).await.unwrap();
        assert_eq!(read.as_deref(), Some(payload.as_ref()));
    }

    #[tokio::test]
    async fn get_returns_none_for_unknown_hash() {
        let (store, _pool, _tmp) = make_store().await;
        assert!(store.get("nope").await.unwrap().is_none());
        assert!(store.read_bytes("nope").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn get_by_iroh_hash_works() {
        let (store, _pool, _tmp) = make_store().await;
        let blob = store.insert(b"x", NewBlobMeta::default()).await.unwrap();
        // freshly inserted blobs have iroh_hash == blake3 (see insert_row).
        let got = store
            .get_by_iroh_hash(&blob.blake3)
            .await
            .unwrap()
            .expect("present");
        assert_eq!(got.blake3, blob.blake3);
        assert!(store.get_by_iroh_hash("missing").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn list_orders_by_created_at_desc_with_limit_offset() {
        let (store, _pool, _tmp) = make_store().await;
        for i in 0u8..5 {
            // distinct payloads -> distinct blake3 -> distinct rows.
            // sleep a tick so created_at strictly increases (resolution = 1s).
            store.insert(&[i; 8], NewBlobMeta::default()).await.unwrap();
            tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
        }
        let (page, total) = store.list(2, 0).await.unwrap();
        assert_eq!(page.len(), 2);
        assert_eq!(total, 5);
        assert!(page[0].created_at >= page[1].created_at);

        let (next, _) = store.list(2, 2).await.unwrap();
        assert_eq!(next.len(), 2);
        assert!(next[0].created_at <= page[1].created_at);
    }

    #[tokio::test]
    async fn list_filtered_sorts_by_size_and_filters_by_search() {
        let (store, _pool, _tmp) = make_store().await;
        store
            .insert(
                b"a",
                NewBlobMeta {
                    filename: Some("apple.txt".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        store
            .insert(
                b"bbbbb",
                NewBlobMeta {
                    filename: Some("banana.txt".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        store
            .insert(
                b"ccc",
                NewBlobMeta {
                    filename: Some("cherry.txt".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();

        let (page, total_count, total_size) = store
            .list_filtered(10, 0, BlobSortField::Size, SortDirection::Asc, None)
            .await
            .unwrap();
        assert_eq!(total_count, 3);
        assert_eq!(total_size, 1 + 5 + 3);
        let sizes: Vec<u64> = page.iter().map(|b| b.size).collect();
        assert_eq!(sizes, vec![1, 3, 5]);

        let (filtered, filtered_count, filtered_size) = store
            .list_filtered(
                10,
                0,
                BlobSortField::Filename,
                SortDirection::Asc,
                Some("an"),
            )
            .await
            .unwrap();
        assert_eq!(filtered_count, 1);
        assert_eq!(filtered_size, 5);
        assert_eq!(filtered[0].filename.as_deref(), Some("banana.txt"));
    }

    #[tokio::test]
    async fn path_for_uses_2char_prefix_split() {
        let (store, _pool, _tmp) = make_store().await;
        let blob = store.insert(b"a", NewBlobMeta::default()).await.unwrap();
        let path = store.path_for(&blob);
        let parent = path.parent().unwrap().file_name().unwrap();
        assert_eq!(parent.to_string_lossy().len(), 2);
        let fname = path.file_name().unwrap().to_string_lossy();
        assert_eq!(fname, blob.blake3[2..]);
    }

    /// concurrent inserts of the *same content* (same blake3) from different
    /// tasks must never surface a duplicate-key error to the caller - the
    /// store's job is to dedupe, not to leak a database-level race. this
    /// uses a real file-backed pool (multiple connections, like production's
    /// `db::open`) and a multi-thread runtime so the check-then-insert
    /// window in `insert()` can actually be hit by concurrent tasks, unlike
    /// `open_in_memory()`'s single-connection pool used by the rest of this
    /// module's tests.
    #[tokio::test(flavor = "multi_thread", worker_threads = 8)]
    async fn concurrent_inserts_of_same_content_never_error() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pool = crate::db::open(tmp.path()).await.expect("open db");
        let store = SqliteBlobStore::new(pool, tmp.path());
        let bytes = b"racing bytes, same content every time";

        let mut handles = Vec::new();
        for _ in 0..8 {
            let store = store.clone();
            handles.push(tokio::spawn(async move {
                store.insert(bytes, NewBlobMeta::default()).await
            }));
        }

        let mut blake3s = std::collections::HashSet::new();
        for h in handles {
            let result = h.await.expect("task panicked");
            let blob = result.expect("insert must not error on a content race");
            blake3s.insert(blob.blake3);
        }

        // all 8 racing inserts must have resolved to the same canonical row.
        assert_eq!(blake3s.len(), 1);
        let (rows, total) = store.list(100, 0).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(total, 1);
    }

    #[tokio::test]
    async fn register_external_path_streams_without_copying_the_file() {
        let (store, _pool, tmp) = make_store().await;
        let src_dir = tempfile::tempdir().expect("src tempdir");
        let src_path = src_dir.path().join("original.bin");
        let payload = vec![7u8; 1024 * 1024]; // 1MB, distinct from any other test's bytes
        tokio::fs::write(&src_path, &payload).await.unwrap();

        let blob = store
            .register_external_path(
                &src_path,
                NewBlobMeta {
                    filename: Some("original.bin".into()),
                    mime: Some("application/octet-stream".into()),
                    ..Default::default()
                },
                None,
                None,
            )
            .await
            .expect("register_external_path");

        let expected_blake3 = blake3::hash(&payload).to_hex().to_string();
        assert_eq!(blob.blake3, expected_blake3);
        assert_eq!(blob.size, payload.len() as u64);
        // "external" - path_for() must point straight at the original file,
        // not a copy under the store's own blob-files dir.
        let resolved = store.path_for(&blob);
        assert_eq!(resolved, src_path);
        assert!(!resolved.starts_with(tmp.path().join(BLOB_FILES_DIR)));

        // dedup on a second call with the same content.
        let again = store
            .register_external_path(&src_path, NewBlobMeta::default(), None, None)
            .await
            .expect("register_external_path again");
        assert_eq!(again.blake3, blob.blake3);
        let (rows, _) = store.list(100, 0).await.unwrap();
        assert_eq!(rows.len(), 1);
    }

    #[tokio::test]
    async fn register_external_path_repairs_a_stale_path_once_the_file_has_moved() {
        // simulates the bug this fixes: a local file upload registers the
        // user's original file in place (never copied); the user later
        // moves/renames it, so the recorded path stops resolving to a real
        // file (breaking any later local-disk read - thumbnail/waveform
        // generation, transcode, etc). re-adding the SAME content from its
        // new location must repair the row's path instead of silently
        // handing back a row that's known to be wrong.
        let (store, _pool, _tmp) = make_store().await;
        let src_dir = tempfile::tempdir().expect("src tempdir");
        let old_path = src_dir.path().join("original.mp3");
        let payload = b"identical audio bytes";
        tokio::fs::write(&old_path, payload).await.unwrap();

        let first = store
            .register_external_path(&old_path, NewBlobMeta::default(), None, None)
            .await
            .expect("register_external_path");
        assert_eq!(store.path_for(&first), old_path);

        // the user moves the file to a new location (same content).
        let new_path = src_dir.path().join("renamed.mp3");
        tokio::fs::rename(&old_path, &new_path).await.unwrap();

        let repaired = store
            .register_external_path(&new_path, NewBlobMeta::default(), None, None)
            .await
            .expect("register_external_path after move");
        assert_eq!(repaired.blake3, first.blake3);
        assert_eq!(store.path_for(&repaired), new_path);

        // the repair persisted, not just returned for this one call.
        let refetched = store.get_any(&first.blake3).await.unwrap().unwrap();
        assert_eq!(store.path_for(&refetched), new_path);
        let (rows, _) = store.list(100, 0).await.unwrap();
        assert_eq!(rows.len(), 1, "still one row, not a duplicate");
    }

    #[tokio::test]
    async fn register_external_path_leaves_a_still_valid_row_untouched() {
        let (store, _pool, _tmp) = make_store().await;
        let src_dir = tempfile::tempdir().expect("src tempdir");
        let src_path = src_dir.path().join("still-here.bin");
        tokio::fs::write(&src_path, b"never moved").await.unwrap();

        let first = store
            .register_external_path(
                &src_path,
                NewBlobMeta {
                    filename: Some("still-here.bin".into()),
                    ..Default::default()
                },
                None,
                None,
            )
            .await
            .unwrap();

        // re-registering the exact same (still-valid) path must not touch
        // the row's metadata (a repair should only ever kick in when the
        // recorded path no longer resolves to a real file).
        let again = store
            .register_external_path(&src_path, NewBlobMeta::default(), None, None)
            .await
            .unwrap();
        assert_eq!(again.filename.as_deref(), Some("still-here.bin"));
        assert_eq!(again.blake3, first.blake3);
    }

    #[tokio::test]
    async fn register_external_path_reports_progress_and_reaches_100_percent() {
        let (store, _pool, _tmp) = make_store().await;
        let src_dir = tempfile::tempdir().expect("src tempdir");
        let src_path = src_dir.path().join("big.bin");
        // large enough to cross the 4MB progress-report threshold at least
        // once, so this test actually exercises the throttled-report path,
        // not just the unconditional final call.
        let payload = vec![9u8; 5 * 1024 * 1024];
        tokio::fs::write(&src_path, &payload).await.unwrap();

        let reports = std::sync::Arc::new(std::sync::Mutex::new(Vec::<(u64, u64)>::new()));
        let reports_clone = reports.clone();
        let cb = move |read: u64, total: u64| {
            reports_clone.lock().unwrap().push((read, total));
        };

        let blob = store
            .register_external_path(&src_path, NewBlobMeta::default(), Some(&cb), None)
            .await
            .expect("register_external_path");

        let calls = reports.lock().unwrap();
        assert!(!calls.is_empty(), "expected at least one progress report");
        let (last_read, last_total) = *calls.last().unwrap();
        assert_eq!(last_read, blob.size);
        assert_eq!(last_total, payload.len() as u64);
        // every reported total must agree - this file's size never changes
        // mid-read.
        assert!(calls
            .iter()
            .all(|(_, total)| *total == payload.len() as u64));
    }

    #[tokio::test]
    async fn register_external_path_rejects_relative_paths() {
        let (store, _pool, _tmp) = make_store().await;
        let err = store
            .register_external_path(
                Path::new("relative/path.bin"),
                NewBlobMeta::default(),
                None,
                None,
            )
            .await
            .expect_err("relative path must be rejected");
        assert!(matches!(err, BlobStoreError::Io(_)));
    }

    #[tokio::test]
    async fn register_external_path_cancelled_flag_returns_cancelled_error() {
        let (store, _pool, _tmp) = make_store().await;
        let src_dir = tempfile::tempdir().expect("src tempdir");
        let src_path = src_dir.path().join("cancel.bin");
        // large enough that the cancel check fires during the read loop.
        let payload = vec![5u8; 2 * 1024 * 1024];
        tokio::fs::write(&src_path, &payload).await.unwrap();

        // pre-set the cancel flag before calling register_external_path so
        // it fires on the very first loop iteration.
        let cancel = AtomicBool::new(true);
        let err = store
            .register_external_path(&src_path, NewBlobMeta::default(), None, Some(&cancel))
            .await
            .expect_err("should have been cancelled");
        assert!(matches!(err, BlobStoreError::Cancelled));
        assert_eq!(err.to_string(), "operation cancelled");
    }

    #[tokio::test]
    async fn adopt_local_file_moves_the_file_into_canonical_storage() {
        let (store, _pool, tmp) = make_store().await;
        let src_dir = tempfile::tempdir().expect("src tempdir");
        let src_path = src_dir.path().join("adopt-me.bin");
        let payload = vec![3u8; 512 * 1024];
        tokio::fs::write(&src_path, &payload).await.unwrap();

        let blob = store
            .adopt_local_file(
                &src_path,
                NewBlobMeta {
                    filename: Some("adopt-me.bin".into()),
                    ..Default::default()
                },
            )
            .await
            .expect("adopt_local_file");

        let expected_blake3 = blake3::hash(&payload).to_hex().to_string();
        assert_eq!(blob.blake3, expected_blake3);
        assert_eq!(blob.size, payload.len() as u64);
        assert!(!blob.external);

        // the source file is gone - it was moved, not copied.
        assert!(!src_path.exists());

        // bytes live under the store's own canonical, content-addressed
        // path now, not at the original location.
        let resolved = store.path_for(&blob);
        assert!(resolved.starts_with(tmp.path().join(BLOB_FILES_DIR)));
        assert_ne!(resolved, src_path);

        let read = store.read_bytes(&blob.blake3).await.unwrap();
        assert_eq!(read.as_deref(), Some(payload.as_slice()));
    }

    #[tokio::test]
    async fn adopt_local_file_dedupes_and_still_removes_the_source() {
        let (store, _pool, _tmp) = make_store().await;
        let payload = b"content that already exists in the store";
        let existing = store.insert(payload, NewBlobMeta::default()).await.unwrap();

        let src_dir = tempfile::tempdir().expect("src tempdir");
        let src_path = src_dir.path().join("duplicate.bin");
        tokio::fs::write(&src_path, payload).await.unwrap();

        let adopted = store
            .adopt_local_file(&src_path, NewBlobMeta::default())
            .await
            .expect("adopt_local_file on duplicate content");

        assert_eq!(adopted.blake3, existing.blake3);
        // dedup path still consumes the source file - its bytes are
        // redundant once the existing row is found.
        assert!(!src_path.exists());

        let (rows, total) = store.list(100, 0).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(total, 1);
    }

    // a cross-filesystem-boundary rename failure (falling back to
    // copy-then-delete) isn't practical to simulate realistically in a unit
    // test without mounting a second filesystem - skipped, matching this
    // module's own coverage philosophy of only testing what a real tempdir
    // setup can exercise.

    #[tokio::test]
    async fn total_usage_sums_sizes_and_counts_rows() {
        let (store, _pool, _tmp) = make_store().await;

        let stats = store.total_usage().await.unwrap();
        assert_eq!(stats.total_bytes, 0);
        assert_eq!(stats.count, 0);

        store
            .insert(b"hello", NewBlobMeta::default())
            .await
            .unwrap();
        store
            .insert(b"world!!", NewBlobMeta::default())
            .await
            .unwrap();

        let stats = store.total_usage().await.unwrap();
        assert_eq!(stats.count, 2);
        assert_eq!(
            stats.total_bytes,
            (b"hello".len() + b"world!!".len()) as u64
        );
    }

    #[tokio::test]
    async fn list_all_iroh_hashes_includes_soft_deleted_rows() {
        let (store, _pool, _tmp) = make_store().await;
        let live = store
            .insert(b"still here", NewBlobMeta::default())
            .await
            .unwrap();
        let gone = store
            .insert(b"soft deleted", NewBlobMeta::default())
            .await
            .unwrap();
        store
            .soft_delete(std::slice::from_ref(&gone.blake3), "actor")
            .await
            .unwrap();

        let mut hashes = store.list_all_iroh_hashes().await.unwrap();
        hashes.sort();
        let mut expected = vec![live.blake3.clone(), gone.blake3.clone()];
        expected.sort();
        assert_eq!(hashes, expected);
    }

    // --- soft-delete tests ---

    #[tokio::test]
    async fn soft_delete_hides_from_get_list_total_usage_but_get_any_finds_it() {
        let (store, _pool, _tmp) = make_store().await;
        let blob = store
            .insert(
                b"soft del me",
                NewBlobMeta {
                    filename: Some("f.txt".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();

        let before = store.total_usage().await.unwrap();
        assert_eq!(before.count, 1);

        let outcome = store
            .soft_delete(std::slice::from_ref(&blob.blake3), "admin-node")
            .await
            .unwrap();
        assert_eq!(outcome.affected, 1);
        assert!(outcome.failed.is_empty());

        // get() returns None after soft-delete
        assert!(store.get(&blob.blake3).await.unwrap().is_none());
        // read_bytes() returns None
        assert!(store.read_bytes(&blob.blake3).await.unwrap().is_none());
        // list() excludes it
        let (rows, total) = store.list(100, 0).await.unwrap();
        assert!(rows.is_empty());
        assert_eq!(total, 0);
        // total_usage() excludes it
        let after = store.total_usage().await.unwrap();
        assert_eq!(after.total_bytes, 0);
        assert_eq!(after.count, 0);

        // get_any() still finds it
        assert!(store.get_any(&blob.blake3).await.unwrap().is_some());
    }

    #[tokio::test]
    async fn soft_delete_stamps_actor_and_list_soft_deleted_returns_it() {
        let (store, _pool, _tmp) = make_store().await;
        let blob = store
            .insert(b"actor test", NewBlobMeta::default())
            .await
            .unwrap();

        store
            .soft_delete(std::slice::from_ref(&blob.blake3), "node-abc123")
            .await
            .unwrap();

        let (sd, total) = store.list_soft_deleted(100, 0).await.unwrap();
        assert_eq!(sd.len(), 1);
        assert_eq!(total, 1);
        assert_eq!(sd[0].blake3, blob.blake3);
        assert_eq!(sd[0].soft_deleted_by.as_deref(), Some("node-abc123"));
        assert!(sd[0].soft_deleted_at.unwrap() > 0);
    }

    #[tokio::test]
    async fn soft_delete_already_deleted_row_goes_to_failed() {
        let (store, _pool, _tmp) = make_store().await;
        let blob = store
            .insert(b"double del", NewBlobMeta::default())
            .await
            .unwrap();

        store
            .soft_delete(std::slice::from_ref(&blob.blake3), "a1")
            .await
            .unwrap();
        // second call: already soft-deleted - should land in failed
        let outcome = store
            .soft_delete(std::slice::from_ref(&blob.blake3), "a2")
            .await
            .unwrap();
        assert_eq!(outcome.affected, 0);
        assert_eq!(outcome.failed, vec![blob.blake3.clone()]);
    }

    #[tokio::test]
    async fn restore_clears_soft_delete_marker() {
        let (store, _pool, _tmp) = make_store().await;
        let blob = store
            .insert(b"restore me", NewBlobMeta::default())
            .await
            .unwrap();

        store
            .soft_delete(std::slice::from_ref(&blob.blake3), "actor")
            .await
            .unwrap();
        assert!(store.get(&blob.blake3).await.unwrap().is_none());

        let outcome = store
            .restore(std::slice::from_ref(&blob.blake3))
            .await
            .unwrap();
        assert_eq!(outcome.affected, 1);
        assert!(outcome.failed.is_empty());

        // visible again after restore
        assert!(store.get(&blob.blake3).await.unwrap().is_some());
        let (sd, _) = store.list_soft_deleted(100, 0).await.unwrap();
        assert!(sd.is_empty());
    }

    #[tokio::test]
    async fn restore_non_soft_deleted_row_goes_to_failed() {
        let (store, _pool, _tmp) = make_store().await;
        let blob = store
            .insert(b"not deleted", NewBlobMeta::default())
            .await
            .unwrap();

        let outcome = store
            .restore(std::slice::from_ref(&blob.blake3))
            .await
            .unwrap();
        assert_eq!(outcome.affected, 0);
        assert_eq!(outcome.failed, vec![blob.blake3.clone()]);
    }

    #[tokio::test]
    async fn hard_delete_soft_deleted_unlinks_managed_file_and_row() {
        let (store, _pool, _tmp) = make_store().await;
        let blob = store
            .insert(b"hard del me", NewBlobMeta::default())
            .await
            .unwrap();
        let path = store.path_for(&blob);
        assert!(path.exists());

        store
            .soft_delete(std::slice::from_ref(&blob.blake3), "actor")
            .await
            .unwrap();
        let outcome = store
            .hard_delete_soft_deleted(Some(std::slice::from_ref(&blob.blake3)))
            .await
            .unwrap();
        assert_eq!(outcome.affected, 1);
        assert!(outcome.failed.is_empty());

        // row is gone
        assert!(store.get_any(&blob.blake3).await.unwrap().is_none());
        // file is unlinked
        assert!(!path.exists());
    }

    #[tokio::test]
    async fn hard_delete_refuses_non_soft_deleted_row() {
        let (store, _pool, _tmp) = make_store().await;
        let blob = store
            .insert(b"live blob", NewBlobMeta::default())
            .await
            .unwrap();

        let outcome = store
            .hard_delete_soft_deleted(Some(std::slice::from_ref(&blob.blake3)))
            .await
            .unwrap();
        assert_eq!(outcome.affected, 0);
        assert_eq!(outcome.failed, vec![blob.blake3.clone()]);
        // blob is still present
        assert!(store.get(&blob.blake3).await.unwrap().is_some());
    }

    #[tokio::test]
    async fn hard_delete_soft_deleted_with_no_hashes_purges_every_soft_deleted_row() {
        let (store, _pool, _tmp) = make_store().await;
        let live = store
            .insert(b"stays live", NewBlobMeta::default())
            .await
            .unwrap();
        let a = store
            .insert(b"purge me a", NewBlobMeta::default())
            .await
            .unwrap();
        let b = store
            .insert(b"purge me b", NewBlobMeta::default())
            .await
            .unwrap();

        store
            .soft_delete(&[a.blake3.clone(), b.blake3.clone()], "actor")
            .await
            .unwrap();

        let outcome = store.hard_delete_soft_deleted(None).await.unwrap();
        assert_eq!(outcome.affected, 2);
        assert!(outcome.failed.is_empty());
        assert!(store.get_any(&a.blake3).await.unwrap().is_none());
        assert!(store.get_any(&b.blake3).await.unwrap().is_none());
        // the live (never soft-deleted) row is untouched
        assert!(store.get(&live.blake3).await.unwrap().is_some());
    }

    #[tokio::test]
    async fn soft_deleted_usage_counts_only_soft_deleted() {
        let (store, _pool, _tmp) = make_store().await;
        let b1 = store
            .insert(b"alive", NewBlobMeta::default())
            .await
            .unwrap();
        let b2 = store.insert(b"soft", NewBlobMeta::default()).await.unwrap();

        store
            .soft_delete(std::slice::from_ref(&b2.blake3), "actor")
            .await
            .unwrap();

        let sd_stats = store.soft_deleted_usage().await.unwrap();
        assert_eq!(sd_stats.count, 1);
        assert_eq!(sd_stats.total_bytes, b2.size);

        let live_stats = store.total_usage().await.unwrap();
        assert_eq!(live_stats.count, 1);
        assert_eq!(live_stats.total_bytes, b1.size);
    }

    // --- schema-delta tests: sha256, old_grimoire_id, derived blobs ---
    //
    // none of these fields are ever written by the `BlobStore` trait itself
    // (sha256/old_grimoire_id are populated by an out-of-scope migration
    // path; blob_type/parent_blake3 ARE trait-writable via `NewBlobMeta`).
    // the sha256/old_grimoire_id tests poke the columns directly via sql to
    // simulate that migration having already run.

    #[tokio::test]
    async fn get_by_sha256_finds_migrated_row() {
        let (store, pool, _tmp) = make_store().await;
        let blob = store
            .insert(b"legacy content", NewBlobMeta::default())
            .await
            .unwrap();

        sqlx::query("UPDATE blobz SET sha256 = ?1 WHERE blake3 = ?2")
            .bind("deadbeef-sha256")
            .bind(&blob.blake3)
            .execute(&pool)
            .await
            .unwrap();

        let found = store
            .get_by_sha256("deadbeef-sha256")
            .await
            .unwrap()
            .expect("found by sha256");
        assert_eq!(found.blake3, blob.blake3);
        assert!(store.get_by_sha256("missing").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn get_by_old_id_finds_migrated_row() {
        let (store, pool, _tmp) = make_store().await;
        let blob = store
            .insert(b"tomb legacy blob", NewBlobMeta::default())
            .await
            .unwrap();

        sqlx::query("UPDATE blobz SET old_grimoire_id = ?1 WHERE blake3 = ?2")
            .bind("a1b2c3d4")
            .bind(&blob.blake3)
            .execute(&pool)
            .await
            .unwrap();

        let found = store
            .get_by_old_id("a1b2c3d4")
            .await
            .unwrap()
            .expect("found by old_grimoire_id");
        assert_eq!(found.blake3, blob.blake3);
        assert!(store.get_by_old_id("missing").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn insert_with_derived_blob_metadata_persists_full_shape() {
        let (store, _pool, _tmp) = make_store().await;
        let parent = store
            .insert(b"parent image bytes", NewBlobMeta::default())
            .await
            .unwrap();

        let meta_json = serde_json::json!({"generator": "test"});
        let thumb = store
            .insert(
                b"thumbnail bytes",
                NewBlobMeta {
                    blob_type: BlobType::Thumbnail,
                    parent_blake3: Some(parent.blake3.clone()),
                    width: Some(128),
                    height: Some(96),
                    metadata: Some(meta_json.clone()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();

        let got = store.get(&thumb.blake3).await.unwrap().expect("found");
        assert_eq!(got.blob_type, BlobType::Thumbnail);
        assert_eq!(got.parent_blake3.as_deref(), Some(parent.blake3.as_str()));
        assert_eq!(got.width, Some(128));
        assert_eq!(got.height, Some(96));
        assert_eq!(got.metadata, Some(meta_json));
    }

    #[tokio::test]
    async fn children_of_filters_by_parent_and_optional_blob_type() {
        let (store, _pool, _tmp) = make_store().await;
        let parent = store
            .insert(b"parent bytes", NewBlobMeta::default())
            .await
            .unwrap();
        let other_parent = store
            .insert(b"other parent bytes", NewBlobMeta::default())
            .await
            .unwrap();

        let thumb = store
            .insert(
                b"thumb bytes",
                NewBlobMeta {
                    blob_type: BlobType::Thumbnail,
                    parent_blake3: Some(parent.blake3.clone()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        let waveform = store
            .insert(
                b"waveform bytes",
                NewBlobMeta {
                    blob_type: BlobType::Waveform,
                    parent_blake3: Some(parent.blake3.clone()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        // a derived blob of an unrelated parent must never show up.
        store
            .insert(
                b"unrelated thumb bytes",
                NewBlobMeta {
                    blob_type: BlobType::Thumbnail,
                    parent_blake3: Some(other_parent.blake3.clone()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();

        let all_children = store.children_of(&parent.blake3, None).await.unwrap();
        let mut child_hashes: Vec<_> = all_children.iter().map(|r| r.blake3.clone()).collect();
        child_hashes.sort();
        let mut expected = vec![thumb.blake3.clone(), waveform.blake3.clone()];
        expected.sort();
        assert_eq!(child_hashes, expected);

        let only_thumbs = store
            .children_of(&parent.blake3, Some(BlobType::Thumbnail))
            .await
            .unwrap();
        assert_eq!(only_thumbs.len(), 1);
        assert_eq!(only_thumbs[0].blake3, thumb.blake3);
    }

    #[tokio::test]
    async fn derived_returns_single_record_for_parent_and_type_or_none() {
        let (store, _pool, _tmp) = make_store().await;
        let parent = store
            .insert(b"parent for derived", NewBlobMeta::default())
            .await
            .unwrap();

        assert!(store
            .derived(&parent.blake3, BlobType::Preview)
            .await
            .unwrap()
            .is_none());

        let preview = store
            .insert(
                b"preview bytes",
                NewBlobMeta {
                    blob_type: BlobType::Preview,
                    parent_blake3: Some(parent.blake3.clone()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();

        let found = store
            .derived(&parent.blake3, BlobType::Preview)
            .await
            .unwrap()
            .expect("preview found");
        assert_eq!(found.blake3, preview.blake3);

        // wrong blob_type for this parent still returns none.
        assert!(store
            .derived(&parent.blake3, BlobType::Waveform)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn canvas_refs_track_and_remove_individually() {
        let (store, _pool, _tmp) = make_store().await;
        let blob = store
            .insert(b"canvas ref test bytes", NewBlobMeta::default())
            .await
            .unwrap();

        assert!(store
            .canvas_refs_for_blob(&blob.blake3)
            .await
            .unwrap()
            .is_empty());

        store
            .add_canvas_ref(&blob.blake3, "canvas-a")
            .await
            .unwrap();
        store
            .add_canvas_ref(&blob.blake3, "canvas-b")
            .await
            .unwrap();
        // re-adding an existing ref is a no-op, not an error.
        store
            .add_canvas_ref(&blob.blake3, "canvas-a")
            .await
            .unwrap();

        let mut refs = store.canvas_refs_for_blob(&blob.blake3).await.unwrap();
        refs.sort();
        assert_eq!(refs, vec!["canvas-a".to_string(), "canvas-b".to_string()]);

        store
            .remove_canvas_ref(&blob.blake3, "canvas-a")
            .await
            .unwrap();
        assert_eq!(
            store.canvas_refs_for_blob(&blob.blake3).await.unwrap(),
            vec!["canvas-b".to_string()]
        );

        // removing a ref that doesn't exist is a no-op.
        store
            .remove_canvas_ref(&blob.blake3, "canvas-a")
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn remove_all_canvas_refs_clears_every_blob_for_that_canvas() {
        let (store, _pool, _tmp) = make_store().await;
        let a = store
            .insert(b"ref bulk a", NewBlobMeta::default())
            .await
            .unwrap();
        let b = store
            .insert(b"ref bulk b", NewBlobMeta::default())
            .await
            .unwrap();

        store.add_canvas_ref(&a.blake3, "canvas-x").await.unwrap();
        store.add_canvas_ref(&b.blake3, "canvas-x").await.unwrap();
        store.add_canvas_ref(&a.blake3, "canvas-y").await.unwrap();

        store.remove_all_canvas_refs("canvas-x").await.unwrap();

        assert!(store
            .canvas_refs_for_blob(&a.blake3)
            .await
            .unwrap()
            .contains(&"canvas-y".to_string()));
        assert!(!store
            .canvas_refs_for_blob(&a.blake3)
            .await
            .unwrap()
            .contains(&"canvas-x".to_string()));
        assert!(store
            .canvas_refs_for_blob(&b.blake3)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn blobs_for_batch_resolves_existing_and_skips_missing() {
        let (store, _pool, _tmp) = make_store().await;
        let a = store
            .insert(b"blob a", NewBlobMeta::default())
            .await
            .unwrap();
        let b = store
            .insert(b"blob b", NewBlobMeta::default())
            .await
            .unwrap();

        let map = store
            .blobs_for(&[
                a.blake3.clone(),
                b.blake3.clone(),
                "missing-hash".to_string(),
            ])
            .await
            .unwrap();

        assert_eq!(map.len(), 2);
        assert!(map.contains_key(&a.blake3));
        assert!(map.contains_key(&b.blake3));
        assert!(!map.contains_key("missing-hash"));

        // empty input returns an empty map without querying.
        let empty = store.blobs_for(&[]).await.unwrap();
        assert!(empty.is_empty());
    }
}
