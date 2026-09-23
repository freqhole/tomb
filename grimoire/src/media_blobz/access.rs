use crate::blob_data::find_existing_thumbnail;
use crate::error::ErrorDetail;
use crate::media_blobz::get_media_blob;
use crate::media_blobz::get_media_blob_by_blake3;
use crate::media_blobz::get_media_blob_with_data;
use crate::response::GrimoireResponse;
use base64::Engine;
use serde_json::{json, Value as JsonValue};

/// standard "blob record exists but has no file path" response - expected
/// for db-stored blobs (e.g. thumbnails, waveforms); callers fall back to
/// `build_blob_data_response` on this error, so this isn't something an
/// operator needs to act on.
fn no_local_path_response(blob_id: &str) -> GrimoireResponse<JsonValue> {
    tracing::debug!(
        blob_id = %blob_id,
        "blob has no local_path — db record exists but file path is null"
    );
    GrimoireResponse::failure(
        "blob has no local path",
        vec![ErrorDetail::new(
            "no_local_path",
            "blob has no local path",
            "this blob is stored in database, not filesystem",
        )],
    )
}

/// standard "the db's local_path points at a file that's no longer there"
/// response - db/disk drift (moved, deleted, external storage unmounted).
/// distinct from `no_local_path` (which means "never had a file path at
/// all") so callers can tell "re-fetch this from a remote" apart from
/// "this is a db-stored blob, try the data endpoint instead". mirrors the
/// `blob_local_file_missing` error_type `EnsureBlobOutcome::LocalFileMissing`
/// already uses on the p2p-serving side (`blobz::blake3::ensure_blob_by_blake3`).
fn local_file_missing_response(blob_id: &str, path: &str) -> GrimoireResponse<JsonValue> {
    tracing::warn!(
        blob_id = %blob_id,
        path = %path,
        "blob's local_path no longer exists on disk — db/disk drift"
    );
    GrimoireResponse::failure(
        "local file missing",
        vec![ErrorDetail::new(
            "blob_local_file_missing",
            "local file missing",
            format!("media_blob row exists but the file at {path} is gone"),
        )],
    )
}

/// build the standard blob-path response used by blob route handlers.
///
/// `id` is a `media_blobz.id` short pk (7-16 hex chars, generated
/// per-instance by `lower(hex(randomblob(8)))`). it is NOT a
/// sha256 or blake3 content hash. callers that only have a blake3
/// should use `build_blob_path_response_by_blake3` instead.
pub async fn build_blob_path_response(id: &str) -> GrimoireResponse<JsonValue> {
    match get_media_blob(id).await {
        Ok(blob) => {
            if let Some(path) = blob.local_path {
                if !tokio::fs::try_exists(&path).await.unwrap_or(false) {
                    return local_file_missing_response(&blob.id, &path);
                }
                GrimoireResponse::success(
                    "blob path",
                    json!({
                        "id": blob.id,
                        "path": path,
                        "mime": blob.mime,
                    }),
                )
            } else {
                no_local_path_response(&blob.id)
            }
        }
        Err(e) => GrimoireResponse::failure("blob not found", vec![ErrorDetail::from(e)]),
    }
}

/// same as `build_blob_path_response`, but resolved by content hash (blake3)
/// instead of `media_blobz.id`. used by callers that only know a song's
/// stable blake3 (e.g. a play-queue snapshot) and need to find its CURRENT
/// local blob record - which gets a fresh, different `media_blobz.id` each
/// time the song is synced/re-synced, so a caller can't cache that id
/// across a sync the way it can cache the blake3. every song that's ever
/// been synced locally via iroh-blobs is guaranteed to have a blake3 (sync
/// hard-requires it), so this is safe to try first for any queue item.
pub async fn build_blob_path_response_by_blake3(blake3: &str) -> GrimoireResponse<JsonValue> {
    match get_media_blob_by_blake3(blake3).await {
        Ok(blob) => {
            if let Some(path) = blob.local_path {
                if !tokio::fs::try_exists(&path).await.unwrap_or(false) {
                    return local_file_missing_response(&blob.id, &path);
                }
                GrimoireResponse::success(
                    "blob path",
                    json!({
                        "id": blob.id,
                        "path": path,
                        "mime": blob.mime,
                    }),
                )
            } else {
                no_local_path_response(&blob.id)
            }
        }
        Err(e) => GrimoireResponse::failure("blob not found", vec![ErrorDetail::from(e)]),
    }
}

/// build the standard blob-data response used by blob route handlers.
pub async fn build_blob_data_response(id: &str) -> GrimoireResponse<JsonValue> {
    let (blob, maybe_data) = match get_media_blob_with_data(id).await {
        Ok(v) => v,
        Err(e) => return GrimoireResponse::failure("blob not found", vec![ErrorDetail::from(e)]),
    };

    let data = match maybe_data {
        Some(d) => d,
        None => match blob.local_path.as_deref() {
            Some(path) => match tokio::fs::read(path).await {
                Ok(bytes) => bytes,
                Err(e) => {
                    return GrimoireResponse::failure(
                        "failed to read blob file",
                        vec![ErrorDetail::new(
                            "blob_file_read_failed",
                            "failed to read blob file",
                            format!("could not read file at {path}: {e}"),
                        )],
                    )
                }
            },
            None => {
                return GrimoireResponse::failure(
                    "blob data not found",
                    vec![ErrorDetail::new(
                        "blob_data_not_found",
                        "blob data not found",
                        "no binary data stored for this blob",
                    )],
                )
            }
        },
    };

    let base64_data = base64::engine::general_purpose::STANDARD.encode(&data);

    GrimoireResponse::success(
        "blob data",
        json!({
            "id": blob.id,
            "mime": blob.mime,
            "data": base64_data,
        }),
    )
}

