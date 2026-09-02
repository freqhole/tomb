//! iroh-blobs pull: fetch a blob from a peer by blake3 and land it in local
//! media storage. shared by the `*-by-blake3` upload routes and by every
//! `offal::sync` handler.

use serde_json::{json, Value as JsonValue};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tokio::time::Duration;

use crate::config::get_config;
use crate::error::{ErrorDetail, GrimoireError};
use crate::federation::p2p_client;
use crate::media_blobz::{
    create_media_blob, get_media_blob_by_sha256, set_blob_local_path_or_purge_duplicate, BlobType,
    CreateMediaBlobRequest, MediaBlob,
};
use crate::media_domain::MediaDomain;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;

use super::mime::{detect_audio_mime_type, detect_extension, detect_video_mime_type};

/// result of pulling a single audio blob from a remote peer to local storage.
#[derive(Debug)]
pub struct PullAudioBlobResult {
    /// the media_blob row that was created (or deduped to)
    pub blob: MediaBlob,
    /// final on-disk path of the audio file (after rename to {blob_id}.{ext})
    pub local_path: PathBuf,
    /// detected audio mime type
    pub mime: String,
    /// computed sha256 of the downloaded bytes
    pub sha256: String,
    /// file size in bytes
    pub size: i64,
    /// true if a media_blob with this sha256 already existed before this call
    pub existing: bool,
}

/// errors that can occur while pulling an audio blob from a remote peer.
///
/// each variant is mapped to a structured `ErrorDetail` (preserves the
/// `error_type` codes the original `/api/upload/music-by-blake3` route returned).
#[derive(Debug)]
pub enum PullAudioBlobError {
    /// blake3 hash isn't 64 hex chars
    InvalidBlake3,
    /// declared size exceeds federation.max_upload_size_mb
    FileTooLarge { declared: u64, max: u64 },
    /// failed to mkdir -p the output directory
    CreateDirFailed { path: String, message: String },
    /// iroh-blobs fetch failed
    FetchFailed(String),
    /// source peer refused because we aren't a registered federation peer.
    /// caller should create a knock request before retrying.
    PeerUnauthorized { peer: String, blake3: String },
    /// iroh-blobs fetch took longer than 120s wall-clock
    Timeout,
    /// downloaded byte count didn't match the declared size
    SizeMismatch { expected: u64, got: u64 },
    /// failed to read back the downloaded file
    ReadFailed(String),
    /// computed sha256 didn't match the caller-supplied expected sha256
    Sha256Mismatch { expected: String, got: String },
    /// detected mime type didn't match the expected domain (`audio/*`/`video/*`)
    WrongMediaType(MediaDomain),
    /// `create_media_blob` failed
    CreateBlobFailed(GrimoireError),
    /// rename / cross-device-copy failed
    MoveFailed(String),
}

