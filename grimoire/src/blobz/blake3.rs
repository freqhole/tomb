//! blake3 hash computation for iroh-blobs
//!
//! computes blake3 hashes for audio files, used for verified streaming.
//! hashes are stored in media_blobz.blake3 column for lookup.
//! also adds files to the shared storage node's iroh-blobs store for P2P
//! serving.

use crate::error::{GrimoireError, GrimoireResult};
use crate::media_blobz;
use futures_util::stream::{self, StreamExt};
use iroh_blobs::api::blobs::AddPathOptions;
use iroh_blobs::api::proto::ImportMode;
use iroh_blobs::{BlobFormat, Hash};
use std::error::Error as _;
use std::path::Path;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

/// log pre-flight metadata about a path before handing it to iroh-blobs'
/// reference-mode import, since iroh-blobs' own io errors are too terse
/// (e.g. `Error::Io` with no path/kind/errno) to tell us why an import
/// failed. also warns if the source file and the blobs store's data_dir
/// live on different devices/volumes, since `ImportMode::TryReference`
/// likely relies on a hardlink under the hood, which can't cross devices.
fn log_preflight_metadata(canonical: &Path) {
    match std::fs::symlink_metadata(canonical) {
        Ok(meta) => {
            #[cfg(unix)]
            let (dev, ino) = {
                use std::os::unix::fs::MetadataExt;
                (Some(meta.dev()), Some(meta.ino()))
            };
            #[cfg(not(unix))]
            let (dev, ino): (Option<u64>, Option<u64>) = (None, None);

            tracing::info!(
                path = ?canonical,
                is_file = meta.is_file(),
                is_dir = meta.is_dir(),
                is_symlink = meta.is_symlink(),
                len = meta.len(),
                readonly = meta.permissions().readonly(),
                ?dev,
                ?ino,
                "add_file_to_store: pre-flight metadata"
            );

            #[cfg(unix)]
            if let (Some(file_dev), Ok(store_meta)) = (
                dev,
                std::fs::metadata(&crate::config::get_config().data_dir),
            ) {
                use std::os::unix::fs::MetadataExt;
                if file_dev != store_meta.dev() {
                    tracing::warn!(
                        path = ?canonical,
                        file_dev,
                        data_dir_dev = store_meta.dev(),
                        "add_file_to_store: source file and blobs store data_dir are on \
                         different devices/volumes - a reference-mode (hardlink) import may \
                         fail and require falling back to a copy"
                    );
                }
            }
        }
        Err(e) => {
            tracing::warn!(
                path = ?canonical,
                error = ?e,
                "add_file_to_store: failed to stat file before import"
            );
        }
    }
}

/// add a file to the shared storage node's iroh-blobs store using reference
/// mode, avoiding a copy of the file's bytes.
///
/// only stores the outboard verification tree (.obao4) and references the
/// original file. the input path is canonicalized first so iroh-blobs never
/// persists tilde paths, symlink chains, or flatpak portal paths that vanish
/// across sessions - canonicalization failures (e.g. file deleted) fall back
/// to the input path and let iroh surface the error downstream.
pub async fn add_file_to_store(path: &Path) -> GrimoireResult<Hash> {
    let store = crate::database::storage_node().await?.fs_store;

    let canonical = crate::paths::canonical_path(path);

    log_preflight_metadata(&canonical);

    let options = AddPathOptions {
        path: canonical.clone(),
        format: BlobFormat::Raw,
        mode: ImportMode::TryReference,
    };

    let tag = store.add_path_with_opts(options).await.map_err(|e| {
        // debug (`{:?}`) formatting and the source chain often carry the
        // underlying io::Error's kind/errno/message that Display (`{}`)
        // drops - both are logged since we don't yet know which iroh-blobs
        // surfaces more detail through.
        let source_chain: Vec<String> = {
            let mut chain = Vec::new();
            let mut source = e.source();
            while let Some(s) = source {
                chain.push(s.to_string());
                source = s.source();
            }
            chain
        };
        tracing::error!(
            path = ?canonical,
            error_display = %e,
            error_debug = ?e,
            ?source_chain,
            "failed to add file to blobs store"
        );
        GrimoireError::ProcessingFailed {
            message: format!("failed to add file to blobs store: {} (debug: {:?})", e, e),
        }
    })?;

    tracing::info!(
        "added file {:?} to blobs store (reference mode), hash: {}",
        canonical,
        tag.hash.to_hex()
    );

    Ok(tag.hash)
}

