//! content sniffing shared by the upload handlers: extension first, then
//! magic bytes when the extension is missing or lying.

/// detect image mime type from filename extension and magic bytes
pub fn detect_image_mime_type(filename: &str, data: &[u8]) -> String {
    // check magic bytes first
    if data.len() >= 8 {
        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if data.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) {
            return "image/png".to_string();
        }
        // JPEG: FF D8 FF
        if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
            return "image/jpeg".to_string();
        }
        // GIF: GIF87a or GIF89a
        if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
            return "image/gif".to_string();
        }
        // WebP: RIFF....WEBP
        if data.len() >= 12 && data.starts_with(b"RIFF") && &data[8..12] == b"WEBP" {
            return "image/webp".to_string();
        }
        // BMP: BM
        if data.starts_with(b"BM") {
            return "image/bmp".to_string();
        }
    }

    // fallback to extension
    let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();

    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
    .to_string()
}

/// decode raster images before publishing their bytes; SVG remains supported
/// separately because the image crate does not decode it.
pub async fn validate_image_bytes(data: Vec<u8>, mime: &str) -> crate::GrimoireResult<Vec<u8>> {
    if mime == "image/svg+xml" {
        return Ok(data);
    }
    let mime = mime.to_owned();
    tokio::task::spawn_blocking(move || {
        let format =
            image::guess_format(&data).map_err(|e| crate::GrimoireError::ImageDecodeFailed {
                reason: e.to_string(),
            })?;
        if format.to_mime_type() != mime {
            return Err(crate::GrimoireError::ImageDecodeFailed {
                reason: format!("image format does not match declared MIME type {mime}"),
            });
        }
        image::load_from_memory_with_format(&data, format).map_err(|e| {
            crate::GrimoireError::ImageDecodeFailed {
                reason: e.to_string(),
            }
        })?;
        Ok(data)
    })
    .await
    .map_err(|e| crate::GrimoireError::ProcessingFailed {
        message: format!("image validation task failed: {e}"),
    })?
}

pub const MAX_IMAGE_INPUT_BYTES: usize = 64 * 1024 * 1024;

pub async fn normalize_image_upload(
    data: Vec<u8>,
    mime: &str,
) -> crate::GrimoireResult<(Vec<u8>, String)> {
    if data.len() > MAX_IMAGE_INPUT_BYTES {
        return Err(crate::GrimoireError::Validation {
            field: "image".into(),
            message: format!("image exceeds {MAX_IMAGE_INPUT_BYTES} input bytes"),
        });
    }
    let data = validate_image_bytes(data, mime).await?;
    if mime == "image/svg+xml" {
        if data.len() > crate::blob_data::MAX_ARTWORK_BYTES {
            return Err(crate::GrimoireError::Validation {
                field: "image".into(),
                message: "SVG exceeds the artwork size limit".into(),
            });
        }
        return Ok((data, mime.to_owned()));
    }
    if crate::blob_data::artwork_needs_normalization(&data)? {
        return Ok((
            crate::blob_data::convert_artwork_to_webp(data).await?,
            "image/webp".into(),
        ));
    }
    Ok((data, mime.to_owned()))
}