impl PullAudioBlobError {
    /// convert into a `GrimoireResponse` matching the original
    /// `/api/upload/music-by-blake3` failure shapes (preserves error_type codes).
    pub fn into_grimoire_response(self) -> GrimoireResponse<JsonValue> {
        match self {
            PullAudioBlobError::InvalidBlake3 => GrimoireResponse::failure(
                "invalid blake3 hash",
                vec![ErrorDetail::new(
                    "bad_request",
                    "invalid blake3 hash",
                    "blake3 hash must be exactly 64 hex characters",
                )],
            ),
            PullAudioBlobError::FileTooLarge { declared, max } => GrimoireResponse::failure(
                "file too large",
                vec![ErrorDetail::new(
                    "file_too_large",
                    "file too large",
                    format!(
                        "declared size {} bytes exceeds max upload size {} bytes",
                        declared, max
                    ),
                )],
            ),
            PullAudioBlobError::CreateDirFailed { path, message } => {
                // a doc-portal path (flatpak) failing here usually means the portal
                // grant went stale (revoked, file moved/deleted, reinstall) rather
                // than a generic IO error - flag it distinctly so the UI can offer
                // a "reselect folder" recovery instead of a raw error message.
                let error_type = if crate::paths::is_doc_portal_path(&path) {
                    "stale_doc_portal_path"
                } else {
                    "internal_error"
                };
                GrimoireResponse::failure(
                    "failed to create directory",
                    vec![ErrorDetail::new(
                        error_type,
                        "failed to create directory",
                        format!("{} (path: {})", message, path),
                    )],
                )
            }
            PullAudioBlobError::FetchFailed(msg) => GrimoireResponse::failure(
                "failed to fetch blob from peer",
                vec![ErrorDetail::new(
                    "fetch_failed",
                    "failed to fetch blob from peer",
                    &msg,
                )],
            ),
            PullAudioBlobError::PeerUnauthorized { peer, blake3 } => {
                let peer_short = &peer[..16.min(peer.len())];
                let blake3_short = &blake3[..16.min(blake3.len())];
                GrimoireResponse::failure(
                    "peer unauthorized",
                    vec![ErrorDetail::new(
                        "peer_unauthorized",
                        "peer refused access",
                        format!(
                            "source peer {} refused access to blob {} — a knock request is required before retrying.",
                            peer_short, blake3_short,
                        ),
                    )],
                )
            }
            PullAudioBlobError::Timeout => GrimoireResponse::failure(
                "blob fetch timed out",
                vec![ErrorDetail::new(
                    "timeout",
                    "blob fetch timed out",
                    "failed to download blob from peer within 120 seconds. the peer may not be serving blobs (browser needs blob server running) or the connection may have dropped.",
                )],
            ),
            PullAudioBlobError::SizeMismatch { expected, got } => GrimoireResponse::failure(
                "size mismatch",
                vec![ErrorDetail::new(
                    "bad_request",
                    "size mismatch",
                    format!("expected {} bytes but received {} bytes", expected, got),
                )],
            ),
            PullAudioBlobError::ReadFailed(msg) => GrimoireResponse::failure(
                "failed to read downloaded file",
                vec![ErrorDetail::from(GrimoireError::ProcessingFailed { message: msg })],
            ),
            PullAudioBlobError::Sha256Mismatch { expected, got } => GrimoireResponse::failure(
                "sha256 mismatch",
                vec![ErrorDetail::new(
                    "bad_request",
                    "sha256 mismatch",
                    format!("expected sha256 {}, computed {}", expected, got),
                )],
            ),
            PullAudioBlobError::WrongMediaType(domain) => GrimoireResponse::failure(
                format!("invalid {} file", domain),
                vec![ErrorDetail::new(
                    "bad_request",
                    format!("invalid {} file", domain),
                    format!("file is not a valid {} file", domain),
                )],
            ),
            PullAudioBlobError::CreateBlobFailed(e) => {
                GrimoireResponse::failure("failed to create blob", vec![ErrorDetail::from(e)])
            }
            PullAudioBlobError::MoveFailed(msg) => GrimoireResponse::failure(
                "failed to move file",
                vec![ErrorDetail::new("internal_error", "failed to move file", &msg)],
            ),
        }
    }
}