/// add raw bytes to the shared storage node's iroh-blobs store.
/// used for small blobs (thumbnails, waveforms) that live in the database,
/// not on disk.
pub async fn add_bytes_to_store(data: &[u8]) -> GrimoireResult<Hash> {
    let store = crate::database::storage_node().await?.fs_store;

    let tag = store
        .blobs()
        .add_bytes(bytes::Bytes::copy_from_slice(data))
        .await
        .map_err(|e| {
            tracing::error!(bytes = data.len(), error = %e, "failed to add bytes to blobs store");
            GrimoireError::ProcessingFailed {
                message: format!("failed to add bytes to blobs store: {}", e),
            }
        })?;

    tracing::info!(
        "added {} bytes to blobs store, hash: {}",
        data.len(),
        tag.hash.to_hex()
    );

    Ok(tag.hash)
}

/// check if a blob exists in the shared storage node's iroh-blobs store by
/// hash.
async fn has_blob(hash: Hash) -> GrimoireResult<bool> {
    let store = crate::database::storage_node().await?.fs_store;
    store
        .has(hash)
        .await
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("failed to check blob existence: {}", e),
        })
}

/// parse a blake3 hash string into an iroh `Hash`.
fn parse_hash(hash_str: &str) -> GrimoireResult<Hash> {
    hash_str
        .parse()
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("invalid blake3 hash: {}", e),
        })
}

/// compute blake3 hash of a file
/// returns hex-encoded hash string
pub async fn compute_blake3_hash(path: &Path) -> GrimoireResult<String> {
    reliquary::hash_file(path)
        .await
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("failed to compute blake3 hash: {}", e),
        })
}

/// compute blake3 hash from bytes
pub fn compute_blake3_from_bytes(data: &[u8]) -> String {
    reliquary::hash_bytes(data)
}

/// compute and store blake3 hash for a blob
/// used for on-demand computation when P2P client requests a blob
/// also adds the file to iroh-blobs FsStore for P2P serving
///
/// handles both file-backed blobs (with local_path) and db-stored blobs
/// (waveforms, thumbnails stored in blob_data table with no local_path).
pub async fn ensure_blake3_hash(blob_id: &str) -> GrimoireResult<String> {
    tracing::debug!("ensure_blake3_hash called for blob_id={}", blob_id);

    let blob = media_blobz::get_media_blob(blob_id).await?;

    tracing::debug!(
        "ensure_blake3_hash: blob_id={}, local_path={:?}, blake3={:?}, blob_type={}, mime={:?}",
        blob_id,
        blob.local_path,
        blob.blake3.as_deref().map(|h| &h[..16.min(h.len())]),
        blob.blob_type,
        blob.mime
    );

    match blob.local_path {
        Some(local_path) => {
            // file-backed blob: audio files, large images stored on disk
            let path = Path::new(&local_path);
            if !path.exists() {
                return Err(GrimoireError::ProcessingFailed {
                    message: format!("blob file does not exist: {}", local_path),
                });
            }

            if let Some(blake3) = blob.blake3 {
                // already has blake3, just ensure it's in FsStore
                let _ = add_file_to_store(path).await;
                return Ok(blake3);
            }

            // compute blake3 by adding file to FsStore
            let hash = add_file_to_store(path).await?;
            let blake3_hash = hash.to_hex().to_string();
            media_blobz::update_blob_blake3(blob_id, &blake3_hash).await?;

            tracing::info!(
                "computed blake3 for file-backed blob {}: {} (added to FsStore)",
                blob_id,
                &blake3_hash[..16]
            );

            Ok(blake3_hash)
        }
        None => {
            // db-stored blob: waveforms, thumbnails, small images in blob_data table
            if let Some(blake3) = blob.blake3 {
                // already has blake3, ensure it's in FsStore
                let hash = parse_hash(&blake3)?;
                if !has_blob(hash).await? {
                    // not in FsStore — re-add from whichever source still has
                    // the bytes (blob_data table, or reliquary's blob store)
                    if let Ok((_, Some(data))) =
                        media_blobz::get_media_blob_with_data(blob_id).await
                    {
                        let _ = add_bytes_to_store(&data).await;
                    }
                }
                return Ok(blake3);
            }

            // no blake3 yet — read bytes from wherever they still live
            // (blob_data table or, failing that, reliquary's blob store)
            let data = match media_blobz::get_media_blob_with_data(blob_id).await {
                Ok((_, Some(data))) => data,
                _ => {
                    return Err(GrimoireError::ProcessingFailed {
                        message: format!(
                            "blob {} has no local_path and no data source for blake3 computation",
                            blob_id
                        ),
                    });
                }
            };

            // add bytes to FsStore — returns blake3 hash
            let hash = add_bytes_to_store(&data).await?;
            let blake3_hash = hash.to_hex().to_string();

            // store blake3 in database for future lookups
            media_blobz::update_blob_blake3(blob_id, &blake3_hash).await?;

            tracing::info!(
                "computed blake3 for db-stored blob {} ({}): {} ({} bytes, added to FsStore)",
                blob_id,
                blob.blob_type,
                &blake3_hash[..16],
                data.len()
            );

            Ok(blake3_hash)
        }
    }
}