/// sniff audio mime type from filename extension and magic bytes only -
/// `None` if neither recognizes the file, with no assumed default. shared
/// by `detect_audio_mime_type` (which adds the mp3 last-resort default
/// below) and `detect_media_mime_type` (which needs a fallback-free
/// signal to decide between audio and video).
fn sniff_audio_mime_type(filename: &str, data: &[u8]) -> Option<String> {
    // try filename extension first
    let mime = mime_guess::from_path(filename).first();
    if let Some(mime) = mime {
        let mime_str = mime.to_string();
        if mime_str.starts_with("audio/") {
            return Some(mime_str);
        }
    }

    // fallback to magic bytes
    if data.len() >= 4 {
        // mp3
        if data.starts_with(b"ID3") || (data[0] == 0xFF && (data[1] & 0xE0) == 0xE0) {
            return Some("audio/mpeg".to_string());
        }
        // flac
        if data.starts_with(b"fLaC") {
            return Some("audio/flac".to_string());
        }
        // ogg
        if data.starts_with(b"OggS") {
            return Some("audio/ogg".to_string());
        }
        // wav/riff
        if data.starts_with(b"RIFF") && data.len() >= 12 && &data[8..12] == b"WAVE" {
            return Some("audio/wav".to_string());
        }
        // m4a/mp4
        if data.len() >= 12 && &data[4..8] == b"ftyp" {
            return Some("audio/mp4".to_string());
        }
        // webm/mkv (EBML header) - opus/vorbis-in-webm is a legitimate
        // audio-only format, but shares its top-level magic bytes with
        // video webm/mkv; header bytes alone can't tell them apart.
        // optimistically treat it as audio here (an audio-domain
        // caller, e.g. `pull_audio_blob_to_local_storage`, already
        // expressed audio intent) rather than reject outright - a
        // genuinely video-content webm pushed through the music path
        // would still get through, but that's a narrower risk than
        // rejecting every legitimate audio-only webm/opus file.
        if data.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
            return Some("audio/webm".to_string());
        }
    }

    None
}

/// detect audio mime type from filename and magic bytes
pub fn detect_audio_mime_type(filename: &str, data: &[u8]) -> String {
    // an audio-domain caller passing in a file that's neither recognized
    // by extension nor magic bytes is still overwhelmingly likely to be
    // audio (it got here via an audio import/pull path) - guess mp3
    // rather than the meaningless `application/octet-stream`, which
    // webkitgtk/webview2 refuse to even attempt playing.
    sniff_audio_mime_type(filename, data).unwrap_or_else(|| {
        tracing::warn!("detect_audio_mime_type: could not identify '{filename}' by extension or magic bytes - guessing audio/mpeg");
        "audio/mpeg".to_string()
    })
}

/// sniff video mime type from filename extension and magic bytes only -
/// `None` if neither recognizes the file, with no assumed default. see
/// `sniff_audio_mime_type`'s doc comment for why this split exists.
fn sniff_video_mime_type(filename: &str, data: &[u8]) -> Option<String> {
    // try filename extension first
    let mime = mime_guess::from_path(filename).first();
    if let Some(mime) = mime {
        let mime_str = mime.to_string();
        if mime_str.starts_with("video/") {
            return Some(mime_str);
        }
    }

    // fallback to magic bytes
    if data.len() >= 4 {
        // mp4/mov/m4v: ftyp box at offset 4
        if data.len() >= 12 && &data[4..8] == b"ftyp" {
            return Some("video/mp4".to_string());
        }
        // mkv/webm: EBML header
        if data.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
            return Some("video/x-matroska".to_string());
        }
        // avi: RIFF....AVI
        if data.starts_with(b"RIFF") && data.len() >= 12 && &data[8..12] == b"AVI " {
            return Some("video/x-msvideo".to_string());
        }
    }

    None
}

/// detect video mime type from filename extension and magic bytes
pub fn detect_video_mime_type(filename: &str, data: &[u8]) -> String {
    // same reasoning as `detect_audio_mime_type`'s mp3 default, but for
    // video-domain callers - guess mp4 rather than `application/octet-stream`.
    sniff_video_mime_type(filename, data).unwrap_or_else(|| {
        tracing::warn!("detect_video_mime_type: could not identify '{filename}' by extension or magic bytes - guessing video/mp4");
        "video/mp4".to_string()
    })
}