/// build the standard blob-thumbnail response used by blob route handlers.
pub async fn build_blob_thumbnail_response(
    id: &str,
    target_size: u32,
) -> GrimoireResponse<JsonValue> {
    match find_existing_thumbnail(id, target_size).await {
        Some(thumb) => {
            if let Some(path) = thumb.local_path {
                GrimoireResponse::success(
                    "thumbnail path",
                    json!({
                        "id": thumb.id,
                        "path": path,
                        "mime": thumb.mime,
                        "width": thumb.width,
                        "height": thumb.height,
                    }),
                )
            } else {
                GrimoireResponse::failure(
                    "thumbnail has no local path",
                    vec![ErrorDetail::new(
                        "no_local_path",
                        "thumbnail has no local path",
                        "thumbnail stored in database",
                    )],
                )
            }
        }
        None => build_blob_path_response(id).await,
    }
}

/// build the standard blob descriptor response used by blob route handlers.
pub async fn build_blob_response(id: &str) -> GrimoireResponse<JsonValue> {
    match get_media_blob(id).await {
        Ok(blob) => {
            if let Some(path) = &blob.local_path {
                GrimoireResponse::success(
                    "blob",
                    json!({
                        "id": blob.id,
                        "path": path,
                        "mime": blob.mime,
                        "size": blob.size,
                        "filename": blob.filename,
                    }),
                )
            } else {
                GrimoireResponse::success(
                    "blob (no local path)",
                    json!({
                        "id": blob.id,
                        "mime": blob.mime,
                        "size": blob.size,
                        "filename": blob.filename,
                        "note": "blob stored in database, use HTTP for streaming",
                    }),
                )
            }
        }
        Err(e) => GrimoireResponse::failure("blob not found", vec![ErrorDetail::from(e)]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // these tests spin up a fresh tempdir with their own grimoire.db (via
    // the same real db pool singleton `get_media_blob`/`get_media_blob_by_blake3`
    // themselves use), so each is marked #[ignore] per this crate's convention
    // for tests touching that singleton - run ONE at a time, each its own
    // process:
    // cargo test -p grimoire --lib -- --ignored --exact media_blobz::access::tests::test_build_blob_path_response_succeeds_when_file_exists
    // cargo test -p grimoire --lib -- --ignored --exact media_blobz::access::tests::test_build_blob_path_response_by_blake3_reports_local_file_missing
    async fn init_test_env(data_dir: &std::path::Path) {
        let config_toml = format!(
            r#"data_dir = "{data_dir}"

[database]
filename = "grimoire.db"

[media]
max_fs_file_size = 104857600
supported_audio_formats = ["mp3", "flac"]

[musicbrainz]
enabled = false

[logging]
level = "warn"
"#,
            data_dir = data_dir.display()
        );
        let config_path = data_dir.join("freqhole-config.toml");
        std::fs::write(&config_path, config_toml).expect("write config");
        std::fs::write(data_dir.join("grimoire.db"), b"").expect("touch grimoire.db");

        crate::config::init_config(Some(config_path)).expect("init config");
        crate::database::run_migrations()
            .await
            .expect("run migrations");
    }

    async fn insert_media_blob(id: &str, blake3: &str, local_path: Option<&str>) {
        let pool = crate::database::connect().await.expect("connect");
        sqlx::query(
            "INSERT INTO media_blobz (id, sha256, size, mime, blob_type, blake3, local_path)
             VALUES (?, ?, 0, 'audio/mpeg', 'original', ?, ?)",
        )
        .bind(id)
        .bind("a".repeat(64))
        .bind(blake3)
        .bind(local_path)
        .execute(&pool)
        .await
        .expect("insert media_blobz row");
    }

    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singleton"]
    async fn test_build_blob_path_response_succeeds_when_file_exists() {
        let tmp = tempfile::tempdir().expect("tempdir");
        init_test_env(tmp.path()).await;

        let file_path = tmp.path().join("real-file.mp3");
        std::fs::write(&file_path, b"fake audio bytes").expect("write real file");

        insert_media_blob(
            "blob-exists",
            "blake3-exists",
            Some(&file_path.display().to_string()),
        )
        .await;

        let resp = build_blob_path_response("blob-exists").await;
        assert!(resp.is_success(), "expected success, got: {resp:?}");
        let data = resp.data.expect("data");
        assert_eq!(data["path"], file_path.display().to_string());
    }

    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singleton"]
    async fn test_build_blob_path_response_by_blake3_reports_local_file_missing() {
        let tmp = tempfile::tempdir().expect("tempdir");
        init_test_env(tmp.path()).await;

        // local_path is set in the db, but nothing was ever written there -
        // simulates a file moved/deleted out from under the db row.
        let gone_path = tmp.path().join("gone.mp3");
        insert_media_blob(
            "blob-gone",
            "blake3-gone",
            Some(&gone_path.display().to_string()),
        )
        .await;

        let resp = build_blob_path_response_by_blake3("blake3-gone").await;
        assert!(!resp.is_success(), "expected failure, got: {resp:?}");
        assert_eq!(resp.errors[0].error_type, "blob_local_file_missing");
    }
}
