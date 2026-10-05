//! generic file-move / extension-resolution helpers shared by every
//! "relocate a library file on disk under a new path" feature -
//! removable-storage sync and `maintenance::reorganize_library`. lives in
//! grimoire (not charnel's tauri-only src-tauri) so both can share it.

use std::path::{Path, PathBuf};

use crate::media_blobz::MediaBlob;

/// prefer the source blob's real filename extension; fall back to the
/// shared mime<->extension table (`offal::upload::mime::detect_extension`,
/// covering both audio and video) then to mp3 as a last resort. `.bin` is
/// never trusted as a real extension - local-library fetches sometimes
/// stash content under a `.bin` name (a known, separately-tracked
/// lingering bug - see docs/removable-storage-sync-plan.md known bugs),
/// so that case is treated the same as "no usable extension" and the
/// mime-based guess (already saved in the db from the original
/// fetch/scan) is used instead.
pub fn resolve_extension(blob: &MediaBlob) -> String {
    if let Some(filename) = &blob.filename {
        if let Some(ext) = Path::new(filename).extension().and_then(|e| e.to_str()) {
            let ext = ext.to_lowercase();
            if !ext.is_empty() && ext != "bin" {
                return ext;
            }
        }
    }
    // empty filename arg skips detect_extension's own filename-based
    // branch, so this only ever consults the mime table.
    match blob
        .mime
        .as_deref()
        .map(|mime| crate::offal::upload::mime::detect_extension(mime, ""))
    {
        Some(ext) if ext != "bin" => ext,
        _ => "mp3".to_string(),
    }
}

/// strips a leading `.` and lowercases a user-configured extension;
/// falls back to "mp3" if empty.
pub fn normalize_extension(raw: &str) -> String {
    let trimmed = raw.trim().trim_start_matches('.').to_lowercase();
    if trimmed.is_empty() {
        "mp3".to_string()
    } else {
        trimmed
    }
}

/// maps a target extension to the ffmpeg muxer name to pass via `-f` -
/// most extensions are already valid muxer names, but a few need
/// translating (e.g. `.m4a` is muxed as `ipod`, not `m4a`).
pub fn ffmpeg_format_for_extension(ext: &str) -> &str {
    match ext {
        "m4a" => "ipod",
        "aac" => "adts",
        other => other,
    }
}

/// rename when possible (same volume - cheap, atomic); fall back to
/// copy+delete only if the rename fails (e.g. a genuine cross-filesystem
/// move). callers are responsible for making sure `to` doesn't already
/// hold a *different* file's content before calling this - a bare
/// `rename`/`copy` silently overwrites an existing destination on every
/// platform this runs on.
pub fn move_file(from: &Path, to: &Path) -> Result<(), String> {
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    std::fs::copy(from, to).map_err(|e| format!("failed to move file: {e}"))?;
    std::fs::remove_file(from).map_err(|e| format!("failed to remove old file after move: {e}"))?;
    Ok(())
}

/// best-effort cleanup: remove now-empty directories a moved file left
/// behind, stopping at (and never removing) `stop_at`.
pub fn prune_empty_ancestors(mut dir: PathBuf, stop_at: &Path) {
    while dir != *stop_at && dir.starts_with(stop_at) {
        match std::fs::read_dir(&dir) {
            Ok(mut entries) => {
                if entries.next().is_some() {
                    break;
                }
            }
            Err(_) => break,
        }
        if std::fs::remove_dir(&dir).is_err() {
            break;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
    }
}

/// a collision-free-ish temp file name (pid + nanosecond timestamp) for
/// staging in-memory bytes to disk before handing them to an external
/// tool (e.g. ffmpeg) that needs a real file path.
pub fn temp_file_name(ext: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("freqhole-fileops-{}-{nanos}.{ext}", std::process::id())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media_blobz::BlobType;

    fn blob(filename: Option<&str>, mime: Option<&str>) -> MediaBlob {
        MediaBlob {
            id: "test".to_string(),
            size: None,
            mime: mime.map(str::to_string),
            source_client_id: None,
            local_path: None,
            filename: filename.map(str::to_string),
            parent_blob_id: None,
            blob_type: BlobType::Original,
            metadata: serde_json::Value::Null,
            created_at: 0,
            updated_at: 0,
            deleted_at: None,
            deleted_by: None,
            created_by: None,
            updated_by: None,
            width: None,
            height: None,
            blake3: None,
        }
    }

    #[test]
    fn resolve_extension_trusts_a_real_filename_extension() {
        assert_eq!(resolve_extension(&blob(Some("song.flac"), None)), "flac");
    }

    #[test]
    fn resolve_extension_never_trusts_a_bin_filename_extension() {
        assert_eq!(
            resolve_extension(&blob(Some("video.bin"), Some("video/mp4"))),
            "mp4"
        );
    }

    #[test]
    fn resolve_extension_covers_video_mime_types() {
        assert_eq!(resolve_extension(&blob(None, Some("video/mp4"))), "mp4");
        assert_eq!(
            resolve_extension(&blob(None, Some("video/x-matroska"))),
            "mkv"
        );
    }

    #[test]
    fn resolve_extension_falls_back_to_mp3_when_unresolvable() {
        assert_eq!(resolve_extension(&blob(None, None)), "mp3");
        assert_eq!(
            resolve_extension(&blob(None, Some("application/octet-stream"))),
            "mp3"
        );
    }
}