/// detect a media mime type when the DOMAIN (audio/video/image) isn't
/// known up front - unlike `detect_audio_mime_type`/`detect_video_mime_type`/
/// `detect_image_mime_type` above, which are called by a caller that
/// already knows what it's importing. tries image, then audio, then video
/// sniffing in turn (extension/magic bytes only, no domain-specific
/// fallback guess yet), and only once all three come up empty, defaults to
/// mp3 - audio is the dominant use case for this codebase's only
/// domain-agnostic caller (charnel's `freqhole-media://` protocol
/// handler), and an unrecognized file is far more likely to be an
/// oddly-tagged/legacy-imported song than a video.
pub fn detect_media_mime_type(filename: &str, data: &[u8]) -> String {
    let image = detect_image_mime_type(filename, data);
    if image != "application/octet-stream" {
        return image;
    }

    // an extension mime_guess actually recognizes as audio or video is a
    // real, unambiguous signal - trust it before any magic-byte guessing
    // below, so a properly-named .mp4/.mkv file is never relabeled by the
    // audio-leaning fallback further down.
    if let Some(mime) = mime_guess::from_path(filename).first() {
        let mime_str = mime.to_string();
        if mime_str.starts_with("audio/") || mime_str.starts_with("video/") {
            return mime_str;
        }
    }

    // ftyp (mp4 family) and EBML (mkv/webm family) containers can hold
    // either audio-only or video content, and the magic bytes alone don't
    // say which - `sniff_audio_mime_type`'s own fallback below assumes
    // audio unconditionally for both, which is only safe for a caller
    // that already knows the domain (`detect_audio_mime_type`'s callers
    // do). here the domain is unknown, and this same domain-agnostic path
    // now serves both audio AND video playback (charnel's
    // `freqhole-media://` handler, used by both `localAudio.ts` and
    // `localVideo.ts`) - so an unlabeled/`.bin` file with one of these two
    // magic headers is checked as video first instead: a real audio-only
    // file mislabeled `video/*` still visibly plays in an `<audio>`
    // element (the browser probes actual codecs, not just the label),
    // but a real video file mislabeled `audio/*` is flatly refused by
    // `<video>` (confirmed live: `NotSupportedError`/media error 4 for
    // exactly this misidentification - a `.bin`-extensioned mp4/mkv video
    // sniffed as audio). the one real, non-guessed signal here - an mp4
    // ftyp box's major brand explicitly declaring itself audio (`M4A `/
    // `M4B `) - is still honored ahead of the video-first default.
    if data.len() >= 12 && &data[4..8] == b"ftyp" && matches!(&data[8..12], b"M4A " | b"M4B ") {
        return "audio/mp4".to_string();
    }
    if let Some(video) = sniff_video_mime_type(filename, data) {
        return video;
    }
    if let Some(audio) = sniff_audio_mime_type(filename, data) {
        return audio;
    }
    tracing::warn!("detect_media_mime_type: could not identify '{filename}' by extension or magic bytes - guessing audio/mpeg");
    "audio/mpeg".to_string()
}

