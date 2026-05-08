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

/// arg to [`SlashAction::ServeStart`]: which subcommand the shell
/// should launch the freqhole binary with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServeKindArg {
    /// `freqhole serve` — starts http + p2p per config
    Auto,
    /// `freqhole http` — http only
    Http,
    /// `freqhole p2p` — p2p only
    P2p,
}

/// a typed slash command, ready for the shell to execute. arg
/// payloads are kept as borrowed strings against the original input
/// where possible to avoid extra allocations in the hot path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SlashAction {
    /// switch to the music view's search mode and (optionally) seed
    /// the query with the given text.
    Search {
        query: Option<String>,
    },
    /// search and immediately play the first result. `/play metal`.
    /// when `query` is `None` and the player has a current track,
    /// resumes playback (sends `PlayerCmd::Play`).
    Play {
        query: Option<String>,
    },
    Pause,
    Stop,
    Next,
    Previous,
    /// absolute seek in seconds (e.g. `/seek 90` or `/seek 1:30`).
    Seek {
        seconds: u64,
    },
    /// set volume by percent (0..=200). `/vol 80`.
    Volume {
        percent: u8,
    },
    /// switch focus to the music view (no query change).
    Music,
    /// list locally-downloaded songs in the music view (recent first).
    Local,
    /// switch focus to the admin palette and reveal the commands
    /// list. dispatched via `/admin` (or aliases `/commands`,
    /// `/cmds`, `/c`).
    Admin,
    /// open the result panel showing the current playback queue.
    Queue,
    /// open the modal for connecting to (and saving) a new remote
    /// peer. dispatched via `/remote` (singular).
    AddRemote,
    /// list all saved remotes in the result panel. dispatched via
    /// `/remotes` (plural). note: `/r` is already taken by `/radio`.
    ListRemotes,
    /// quit the app.
    Quit,
    /// list every known slash command in the result panel — useful
    /// when users want to discover the full repl vocabulary (the
    /// admin palette only shows admin RPC commands, not slash
    /// commands). dispatched via `/help` or `/?`.
    Help,
    /// clear the playback queue (stops playback and forgets the
    /// queue rows). dispatched via `/clear` or `/cq`.
    ClearQueue,
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
    /// start the local serve subprocess (auto / http / p2p).
    /// shells route to their own subprocess monitor.
    ServeStart {
        kind: ServeKindArg,
    },
    /// stop a running serve subprocess.
    ServeStop,
    /// dump local server config + p2p identity + paths into the
    /// result panel. like `server_info` but with extra context that
    /// only the local process knows (node_id, config path, etc.).
    Info,
    /// copy the spume invite link (https://spume.freqhole.net/?r={node_id})
    /// to the system clipboard.
    CopyInvite,
    /// open the spume invite link in the system default browser.
    OpenInvite,
    /// dump the most recent log lines (from the in-memory ring
    /// buffer installed at log-init) into the result panel.
    Logs,
    /// recognised name but malformed args. `hint` describes what
    /// the user needs to type instead.
    BadArgs {
        name: &'static str,
        hint: &'static str,
    },
    /// unknown command. `name` is what the user typed (without the
    /// leading `/`).
    Unknown {
        name: String,
    },
}