/// ensure a blob is loaded into the shared storage node's iroh-blobs store
/// by its blake3 hash.
///
/// looks up the blob in media_blobz by blake3, then adds the file (or
/// bytes) to the store if not already present. returns true if the blob is
/// now available, false if the blake3 hash is not found in our database.
///
/// this enables on-demand loading for iroh-blobs requests.
pub async fn ensure_blob_by_blake3(blake3_hash: &str) -> GrimoireResult<bool> {
    // first check if already in store
    let hash = match parse_hash(blake3_hash) {
        Ok(h) => h,
        Err(_) => return Ok(false),
    };

    if has_blob(hash).await? {
        tracing::info!(
            "ensure_blob_by_blake3: already in FsStore: {}",
            &blake3_hash[..16]
        );
        return Ok(true);
    }

    // look up blob by blake3 in media_blobz
    let blob = match media_blobz::get_media_blob_by_blake3(blake3_hash).await {
        Ok(b) => b,
        Err(_) => {
            tracing::warn!(
                "ensure_blob_by_blake3: NOT FOUND in media_blobz: {} (dest asked for a blake3 this source has never seen)",
                &blake3_hash[..16]
            );
            return Ok(false);
        }
    };
    tracing::info!(
        "ensure_blob_by_blake3: found media_blob {} for blake3 {} (local_path={:?})",
        blob.id,
        &blake3_hash[..16],
        blob.local_path.as_deref(),
    );

    match blob.local_path {
        Some(local_path) => {
            // file-backed blob
            let path = Path::new(&local_path);
            if !path.exists() {
                tracing::warn!(
                    "ensure_blob_by_blake3: LOCAL FILE MISSING for {}: path={} (media_blob row exists but on-disk file is gone -- db/disk drift)",
                    &blake3_hash[..16],
                    local_path
                );
                return Ok(false);
            }

            match add_file_to_store(path).await {
                Ok(_) => {
                    tracing::info!(
                        "ensure_blob_by_blake3: added file to FsStore: {} -> {}",
                        &blake3_hash[..16],
                        local_path
                    );
                    Ok(true)
                }
                Err(e) => {
                    tracing::warn!(
                        "ensure_blob_by_blake3: failed to add file to FsStore: {} -> {}: {}",
                        &blake3_hash[..16],
                        local_path,
                        e
                    );
                    Ok(false)
                }
            }
        }
        None => {
            // db-stored blob: waveforms, thumbnails — read via grimoire's own
            // blob_data table, falling back to reliquary if it's already
            // moved on (get_media_blob_with_data covers both sources).
            let data = match media_blobz::get_media_blob_with_data(&blob.id).await {
                Ok((_, Some(data))) => data,
                Ok((_, None)) => {
                    tracing::warn!(
                        "ensure_blob_by_blake3: NO LOCAL_PATH AND NO DATA for {}: media_blob {} has neither a file nor inline bytes",
                        &blake3_hash[..16],
                        blob.id,
                    );
                    return Ok(false);
                }
                Err(e) => {
                    tracing::warn!(
                        "ensure_blob_by_blake3: failed to resolve bytes for {} (media_blob {}): {}",
                        &blake3_hash[..16],
                        blob.id,
                        e,
                    );
                    return Ok(false);
                }
            };

            match add_bytes_to_store(&data).await {
                Ok(_) => {
                    tracing::info!(
                        "ensure_blob_by_blake3: added db blob to FsStore: {} ({} bytes)",
                        &blake3_hash[..16],
                        data.len()
                    );
                    Ok(true)
                }
                Err(e) => {
                    tracing::warn!(
                        "ensure_blob_by_blake3: failed to add db blob to FsStore: {}: {}",
                        &blake3_hash[..16],
                        e
                    );
                    Ok(false)
                }
            }
        }
    }
}

