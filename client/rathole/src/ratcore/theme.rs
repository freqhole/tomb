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
