//! subprocess-based pdf/video/audio thumbnailing (feature `thumbnails`).
//!
//! dispatches thumbnail generation to external tools: `magick` (imagemagick)
//! for pdf first-page rasterization, `ffprobe`/`ffmpeg` for video frame
//! extraction, and `ffmpeg`'s `showwavespic` filter for audio waveform
//! images. image thumbnails reuse [`crate::media::resize_to_square_webp`]
//! and need no external binary. all tools must be on `PATH`.

use std::path::Path;

use tokio::process::Command;

/// thumbnail bytes plus their mime type.
pub struct ThumbnailBytes {
    pub data: Vec<u8>,
    pub mime: &'static str,
}

#[derive(Debug, thiserror::Error)]
pub enum ThumbnailError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("image processing failed: {0}")]
    Media(#[from] crate::media::MediaError),

    #[error("external tool failed: {0}")]
    Tool(String),
}

/// generate a thumbnail for a blob on disk. returns `None` for unsupported
/// mime types - callers should treat that as "no thumbnail available", not
/// an error.
pub async fn generate_thumbnail(
    blob_path: &Path,
    mime: &str,
    size: u32,
) -> Result<Option<ThumbnailBytes>, ThumbnailError> {
    if mime.starts_with("image/") {
        Ok(Some(thumbnail_image(blob_path, size).await?))
    } else if mime == "application/pdf" {
        Ok(Some(thumbnail_pdf(blob_path, size).await?))
    } else if mime.starts_with("video/") {
        Ok(Some(thumbnail_video(blob_path, size).await?))
    } else if mime.starts_with("audio/") {
        Ok(Some(thumbnail_audio(blob_path, size).await?))
    } else {
        Ok(None)
    }
}

// ---------------------------------------------------------------------------
// image (no subprocess)
// ---------------------------------------------------------------------------

async fn thumbnail_image(path: &Path, size: u32) -> Result<ThumbnailBytes, ThumbnailError> {
    let bytes = tokio::fs::read(path).await?;
    let webp = crate::media::resize_to_square_webp(&bytes, size)?;
    Ok(ThumbnailBytes {
        data: webp,
        mime: "image/webp",
    })
}

// ---------------------------------------------------------------------------
// pdf (first page via magick)
// ---------------------------------------------------------------------------

async fn thumbnail_pdf(path: &Path, size: u32) -> Result<ThumbnailBytes, ThumbnailError> {
    let work_dir = std::env::temp_dir().join(format!("reliquary_thumb_{}", uuid::Uuid::new_v4()));
    tokio::fs::create_dir_all(&work_dir).await?;

    let output_path = work_dir.join("thumb.png");
    let resize_arg = format!("{size}x{size}");
    // `input.pdf[0]` selects only the first page - avoids loading the whole
    // document just to get a cover image.
    let input_arg = format!("{}[0]", path.to_string_lossy());

    let output = Command::new("magick")
        .arg("-density")
        .arg("72")
        .arg(&input_arg)
        .arg("-resize")
        .arg(&resize_arg)
        .arg(&output_path)
        .output()
        .await;

    let out = match output {
        Ok(o) => o,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let _ = tokio::fs::remove_dir_all(&work_dir).await;
            return Err(ThumbnailError::Tool(
                "magick not found - install ImageMagick (brew install imagemagick / apt install imagemagick)"
                    .to_string(),
            ));
        }
        Err(e) => {
            let _ = tokio::fs::remove_dir_all(&work_dir).await;
            return Err(ThumbnailError::Io(e));
        }
    };

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        tracing::warn!(stderr = %stderr, "magick pdf thumbnail failed");
        let _ = tokio::fs::remove_dir_all(&work_dir).await;
        return Err(ThumbnailError::Tool(format!("magick failed: {stderr}")));
    }

    let png_bytes = tokio::fs::read(&output_path).await;
    let _ = tokio::fs::remove_dir_all(&work_dir).await;
    let png_bytes = png_bytes?;

    Ok(ThumbnailBytes {
        data: png_bytes,
        mime: "image/png",
    })
}

// ---------------------------------------------------------------------------
// video (first frame via ffprobe + ffmpeg)
// ---------------------------------------------------------------------------

