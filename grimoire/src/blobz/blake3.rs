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
                        if let Err(e) =
                            media_blobz::update_blob_blake3(&blob_id, &blake3_hash).await
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
