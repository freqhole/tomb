//! ephemeral blob fetch + cleanup tauri commands.
//!
//! when the user has `sync_queue_to_local` disabled, the rodio backend
//! still needs the audio file on disk (rodio decodes from a fs path;
//! it can't stream http urls). these commands provide a scoped
//! "fetch the audio, play it, throw it away" lifecycle without ever
//! touching the regular sqlite-backed media library.
//!
//! files land in `<fetch_dir>/_ephemeral/<blake3>.<ext>` — the
//! `_ephemeral/` prefix is the safety boundary: anything under it is
//! freely deletable; anything outside is hands-off.
//!
//! safety rules for deletion (defense in depth):
//!   1. blake3 must be exactly 64 lowercase hex chars.
//!   2. ext must match `^[a-z0-9]{1,5}$` (no dots, no slashes).
//!   3. canonicalized target path's parent must equal the
//!      canonicalized ephemeral dir (no `..` escape).
//!   4. file must not be a symlink (no follow-the-link tricks).
//!
//! no sqlite rows are created or modified by any command in this
//! module. that's intentional: it mirrors the existing OFF-path
//! behavior of `syncSongToLocal` (which also short-circuits when
//! sync is off and never writes to the db).

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

use grimoire::config::get_config;
use serde::Serialize;

/// info about one ephemeral file on disk. returned by `list_ephemeral_blobs`
/// and `reconcile_ephemeral_dir` so the ts side can reconstruct the
/// `<blake3>.<ext>` filename without re-parsing.
#[derive(Debug, Clone, Serialize)]
pub struct EphemeralFileInfo {
    pub blake3: String,
    pub ext: String,
}

/// summary of a reconcile pass.
#[derive(Debug, Clone, Serialize)]
pub struct EphemeralReconcileResult {
    /// files still on disk after the pass (callers seed their ui from this).
    pub kept: Vec<EphemeralFileInfo>,
    /// count of files deleted during the pass.
    pub deleted: u64,
}

/// hard-coded ephemeral subdirectory name. lives under the configured
/// `fetch_music.output_dir` (or `<data_dir>/fetch` if unset). kept
/// distinct from the scanner's `<year>/<month>/` tree so a `rm -rf`
/// of this single subdir can never touch a user-managed file.
const EPHEMERAL_SUBDIR: &str = "_ephemeral";

/// resolve the absolute path of `<fetch_dir>/_ephemeral/`. does not
/// create the directory; callers that need the dir to exist call
/// `ensure_ephemeral_dir`.
fn ephemeral_dir() -> PathBuf {
    let config = get_config();
    let fetch_dir = config
        .server
        .as_ref()
        .and_then(|s| s.fetch_music.as_ref())
        .and_then(|f| f.output_dir.as_ref())
        .map(PathBuf::from)
        .unwrap_or_else(|| config.data_dir.join("fetch"));
    fetch_dir.join(EPHEMERAL_SUBDIR)
}

/// create `<fetch_dir>/_ephemeral/` if missing. returns the path.
async fn ensure_ephemeral_dir() -> Result<PathBuf, String> {
    let dir = ephemeral_dir();
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("create_dir failed: {e}"))?;
    Ok(dir)
}

/// validate blake3: 64 lowercase hex chars exactly.
fn validate_blake3(blake3: &str) -> Result<(), String> {
    if blake3.len() != 64
        || !blake3
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    {
        return Err(format!("invalid blake3 hash: {blake3}"));
    }
    Ok(())
}

/// validate ext: 1-5 chars, lowercase ascii alphanumeric only.
fn validate_ext(ext: &str) -> Result<(), String> {
    if ext.is_empty()
        || ext.len() > 5
        || !ext
            .chars()
            .all(|c| c.is_ascii_alphanumeric() && !c.is_ascii_uppercase())
    {
        return Err(format!("invalid ext: {ext}"));
    }
    Ok(())
}

