//! media resolution: fetch a `MediaRef` to a local, playable file
//! path.

use crate::ratcore::app::{MediaKind, MediaRef};

fn player_cache_dir() -> std::path::PathBuf {
    grimoire::config::get_config()
        .data_dir
        .join("rathole")
        .join("player_cache")
}

fn guess_extension(media: &MediaRef) -> &'static str {
    match media.mime_type.as_deref() {
        Some("audio/flac") => "flac",
        Some("audio/wav") | Some("audio/x-wav") => "wav",
        Some("audio/ogg") => "ogg",
        Some("audio/opus") => "opus",
        Some("audio/mp4") | Some("audio/m4a") => "m4a",
        Some("video/mp4") => "mp4",
        Some("video/webm") => "webm",
        Some("video/x-matroska") => "mkv",
        _ => match media.kind {
            Some(MediaKind::Video) => "mp4",
            _ => "mp3",
        },
    }
}

/// resolve a `MediaRef` to a local file path, fetching the bytes from
/// `source_peer_addr` via grimoire's existing verified iroh-blobs
/// client if not already cached locally. reuses
/// `grimoire::federation::p2p_client::fetch_blob_verified_to_file` -
/// the same primitive charnel's own player-pairing "queue push" flow
/// is built on (see repo memory
/// `tomb-grimoire-player-alpn-half-baked.md`'s follow-up #2) - streamed
/// straight to disk, no full-file memory buffering.
pub async fn resolve_media_ref(media: &MediaRef) -> Result<String, String> {
    resolve_media_ref_with_progress(media, None).await
}

/// `resolve_media_ref` with an optional cumulative-bytes progress
/// callback, so a caller resolving a whole queue can drive a live
/// "downloading N/M" indicator instead of the ui just freezing until
/// each fetch completes. same lifetime bound as grimoire's own
/// `BlobProgressFn` (implicitly `'static` - a plain `dyn Trait` type
/// alias used behind a reference doesn't inherit the reference's own
/// lifetime the way a bare `&dyn Trait` written inline would) so it
/// can be forwarded straight through to
/// `fetch_blob_verified_to_file_with_progress` without a mismatch.
pub async fn resolve_media_ref_with_progress(
    media: &MediaRef,
    on_progress: Option<&grimoire::federation::p2p_client::BlobProgressFn>,
) -> Result<String, String> {
    let cache_dir = player_cache_dir();
    std::fs::create_dir_all(&cache_dir).map_err(|e| format!("player cache dir: {e}"))?;
    let target = cache_dir.join(format!("{}.{}", media.blake3_hash, guess_extension(media)));
    if target.exists() {
        return Ok(target.to_string_lossy().into_owned());
    }
    grimoire::federation::p2p_client::fetch_blob_verified_to_file_with_progress(
        &media.source_peer_addr,
        &media.blake3_hash,
        &target,
        on_progress,
    )
    .await
    .map_err(|e| format!("failed to fetch media from {}: {e}", media.source_peer_addr))?;
    Ok(target.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ref_with_kind(kind: MediaKind) -> MediaRef {
        MediaRef {
            source_peer_addr: "peer".into(),
            blake3_hash: "hash".into(),
            size_bytes: None,
            duration_ms: None,
            mime_type: None,
            kind: Some(kind),
            title: None,
            artist: None,
            artwork_thumb_url: None,
            artwork_full_url: None,
        }
    }

    #[test]
    fn guess_extension_prefers_mime_type() {
        let mut m = ref_with_kind(MediaKind::Audio);
        m.mime_type = Some("audio/flac".into());
        assert_eq!(guess_extension(&m), "flac");
    }

    #[test]
    fn guess_extension_falls_back_to_kind() {
        assert_eq!(guess_extension(&ref_with_kind(MediaKind::Video)), "mp4");
        assert_eq!(guess_extension(&ref_with_kind(MediaKind::Audio)), "mp3");
    }
}