/// pull a single audio or video blob from a remote iroh peer to local storage.
///
/// shared between `/api/upload/music-by-blake3`, `/api/upload/video-by-blake3`,
/// and `/api/sync/song-by-blake3`. `domain` selects which `fetch_*` config's
/// `output_dir` to write into and which mime-type prefix (`audio/`/`video/`)
/// the downloaded file must match. performs:
///   1. blake3 format validation
///   2. max-upload-size enforcement (from federation.max_upload_size_mb)
///   3. iroh-blobs verified streaming fetch to a temp path (120s timeout)
///   4. size validation if `expected_size` provided
///   5. streaming sha256 computation
///   6. optional sha256 verification against `expected_sha256`
///   7. mime detection (must match `domain`)
///   8. `create_media_blob` (with sha256 dedupe)
///   9. rename temp file → `{output_dir}/{year}/{month}/{blob_id}.{ext}`
///
/// caller is responsible for: role checks, transport node_id extraction,
/// follow-up work (importmusic job creation, song stub creation, etc).
pub async fn pull_audio_blob_to_local_storage(
    source_node_id: &str,
    blake3: &str,
    expected_sha256: Option<&str>,
    expected_size: Option<u64>,
    filename: &str,
    caller: &Caller,
    domain: MediaDomain,
) -> Result<PullAudioBlobResult, PullAudioBlobError> {
    // 1. validate blake3 hash format (64 hex chars)
    if blake3.len() != 64 || !blake3.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(PullAudioBlobError::InvalidBlake3);
    }

    // 2. enforce max upload size from config before pulling
    let config = get_config();
    let max_upload_bytes = config
        .federation
        .as_ref()
        .map(|f| f.max_upload_size_mb as u64 * 1024 * 1024)
        .unwrap_or(500 * 1024 * 1024); // default 500MB

    if let Some(declared_size) = expected_size {
        if declared_size > max_upload_bytes {
            return Err(PullAudioBlobError::FileTooLarge {
                declared: declared_size,
                max: max_upload_bytes,
            });
        }
    }

    // pull the blob from the source peer via iroh-blobs verified streaming.
    // streams directly to disk via FsStore export — no full-file memory buffering.
    // timeout after 120 seconds to prevent indefinite hangs.
    tracing::info!(
        "pulling blob {} from peer {} for {} (full_node_id={})",
        &blake3[..16],
        &source_node_id[..16.min(source_node_id.len())],
        caller.username,
        source_node_id,
    );

    // determine output path before downloading so we can stream directly to it
    let output_dir = match domain {
        MediaDomain::Music => config
            .server
            .as_ref()
            .and_then(|s| s.fetch_music.as_ref())
            .and_then(|f| f.output_dir.as_ref())
            .map(PathBuf::from)
            .unwrap_or_else(|| config.data_dir.join("fetch")),
        MediaDomain::Video => config
            .server
            .as_ref()
            .and_then(|s| s.fetch_video.as_ref())
            .and_then(|f| f.output_dir.as_ref())
            .map(PathBuf::from)
            .unwrap_or_else(|| config.data_dir.join("fetch")),
    };

    let ext = detect_extension(
        &mime_guess::from_path(filename)
            .first()
            .map(|m| m.to_string())
            .unwrap_or_default(),
        filename,
    );
    let now = time::OffsetDateTime::now_utc();
    let year = now.year();
    let month = now.month() as u8;

    // use a temp filename based on blake3 hash (will rename after blob record creation)
    let temp_filename = format!("{}.{}", &blake3[..16], ext);
    let temp_path = output_dir.join(format!("{:04}/{:02}/{}", year, month, temp_filename));

    // ensure directory exists
    if let Some(parent) = temp_path.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            return Err(PullAudioBlobError::CreateDirFailed {
                path: parent.to_string_lossy().into_owned(),
                message: e.to_string(),
            });
        }
    }

    let fetch_future =
        p2p_client::fetch_blob_verified_to_file_with_ensure(source_node_id, blake3, &temp_path);
    let file_size = match tokio::time::timeout(Duration::from_secs(120), fetch_future).await {
        Ok(Ok(size)) => {
            tracing::info!(
                "exported {} bytes for blob {} from peer {} to {}",
                size,
                &blake3[..16],
                &source_node_id[..16.min(source_node_id.len())],
                temp_path.display(),
            );
            size
        }
        Ok(Err(e)) => {
            tracing::error!(
                "failed to fetch blob {} from peer {}: {}",
                &blake3[..16],
                &source_node_id[..16.min(source_node_id.len())],
                e,
            );
            if let GrimoireError::PeerUnauthorized { peer, blake3: b } = e {
                return Err(PullAudioBlobError::PeerUnauthorized { peer, blake3: b });
            }
            return Err(PullAudioBlobError::FetchFailed(e.to_string()));
        }
        Err(_) => {
            tracing::error!(
                "timeout fetching blob {} from peer {} (120s)",
                &blake3[..16],
                &source_node_id[..16.min(source_node_id.len())],
            );
            return Err(PullAudioBlobError::Timeout);
        }
    };

    // 4. validate size if provided
    if let Some(declared) = expected_size {
        if file_size != declared {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err(PullAudioBlobError::SizeMismatch {
                expected: declared,
                got: file_size,
            });
        }
    }

    // 5. compute sha256 by streaming from the file on disk (no full-file memory load)
    let hash = {
        use tokio::io::AsyncReadExt;
        let mut file = match tokio::fs::File::open(&temp_path).await {
            Ok(f) => f,
            Err(e) => {
                return Err(PullAudioBlobError::ReadFailed(e.to_string()));
            }
        };
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 64 * 1024]; // 64KB chunks
        loop {
            let n = match file.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => n,
                Err(e) => {
                    let _ = tokio::fs::remove_file(&temp_path).await;
                    return Err(PullAudioBlobError::ReadFailed(e.to_string()));
                }
            };
            hasher.update(&buf[..n]);
        }
        format!("{:x}", hasher.finalize())
    };
    tracing::debug!(
        "computed sha256 for blob {}: {}",
        &blake3[..16],
        &hash[..16]
    );

    // 6. verify against caller-supplied sha256 if provided
    if let Some(expected) = expected_sha256 {
        if expected != hash {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err(PullAudioBlobError::Sha256Mismatch {
                expected: expected.to_string(),
                got: hash,
            });
        }
    }

    // 7. detect mime type from filename and file header (read first 12 bytes)
    let header = {
        use tokio::io::AsyncReadExt;
        let mut f = match tokio::fs::File::open(&temp_path).await {
            Ok(f) => f,
            Err(e) => {
                let _ = tokio::fs::remove_file(&temp_path).await;
                return Err(PullAudioBlobError::ReadFailed(e.to_string()));
            }
        };
        let mut buf = [0u8; 12];
        let _ = f.read(&mut buf).await;
        buf
    };
    let mime_type = match domain {
        MediaDomain::Music => detect_audio_mime_type(filename, &header),
        MediaDomain::Video => detect_video_mime_type(filename, &header),
    };
    tracing::debug!(
        "detected mime type for blob {}: {}",
        &blake3[..16],
        &mime_type
    );
    let expected_prefix = match domain {
        MediaDomain::Music => "audio/",
        MediaDomain::Video => "video/",
    };
    if !mime_type.starts_with(expected_prefix) {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(PullAudioBlobError::WrongMediaType(domain));
    }

    // re-derive the extension from the verified mime type rather than trusting the
    // pre-download filename guess (which may be a caller-supplied placeholder, e.g. ".bin")
    let ext = detect_extension(&mime_type, filename);

    let size = file_size as i64;

    // 8. check for existing blob by sha256 before creating
    let existing = get_media_blob_by_sha256(&hash).await.is_ok();

    // create media blob entry (with deduplication via sha256 unique constraint)
    let blob = match create_media_blob(CreateMediaBlobRequest {
        sha256: hash.clone(),
        size: Some(size),
        mime: Some(mime_type.clone()),
        source_client_id: None,
        local_path: None, // will be set below after rename
        filename: Some(filename.to_string()),
        parent_blob_id: None,
        blob_type: Some(BlobType::Original),
        metadata: json!({
            "original_filename": filename,
            "upload_method": "blake3_pull",
            "source_node_id": source_node_id,
        }),
        created_by: Some(caller.user_id.clone()),
        data: None,
        width: None,
        height: None,
        blake3: Some(blake3.to_string()),
        delete_duplicate_local_path: false,
    })
    .await
    {
        Ok(b) => {
            tracing::info!("created media blob {} for blob {}", b.id, &blake3[..16]);
            b
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err(PullAudioBlobError::CreateBlobFailed(e));
        }
    };

    // 9. rename temp file to final path with blob id
    let rel_path = format!("{:04}/{:02}/{}.{}", year, month, blob.id, ext);
    let full_path = output_dir.join(&rel_path);

    if temp_path != full_path && tokio::fs::rename(&temp_path, &full_path).await.is_err() {
        // fall back to copy+delete if rename fails (cross-device)
        if let Err(e) = tokio::fs::copy(&temp_path, &full_path).await {
            return Err(PullAudioBlobError::MoveFailed(e.to_string()));
        }
        let _ = tokio::fs::remove_file(&temp_path).await;
    }

    tracing::info!("file at {}", full_path.display());

    // persist local_path on the media_blob row so future requests
    // (e.g. ensure_blob_by_blake3, blob data serving) can locate the file -
    // purges the just-renamed file instead if it's a duplicate of an
    // already-owned file elsewhere (see the function's doc comment).
    // skip when dedup'd to a pre-existing blob that already has a path set.
    let blob = if blob.local_path.as_deref() != Some(full_path.to_string_lossy().as_ref()) {
        match set_blob_local_path_or_purge_duplicate(
            &blob.id,
            &full_path.to_string_lossy(),
            Some(caller.user_id.clone()),
        )
        .await
        {
            Ok(updated) => updated,
            Err(e) => {
                tracing::warn!(
                    "pull_audio_blob: failed to persist local_path for blob {}: {} (file is on disk at {} but row will not point to it)",
                    blob.id,
                    e,
                    full_path.display(),
                );
                blob
            }
        }
    } else {
        blob
    };

    // report the path callers should actually use going forward: the
    // blob's own local_path once it's set/kept-pointing-at-existing above,
    // falling back to full_path only if that update somehow failed (in
    // which case full_path is still the best guess, since nothing was
    // purged in that branch).
    let result_path = blob
        .local_path
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or(full_path);

    Ok(PullAudioBlobResult {
        blob,
        local_path: result_path,
        mime: mime_type,
        sha256: hash,
        size,
        existing,
    })
}