/// fetch a remote audio blob into the ephemeral dir via iroh-blobs
/// verified streaming. returns the absolute path.
///
/// idempotent: if the file already exists, returns its path without
/// re-fetching (cheap dedup across replays in a session).
///
/// no DB rows are touched. the resulting file is invisible to the
/// scanner / library views — by design.
#[tauri::command]
pub async fn fetch_ephemeral_blob(
    peer_addr: String,
    blake3: String,
    ext: String,
) -> Result<String, String> {
    validate_blake3(&blake3)?;
    validate_ext(&ext)?;

    let dir = ensure_ephemeral_dir().await?;
    let target = dir.join(format!("{blake3}.{ext}"));

    // idempotency: if the file is already there, hand back the path.
    // we don't re-verify the hash here because (a) the file lives in
    // a directory only this command writes to, and (b) the next
    // playback will fail loudly if the file is corrupt.
    if tokio::fs::metadata(&target).await.is_ok() {
        tracing::info!(
            blake3 = %&blake3[..16],
            "ephemeral blob already present, reusing"
        );
        return Ok(target.display().to_string());
    }

    tracing::info!(
        peer = %peer_addr,
        blake3 = %&blake3[..16],
        target = %target.display(),
        "fetching ephemeral blob"
    );

    let fetch_future = grimoire::federation::p2p_client::fetch_blob_verified_to_file_with_ensure(
        &peer_addr, &blake3, &target,
    );
    match tokio::time::timeout(Duration::from_secs(120), fetch_future).await {
        Ok(Ok(size)) => {
            tracing::info!(
                blake3 = %&blake3[..16],
                bytes = size,
                "ephemeral blob fetched"
            );
            Ok(target.display().to_string())
        }
        Ok(Err(e)) => {
            // best-effort cleanup of any partial file written before failure.
            let _ = tokio::fs::remove_file(&target).await;
            Err(format!("fetch failed: {e}"))
        }
        Err(_) => {
            let _ = tokio::fs::remove_file(&target).await;
            Err("fetch timeout (120s)".to_string())
        }
    }
}

/// safely delete one ephemeral blob.
///
/// missing file is a non-error (returns Ok). all the safety checks
/// described at the top of this module are enforced before unlink.
#[tauri::command]
pub async fn delete_ephemeral_blob(blake3: String, ext: String) -> Result<(), String> {
    validate_blake3(&blake3)?;
    validate_ext(&ext)?;

    let dir = ephemeral_dir();
    let target = dir.join(format!("{blake3}.{ext}"));
    safe_delete_in_ephemeral_dir(&dir, &target).await
}

/// nuke everything inside `<fetch_dir>/_ephemeral/`. called on
/// charnel startup (catches anything that escaped previous cleanup,
/// e.g. crash) and on player dispose / app shutdown.
///
/// only deletes regular files whose name matches the
/// `<blake3>.<ext>` pattern. directories, symlinks, and oddly-named
/// files are skipped (and logged) to avoid surprising behavior if
/// someone has poked around in the dir manually.
#[tauri::command]
pub async fn purge_ephemeral_dir() -> Result<u64, String> {
    let dir = ephemeral_dir();
    if !tokio::fs::metadata(&dir).await.is_ok() {
        return Ok(0);
    }

    let mut entries = match tokio::fs::read_dir(&dir).await {
        Ok(rd) => rd,
        Err(e) => return Err(format!("read_dir failed: {e}")),
    };

    let mut deleted: u64 = 0;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        let name = match entry.file_name().into_string() {
            Ok(n) => n,
            Err(_) => {
                tracing::warn!(path = %path.display(), "ephemeral purge: skipping non-utf8 filename");
                continue;
            }
        };

        // parse <blake3>.<ext> and reject anything else.
        let (blake3, ext) = match name.rsplit_once('.') {
            Some((b, e)) => (b, e),
            None => {
                tracing::warn!(name = %name, "ephemeral purge: skipping unrecognized filename (no ext)");
                continue;
            }
        };
        if validate_blake3(blake3).is_err() || validate_ext(ext).is_err() {
            tracing::warn!(name = %name, "ephemeral purge: skipping unrecognized filename (bad pattern)");
            continue;
        }

        if let Err(e) = safe_delete_in_ephemeral_dir(&dir, &path).await {
            tracing::warn!(path = %path.display(), error = %e, "ephemeral purge: delete failed");
            continue;
        }
        deleted += 1;
    }

    tracing::info!(deleted, "ephemeral purge complete");
    Ok(deleted)
}

/// list every well-formed `<blake3>.<ext>` file currently in
/// `<fetch_dir>/_ephemeral/`. used by the ts side on startup to seed
/// the "available offline" ui without re-fetching anything.
///
/// returns an empty list if the dir doesn't exist (first run).
/// silently skips files whose name doesn't parse cleanly.
#[tauri::command]
pub async fn list_ephemeral_blobs() -> Result<Vec<EphemeralFileInfo>, String> {
    let dir = ephemeral_dir();
    if tokio::fs::metadata(&dir).await.is_err() {
        return Ok(Vec::new());
    }

    let mut entries = match tokio::fs::read_dir(&dir).await {
        Ok(rd) => rd,
        Err(e) => return Err(format!("read_dir failed: {e}")),
    };

    let mut out = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = match entry.file_name().into_string() {
            Ok(n) => n,
            Err(_) => continue,
        };
        let Some((blake3, ext)) = name.rsplit_once('.') else {
            continue;
        };
        if validate_blake3(blake3).is_err() || validate_ext(ext).is_err() {
            continue;
        }
        // only count regular files (skip dirs / symlinks).
        let meta = match entry.metadata().await {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !meta.file_type().is_file() {
            continue;
        }
        out.push(EphemeralFileInfo {
            blake3: blake3.to_string(),
            ext: ext.to_string(),
        });
    }
    Ok(out)
}

