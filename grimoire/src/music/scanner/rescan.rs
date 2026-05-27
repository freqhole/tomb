//! rescan-update path for files already known to grimoire
//!
//! when the directory scanner finds an audio file at a `local_path` that
//! already has a `media_blobz` row, it routes the ProcessFile job through
//! this module instead of the normal new-import flow. the goal is to keep
//! the existing song id (and everything that hangs off it: playlist
//! memberships, favorites, ratings, listening sessions, edited tags, etc.)
//! while still picking up changes to the underlying file's technical
//! properties.
//!
//! conservative update policy (no user-edit tracking exists in the schema):
//!   - blob row: file_modified_at / file_size in metadata json are always
//!     refreshed. sha256 / blake3 are only refreshed when no other blob row
//!     already owns the new sha256 (avoids UNIQUE conflicts).
//!   - song row: `duration` (technical, safe to overwrite) and the
//!     file/tags blocks inside `metadata` json are refreshed. user-visible
//!     fields like title, track_artist, lyrics, bpm, and the
//!     album/artist/playlist relationships are left untouched.

use crate::blob_data::stream_sha256_hash;
use crate::blobz::compute_blake3_hash;
use crate::database;
use crate::jobs::JobError;
use lofty::{AudioFile, Probe};
use serde_json::Value;
use std::path::Path;
use tracing::{debug, info, warn};

/// outcome of a rescan-update pass on a previously-imported file
#[derive(Debug, Clone)]
pub struct RescanUpdateResult {
    pub blob_id: String,
    pub song_id: Option<String>,
    pub sha256_changed: bool,
    pub song_updated: bool,
}

/// update an existing media_blobz row (and any song row hanging off it)
/// from a freshly-rescanned file on disk. preserves the blob id and song
/// id so referenced records (playlists, favorites, ratings, sessions)
/// stay intact.
pub async fn update_existing_from_rescan(
    existing_blob_id: &str,
    file_path: &Path,
    file_size: i64,
    file_modified_at: i64,
) -> Result<RescanUpdateResult, JobError> {
    let pool = database::connect()
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("failed to connect to database: {}", e),
        })?;

    let file_path_str = file_path.to_string_lossy().to_string();

    // load the existing blob row (sha256 + current metadata json)
    let existing = sqlx::query!(
        r#"SELECT sha256 as "sha256!", metadata FROM media_blobz WHERE id = ? AND deleted_at IS NULL"#,
        existing_blob_id
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| JobError::ProcessingFailed {
        reason: format!("failed to load existing blob row: {}", e),
    })?;

    let existing = match existing {
        Some(row) => row,
        None => {
            // record vanished between scan and processing; fall through to
            // caller which will treat this as a fresh import
            return Err(JobError::ProcessingFailed {
                reason: format!("existing blob {} not found during rescan update", existing_blob_id),
            });
        }
    };

    // hash the current file contents
    let new_sha256 = stream_sha256_hash(&file_path_str).await.map_err(|e| {
        JobError::ProcessingFailed {
            reason: format!("failed to hash file during rescan: {}", e),
        }
    })?;
    let sha256_changed = new_sha256 != existing.sha256;

    let new_blake3 = if sha256_changed {
        compute_blake3_hash(file_path).await.ok()
    } else {
        None
    };

    // merge new file_size / file_modified_at into existing metadata json
    let mut metadata_json: Value = existing
        .metadata
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_else(|| Value::Object(serde_json::Map::new()));

    if let Value::Object(ref mut map) = metadata_json {
        map.insert("file_size".to_string(), Value::from(file_size));
        map.insert(
            "file_modified_at".to_string(),
            Value::from(file_modified_at),
        );
    }

    // decide whether we can safely bump the blob's sha256/blake3 too
    let mut sha256_bumped = false;
    if sha256_changed {
        let conflict = sqlx::query!(
            r#"SELECT id FROM media_blobz WHERE sha256 = ? AND id != ? LIMIT 1"#,
            new_sha256,
            existing_blob_id
        )
        .fetch_optional(&pool)
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("failed to check sha256 conflict: {}", e),
        })?;

        if conflict.is_some() {
            warn!(
                "rescan: file content for blob {} changed but another blob already owns the new sha256 - leaving stored sha256 unchanged",
                existing_blob_id
            );
        } else {
            sha256_bumped = true;
        }
    }

    let metadata_str = serde_json::to_string(&metadata_json).unwrap_or_else(|_| "{}".to_string());

    if sha256_bumped {
        sqlx::query!(
            r#"UPDATE media_blobz
               SET sha256 = ?, blake3 = COALESCE(?, blake3), size = ?, metadata = ?
               WHERE id = ?"#,
            new_sha256,
            new_blake3,
            file_size,
            metadata_str,
            existing_blob_id,
        )
        .execute(&pool)
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("failed to update existing blob: {}", e),
        })?;
    } else {
        sqlx::query!(
            r#"UPDATE media_blobz SET size = ?, metadata = ? WHERE id = ?"#,
            file_size,
            metadata_str,
            existing_blob_id,
        )
        .execute(&pool)
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("failed to update existing blob metadata: {}", e),
        })?;
    }

    debug!(
        "rescan: updated blob {} (sha256_changed={}, sha256_bumped={})",
        existing_blob_id, sha256_changed, sha256_bumped
    );

    // look up the song row hanging off this blob (if any) and refresh the
    // safe-to-overwrite technical fields. we deliberately do NOT touch
    // title, track_artist, lyrics, bpm, or any album/artist relationships
    // since the schema has no user-edit tracking and we want to preserve
    // anything the user may have curated.
    let song_row = sqlx::query!(
        r#"SELECT id as "id!" FROM songz WHERE media_blob_id = ? AND deleted_at IS NULL LIMIT 1"#,
        existing_blob_id
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| JobError::ProcessingFailed {
        reason: format!("failed to load existing song row: {}", e),
    })?;

    let mut song_id_out: Option<String> = None;
    let mut song_updated = false;

    if let Some(song) = song_row {
        song_id_out = Some(song.id.clone());

        // best-effort re-extract duration from tags. failure here is logged
        // and ignored so a corrupt re-encoded file doesn't blow up the rescan.
        // we deliberately only refresh `duration` (a purely technical
        // property the user can't meaningfully edit). title, track_artist,
        // lyrics, bpm, album/artist relationships are all preserved.
        let new_duration = match Probe::open(file_path).and_then(|p| p.read()) {
            Ok(tagged) => Some(tagged.properties().duration().as_millis() as i64),
            Err(e) => {
                warn!(
                    "rescan: could not re-read tags for {:?}: {} - skipping song duration refresh",
                    file_path, e
                );
                None
            }
        };

        if let Some(dur) = new_duration {
            sqlx::query!(
                r#"UPDATE songz SET duration = ? WHERE id = ?"#,
                dur,
                song.id,
            )
            .execute(&pool)
            .await
            .map_err(|e| JobError::ProcessingFailed {
                reason: format!("failed to update song row during rescan: {}", e),
            })?;
            song_updated = true;
        }
        info!(
            "rescan: updated song {} (blob={}, duration_refreshed={})",
            song.id, existing_blob_id, song_updated
        );
    } else {
        debug!(
            "rescan: no song row found for existing blob {} - blob-only update",
            existing_blob_id
        );
    }

    Ok(RescanUpdateResult {
        blob_id: existing_blob_id.to_string(),
        song_id: song_id_out,
        sha256_changed,
        song_updated,
    })
}
