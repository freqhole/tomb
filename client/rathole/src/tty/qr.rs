//! qr code rendering for the `--player`/`/player` pairing screen.
//!
//! default rendering mode (`ImageDisplayMode::Terminal`, see
//! `grimoire::config::PlayerPairingConfig`): draws directly into the
//! ratatui frame as unicode half-block text via the `qrcode` crate's own
//! dense unicode renderer - precise 1:1 module mapping (unlike a
//! general-purpose image renderer like `ratatui-image`, which would
//! resample/blur a QR's fine module grid). the alternative "framebuffer"
//! mode (`render_qr_pin_png` below) renders a real png (magenta-on-black,
//! pin digits baked in) and shows it through the existing mpv
//! `VideoCommand::ShowImage` path instead of this module's unicode text.

use std::cell::Cell;
use std::hash::{Hash, Hasher};

use image::{Rgb, RgbImage};
use qrcode::render::unicode;
use qrcode::QrCode;

/// render `payload` as a scannable qr code using unicode half-block
/// characters, ready to drop directly into a ratatui `Paragraph`/`Text`.
pub fn render_qr_unicode(payload: &str) -> Result<String, String> {
    let code = QrCode::new(payload.as_bytes()).map_err(|e| e.to_string())?;
    Ok(code.render::<unicode::Dense1x2>().quiet_zone(true).build())
}

const MAGENTA: Rgb<u8> = Rgb([255, 0, 255]);
const BLACK: Rgb<u8> = Rgb([0, 0, 0]);
/// height, in pixels, reserved below the qr for the baked-in pin digits.
const PIN_BAND_HEIGHT: u32 = 110;

thread_local! {
    /// hash of the (payload, pin) last written to `qr_pin_png_path()` -
    /// there's only ever one "current" qr+pin (whatever the live pairing
    /// session's node id/pin happen to be right now), so this is
    /// overwritten in place rather than accumulating one file per past
    /// pin regeneration.
    static LAST_RENDERED_HASH: Cell<Option<u64>> = const { Cell::new(None) };
}

/// renders `payload`'s qr code plus `pin` as a single magenta-on-black
/// png, overwriting the one cached file (returning its path, suitable
/// for `VideoCommand::ShowImage`). the pin is baked directly into the
/// image (rather than left to ratatui text) since mpv's framebuffer
/// output and ratatui's own terminal text can't both be relied on to be
/// visible at once - see docs/rathole-headless-player-plan.md's
/// "framebuffer mode" open question. re-encodes only when `payload`/
/// `pin` actually changed since the last call (in-memory hash check),
/// so repeated renders while idle are free and the file is never
/// rewritten with identical bytes.
pub fn render_qr_pin_png(payload: &str, pin: &str) -> Result<std::path::PathBuf, String> {
    let path = qr_pin_png_path();
    let hash = content_hash(payload, pin);
    if path.exists() && LAST_RENDERED_HASH.get() == Some(hash) {
        return Ok(path);
    }

    let code = QrCode::new(payload.as_bytes()).map_err(|e| e.to_string())?;
    let qr_img: RgbImage = code
        .render::<Rgb<u8>>()
        .dark_color(MAGENTA)
        .light_color(BLACK)
        .quiet_zone(true)
        .min_dimensions(480, 480)
        .build();

    let width = qr_img.width();
    let height = qr_img.height() + PIN_BAND_HEIGHT;
    let mut canvas = RgbImage::from_pixel(width, height, BLACK);
    image::imageops::overlay(&mut canvas, &qr_img, 0, 0);
    draw_pin_digits(&mut canvas, pin, qr_img.height());

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    canvas
        .save(&path)
        .map_err(|e| format!("failed to save qr+pin png: {e}"))?;
    LAST_RENDERED_HASH.set(Some(hash));
    Ok(path)
}

fn content_hash(payload: &str, pin: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    payload.hash(&mut hasher);
    pin.hash(&mut hasher);
    hasher.finish()
}