/// reconcile the ephemeral dir against a "keep set" of blake3 hashes:
/// delete any well-formed file whose blake3 is NOT in `keep_blake3s`,
/// and return the survivors plus a deleted count.
///
/// called by the ts side on startup (keep = current queue) and on
/// queue mutations (keep = new queue) so files for songs the user
/// removed from the queue get cleaned up promptly without nuking
/// files for songs they're still planning to play.
#[tauri::command]
pub async fn reconcile_ephemeral_dir(
    keep_blake3s: Vec<String>,
) -> Result<EphemeralReconcileResult, String> {
    let dir = ephemeral_dir();
    if tokio::fs::metadata(&dir).await.is_err() {
        return Ok(EphemeralReconcileResult {
            kept: Vec::new(),
            deleted: 0,
        });
    }

    // validate the keep list once up front. an invalid hash from the
    // caller is a programming error, not a security risk (we'd just
    // never match anything), but it's worth catching loudly.
    for k in &keep_blake3s {
        validate_blake3(k)?;
    }
    let keep: HashSet<&str> = keep_blake3s.iter().map(String::as_str).collect();

    let mut entries = match tokio::fs::read_dir(&dir).await {
        Ok(rd) => rd,
        Err(e) => return Err(format!("read_dir failed: {e}")),
    };

    let mut kept = Vec::new();
    let mut deleted: u64 = 0;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        let name = match entry.file_name().into_string() {
            Ok(n) => n,
            Err(_) => {
                tracing::warn!(path = %path.display(), "ephemeral reconcile: skipping non-utf8 filename");
                continue;
            }
        };
        let Some((blake3, ext)) = name.rsplit_once('.') else {
            tracing::warn!(name = %name, "ephemeral reconcile: skipping unrecognized filename (no ext)");
            continue;
        };
        if validate_blake3(blake3).is_err() || validate_ext(ext).is_err() {
            tracing::warn!(name = %name, "ephemeral reconcile: skipping unrecognized filename (bad pattern)");
            continue;
        }

        if keep.contains(blake3) {
            kept.push(EphemeralFileInfo {
                blake3: blake3.to_string(),
                ext: ext.to_string(),
            });
            continue;
        }

        if let Err(e) = safe_delete_in_ephemeral_dir(&dir, &path).await {
            tracing::warn!(path = %path.display(), error = %e, "ephemeral reconcile: delete failed");
            continue;
        }
        deleted += 1;
    }

    tracing::info!(kept = kept.len(), deleted, "ephemeral reconcile complete");
    Ok(EphemeralReconcileResult { kept, deleted })
}

/// the actual safety-checked unlink. all four safety rules are
/// enforced here so callers don't need to remember them.
async fn safe_delete_in_ephemeral_dir(expected_parent: &Path, target: &Path) -> Result<(), String> {
    // missing file = success (idempotent cleanup).
    let symlink_meta = match tokio::fs::symlink_metadata(target).await {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("stat failed: {e}")),
    };

    // rule 4: never follow symlinks. bail loudly.
    if symlink_meta.file_type().is_symlink() {
        return Err(format!(
            "refusing to delete symlink at {}",
            target.display()
        ));
    }

    if !symlink_meta.file_type().is_file() {
        return Err(format!(
            "refusing to delete non-regular file at {}",
            target.display()
        ));
    }

    // rule 3: canonicalize and confirm the parent matches the
    // ephemeral dir exactly. defends against `..` segments,
    // case-insensitive fs trickery, and bind mounts.
    let canonical_target = tokio::fs::canonicalize(target)
        .await
        .map_err(|e| format!("canonicalize target failed: {e}"))?;
    let canonical_parent = tokio::fs::canonicalize(expected_parent)
        .await
        .map_err(|e| format!("canonicalize parent failed: {e}"))?;

    let target_parent = canonical_target.parent().ok_or_else(|| {
        format!(
            "canonical target has no parent: {}",
            canonical_target.display()
        )
    })?;
    if target_parent != canonical_parent {
        return Err(format!(
            "refusing to delete {} (parent {} != expected {})",
            canonical_target.display(),
            target_parent.display(),
            canonical_parent.display(),
        ));
    }

    // rule 1+2 (re-validate from the canonical filename, in case the
    // path traversed any symlinked dirs that resolved to a different
    // basename).
    let name = canonical_target
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "canonical target has no filename".to_string())?;
    let (blake3, ext) = name
        .rsplit_once('.')
        .ok_or_else(|| format!("canonical filename has no ext: {name}"))?;
    validate_blake3(blake3)?;
    validate_ext(ext)?;

    tokio::fs::remove_file(&canonical_target)
        .await
        .map_err(|e| format!("remove_file failed: {e}"))?;
    tracing::debug!(path = %canonical_target.display(), "ephemeral blob deleted");
    Ok(())
}
