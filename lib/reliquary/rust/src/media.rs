//! image processing helpers: resize + webp encode, data-url codec.
//!
//! the default (`media`) feature covers everything that doesn't need an
//! external binary: square/max-dim resize and webp encoding (merged from
//! skein's `hub/avatar.rs` and the generic resize/webp primitives split out
//! of tomb grimoire's `blob_data/helpers.rs` and `blob_data/thumbnails.rs`),
//! plus the avatar data-url codec. the `thumbnails` feature (see the
//! [`thumbnails`] submodule) adds subprocess-based pdf/video thumbnailing.

use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView};

#[derive(Debug, thiserror::Error)]
pub enum MediaError {
    #[error("image decode failed: {0}")]
    Decode(String),

    #[error("image encode failed: {0}")]
    Encode(String),
}

/// resize strategy for square thumbnails.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ResizeMode {
    /// center-crop to square first, then resize (preserves detail, may lose
    /// edges) - the right choice for album art / avatars / regular images.
    #[default]
    CenterCrop,
    /// resize directly to square, distorting the aspect ratio (preserves
    /// all content) - the right choice for waveforms and similar plots.
    Squish,
}

fn resize_to_square(img: &DynamicImage, size: u32, mode: ResizeMode) -> DynamicImage {
    match mode {
        ResizeMode::CenterCrop => {
            let (w, h) = img.dimensions();
            let square_size = w.min(h);
            let x = (w - square_size) / 2;
            let y = (h - square_size) / 2;
            let cropped = img.crop_imm(x, y, square_size, square_size);
            cropped.resize_exact(size, size, FilterType::Lanczos3)
        }
        ResizeMode::Squish => img.resize_exact(size, size, FilterType::Lanczos3),
    }
}

/// lossy webp quality used by [`image_to_webp`] - matches skein's avatar
/// helper (a good balance between size and visual fidelity for
/// avatar/thumbnail-sized images).
const WEBP_QUALITY: f32 = 75.0;

/// encode a decoded image as webp bytes (lossy, quality 75) via the `webp`
/// crate's libwebp bindings - the `image` crate's own webp encoder path is
/// lossless-only and produces much larger files for photographic content.
fn image_to_webp(img: &DynamicImage) -> Result<Vec<u8>, MediaError> {
    let encoder = webp::Encoder::from_image(img).map_err(|e| MediaError::Encode(e.to_string()))?;
    Ok(encoder.encode(WEBP_QUALITY).to_vec())
}

/// decode any format the `image` crate understands and re-encode as webp,
/// with no resizing. handy for normalizing arbitrary source images (e.g.
/// 16-bit pngs) into a webp the rest of the pipeline can assume.
pub fn convert_to_webp(image_data: &[u8]) -> Result<Vec<u8>, MediaError> {
    let img = image::load_from_memory(image_data).map_err(|e| MediaError::Decode(e.to_string()))?;
    image_to_webp(&img)
}

/// resize an image to a square thumbnail (center-crop) and re-encode as
/// webp. uses lanczos3 resampling and lossy webp at quality 75 - a good
/// balance between size and visual fidelity for avatar-sized thumbnails
/// (typical output: 4-8KB at 128px).
pub fn resize_to_square_webp(image_data: &[u8], size: u32) -> Result<Vec<u8>, MediaError> {
    resize_to_square_webp_with_mode(image_data, size, ResizeMode::CenterCrop)
}

/// like [`resize_to_square_webp`], but with an explicit [`ResizeMode`] -
/// `Squish` for waveforms and other content where losing edges (center-crop)
/// would be wrong.
pub fn resize_to_square_webp_with_mode(
    image_data: &[u8],
    size: u32,
    mode: ResizeMode,
) -> Result<Vec<u8>, MediaError> {
    let img = image::load_from_memory(image_data).map_err(|e| MediaError::Decode(e.to_string()))?;
    let resized = resize_to_square(&img, size, mode);
    image_to_webp(&resized)
}

/// decode image bytes, downscale so the longer edge is at most `max_dim`
/// pixels (preserving aspect ratio; never upscales), and encode as webp.
/// returns `(webp_bytes, width, height)` of the result.
///
/// useful at ingest time to normalize remote/user-provided art into a
/// reasonably-sized webp original without persisting multi-megabyte source
/// images verbatim.
pub fn resize_to_max_dim_webp(
    image_data: &[u8],
    max_dim: u32,
) -> Result<(Vec<u8>, u32, u32), MediaError> {
    let img = image::load_from_memory(image_data).map_err(|e| MediaError::Decode(e.to_string()))?;
    let (w, h) = img.dimensions();
    let resized = if w.max(h) > max_dim {
        img.resize(max_dim, max_dim, FilterType::Lanczos3)
    } else {
        img
    };
    let (rw, rh) = resized.dimensions();
    let bytes = image_to_webp(&resized)?;
    Ok((bytes, rw, rh))
}

