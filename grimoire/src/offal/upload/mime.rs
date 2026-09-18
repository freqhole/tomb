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
    if let Some(audio) = sniff_audio_mime_type(filename, data) {
        return audio;
    }
    if let Some(video) = sniff_video_mime_type(filename, data) {
        return video;
    }
    tracing::warn!("detect_media_mime_type: could not identify '{filename}' by extension or magic bytes - guessing audio/mpeg");
    "audio/mpeg".to_string()
}

/// detect file extension from mime type or filename.
///
/// tries the filename first (any short trailing extension), then falls back
/// to a known mime-type table covering the audio + image formats this
/// codebase actually serves. unknown types resolve to `"bin"`.
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
        "audio/flac" => "flac",
        "audio/ogg" | "audio/vorbis" => "ogg",
        "audio/opus" => "opus",
        "audio/wav" | "audio/wave" => "wav",
        "audio/aac" => "aac",
        "audio/m4a" | "audio/mp4" => "m4a",
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