async fn thumbnail_video(path: &Path, size: u32) -> Result<ThumbnailBytes, ThumbnailError> {
    // probe duration first.
    let probe_out = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(path)
        .output()
        .await;

    let probe_out = match probe_out {
        Ok(o) => o,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(ThumbnailError::Tool(
                "ffprobe not found - install ffmpeg".to_string(),
            ));
        }
        Err(e) => return Err(ThumbnailError::Io(e)),
    };

    // seek to 1% of duration; fall back to 0.5s when probing fails.
    let seek_secs: f64 = if probe_out.status.success() {
        let raw = String::from_utf8_lossy(&probe_out.stdout)
            .trim()
            .to_string();
        raw.parse::<f64>().unwrap_or(50.0) * 0.01
    } else {
        0.5
    };

    let work_dir = std::env::temp_dir().join(format!("reliquary_vthumb_{}", uuid::Uuid::new_v4()));
    tokio::fs::create_dir_all(&work_dir).await?;

    let output_path = work_dir.join("frame.png");
    let scale_filter = format!("scale={size}:-2");
    let seek_str = format!("{seek_secs:.3}");

    let ffmpeg_out = Command::new("ffmpeg")
        .args(["-ss", &seek_str, "-i"])
        .arg(path)
        .args(["-frames:v", "1", "-vf", &scale_filter, "-f", "image2"])
        .arg(&output_path)
        .args(["-y"]) // overwrite if temp dir collision (unlikely but safe)
        .output()
        .await;

    let ffmpeg_out = match ffmpeg_out {
        Ok(o) => o,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let _ = tokio::fs::remove_dir_all(&work_dir).await;
            return Err(ThumbnailError::Tool(
                "ffmpeg not found - install ffmpeg".to_string(),
            ));
        }
        Err(e) => {
            let _ = tokio::fs::remove_dir_all(&work_dir).await;
            return Err(ThumbnailError::Io(e));
        }
    };

    if !ffmpeg_out.status.success() {
        let stderr = String::from_utf8_lossy(&ffmpeg_out.stderr).to_string();
        tracing::warn!(stderr = %stderr, "ffmpeg video thumbnail failed");
        let _ = tokio::fs::remove_dir_all(&work_dir).await;
        return Err(ThumbnailError::Tool(format!("ffmpeg failed: {stderr}")));
    }

    let png_bytes = tokio::fs::read(&output_path).await;
    let _ = tokio::fs::remove_dir_all(&work_dir).await;
    let png_bytes = png_bytes?;

    Ok(ThumbnailBytes {
        data: png_bytes,
        mime: "image/png",
    })
}

// ---------------------------------------------------------------------------
// audio (waveform image via ffmpeg showwavespic)
// ---------------------------------------------------------------------------

