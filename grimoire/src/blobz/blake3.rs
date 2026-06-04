//! blake3 hash computation for iroh-blobs
//!
//! computes blake3 hashes for audio files, used for verified streaming.
//! hashes are stored in media_blobz.blake3 column for lookup.
//! also adds files to the iroh-blobs FsStore for P2P serving.

use crate::blobz::store;
use crate::error::{GrimoireError, GrimoireResult};
use crate::media_blobz;
use futures_util::stream::{self, StreamExt};
use std::path::Path;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, BufReader};

/// compute blake3 hash of a file
/// returns hex-encoded hash string
pub async fn compute_blake3_hash(path: &Path) -> GrimoireResult<String> {
    let file = File::open(path)
        .await
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("failed to open file for blake3 hashing: {}", e),
        })?;

    let mut reader = BufReader::new(file);
    let mut hasher = blake3::Hasher::new();
    let mut buffer = vec![0u8; 64 * 1024]; // 64KB chunks

    loop {
        let bytes_read =
            reader
                .read(&mut buffer)
                .await
                .map_err(|e| GrimoireError::ProcessingFailed {
                    message: format!("failed to read file for blake3 hashing: {}", e),
                })?;

        if bytes_read == 0 {
            break;
        }

        hasher.update(&buffer[..bytes_read]);
    }

    Ok(hasher.finalize().to_hex().to_string())
}

/// compute blake3 hash from bytes
pub fn compute_blake3_from_bytes(data: &[u8]) -> String {
    blake3::hash(data).to_hex().to_string()
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
                let _ = store::add_file_to_store(path).await;
                return Ok(blake3);
            }

            // compute blake3 by adding file to FsStore
            let hash = store::add_file_to_store(path).await?;
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
                let hash = store::parse_hash(&blake3)?;
                if !store::has_blob(hash).await? {
                    // not in FsStore — re-add from db
                    let data_response = crate::blob_data::get_blob_data(blob_id).await;
                    if data_response.success {
                        if let Some(data) = data_response.data {
                            let _ = store::add_bytes_to_store(&data).await;
                        }
                    }
                }
                return Ok(blake3);
            }

            // no blake3 yet — read bytes from blob_data table
            let data_response = crate::blob_data::get_blob_data(blob_id).await;
            if !data_response.success {
                return Err(GrimoireError::ProcessingFailed {
                    message: format!(
                        "blob {} has no local_path and no blob_data for blake3 computation",
                        blob_id
                    ),
                });
            }

            let data = data_response
                .data
                .ok_or_else(|| GrimoireError::ProcessingFailed {
                    message: format!(
                        "blob {} has no local_path and blob_data returned no bytes",
                        blob_id
                    ),
                })?;

            // add bytes to FsStore — returns blake3 hash
            let hash = store::add_bytes_to_store(&data).await?;
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
    // eagerly warm up the FsStore so the first iteration doesn't pay
    // the (one-time) load cost silently. surfaces hangs at this step.
    crate::progress::report("loading iroh-blobs FsStore\u{2026}".to_string());
    tracing::info!("backfill_blake3_hashes: warming FsStore");
    match store::get_blobs_store().await {
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
        match store::add_file_to_store(path).await {
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
}
