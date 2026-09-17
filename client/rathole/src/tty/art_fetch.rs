//! resolves a remote-pushed queue entry's `art_url` (see
//! `SongRow::art_url`'s doc comment) to a local file path.
//!
//! spume's `playerQueuePush.ts`'s `resolveArtwork()` embeds art as a
//! `data:` url (base64 bytes) for the common cases (locally-cached
//! blob, or a charnel-managed remote the player device could never
//! reach directly) - that's the only case handled here today, by
//! decoding + caching to disk. a real http(s) url (the less common
//! fallback case, per that function's own doc comment) isn't fetched
//! yet - rathole has no http client wired in for this - and resolves
//! to an error instead of silently doing nothing.

use base64::Engine as _;

fn art_cache_dir() -> std::path::PathBuf {
    grimoire::config::get_config()
        .data_dir
        .join("rathole")
        .join("art_cache")
}

/// resolves `url` to a local file path, decoding+caching a `data:` url
/// to disk (content-hashed filename, so repeat calls for the same
/// bytes are free). errors (rather than silently returning nothing)
/// on anything else so callers can log a clear reason art didn't show.
pub async fn resolve_art_url(url: &str) -> Result<String, String> {
    match url.strip_prefix("data:") {
        Some(rest) => decode_data_url(rest),
        None => Err(format!(
            "fetching a real http(s) art url isn't supported yet (no http client wired into rathole): {url}"
        )),
    }
}

fn decode_data_url(rest: &str) -> Result<String, String> {
    let (meta, data) = rest
        .split_once(',')
        .ok_or_else(|| "malformed data url (no comma separating metadata from data)".to_string())?;
    if !meta.ends_with(";base64") {
        return Err(format!(
            "unsupported data url encoding (expected `;base64`): {meta}"
        ));
    }
    let mime = meta.trim_end_matches(";base64");
    let ext = ext_for_mime(mime);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("failed to base64-decode data url: {e}"))?;

    let hash = content_hash(&bytes);
    let dir = art_cache_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("art cache dir: {e}"))?;
    let path = dir.join(format!("{hash:016x}.{ext}"));
    if !path.exists() {
        std::fs::write(&path, &bytes)
            .map_err(|e| format!("failed to write art cache file: {e}"))?;
    }
    Ok(path.to_string_lossy().into_owned())
}

fn content_hash(bytes: &[u8]) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}

fn ext_for_mime(mime: &str) -> &'static str {
    match mime {
        "image/webp" => "webp",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        _ => "img",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn decodes_a_data_url_to_a_cached_file() {
        grimoire::config::init_config_for_tests();
        // 1x1 white pixel png.
        let png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQD3A0FDAAAAAElFTkSuQmCC";
        let url = format!("data:image/png;base64,{png_b64}");
        let path = resolve_art_url(&url).await.expect("should decode");
        assert!(path.ends_with(".png"));
        let bytes = std::fs::read(&path).unwrap();
        assert!(bytes.starts_with(b"\x89PNG"));
    }

    #[tokio::test]
    async fn rejects_a_real_http_url_with_a_clear_error() {
        let err = resolve_art_url("https://example.com/art.png")
            .await
            .unwrap_err();
        assert!(err.contains("http client"));
    }

    #[tokio::test]
    async fn rejects_malformed_data_url() {
        let err = resolve_art_url("data:garbage").await.unwrap_err();
        assert!(err.contains("malformed"));
    }
}