async fn thumbnail_audio(path: &Path, size: u32) -> Result<ThumbnailBytes, ThumbnailError> {
    let work_dir = std::env::temp_dir().join(format!("reliquary_athumb_{}", uuid::Uuid::new_v4()));
    tokio::fs::create_dir_all(&work_dir).await?;

    let output_path = work_dir.join("waveform.png");
    // a 4:1 aspect ratio (matching tomb's charnel waveform renderer) reads
    // better as a scrubber/preview strip than a square image would.
    let width = size * 4;
    let height = size;
    let filter = format!(
        "color=black:s={width}x{height}[bg];[0:a]showwavespic=s={width}x{height}:colors=0xff00ff[fg];[bg][fg]overlay=format=auto"
    );

    let ffmpeg_out = Command::new("ffmpeg")
        .arg("-i")
        .arg(path)
        .args(["-filter_complex", &filter, "-frames:v", "1", "-y"])
        .arg(&output_path)
        .output()
        .await;

    let ffmpeg_out = match ffmpeg_out {
        Ok(o) => o,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let _ = tokio::fs::remove_dir_all(&work_dir).await;
            return Err(ThumbnailError::Tool(
                "ffmpeg not found - install ffmpeg".to_string(),
            ));
        }
        Err(e) => {
            let _ = tokio::fs::remove_dir_all(&work_dir).await;
            return Err(ThumbnailError::Io(e));
        }
    };

    if !ffmpeg_out.status.success() {
        let stderr = String::from_utf8_lossy(&ffmpeg_out.stderr).to_string();
        tracing::warn!(stderr = %stderr, "ffmpeg waveform thumbnail failed");
        let _ = tokio::fs::remove_dir_all(&work_dir).await;
        return Err(ThumbnailError::Tool(format!("ffmpeg failed: {stderr}")));
    }

    let png_bytes = tokio::fs::read(&output_path).await;
    let _ = tokio::fs::remove_dir_all(&work_dir).await;
    let png_bytes = png_bytes?;

    Ok(ThumbnailBytes {
        data: png_bytes,
        mime: "image/png",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// exercises the no-subprocess path only - safe to run without ffmpeg/
    /// imagemagick installed. pdf/video paths need real binaries on `PATH`
    /// and are skipped (not failed) when those binaries aren't found - see
    /// [`tool_on_path`].
    #[tokio::test]
    async fn image_mime_produces_a_webp_thumbnail() {
        let img =
            image::RgbImage::from_fn(32, 32, |x, y| image::Rgb([(x * 8) as u8, (y * 8) as u8, 0]));
        let mut buf = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut buf, image::ImageFormat::Png)
            .unwrap();
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join("in.png");
        tokio::fs::write(&path, buf.into_inner()).await.unwrap();

        let thumb = generate_thumbnail(&path, "image/png", 16)
            .await
            .expect("generate_thumbnail")
            .expect("image mime should produce a thumbnail");
        assert_eq!(thumb.mime, "image/webp");
        assert_eq!(&thumb.data[0..4], b"RIFF");
    }

    #[tokio::test]
    async fn unsupported_mime_returns_none() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join("in.bin");
        tokio::fs::write(&path, b"not media").await.unwrap();

        let thumb = generate_thumbnail(&path, "application/octet-stream", 16)
            .await
            .expect("generate_thumbnail");
        assert!(thumb.is_none());
    }

    /// true if `name` resolves on `PATH`. used to skip (not fail) the
    /// subprocess-backed tests below on machines without imagemagick/ffmpeg
    /// installed - this crate's default feature set never requires them.
    fn tool_on_path(name: &str) -> bool {
        std::process::Command::new(name)
            .arg("-version")
            .output()
            .is_ok()
    }

    #[tokio::test]
    async fn pdf_mime_produces_a_png_thumbnail_via_magick() {
        if !tool_on_path("magick") {
            eprintln!("skipping: magick not found on PATH");
            return;
        }

        let tmp = tempfile::tempdir().expect("tempdir");
        let png_path = tmp.path().join("page.png");
        let pdf_path = tmp.path().join("doc.pdf");

        // build a tiny source png, then convert it to a one-page pdf via
        // magick itself - avoids needing a pdf-writing dependency just for
        // this test fixture.
        let img = image::RgbImage::from_fn(64, 64, |x, y| {
            image::Rgb([(x * 4) as u8, (y * 4) as u8, 200])
        });
        let mut buf = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut buf, image::ImageFormat::Png)
            .unwrap();
        tokio::fs::write(&png_path, buf.into_inner()).await.unwrap();

        let convert = tokio::process::Command::new("magick")
            .arg(&png_path)
            .arg(&pdf_path)
            .output()
            .await
            .expect("run magick to build test pdf fixture");
        assert!(
            convert.status.success(),
            "failed to build test pdf fixture: {}",
            String::from_utf8_lossy(&convert.stderr)
        );

        let thumb = generate_thumbnail(&pdf_path, "application/pdf", 32)
            .await
            .expect("generate_thumbnail")
            .expect("pdf mime should produce a thumbnail");
        assert_eq!(thumb.mime, "image/png");
        assert_eq!(&thumb.data[1..4], b"PNG");
    }

    #[tokio::test]
    async fn video_mime_produces_a_png_thumbnail_via_ffmpeg() {
        if !tool_on_path("ffmpeg") || !tool_on_path("ffprobe") {
            eprintln!("skipping: ffmpeg/ffprobe not found on PATH");
            return;
        }

        let tmp = tempfile::tempdir().expect("tempdir");
        let video_path = tmp.path().join("clip.mp4");

        // synthesize a tiny 1-second test-pattern clip - no real footage needed.
        let gen = tokio::process::Command::new("ffmpeg")
            .args(["-f", "lavfi", "-i", "color=red:size=64x64:duration=1"])
            .arg("-y")
            .arg(&video_path)
            .output()
            .await
            .expect("run ffmpeg to build test video fixture");
        assert!(
            gen.status.success(),
            "failed to build test video fixture: {}",
            String::from_utf8_lossy(&gen.stderr)
        );

        let thumb = generate_thumbnail(&video_path, "video/mp4", 32)
            .await
            .expect("generate_thumbnail")
            .expect("video mime should produce a thumbnail");
        assert_eq!(thumb.mime, "image/png");
        assert_eq!(&thumb.data[1..4], b"PNG");
    }

    #[tokio::test]
    async fn audio_mime_produces_a_png_thumbnail_via_ffmpeg() {
        if !tool_on_path("ffmpeg") {
            eprintln!("skipping: ffmpeg not found on PATH");
            return;
        }

        let tmp = tempfile::tempdir().expect("tempdir");
        let audio_path = tmp.path().join("tone.wav");

        // synthesize a tiny 1-second test tone - no real audio needed.
        let gen = tokio::process::Command::new("ffmpeg")
            .args(["-f", "lavfi", "-i", "sine=frequency=1000:duration=1"])
            .arg("-y")
            .arg(&audio_path)
            .output()
            .await
            .expect("run ffmpeg to build test audio fixture");
        assert!(
            gen.status.success(),
            "failed to build test audio fixture: {}",
            String::from_utf8_lossy(&gen.stderr)
        );

        let thumb = generate_thumbnail(&audio_path, "audio/wav", 32)
            .await
            .expect("generate_thumbnail")
            .expect("audio mime should produce a thumbnail");
        assert_eq!(thumb.mime, "image/png");
        assert_eq!(&thumb.data[1..4], b"PNG");
    }
}
