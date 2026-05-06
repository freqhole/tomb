//! `/slash` command parser + dispatcher for the bottom repl line.
//!
//! kept ui- and shell-agnostic: parses raw input into a typed
//! [`SlashAction`], and shells decide how to execute each variant
//! (e.g. tty fires player commands directly via the rodio handle,
//! web routes through the html-audio runtime when it lands).
//!
//! the parser is permissive: leading/trailing whitespace is
//! stripped, the leading `/` is optional, names are case-insensitive,
//! and unknown commands return `SlashAction::Unknown` rather than an
//! error so the shell can render a friendly hint.

use crate::ratcore::app::Focus;

/// a typed slash command, ready for the shell to execute. arg
/// payloads are kept as borrowed strings against the original input
/// where possible to avoid extra allocations in the hot path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SlashAction {
    /// switch to the music view's search mode and (optionally) seed
    /// the query with the given text.
    Search { query: Option<String> },
    /// search and immediately play the first result. `/play metal`.
    /// when `query` is `None` and the player has a current track,
    /// resumes playback (sends `PlayerCmd::Play`).
    Play { query: Option<String> },
    Pause,
    Stop,
    Next,
    Previous,
    /// absolute seek in seconds (e.g. `/seek 90` or `/seek 1:30`).
    Seek { seconds: u64 },
    /// set volume by percent (0..=200). `/vol 80`.
    Volume { percent: u8 },
    /// switch focus to the music view (no query change).
    Music,
    /// switch focus back to the admin palette.
    Admin,
    /// quit the app.
    Quit,
    /// query a library entity (album/artist/playlist/favorites/radio).
    /// shells dispatch via [`Transport::library_query`] and pipe
    /// the result into the result-panel as if it were an admin
    /// dispatch.
    Library {
        kind: &'static str,
        query: Option<String>,
    },
    /// no-op — empty input or whitespace.
    Empty,
    /// recognised name but malformed args. `hint` describes what
    /// the user needs to type instead.
    BadArgs { name: &'static str, hint: &'static str },
    /// unknown command. `name` is what the user typed (without the
    /// leading `/`).
    Unknown { name: String },
}

/// canonical list of known slash command names + one-line help.
/// used by the repl autocompleter and the help hint line.
pub const COMMANDS: &[(&str, &str)] = &[
    ("search", "/search [query]    open music view, seed search"),
    ("play", "/play [query]      search + play first hit, or resume"),
    ("pause", "/pause             pause playback"),
    ("stop", "/stop              stop playback"),
    ("next", "/next              skip to next track"),
    ("prev", "/prev              skip to previous track"),
    ("seek", "/seek <m:ss|sec>   seek to position"),
    ("vol", "/vol <0-200>       set volume percent"),
    ("music", "/music             focus music view"),
    ("admin", "/admin             focus admin palette"),
    ("album", "/album [query]     browse albums (or search)"),
    ("artist", "/artist [query]    browse artists (or search)"),
    ("playlist", "/playlist [query]  list playlists (or search)"),
    ("favorites", "/favorites         list your favorited songs"),
    ("radio", "/radio             list radio stations"),
    ("quit", "/quit              exit rathole"),
];