fn qr_pin_png_path() -> std::path::PathBuf {
    image_cache_dir().join("qr-pin.png")
}

fn image_cache_dir() -> std::path::PathBuf {
    grimoire::config::get_config()
        .data_dir
        .join("rathole")
        .join("image_cache")
}

/// minimal 3x5-pixel bitmap digit font (row-major, bit 2 = leftmost
/// column), scaled up and drawn in magenta - just enough to bake a
/// 6-digit numeric pin into a raster image without pulling in a real
/// font-rendering dependency.
const DIGIT_GLYPHS: [[u8; 5]; 10] = [
    [0b111, 0b101, 0b101, 0b101, 0b111], // 0
    [0b010, 0b110, 0b010, 0b010, 0b111], // 1
    [0b111, 0b001, 0b111, 0b100, 0b111], // 2
    [0b111, 0b001, 0b111, 0b001, 0b111], // 3
    [0b101, 0b101, 0b111, 0b001, 0b001], // 4
    [0b111, 0b100, 0b111, 0b001, 0b111], // 5
    [0b111, 0b100, 0b111, 0b101, 0b111], // 6
    [0b111, 0b001, 0b001, 0b001, 0b001], // 7
    [0b111, 0b101, 0b111, 0b101, 0b111], // 8
    [0b111, 0b101, 0b111, 0b001, 0b111], // 9
];

fn draw_pin_digits(canvas: &mut RgbImage, pin: &str, band_top: u32) {
    const SCALE: u32 = 12;
    const GLYPH_W: u32 = 3 * SCALE;
    const GLYPH_H: u32 = 5 * SCALE;
    const GAP: u32 = SCALE * 2;

    let digits: Vec<usize> = pin
        .chars()
        .filter_map(|c| c.to_digit(10))
        .map(|d| d as usize)
        .collect();
    if digits.is_empty() {
        return;
    }
    let total_w = digits.len() as u32 * GLYPH_W + (digits.len() as u32 - 1) * GAP;
    let start_x = canvas.width().saturating_sub(total_w) / 2;
    let start_y = band_top + PIN_BAND_HEIGHT.saturating_sub(GLYPH_H) / 2;

    for (i, &digit) in digits.iter().enumerate() {
        let gx = start_x + i as u32 * (GLYPH_W + GAP);
        for (row, bits) in DIGIT_GLYPHS[digit].iter().enumerate() {
            for col in 0..3u32 {
                if bits & (1 << (2 - col)) == 0 {
                    continue;
                }
                let px0 = gx + col * SCALE;
                let py0 = start_y + row as u32 * SCALE;
                for dy in 0..SCALE {
                    for dx in 0..SCALE {
                        let (x, y) = (px0 + dx, py0 + dy);
                        if x < canvas.width() && y < canvas.height() {
                            canvas.put_pixel(x, y, MAGENTA);
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_non_empty_qr_for_a_pairing_payload() {
        // mirrors the shape player.freqhole.net's own pairing qr uses.
        let payload = r#"{"node_id":"abc123","name":"rathole","role":"player_remote"}"#;
        let rendered = render_qr_unicode(payload).expect("valid qr payload should render");
        assert!(!rendered.is_empty());
        assert!(rendered.lines().count() > 1);
        // sanity: should actually be block-drawing characters, not
        // plain ascii placeholder text.
        assert!(rendered
            .chars()
            .any(|c| matches!(c, '\u{2588}' | '\u{2580}' | '\u{2584}')));
    }

    #[test]
    fn never_panics_on_an_empty_payload() {
        let _ = render_qr_unicode("");
    }

    #[test]
    fn renders_qr_pin_png_to_a_real_file() {
        grimoire::config::init_config_for_tests();
        let payload = r#"{"node_id":"abc123"}"#;
        let path = render_qr_pin_png(payload, "042017").expect("should render a qr+pin png");
        assert!(path.exists(), "expected png to be written to {path:?}");
        let bytes = std::fs::read(&path).unwrap();
        assert!(bytes.starts_with(b"\x89PNG"), "expected a valid png header");
    }
}