/// canonical list of known slash command names + one-line help.
/// used by the repl autocompleter and the help hint line.
pub const COMMANDS: &[(&str, &str)] = &[
    ("search", "/search [query]    open music view, seed search"),
    (
        "play",
        "/play [query]      search + play first hit, or resume",
    ),
    ("pause", "/pause             pause playback"),
    ("stop", "/stop              stop playback"),
    ("next", "/next              skip to next track"),
    ("prev", "/prev              skip to previous track"),
    ("seek", "/seek <m:ss|sec>   seek to position"),
    ("vol", "/vol <0-200>       set volume percent"),
    ("music", "/music             focus music view"),
    ("local", "/local             list local downloaded songs"),
    ("admin", "/admin             browse all admin commands"),
    ("queue", "/queue             show current playback queue"),
    ("remote", "/remote            connect to a new remote peer"),
    ("remotes", "/remotes           list saved remotes"),
    ("album", "/album [query]     browse albums (or search)"),
    ("artist", "/artist [query]    browse artists (or search)"),
    ("playlist", "/playlist [query]  list playlists (or search)"),
    ("favorites", "/favorites         list your favorited songs"),
    ("radio", "/radio             list radio stations"),
    ("help", "/help              list every slash command"),
    ("clear", "/clear             clear the playback queue"),
    ("serve", "/serve             start http + p2p subprocess"),
    ("http", "/http              start http-only subprocess"),
    ("p2p", "/p2p               start p2p-only subprocess"),
    (
        "serve-stop",
        "/serve-stop        stop the running serve subprocess",
    ),
    (
        "info",
        "/info              show server config + p2p node id + paths",
    ),
    (
        "copy-invite",
        "/copy-invite       copy spume invite link to clipboard",
    ),
    (
        "open-invite",
        "/open-invite       open spume invite link in browser",
    ),
    (
        "log",
        "/log               show recent log lines (in-memory ring buffer)",
    ),
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
        "local" | "l" | "library" | "lib" => SlashAction::Local,
        "admin" | "a" | "commands" | "cmds" | "c" => SlashAction::Admin,
        "queue" | "q!" => SlashAction::Queue,
        "remote" | "connect" => SlashAction::AddRemote,
        "remotes" => SlashAction::ListRemotes,
        "album" | "al" => SlashAction::Library {
            kind: "album",
            query: arg,
        },
        "artist" | "ar" => SlashAction::Library {
            kind: "artist",
            query: arg,
        },
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
        "help" | "?" | "h" => SlashAction::Help,
        "clear" | "cq" | "clearqueue" => SlashAction::ClearQueue,
        "serve" => SlashAction::ServeStart {
            kind: ServeKindArg::Auto,
        },
        "http" | "serve-http" => SlashAction::ServeStart {
            kind: ServeKindArg::Http,
        },
        "p2p" | "serve-p2p" => SlashAction::ServeStart {
            kind: ServeKindArg::P2p,
        },
        "serve-stop" | "servestop" | "stop-serve" => SlashAction::ServeStop,
        "info" => SlashAction::Info,
        "copy-invite" | "copyinvite" | "invite-copy" => SlashAction::CopyInvite,
        "open-invite" | "openinvite" | "invite-open" | "invite" => SlashAction::OpenInvite,
        "log" => SlashAction::Logs,
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
        SlashAction::Search { .. } | SlashAction::Music | SlashAction::Local => {
            Some(Focus::MusicView)
        }
        SlashAction::Admin => Some(Focus::AdminPalette),
        _ => None,
    }
}

/// scan a `radio_stations_list` payload for the station whose name
/// best matches `query`. tries: case-insensitive equality, then
/// startswith, then substring. returns the station id if found.
/// the payload may be either a raw `Vec<RadioStation>` (tty) or
/// wrapped in `{ items: [...] }` (web).
pub fn match_station_id(data: &Option<serde_json::Value>, query: Option<&str>) -> Option<String> {
    let q = query?.trim().to_lowercase();
    if q.is_empty() {
        return None;
    }
    let raw = data.as_ref()?;
    let arr = raw
        .as_array()
        .or_else(|| raw.get("items").and_then(|v| v.as_array()))
        .or_else(|| raw.get("stations").and_then(|v| v.as_array()))?;

    let mut exact: Option<String> = None;
    let mut prefix: Option<String> = None;
    let mut contains: Option<String> = None;
    for s in arr {
        let id = s.get("id").and_then(|v| v.as_str()).map(|s| s.to_string());
        let name = s
            .get("name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_lowercase());
        let (Some(id), Some(name)) = (id, name) else {
            continue;
        };
        if name == q && exact.is_none() {
            exact = Some(id.clone());
        }
        if name.starts_with(&q) && prefix.is_none() {
            prefix = Some(id.clone());
        }
        if name.contains(&q) && contains.is_none() {
            contains = Some(id);
        }
    }
    exact.or(prefix).or(contains)
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

    #[test]
    fn match_station_prefers_exact() {
        let data = serde_json::json!([
            { "id": "s1", "name": "Smooth Jams" },
            { "id": "s2", "name": "Smooth Jazz" },
        ]);
        assert_eq!(
            match_station_id(&Some(data), Some("Smooth Jams")).as_deref(),
            Some("s1")
        );
    }

    #[test]
    fn match_station_falls_back_to_substring() {
        let data = serde_json::json!({
            "items": [
                { "id": "x", "name": "Late Night Lo-Fi" },
                { "id": "y", "name": "Morning Jazz" },
            ]
        });
        assert_eq!(
            match_station_id(&Some(data), Some("jazz")).as_deref(),
            Some("y")
        );
    }

    #[test]
    fn match_station_returns_none_for_no_match() {
        let data = serde_json::json!([{ "id": "x", "name": "Smooth Jams" }]);
        assert!(match_station_id(&Some(data), Some("metal")).is_none());
    }
}