/// detect file extension from mime type or filename.
///
/// tries the filename first (any short trailing extension), then falls back
/// to a known mime-type table covering the audio + image + video formats
/// this codebase actually serves. unknown types resolve to `"bin"`.
pub fn detect_extension(mime_type: &str, filename: &str) -> String {
    // try to get extension from filename first
    if let Some(ext) = filename.rsplit('.').next() {
        if ext.len() <= 5 && !ext.is_empty() && ext != filename {
            return ext.to_lowercase();
        }
    }

    // fallback to mime type mapping
    match mime_type {
        // audio
        "audio/mpeg" => "mp3",
        "audio/flac" | "audio/x-flac" => "flac",
        "audio/ogg" | "audio/vorbis" => "ogg",
        "audio/opus" => "opus",
        "audio/wav" | "audio/wave" | "audio/x-wav" | "audio/vnd.wave" => "wav",
        "audio/aac" => "aac",
        "audio/m4a" | "audio/mp4" | "audio/x-m4a" => "m4a",
        "audio/webm" => "webm",
        // images
        "image/webp" => "webp",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/avif" => "avif",
        "image/bmp" => "bmp",
        "image/svg+xml" => "svg",
        // video
        "video/mp4" => "mp4",
        "video/x-matroska" => "mkv",
        "video/webm" => "webm",
        "video/quicktime" => "mov",
        "video/x-msvideo" => "avi",
        _ => "bin",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn image_validation_rejects_truncated_and_mismatched_rasters() {
        let mut png = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(2, 2)
            .write_to(&mut png, image::ImageOutputFormat::Png)
            .unwrap();
        let png = png.into_inner();
        assert_eq!(
            validate_image_bytes(png.clone(), "image/png")
                .await
                .unwrap(),
            png
        );
        assert!(validate_image_bytes(png[..8].to_vec(), "image/png")
            .await
            .is_err());
        assert!(validate_image_bytes(png, "image/jpeg").await.is_err());
    }

    #[tokio::test]
    async fn image_validation_preserves_svg_support() {
        let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>".to_vec();
        assert_eq!(
            validate_image_bytes(svg.clone(), "image/svg+xml")
                .await
                .unwrap(),
            svg
        );
    }

    #[tokio::test]
    async fn image_upload_normalizes_oversized_artwork() {
        let mut png = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(2, 2)
            .write_to(&mut png, image::ImageOutputFormat::Png)
            .unwrap();
        let mut bytes = png.into_inner();
        bytes.resize(crate::blob_data::MAX_ARTWORK_BYTES + 1, 0);
        let (bytes, mime) = normalize_image_upload(bytes, "image/png").await.unwrap();
        assert_eq!(mime, "image/webp");
        assert!(bytes.len() <= crate::blob_data::MAX_ARTWORK_BYTES);
        let image = image::load_from_memory(&bytes).unwrap();
        assert_eq!((image.width(), image.height()), (2, 2));
    }

    #[tokio::test]
    async fn image_upload_normalizes_over_4k_even_when_small() {
        let mut png = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(4097, 1)
            .write_to(&mut png, image::ImageOutputFormat::Png)
            .unwrap();
        let (bytes, mime) = normalize_image_upload(png.into_inner(), "image/png")
            .await
            .unwrap();
        assert_eq!(mime, "image/webp");
        let image = image::load_from_memory(&bytes).unwrap();
        assert_eq!((image.width(), image.height()), (4096, 1));
    }

    // a minimal ftyp box: size(4) + "ftyp" + major_brand(4) + minor_version(4)
    fn ftyp_box(major_brand: &[u8; 4]) -> Vec<u8> {
        let mut data = vec![0, 0, 0, 32, b'f', b't', b'y', b'p'];
        data.extend_from_slice(major_brand);
        data.extend_from_slice(&[0, 0, 0, 0]);
        data
    }

    const EBML_HEADER: [u8; 4] = [0x1A, 0x45, 0xDF, 0xA3];

    #[test]
    fn generic_mp4_ftyp_with_no_extension_is_video_not_audio() {
        let data = ftyp_box(b"isom");
        assert_eq!(detect_media_mime_type("abc123.bin", &data), "video/mp4");
    }

    #[test]
    fn m4a_branded_ftyp_with_no_extension_is_audio() {
        let data = ftyp_box(b"M4A ");
        assert_eq!(detect_media_mime_type("abc123.bin", &data), "audio/mp4");
    }

    #[test]
    fn properly_extensioned_mp4_stays_video_regardless_of_ftyp_brand() {
        let data = ftyp_box(b"isom");
        assert_eq!(detect_media_mime_type("movie.mp4", &data), "video/mp4");
    }

    #[test]
    fn ebml_header_with_no_extension_is_video_not_audio() {
        assert_eq!(
            detect_media_mime_type("abc123.bin", &EBML_HEADER),
            "video/x-matroska"
        );
    }

    #[test]
    fn mp3_still_detected_as_audio() {
        let data = [b'I', b'D', b'3', 0];
        assert_eq!(detect_media_mime_type("abc123.bin", &data), "audio/mpeg");
    }
}
