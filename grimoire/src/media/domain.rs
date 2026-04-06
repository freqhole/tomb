//! media domain classification
//!
//! determines which domain a file belongs to based on filename extension
//! and/or mime type.

use serde::{Deserialize, Serialize};
use std::fmt;
use zod_gen::ZodSchema;

/// media domain for classifying uploaded files
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaDomain {
    Audio,
    Photo,
    Video,
    Document,
    File,
}

impl MediaDomain {
    pub fn as_str(&self) -> &'static str {
        match self {
            MediaDomain::Audio => "audio",
            MediaDomain::Photo => "photo",
            MediaDomain::Video => "video",
            MediaDomain::Document => "document",
            MediaDomain::File => "file",
        }
    }
}

impl fmt::Display for MediaDomain {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl std::str::FromStr for MediaDomain {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "audio" => Ok(MediaDomain::Audio),
            "photo" => Ok(MediaDomain::Photo),
            "video" => Ok(MediaDomain::Video),
            "document" => Ok(MediaDomain::Document),
            "file" => Ok(MediaDomain::File),
            _ => Err(format!("invalid media domain: {}", s)),
        }
    }
}

impl ZodSchema for MediaDomain {
    fn zod_schema() -> String {
        r#"z.union([z.literal("audio"), z.literal("photo"), z.literal("video"), z.literal("document"), z.literal("file")])"#.to_string()
    }
}

/// classify a file into a media domain based on filename extension and/or mime type.
/// uses extension first, falls back to mime prefix.
pub fn classify_domain(filename: &str, mime: Option<&str>) -> MediaDomain {
    // try extension first
    if let Some(ext) = filename.rsplit('.').next() {
        match ext.to_lowercase().as_str() {
            // audio
            "mp3" | "flac" | "wav" | "ogg" | "aac" | "m4a" | "opus" | "wma" | "aiff" | "aif" => {
                return MediaDomain::Audio
            }
            // photo
            "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "tiff" | "tif" | "heic" | "heif"
            | "avif" | "svg" => return MediaDomain::Photo,
            // video
            "mp4" | "mkv" | "avi" | "mov" | "webm" | "wmv" | "flv" | "m4v" | "ts" | "3gp" => {
                return MediaDomain::Video
            }
            // document
            "pdf" | "epub" | "mobi" | "txt" | "html" | "htm" | "md" | "doc" | "docx" | "rtf"
            | "odt" | "djvu" | "cbz" | "cbr" => return MediaDomain::Document,
            _ => {}
        }
    }

    // fall back to mime type
    if let Some(mime) = mime {
        if mime.starts_with("audio/") {
            return MediaDomain::Audio;
        }
        if mime.starts_with("image/") {
            return MediaDomain::Photo;
        }
        if mime.starts_with("video/") {
            return MediaDomain::Video;
        }
        if mime == "application/pdf" || mime.starts_with("text/") {
            return MediaDomain::Document;
        }
    }

    MediaDomain::File
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classify_by_extension() {
        assert_eq!(classify_domain("track.mp3", None), MediaDomain::Audio);
        assert_eq!(classify_domain("sample.wav", None), MediaDomain::Audio);
        assert_eq!(classify_domain("photo.jpg", None), MediaDomain::Photo);
        assert_eq!(classify_domain("image.png", None), MediaDomain::Photo);
        assert_eq!(classify_domain("clip.mp4", None), MediaDomain::Video);
        assert_eq!(classify_domain("movie.mkv", None), MediaDomain::Video);
        assert_eq!(classify_domain("paper.pdf", None), MediaDomain::Document);
        assert_eq!(classify_domain("notes.txt", None), MediaDomain::Document);
        assert_eq!(classify_domain("archive.zip", None), MediaDomain::File);
        assert_eq!(classify_domain("data.bin", None), MediaDomain::File);
    }

    #[test]
    fn test_classify_by_mime_fallback() {
        assert_eq!(
            classify_domain("noext", Some("audio/mpeg")),
            MediaDomain::Audio
        );
        assert_eq!(
            classify_domain("noext", Some("image/jpeg")),
            MediaDomain::Photo
        );
        assert_eq!(
            classify_domain("noext", Some("video/mp4")),
            MediaDomain::Video
        );
        assert_eq!(
            classify_domain("noext", Some("application/pdf")),
            MediaDomain::Document
        );
        assert_eq!(
            classify_domain("noext", Some("application/octet-stream")),
            MediaDomain::File
        );
    }

    #[test]
    fn test_extension_takes_priority_over_mime() {
        assert_eq!(
            classify_domain("image.png", Some("audio/mpeg")),
            MediaDomain::Photo
        );
    }
}
