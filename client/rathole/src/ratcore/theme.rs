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

/// true when the media-control (⏮⏯⏭⏸) / heart (♥♡) / state (▶■…) glyphs
/// this ui prefers probably won't render, and plain ascii labels should
/// be used instead. there's no portable way to query a terminal's actual
/// font glyph coverage, so this is a best-effort heuristic, in order:
///
/// 1. `RATHOLE_GLYPHS` env var is an explicit override: `ascii` (also
///    `text`/`plain`) forces text labels, `unicode` (also `utf8`/`full`)
///    forces the fancy glyphs. use this on a terminal whose font is
///    missing them (e.g. a raspberry pi desktop terminal or an ssh
///    session into one, which still report `xterm-256color` + a utf-8
///    locale) - nothing else can detect that.
/// 2. `$TERM` of `linux` (kernel virtual console, tiny `.psf` font),
///    `dumb`, or a `vt*` terminal => ascii.
/// 3. a non-utf-8 (or unset) locale (`LC_ALL` / `LC_CTYPE` / `LANG`, first
///    one set wins) => ascii, since the terminal can't be decoding
///    multibyte glyphs anyway.
///
/// computed once (env vars don't change mid-run).
pub fn use_ascii_glyphs() -> bool {
    use std::sync::OnceLock;
    static ASCII: OnceLock<bool> = OnceLock::new();
    *ASCII.get_or_init(|| detect_ascii_glyphs(|k| std::env::var(k).ok()))
}

fn detect_ascii_glyphs(env: impl Fn(&str) -> Option<String>) -> bool {
    if let Some(v) = env("RATHOLE_GLYPHS") {
        match v.trim().to_ascii_lowercase().as_str() {
            "ascii" | "text" | "plain" => return true,
            "unicode" | "utf8" | "utf-8" | "full" => return false,
            _ => {}
        }
    }
    if let Some(term) = env("TERM") {
        let term = term.to_ascii_lowercase();
        if term == "linux" || term == "dumb" || term.starts_with("vt") {
            return true;
        }
    }
    let locale = ["LC_ALL", "LC_CTYPE", "LANG"]
        .iter()
        .find_map(|k| env(k).filter(|v| !v.is_empty()));
    match locale {
        Some(l) => {
            let l = l.to_ascii_lowercase();
            !(l.contains("utf-8") || l.contains("utf8"))
        }
        None => true,
    }
}

#[cfg(test)]
mod tests {
    use super::detect_ascii_glyphs;
    use std::collections::HashMap;

    fn detect(pairs: &[(&str, &str)]) -> bool {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        detect_ascii_glyphs(|k| map.get(k).cloned())
    }

    #[test]
    fn modern_terminal_with_utf8_locale_uses_unicode() {
        assert!(!detect(&[
            ("TERM", "xterm-256color"),
            ("LANG", "en_US.UTF-8")
        ]));
    }

    #[test]
    fn linux_console_and_dumb_terms_use_ascii() {
        assert!(detect(&[("TERM", "linux"), ("LANG", "en_US.UTF-8")]));
        assert!(detect(&[("TERM", "dumb"), ("LANG", "en_US.UTF-8")]));
        assert!(detect(&[("TERM", "vt220"), ("LANG", "en_US.UTF-8")]));
    }

    #[test]
    fn non_utf8_or_missing_locale_uses_ascii() {
        assert!(detect(&[("TERM", "xterm-256color"), ("LANG", "C")]));
        assert!(detect(&[("TERM", "xterm-256color")]));
        // LC_ALL takes precedence over LANG.
        assert!(detect(&[("LC_ALL", "C"), ("LANG", "en_US.UTF-8")]));
    }

    #[test]
    fn env_override_wins() {
        assert!(detect(&[
            ("RATHOLE_GLYPHS", "ascii"),
            ("TERM", "xterm-256color"),
            ("LANG", "en_US.UTF-8"),
        ]));
        assert!(!detect(&[("RATHOLE_GLYPHS", "unicode"), ("TERM", "linux")]));
    }
}