/// backfill blake3 hashes for blobs that need them.
/// covers both file-backed blobs (audio with local_path) and db-stored
/// blobs (images, thumbnails, waveforms in the blob_data table) — anything
/// in `media_blobz` with a NULL `blake3` column gets hashed and added to
/// the iroh-blobs FsStore.
/// processes up to `batch_size` blobs at a time, running up to
/// `concurrency` hash+store tasks in parallel (clamped to >= 1).
/// returns (processed_count, remaining_count)
pub async fn backfill_blake3_hashes(
    batch_size: i64,
    concurrency: usize,
) -> GrimoireResult<(i64, i64)> {
    let concurrency = concurrency.max(1);
    tracing::info!(
        "backfill_blake3_hashes: invoked with batch_size={batch_size} concurrency={concurrency}"
    );
    let blobs = media_blobz::list_blobs_needing_blake3(batch_size).await?;
    let total = blobs.len() as i64;
    tracing::info!("backfill_blake3_hashes: {total} blob(s) queued");
    crate::progress::report(format!(
        "scanning {total} blob(s) needing blake3 (batch_size={batch_size}, concurrency={concurrency})"
    ));
    // eagerly warm up the storage node so the first iteration doesn't pay
    // the (one-time) load cost silently. surfaces hangs at this step.
    crate::progress::report("loading iroh-blobs FsStore\u{2026}".to_string());
    tracing::info!("backfill_blake3_hashes: warming FsStore");
    match crate::database::storage_node().await {
        Ok(_) => {
            tracing::info!("backfill_blake3_hashes: FsStore ready");
            crate::progress::report("FsStore ready".to_string());
        }
        Err(e) => {
            tracing::error!("backfill_blake3_hashes: FsStore load failed: {e}");
            crate::progress::report(format!("FAIL loading FsStore: {e}"));
            return Err(e);
        }
    }

    let processed = Arc::new(AtomicI64::new(0));
    let skipped = Arc::new(AtomicI64::new(0));

    stream::iter(blobs.into_iter().enumerate())
        .for_each_concurrent(concurrency, |(idx, blob)| {
            let processed = processed.clone();
            let skipped = skipped.clone();
            async move {
                let n = (idx as i64) + 1;
                match backfill_one_blob(blob, n, total).await {
                    Ok(()) => {
                        processed.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(()) => {
                        skipped.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }
        })
        .await;

    let processed = processed.load(Ordering::Relaxed);
    let skipped = skipped.load(Ordering::Relaxed);
    let remaining = media_blobz::count_blobs_needing_blake3().await?;
    crate::progress::report(format!(
        "done: hashed {processed}, skipped {skipped}, {remaining} remaining"
    ));

    Ok((processed, remaining))
}

/// process a single blob during backfill. returns Ok(()) on success,
/// Err(()) when the blob was skipped (errors are already reported via
/// `tracing` + `crate::progress::report` inside this function).
async fn backfill_one_blob(blob: media_blobz::MediaBlob, n: i64, total: i64) -> Result<(), ()> {
    let blob_id = blob.id.clone();

    if let Some(local_path) = &blob.local_path {
        // file-backed blob (audio): hash from disk directly.
        let path = Path::new(local_path);
        if !path.exists() {
            tracing::warn!(
                "backfill: skipping blob {} - file not found: {}",
                blob_id,
                local_path
            );
            crate::progress::report(format!(
                "[{n}/{total}] skip {blob_id}: file missing ({local_path})"
            ));
            return Err(());
        }
        let fname = path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| local_path.clone());
        crate::progress::report(format!(
            "[{n}/{total}] hashing file {blob_id} ({fname})\u{2026}"
        ));
        tracing::info!(
            "backfill_blake3: [{n}/{total}] add_file_to_store start blob={blob_id} path={local_path}"
        );
        match add_file_to_store(path).await {
            Ok(hash) => {
                let blake3_hash = hash.to_hex().to_string();
                if let Err(e) = media_blobz::update_blob_blake3(&blob_id, &blake3_hash).await {
                    tracing::warn!("failed to store blake3 for blob {}: {}", blob_id, e);
                    crate::progress::report(format!("[{n}/{total}] FAIL store {blob_id}: {e}"));
                    Err(())
                } else {
                    tracing::debug!(
                        "backfill: computed blake3 for file-backed blob {}: {} (added to FsStore)",
                        blob_id,
                        &blake3_hash[..16]
                    );
                    crate::progress::report(format!(
                        "[{n}/{total}] hashed file blob {blob_id} -> {}\u{2026}",
                        &blake3_hash[..16]
                    ));
                    Ok(())
                }
            }
            Err(e) => {
                tracing::warn!("failed to add blob {} to FsStore: {}", blob_id, e);
                crate::progress::report(format!("[{n}/{total}] FAIL FsStore {blob_id}: {e}"));
                Err(())
            }
        }
    } else {
        // db-stored blob (images, thumbnails, waveforms): read bytes
        // from blob_data and hash. `ensure_blake3_hash` already
        // handles this path and writes the hash back to media_blobz.
        crate::progress::report(format!(
            "[{n}/{total}] hashing db {} blob {blob_id}\u{2026}",
            blob.blob_type
        ));
        match ensure_blake3_hash(&blob_id).await {
            Ok(blake3_hash) => {
                tracing::debug!(
                    "backfill: computed blake3 for db-stored blob {} ({}): {} (added to FsStore)",
                    blob_id,
                    blob.blob_type,
                    &blake3_hash[..16]
                );
                crate::progress::report(format!(
                    "[{n}/{total}] hashed db {} blob {blob_id} -> {}\u{2026}",
                    blob.blob_type,
                    &blake3_hash[..16]
                ));
                Ok(())
            }
            Err(e) => {
                tracing::warn!(
                    "backfill: skipping db-stored blob {} ({}): {}",
                    blob_id,
                    blob.blob_type,
                    e
                );
                crate::progress::report(format!(
                    "[{n}/{total}] skip db {} blob {blob_id}: {e}",
                    blob.blob_type
                ));
                Err(())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_blake3_from_bytes() {
        let data = b"hello world";
        let hash = compute_blake3_from_bytes(data);
        // blake3 produces 64-char hex string
        assert_eq!(hash.len(), 64);
        // known hash for "hello world"
        assert_eq!(
            hash,
            "d74981efa70a0c880b8d8c1985d075dbcbf679b99a5f9914e5aaf96b831a9e24"
        );
    }

    #[test]
    fn test_parse_hash() {
        // valid 64-char hex hash
        let hash_str = "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262";
        let result = parse_hash(hash_str);
        assert!(result.is_ok());
    }

    #[test]
    fn test_parse_hash_invalid() {
        // use a 64-char string with non-hex chars so iroh's Hash::FromStr
        // takes the hex branch and returns Err cleanly. shorter inputs
        // hit the base32 branch which can panic inside data-encoding when
        // the decoded length doesn't match the fixed 32-byte buffer.
        let result = parse_hash(&"z".repeat(64));
        assert!(result.is_err());
    }
}
