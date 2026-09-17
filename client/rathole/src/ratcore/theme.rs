//! shared visual theme constants.
//!
//! one knob to twist when we want to recolor the accent everywhere.

use ratatui::style::Color;

/// hot pink / magenta. used for titles, prompts, and emphasis.
pub const ACCENT: Color = Color::Rgb(255, 64, 156);

/// soft sky blue - a secondary accent for text that should read as
/// related-but-subordinate to `ACCENT` (e.g. artist/album lines under
/// a now-playing title), rather than plain dim gray.
pub const ACCENT_SECONDARY: Color = Color::Rgb(120, 200, 255);

/// true when the current terminal likely lacks the media-control
/// (⏮⏯⏭⏸) and heart (♥♡) glyphs this ui prefers, and plain ascii
/// labels should be used instead. there's no portable way to query a
/// terminal's actual font glyph coverage, so this uses `$TERM ==
/// "linux"` as a heuristic: that's the value the linux kernel's own
/// bare virtual console (fbcon/vgacon - no X/wayland) always reports,
/// which renders via a `.psf` console font with a tiny, fixed glyph
/// set (see `player_pairing.rs`'s `PIN_SIZE_CANDIDATES` doc comment
/// for the same font-coverage fight on the qr/big-text side). real
/// terminal emulators (xterm-256color, alacritty, tmux-256color,
/// ghostty, wezterm, etc.) report something else and almost
/// universally have a modern font with full unicode fallback, so this
/// only trips for the bare-console case. computed once (env vars
/// don't change mid-run).
pub fn use_ascii_glyphs() -> bool {
    use std::sync::OnceLock;
    static ASCII: OnceLock<bool> = OnceLock::new();
    *ASCII.get_or_init(|| std::env::var("TERM").map(|t| t == "linux").unwrap_or(false))
}
