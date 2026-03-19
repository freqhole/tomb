//! blake3 hash computation for iroh-blobs
//!
//! computes blake3 hashes for audio files, used for verified streaming.
//! hashes are stored in media_blobz.blake3 column for lookup.
//! also adds files to the iroh-blobs FsStore for P2P serving.

use crate::blobz::store;
use crate::error::{GrimoireError, GrimoireResult};
use crate::media_blobz;
use std::path::Path;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, BufReader};

/// compute blake3 hash of a file
/// returns hex-encoded hash string
pub async fn compute_blake3_hash(path: &Path) -> GrimoireResult<String> {
    let file = File::open(path).await.map_err(|e| GrimoireError::ProcessingFailed {
        message: format!("failed to open file for blake3 hashing: {}", e),
    })?;

    let mut reader = BufReader::new(file);
    let mut hasher = blake3::Hasher::new();
    let mut buffer = vec![0u8; 64 * 1024]; // 64KB chunks

    loop {
        let bytes_read = reader.read(&mut buffer).await.map_err(|e| {
            GrimoireError::ProcessingFailed {
                message: format!("failed to read file for blake3 hashing: {}", e),
            }
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
pub async fn ensure_blake3_hash(blob_id: &str) -> GrimoireResult<String> {
    // get the blob to check if blake3 already exists
    let blob = media_blobz::get_media_blob(blob_id).await?;

    // need local_path for FsStore operations
    let local_path = blob.local_path.ok_or_else(|| GrimoireError::ProcessingFailed {
        message: format!("blob {} has no local_path for blake3 computation", blob_id),
    })?;

    let path = Path::new(&local_path);
    if !path.exists() {
        return Err(GrimoireError::ProcessingFailed {
            message: format!("blob file does not exist: {}", local_path),
        });
    }

    // if blake3 already exists, ensure file is in FsStore and return
    if let Some(blake3) = blob.blake3 {
        // ensure file is in FsStore (idempotent)
        let _ = store::add_file_to_store(path).await;
        return Ok(blake3);
    }

    // add file to FsStore - returns blake3 hash
    let hash = store::add_file_to_store(path).await?;
    let blake3_hash = hash.to_hex().to_string();

    // store in database
    media_blobz::update_blob_blake3(blob_id, &blake3_hash).await?;

    tracing::info!(
        "computed blake3 hash for blob {}: {} (added to FsStore)",
        blob_id,
        &blake3_hash[..16]
    );

    Ok(blake3_hash)
}

/// backfill blake3 hashes for blobs that need them
/// processes up to `batch_size` blobs at a time
/// returns (processed_count, remaining_count)
pub async fn backfill_blake3_hashes(batch_size: i64) -> GrimoireResult<(i64, i64)> {
    let blobs = media_blobz::list_blobs_needing_blake3(batch_size).await?;
    let mut processed = 0i64;

    for blob in blobs {
        let blob_id = blob.id.clone();

        if let Some(local_path) = &blob.local_path {
            let path = Path::new(local_path);
            if path.exists() {
                // add file to FsStore and get blake3 hash
                match store::add_file_to_store(path).await {
                    Ok(hash) => {
                        let blake3_hash = hash.to_hex().to_string();
                        if let Err(e) = media_blobz::update_blob_blake3(&blob_id, &blake3_hash).await
                        {
                            tracing::warn!("failed to store blake3 for blob {}: {}", blob_id, e);
                        } else {
                            processed += 1;
                            tracing::debug!(
                                "backfill: computed blake3 for blob {}: {} (added to FsStore)",
                                blob_id,
                                &blake3_hash[..16]
                            );
                        }
                    }
                    Err(e) => {
                        tracing::warn!("failed to add blob {} to FsStore: {}", blob_id, e);
                    }
                }
            } else {
                tracing::warn!(
                    "backfill: skipping blob {} - file not found: {}",
                    blob_id,
                    local_path
                );
            }
        }
    }

    let remaining = media_blobz::count_blobs_needing_blake3().await?;

    Ok((processed, remaining))
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