/// parse a raw repl input line into a typed action.
pub fn parse(input: &str) -> SlashAction {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return SlashAction::Empty;
    }
    let body = trimmed.strip_prefix('/').unwrap_or(trimmed);
    let (name, rest) = match body.split_once(char::is_whitespace) {
        Some((n, r)) => (n, r.trim()),
        None => (body, ""),
    };
    let arg = if rest.is_empty() {
        None
    } else {
        Some(rest.to_string())
    };

    match name.to_ascii_lowercase().as_str() {
        "search" | "s" | "find" => SlashAction::Search { query: arg },
        "play" | "p" => SlashAction::Play { query: arg },
        "pause" => SlashAction::Pause,
        "stop" => SlashAction::Stop,
        "next" | "skip" | "n" => SlashAction::Next,
        "prev" | "previous" | "back" => SlashAction::Previous,
        "seek" => match arg.as_deref().map(parse_seek) {
            Some(Some(secs)) => SlashAction::Seek { seconds: secs },
            _ => SlashAction::BadArgs {
                name: "seek",
                hint: "usage: /seek <seconds | m:ss>",
            },
        },
        "vol" | "volume" | "v" => match arg.as_deref().and_then(parse_volume) {
            Some(pct) => SlashAction::Volume { percent: pct },
            None => SlashAction::BadArgs {
                name: "vol",
                hint: "usage: /vol <0-200>",
            },
        },
        "music" | "m" => SlashAction::Music,
        "admin" | "a" => SlashAction::Admin,
        "album" | "al" => SlashAction::Library { kind: "album", query: arg },
        "artist" | "ar" => SlashAction::Library { kind: "artist", query: arg },
        "playlist" | "pl" => SlashAction::Library {
            kind: "playlist",
            query: arg,
        },
        "favorites" | "favs" | "fav" => SlashAction::Library {
            kind: "favorites",
            query: None,
        },
        "radio" | "r" => SlashAction::Library {
            kind: "radio",
            query: arg,
        },
        "quit" | "exit" | "q" => SlashAction::Quit,
        other => SlashAction::Unknown {
            name: other.to_string(),
        },
    }
}

/// parse seek args: either bare seconds (`90`) or `m:ss` (`1:30`).
fn parse_seek(s: &str) -> Option<u64> {
    if let Some((m, ss)) = s.split_once(':') {
        let m: u64 = m.trim().parse().ok()?;
        let ss: u64 = ss.trim().parse().ok()?;
        if ss >= 60 {
            return None;
        }
        return Some(m * 60 + ss);
    }
    s.trim().parse().ok()
}

/// parse a volume percent (0..=200), tolerating a trailing `%`.
fn parse_volume(s: &str) -> Option<u8> {
    let s = s.trim().trim_end_matches('%').trim();
    let pct: u32 = s.parse().ok()?;
    if pct > 200 {
        return None;
    }
    Some(pct as u8)
}

/// best-match autocompletion for a partial command name. returns
/// the canonical command names that have `partial` as a prefix
/// (case-insensitive). `partial` may include the leading `/`.
pub fn complete(partial: &str) -> Vec<&'static str> {
    let p = partial.trim().trim_start_matches('/').to_ascii_lowercase();
    if p.is_empty() {
        return COMMANDS.iter().map(|(n, _)| *n).collect();
    }
    COMMANDS
        .iter()
        .filter_map(|(n, _)| if n.starts_with(&p) { Some(*n) } else { None })
        .collect()
}

/// which top-level focus a slash action implies, if any. shells use
/// this when an action transitions between views.
pub fn focus_for(action: &SlashAction) -> Option<Focus> {
    match action {
        SlashAction::Search { .. } | SlashAction::Music => Some(Focus::MusicView),
        SlashAction::Admin => Some(Focus::AdminPalette),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_play_with_query() {
        assert_eq!(
            parse("/play smooth jams"),
            SlashAction::Play {
                query: Some("smooth jams".into())
            }
        );
    }

    #[test]
    fn parses_play_bare() {
        assert_eq!(parse("/play"), SlashAction::Play { query: None });
    }

    #[test]
    fn parses_seek_seconds() {
        assert_eq!(parse("/seek 90"), SlashAction::Seek { seconds: 90 });
    }

    #[test]
    fn parses_seek_mmss() {
        assert_eq!(parse("/seek 1:30"), SlashAction::Seek { seconds: 90 });
    }

    #[test]
    fn rejects_bad_seek() {
        assert!(matches!(parse("/seek nope"), SlashAction::BadArgs { .. }));
    }

    #[test]
    fn parses_volume() {
        assert_eq!(parse("/vol 80%"), SlashAction::Volume { percent: 80 });
    }

    #[test]
    fn empty_is_empty() {
        assert_eq!(parse("   "), SlashAction::Empty);
    }

    #[test]
    fn unknown_preserves_name() {
        assert_eq!(
            parse("/whatever"),
            SlashAction::Unknown {
                name: "whatever".into()
            }
        );
    }

    #[test]
    fn complete_prefix() {
        assert!(complete("/p").contains(&"play"));
        assert!(complete("/p").contains(&"pause"));
        assert!(complete("/p").contains(&"prev"));
    }
}
