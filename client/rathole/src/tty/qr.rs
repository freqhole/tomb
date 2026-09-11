//! qr code rendering for the `--player`/`/player` pairing screen.
//!
//! default rendering mode (`ImageDisplayMode::Terminal`, see
//! `grimoire::config::PlayerPairingConfig`): draws directly into the
//! ratatui frame as unicode half-block text via the `qrcode` crate's own
//! dense unicode renderer - precise 1:1 module mapping (unlike a
//! general-purpose image renderer like `ratatui-image`, which would
//! resample/blur a QR's fine module grid). the alternative "framebuffer"
//! mode renders a real png (via `qrcode`'s `image` feature, not yet
//! enabled - see Cargo.toml) and shows it through the existing mpv
//! `VideoCommand::ShowImage` path instead of this module.

use qrcode::render::unicode;
use qrcode::QrCode;

/// render `payload` as a scannable qr code using unicode half-block
/// characters, ready to drop directly into a ratatui `Paragraph`/`Text`.
pub fn render_qr_unicode(payload: &str) -> Result<String, String> {
    let code = QrCode::new(payload.as_bytes()).map_err(|e| e.to_string())?;
    Ok(code.render::<unicode::Dense1x2>().quiet_zone(true).build())
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
}
