//! iroh-blobs FsStore management
//!
//! provides singleton FsStore for serving audio files via iroh-blobs protocol.
//! files are added to the store and content-addressed by blake3 hash.
//!
//! uses ImportMode::TryReference to avoid duplicating file data - only stores
//! the outboard (.obao4) verification tree and references the original file.

use crate::config::get_config;
use crate::error::{GrimoireError, GrimoireResult};
use iroh_blobs::api::blobs::AddPathOptions;
use iroh_blobs::api::proto::ImportMode;
use iroh_blobs::store::fs::FsStore;
use iroh_blobs::{BlobFormat, Hash};
use std::path::Path;
use tokio::sync::OnceCell;
use tracing::info;

/// global FsStore instance
static BLOBS_STORE: OnceCell<FsStore> = OnceCell::const_new();

/// re-export iroh-blobs ALPN for protocol registration
pub use iroh_blobs::protocol::ALPN as BLOBS_ALPN;

/// get or initialize the global FsStore
///
/// the store is created at `{data_dir}/freqhole-blobz/`
/// and reused for all iroh-blobs operations.
pub async fn get_blobs_store() -> GrimoireResult<&'static FsStore> {
    BLOBS_STORE
        .get_or_try_init(|| async {
            let config = get_config();
            let store_path = config.freqhole_blobz_path();

            info!("initializing iroh-blobs FsStore at {:?}", store_path);

            // ensure directory exists
            tokio::fs::create_dir_all(&store_path).await.map_err(|e| {
                GrimoireError::ProcessingFailed {
                    message: format!("failed to create blobz directory: {}", e),
                }
            })?;

            FsStore::load(&store_path)
                .await
                .map_err(|e| GrimoireError::ProcessingFailed {
                    message: format!("failed to load iroh-blobs store: {}", e),
                })
        })
        .await
}

/// add file to the blobs store using reference mode
///
/// uses ImportMode::TryReference to avoid copying file data.
/// only stores the outboard verification tree (.obao4) and references original file.
/// returns the blake3 hash of the blob.
pub async fn add_file_to_store(path: &Path) -> GrimoireResult<Hash> {
    let store = get_blobs_store().await?;

    // use TryReference to avoid duplicating data - only stores outboard tree
    let options = AddPathOptions {
        path: path.to_path_buf(),
        format: BlobFormat::Raw,
        mode: ImportMode::TryReference,
    };

    let tag =
        store
            .add_path_with_opts(options)
            .await
            .map_err(|e| GrimoireError::ProcessingFailed {
                message: format!("failed to add file to blobs store: {}", e),
            })?;

    info!(
        "added file {:?} to blobs store (reference mode), hash: {}",
        path,
        tag.hash.to_hex()
    );

    Ok(tag.hash)
}

/// add raw bytes to the blobs store
/// used for small blobs (thumbnails, waveforms) that live in the database, not on disk.
/// returns the blake3 hash of the blob.
pub async fn add_bytes_to_store(data: &[u8]) -> GrimoireResult<Hash> {
    let store = get_blobs_store().await?;

    let tag = store
        .blobs()
        .add_bytes(bytes::Bytes::copy_from_slice(data))
        .await
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("failed to add bytes to blobs store: {}", e),
        })?;

    info!(
        "added {} bytes to blobs store, hash: {}",
        data.len(),
        tag.hash.to_hex()
    );

    Ok(tag.hash)
}

/// check if a blob exists in the store by hash
pub async fn has_blob(hash: Hash) -> GrimoireResult<bool> {
    let store = get_blobs_store().await?;

    let exists = store
        .has(hash)
        .await
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("failed to check blob existence: {}", e),
        })?;

    Ok(exists)
}

/// parse a blake3 hash string into iroh Hash
pub fn parse_hash(hash_str: &str) -> GrimoireResult<Hash> {
    hash_str
        .parse()
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("invalid blake3 hash: {}", e),
        })
}

/// ensure a blob is loaded into FsStore by its blake3 hash
///
/// looks up the blob in media_blobz by blake3, then adds the file to FsStore
/// if not already present. returns true if blob is now available, false if
/// the blake3 hash is not found in our database.
///
/// this enables on-demand loading for iroh-blobs requests.
pub async fn ensure_blob_by_blake3(blake3_hash: &str) -> GrimoireResult<bool> {
    use crate::media_blobz;

    // first check if already in store
    let hash = match parse_hash(blake3_hash) {
        Ok(h) => h,
        Err(_) => return Ok(false),
    };

    if has_blob(hash).await? {
        tracing::debug!(
            "ensure_blob_by_blake3: already in FsStore: {}",
            &blake3_hash[..16]
        );
        return Ok(true);
    }

    // look up blob by blake3 in media_blobz
    let blob = match media_blobz::get_media_blob_by_blake3(blake3_hash).await {
        Ok(b) => b,
        Err(_) => {
            tracing::debug!(
                "ensure_blob_by_blake3: not found in media_blobz: {}",
                &blake3_hash[..16]
            );
            return Ok(false);
        }
    };

    match blob.local_path {
        Some(local_path) => {
            // file-backed blob
            let path = Path::new(&local_path);
            if !path.exists() {
                tracing::debug!(
                    "ensure_blob_by_blake3: file not found: {} -> {}",
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
            // db-stored blob: waveforms, thumbnails — load from blob_data table
            let data_response = crate::blob_data::get_blob_data(&blob.id).await;
            if !data_response.success {
                tracing::debug!(
                    "ensure_blob_by_blake3: no local_path and no blob_data: {}",
                    &blake3_hash[..16]
                );
                return Ok(false);
            }

            let data = match data_response.data {
                Some(d) => d,
                None => {
                    tracing::debug!(
                        "ensure_blob_by_blake3: blob_data returned no bytes: {}",
                        &blake3_hash[..16]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_hash() {
        // valid 64-char hex hash
        let hash_str = "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262";
        let result = parse_hash(hash_str);
        assert!(result.is_ok());
    }

    #[test]
    fn test_parse_hash_invalid() {
        let result = parse_hash("not-a-hash");
        assert!(result.is_err());
    }
}
