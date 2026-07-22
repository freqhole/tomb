//! iroh-blobs integration module
//!
//! provides blake3 hash computation for verified streaming of audio files
//! over P2P transport. the iroh-blobs `FsStore` itself lives in the shared
//! storage node (`crate::database::storage_node`).

mod blake3;
mod migrate_to_reliquary;

pub use blake3::*;
pub use migrate_to_reliquary::{migrate_to_reliquary, MigrationReport, UnresolvedParent};

/// re-export iroh-blobs ALPN for protocol registration
pub use iroh_blobs::protocol::ALPN as BLOBS_ALPN;

use crate::error::{GrimoireError, GrimoireResult};
use iroh_blobs::Hash;

/// begin a chunked upload. creates an empty temp file and returns an
/// upload_id the caller passes to `append_chunk` / `finish_chunked_import`.
///
/// used by clients that can't send a whole file in one payload (e.g.
/// android's file picker returns no filesystem path, and tauri ipc is
/// json-only) - the file is streamed in bounded chunks and accumulated on
/// disk so neither side ever holds the whole thing in memory at once.
pub async fn begin_chunked_import() -> GrimoireResult<String> {
    crate::database::chunked_import()
        .await
        .begin()
        .await
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("failed to begin chunked import: {}", e),
        })
}

/// append a chunk of bytes to an in-flight chunked upload.
/// returns the total number of bytes written so far.
pub async fn append_chunk(upload_id: &str, data: &[u8]) -> GrimoireResult<u64> {
    crate::database::chunked_import()
        .await
        .append(upload_id, data)
        .await
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("failed to append chunk: {}", e),
        })
}

/// finish a chunked upload: adopt the accumulated file into the storage
/// node's blobz store (streamed hash, no full in-memory read), then clear
/// the upload session. returns the blake3 hash of the imported blob.
pub async fn finish_chunked_import(upload_id: &str) -> GrimoireResult<Hash> {
    let store = crate::database::storage_node().await?.blobz.clone();
    let record = crate::database::chunked_import()
        .await
        .finish(
            upload_id,
            store.as_ref(),
            reliquary::blobz::NewBlobMeta::default(),
        )
        .await
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("failed to finish chunked import: {}", e),
        })?;

    record
        .blake3
        .parse()
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("invalid blake3 from chunked import: {}", e),
        })
}

/// abort an in-flight chunked upload: delete the temp file and clear the
/// session. safe to call with an unknown id (no-op).
pub async fn abort_chunked_import(upload_id: &str) -> GrimoireResult<()> {
    crate::database::chunked_import()
        .await
        .abort(upload_id)
        .await;
    Ok(())
}