/// decode a `data:<mime>;base64,<payload>` url into raw bytes plus the
/// declared mime type. returns `None` for empty or malformed input -
/// callers should treat that as "no image".
pub fn decode_data_url(data_url: &str) -> Option<(String, Vec<u8>)> {
    use base64::Engine;
    let trimmed = data_url.trim();
    if trimmed.is_empty() {
        return None;
    }
    let rest = trimmed.strip_prefix("data:")?;
    let (header, payload) = rest.split_once(',')?;
    let mime = header.split(';').next()?.trim();
    if mime.is_empty() {
        return None;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload.trim())
        .ok()?;
    Some((mime.to_string(), bytes))
}

/// the inverse of [`decode_data_url`]: build a `data:<mime>;base64,...`
/// string from raw bytes and a mime type.
pub fn encode_data_url(mime: &str, bytes: &[u8]) -> String {
    use base64::Engine;
    format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

#[cfg(feature = "thumbnails")]
pub mod thumbnails;

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn tiny_png() -> Vec<u8> {
        let img = image::RgbImage::from_fn(16, 16, |x, y| {
            image::Rgb([(x * 16) as u8, (y * 16) as u8, 0])
        });
        let mut buf = Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(img)
            .write_to(&mut buf, image::ImageFormat::Png)
            .unwrap();
        buf.into_inner()
    }

    fn wide_png(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbImage::from_fn(w, h, |x, y| {
            image::Rgb([(x % 256) as u8, (y % 256) as u8, 128])
        });
        let mut buf = Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(img)
            .write_to(&mut buf, image::ImageFormat::Png)
            .unwrap();
        buf.into_inner()
    }

    #[test]
    fn round_trip_png_to_webp() {
        let png = tiny_png();
        let webp = resize_to_square_webp(&png, 32).expect("encode webp");
        assert!(!webp.is_empty(), "webp output should not be empty");
        assert_eq!(&webp[0..4], b"RIFF", "expected RIFF header");
        assert_eq!(&webp[8..12], b"WEBP", "expected WEBP signature");
    }

    #[test]
    fn rejects_non_image_bytes() {
        let result = resize_to_square_webp(b"not an image at all", 64);
        assert!(result.is_err());
    }

    #[test]
    fn squish_mode_distorts_a_non_square_source_to_the_target_size() {
        let png = wide_png(64, 16);
        let webp = resize_to_square_webp_with_mode(&png, 32, ResizeMode::Squish)
            .expect("encode webp squish");
        let decoded = image::load_from_memory(&webp).expect("decode result webp");
        assert_eq!(decoded.dimensions(), (32, 32));
    }

    #[test]
    fn center_crop_mode_also_reaches_the_target_size() {
        let png = wide_png(64, 16);
        let webp = resize_to_square_webp_with_mode(&png, 32, ResizeMode::CenterCrop)
            .expect("encode webp crop");
        let decoded = image::load_from_memory(&webp).expect("decode result webp");
        assert_eq!(decoded.dimensions(), (32, 32));
    }

    #[test]
    fn resize_to_max_dim_never_upscales() {
        let png = tiny_png(); // 16x16
        let (webp, w, h) = resize_to_max_dim_webp(&png, 512).expect("resize to max dim");
        assert_eq!(
            (w, h),
            (16, 16),
            "smaller-than-max source must not be upscaled"
        );
        let decoded = image::load_from_memory(&webp).expect("decode result webp");
        assert_eq!(decoded.dimensions(), (16, 16));
    }

    #[test]
    fn resize_to_max_dim_downscales_preserving_aspect_ratio() {
        let png = wide_png(400, 100);
        let (webp, w, h) = resize_to_max_dim_webp(&png, 200).expect("resize to max dim");
        assert_eq!(w, 200);
        assert_eq!(h, 50);
        let decoded = image::load_from_memory(&webp).expect("decode result webp");
        assert_eq!(decoded.dimensions(), (200, 50));
    }

    #[test]
    fn convert_to_webp_round_trips_any_supported_format() {
        let png = tiny_png();
        let webp = convert_to_webp(&png).expect("convert to webp");
        assert_eq!(&webp[0..4], b"RIFF");
        let decoded = image::load_from_memory(&webp).expect("decode result webp");
        assert_eq!(decoded.dimensions(), (16, 16));
    }

    #[test]
    fn decode_data_url_round_trip() {
        use base64::Engine;
        let payload = b"hello-bytes";
        let url = format!(
            "data:image/webp;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(payload)
        );
        let (mime, bytes) = decode_data_url(&url).expect("decode");
        assert_eq!(mime, "image/webp");
        assert_eq!(bytes, payload);
    }

    #[test]
    fn decode_data_url_rejects_garbage() {
        assert!(decode_data_url("").is_none());
        assert!(decode_data_url("not-a-data-url").is_none());
        assert!(decode_data_url("data:image/png;base64,!!!not-base64!!!").is_none());
    }

    #[test]
    fn encode_data_url_round_trips_through_decode() {
        let bytes = b"round trip me";
        let url = encode_data_url("image/png", bytes);
        let (mime, decoded) = decode_data_url(&url).expect("decode encoded url");
        assert_eq!(mime, "image/png");
        assert_eq!(decoded, bytes);
    }
}
