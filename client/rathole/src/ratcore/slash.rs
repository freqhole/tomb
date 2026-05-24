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

/// arg to [`SlashAction::Autostart`]: which combination of serve
/// modes rathole should autostart on next launch. mirrors the
/// `server.enabled` / `federation.enabled` flags in the config file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutostartMode {
    /// no args — just show the current setting in the repl status.
    Show,
    /// neither http nor p2p autostarts on next launch.
    Off,
    /// http only.
    Http,
    /// p2p only.
    P2p,
    /// both http + p2p.
    Both,
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
    /// view or update the autostart config (`server.enabled` /
    /// `federation.enabled`). only changes the persisted config —
    /// takes effect on the next rathole launch. use `/serve-stop`
    /// to stop the currently-running serve subprocess.
    Autostart {
        mode: AutostartMode,
    },
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
    /// generic admin-rpc dispatch produced by the slash group
    /// commands (`/knock`, `/users`, `/analytics`, `/radio` subs).
    /// shells route this through their existing `admin_dispatch`
    /// path so the result lands in the result panel like any other
    /// admin call.
    AdminDispatch {
        name: &'static str,
        body: serde_json::Value,
    },
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
///
/// commands are roughly grouped:
///   - playback bare verbs (`/play`, `/pause`, `/seek`, `/vol`, ...)
///   - top-level views (`/music`, `/admin`, `/queue`, ...)
///   - subcommand groups (`/library <kind>`, `/serve <sub>`, `/queue <sub>`)
///   - housekeeping (`/help`, `/info`, `/log`, `/quit`)
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
    (
        "fetch",
        "/fetch <url>       queue a yt-dlp fetch job (download + import)",
    ),
    ("queue", "/queue [sub]       show queue (sub: clear)"),
    ("remote", "/remote            connect to a new remote peer"),
    ("remotes", "/remotes           list saved remotes"),
    (
        "library",
        "/library <kind>    album|artist|playlist|favorites|radio",
    ),
    ("album", "/album [query]     browse albums (or search)"),
    ("artist", "/artist [query]    browse artists (or search)"),
    ("playlist", "/playlist [query]  list playlists (or search)"),
    ("favorites", "/favorites         list your favorited songs"),
    ("radio", "/radio             list radio stations"),
    ("help", "/help              list every slash command"),
    ("clear", "/clear             clear the playback queue"),
    (
        "serve",
        "/serve [sub]       start subprocess (sub: http|p2p|stop)",
    ),
    ("http", "/http              start http-only subprocess"),
    ("p2p", "/p2p               start p2p-only subprocess"),
    (
        "serve-stop",
        "/serve-stop        stop the running serve subprocess",
    ),
    (
        "autostart",
        "/autostart [sub]   show/set autostart (sub: off|http|p2p|auto|both)",
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
    (
        "knock",
        "/knock [sub]       knocks (sub: list|accept|reject|reject-all|delete)",
    ),
    (
        "users",
        "/users [sub]       users (sub: list|grant|revoke|delete)",
    ),
    (
        "analytics",
        "/analytics [sub]   analytics (sub: top-songs|top-artists|listens|summary)",
    ),
    (
        "jobs",
        "/jobs [sub]        jobs (sub: list|stats|session <id>)",
    ),
    (
        "genre",
        "/genre [sub]       genres (sub: list|stats|songs <id>|add|remove)",
    ),
    (
        "tag",
        "/tag [sub]         album tags (sub: list|search|add|remove|of <album_id>)",
    ),
    (
        "maintenance",
        "/maintenance [sub] maintenance (sub: cleanup-*|backfill-*|hard-delete|run-full|update-*)",
    ),
    ("quit", "/quit              exit rathole"),
];

/// known subcommands per command group, used by `complete_sub` for
/// tab-completion of `/group <sub>` partials. order is the order
/// shown in the flyout / help.
pub const GROUPS: &[(&str, &[(&str, &str)])] = &[
    (
        "library",
        &[
            ("album", "browse albums"),
            ("artist", "browse artists"),
            ("playlist", "list playlists"),
            ("favorites", "list favorited songs"),
            ("radio", "list radio stations"),
        ],
    ),
    (
        "serve",
        &[
            ("http", "start http-only subprocess"),
            ("p2p", "start p2p-only subprocess"),
            ("stop", "stop the running subprocess"),
        ],
    ),
    ("queue", &[("clear", "clear the playback queue")]),
    (
        "knock",
        &[
            ("list", "list pending knocks"),
            ("accept", "accept a knock by id"),
            ("reject", "reject a knock by id"),
            ("reject-all", "reject every pending knock"),
            ("delete", "delete a knock by id"),
        ],
    ),
    (
        "users",
        &[
            ("list", "list users"),
            ("grant", "grant role: /users grant <id> <role>"),
            ("revoke", "revoke admin: /users revoke <id>"),
            ("delete", "soft-delete a user by id"),
        ],
    ),
    (
        "analytics",
        &[
            ("top-songs", "top played songs"),
            ("top-artists", "top played artists"),
            ("top-albums", "top played albums"),
            ("listens", "per-user listen stats"),
            ("summary", "top songs summary"),
        ],
    ),
    (
        "radio",
        &[
            ("list", "list radio stations"),
            ("start", "start station: /radio start <id>"),
            ("stop", "stop station: /radio stop <id>"),
            ("tune", "tune by name: /radio tune <name>"),
        ],
    ),
    (
        "jobs",
        &[
            ("list", "list recent jobs"),
            ("stats", "queue stats (counts per status)"),
            ("session", "list jobs in a session: /jobs session <id>"),
        ],
    ),
    (
        "genre",
        &[
            ("list", "list all genres"),
            ("stats", "genre stats (song/album counts)"),
            ("songs", "songs in a genre: /genre songs <genre_id>"),
            (
                "add",
                "link genre to album: /genre add <album_id> <genre_id>",
            ),
            (
                "remove",
                "unlink genre: /genre remove <album_id> <genre_id>",
            ),
            ("create", "create a genre: /genre create <name>"),
            ("delete", "delete a genre: /genre delete <genre_id>"),
        ],
    ),
    (
        "tag",
        &[
            ("list", "list all album tags"),
            ("search", "search tags: /tag search <name>"),
            ("of", "tags on an album: /tag of <album_id>"),
            ("add", "add tag to album: /tag add <album_id> <tag_name>"),
            ("remove", "remove tag: /tag remove <album_id> <tag_id>"),
            ("create", "create a tag: /tag create <name>"),
            ("delete", "delete a tag: /tag delete <tag_id>"),
        ],
    ),
    (
        "maintenance",
        &[
            ("cleanup-tags", "delete orphaned tags [dry-run]"),
            ("cleanup-genres", "delete orphaned genres [dry-run]"),
            (
                "cleanup-blobs",
                "hard-delete orphaned media blobs [min-age-days]",
            ),
            ("cleanup-all", "cleanup-tags + cleanup-genres [dry-run]"),
            ("backfill-blake3", "hash missing blake3 [batch_size]"),
            ("backfill-thumbs", "backfill thumbnails [limit] [dry-run]"),
            (
                "hard-delete",
                "hard-delete old soft-deleted [retention_days] [dry-run]",
            ),
            (
                "run-full",
                "full maintenance pipeline [retention_days] [dry-run]",
            ),
            ("update-image", "refresh server image blob from config"),
            ("update-spume", "extract embedded spume to static dir"),
        ],
    ),
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
        "local" | "l" => SlashAction::Local,
        "fetch" | "dl" | "download" | "yt" => match arg.as_deref().map(str::trim) {
            Some(url) if !url.is_empty() => SlashAction::AdminDispatch {
                name: "library_fetch",
                body: serde_json::json!({ "url": url }),
            },
            _ => SlashAction::BadArgs {
                name: "fetch",
                hint: "usage: /fetch <url> (yt-dlp — youtube, soundcloud, bandcamp, …)",
            },
        },
        // /admin is an alias for /help — both surface the slash
        // command list in the result panel.
        "admin" | "a" | "commands" | "cmds" | "c" => SlashAction::Help,
        "queue" | "q!" => match arg
            .as_deref()
            .map(|s| s.split_whitespace().next().unwrap_or(""))
        {
            None | Some("") => SlashAction::Queue,
            Some("clear") => SlashAction::ClearQueue,
            Some(_) => SlashAction::BadArgs {
                name: "queue",
                hint: "usage: /queue [clear]",
            },
        },
        "remote" | "connect" => SlashAction::AddRemote,
        "remotes" => SlashAction::ListRemotes,
        "library" | "lib" => parse_library_sub(arg.as_deref()),
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
        "radio" | "r" => parse_radio_sub(arg.as_deref()),
        "knock" | "knocks" => parse_knock_sub(arg.as_deref()),
        "users" | "user" => parse_users_sub(arg.as_deref()),
        "analytics" | "stats" => parse_analytics_sub(arg.as_deref()),
        "jobs" | "j" => parse_jobs_sub(arg.as_deref()),
        "genre" | "genres" | "g" => parse_genre_sub(arg.as_deref()),
        "tag" | "tags" | "t" => parse_tag_sub(arg.as_deref()),
        "maintenance" | "maint" => parse_maintenance_sub(arg.as_deref()),
        "quit" | "exit" | "q" => SlashAction::Quit,
        "help" | "?" | "h" => SlashAction::Help,
        "clear" | "cq" | "clearqueue" => SlashAction::ClearQueue,
        "serve" => parse_serve_sub(arg.as_deref()),
        "http" | "serve-http" => SlashAction::ServeStart {
            kind: ServeKindArg::Http,
        },
        "p2p" | "serve-p2p" => SlashAction::ServeStart {
            kind: ServeKindArg::P2p,
        },
        "serve-stop" | "servestop" | "stop-serve" => SlashAction::ServeStop,
        "autostart" => parse_autostart_sub(arg.as_deref()),
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

/// parse `/autostart [off|http|p2p|auto|both]` - bare resolves to Show.
fn parse_autostart_sub(arg: Option<&str>) -> SlashAction {
    let sub = arg.and_then(|s| s.split_whitespace().next()).unwrap_or("");
    match sub.to_ascii_lowercase().as_str() {
        "" | "show" | "status" => SlashAction::Autostart {
            mode: AutostartMode::Show,
        },
        "off" | "none" | "disable" | "disabled" | "false" => SlashAction::Autostart {
            mode: AutostartMode::Off,
        },
        "http" => SlashAction::Autostart {
            mode: AutostartMode::Http,
        },
        "p2p" => SlashAction::Autostart {
            mode: AutostartMode::P2p,
        },
        "auto" | "both" | "all" | "on" | "true" => SlashAction::Autostart {
            mode: AutostartMode::Both,
        },
        _ => SlashAction::BadArgs {
            name: "autostart",
            hint: "usage: /autostart [show|off|http|p2p|auto|both]",
        },
    }
}

/// parse `/serve [http|p2p|stop]` - bare resolves to Auto.
fn parse_serve_sub(arg: Option<&str>) -> SlashAction {
    let sub = arg.and_then(|s| s.split_whitespace().next()).unwrap_or("");
    match sub.to_ascii_lowercase().as_str() {
        "" | "auto" => SlashAction::ServeStart {
            kind: ServeKindArg::Auto,
        },
        "http" => SlashAction::ServeStart {
            kind: ServeKindArg::Http,
        },
        "p2p" => SlashAction::ServeStart {
            kind: ServeKindArg::P2p,
        },
        "stop" => SlashAction::ServeStop,
        _ => SlashAction::BadArgs {
            name: "serve",
            hint: "usage: /serve [http|p2p|stop]",
        },
    }
}

/// parse `/library <kind> [query]` - kind is required.
fn parse_library_sub(arg: Option<&str>) -> SlashAction {
    let raw = arg.unwrap_or("").trim();
    if raw.is_empty() {
        return SlashAction::BadArgs {
            name: "library",
            hint: "usage: /library <album|artist|playlist|favorites|radio> [query]",
        };
    }
    let (sub, rest) = match raw.split_once(char::is_whitespace) {
        Some((s, r)) => (s, r.trim()),
        None => (raw, ""),
    };
    let query = if rest.is_empty() {
        None
    } else {
        Some(rest.to_string())
    };
    match sub.to_ascii_lowercase().as_str() {
        "album" | "albums" => SlashAction::Library {
            kind: "album",
            query,
        },
        "artist" | "artists" => SlashAction::Library {
            kind: "artist",
            query,
        },
        "playlist" | "playlists" => SlashAction::Library {
            kind: "playlist",
            query,
        },
        "favorites" | "favs" | "fav" => SlashAction::Library {
            kind: "favorites",
            query: None,
        },
        "radio" | "stations" => SlashAction::Library {
            kind: "radio",
            query,
        },
        _ => SlashAction::BadArgs {
            name: "library",
            hint: "usage: /library <album|artist|playlist|favorites|radio> [query]",
        },
    }
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

/// split `<sub> <rest...>` from a raw arg, tolerating empty input.
fn split_sub(arg: Option<&str>) -> (String, String) {
    let raw = arg.unwrap_or("").trim();
    if raw.is_empty() {
        return (String::new(), String::new());
    }
    match raw.split_once(char::is_whitespace) {
        Some((s, r)) => (s.to_ascii_lowercase(), r.trim().to_string()),
        None => (raw.to_ascii_lowercase(), String::new()),
    }
}

/// parse `/knock [list|accept|reject|reject-all|delete] [id]`.
/// bare `/knock` and `/knock list` both list pending knocks.
/// accept defaults to role=user (operators can use the form for
/// finer control).
fn parse_knock_sub(arg: Option<&str>) -> SlashAction {
    let (sub, rest) = split_sub(arg);
    let id = rest.trim();
    match sub.as_str() {
        "" | "list" => SlashAction::AdminDispatch {
            name: "knocks_list",
            body: serde_json::json!({}),
        },
        "accept" if !id.is_empty() => SlashAction::AdminDispatch {
            name: "knocks_accept",
            body: serde_json::json!({ "knock_id": id, "role": "User" }),
        },
        "reject" if !id.is_empty() => SlashAction::AdminDispatch {
            name: "knocks_reject",
            body: serde_json::json!({ "knock_id": id }),
        },
        "reject-all" | "rejectall" => SlashAction::AdminDispatch {
            name: "knocks_reject_all",
            body: serde_json::json!({}),
        },
        "delete" if !id.is_empty() => SlashAction::AdminDispatch {
            name: "knocks_delete",
            body: serde_json::json!({ "knock_id": id }),
        },
        _ => SlashAction::BadArgs {
            name: "knock",
            hint: "usage: /knock [list|accept <id>|reject <id>|reject-all|delete <id>]",
        },
    }
}

/// parse `/users [list|grant <id> <role>|revoke <id>|delete <id>]`.
/// bare `/users` lists. revoke downgrades to the `User` role.
fn parse_users_sub(arg: Option<&str>) -> SlashAction {
    let (sub, rest) = split_sub(arg);
    let mut tokens = rest.split_whitespace();
    let first = tokens.next().unwrap_or("").trim();
    let second = tokens.next().unwrap_or("").trim();
    match sub.as_str() {
        "" | "list" => SlashAction::AdminDispatch {
            name: "users_list",
            body: serde_json::json!({}),
        },
        "grant" if !first.is_empty() && !second.is_empty() => SlashAction::AdminDispatch {
            name: "users_update_role",
            body: serde_json::json!({ "user_id": first, "role": second }),
        },
        "revoke" if !first.is_empty() => SlashAction::AdminDispatch {
            name: "users_update_role",
            body: serde_json::json!({ "user_id": first, "role": "User" }),
        },
        "delete" if !first.is_empty() => SlashAction::AdminDispatch {
            name: "users_delete",
            body: serde_json::json!({ "user_id": first }),
        },
        _ => SlashAction::BadArgs {
            name: "users",
            hint: "usage: /users [list|grant <id> <role>|revoke <id>|delete <id>]",
        },
    }
}

/// parse `/analytics [top-songs|top-artists|top-albums|listens|summary]`.
/// bare maps to `summary` (top songs). subs map to the matching
/// `analytics_*` admin RPC. limit defaults to 20.
fn parse_analytics_sub(arg: Option<&str>) -> SlashAction {
    let (sub, _rest) = split_sub(arg);
    let body = serde_json::json!({ "limit": 20 });
    match sub.as_str() {
        "" | "summary" | "top-songs" | "topsongs" | "songs" => SlashAction::AdminDispatch {
            name: "analytics_top_songs",
            body,
        },
        "top-artists" | "topartists" | "artists" => SlashAction::AdminDispatch {
            name: "analytics_top_artists",
            body,
        },
        "top-albums" | "topalbums" | "albums" => SlashAction::AdminDispatch {
            name: "analytics_top_albums",
            body,
        },
        "listens" | "users" | "user-stats" => SlashAction::AdminDispatch {
            name: "analytics_all_user_stats",
            body: serde_json::json!({}),
        },
        _ => SlashAction::BadArgs {
            name: "analytics",
            hint: "usage: /analytics [top-songs|top-artists|top-albums|listens|summary]",
        },
    }
}

/// parse `/jobs [list|stats|session <id>]`. bare and `list` list
/// recent jobs across all sessions. `stats` shows queue-wide
/// counters. `session <id>` filters to one session.
fn parse_jobs_sub(arg: Option<&str>) -> SlashAction {
    let (sub, rest) = split_sub(arg);
    let id = rest.trim();
    match sub.as_str() {
        "" | "list" | "ls" => SlashAction::AdminDispatch {
            name: "jobs_list",
            body: serde_json::json!({}),
        },
        "stats" | "queue" => SlashAction::AdminDispatch {
            name: "jobs_stats",
            body: serde_json::json!({}),
        },
        "session" | "for" if !id.is_empty() => SlashAction::AdminDispatch {
            name: "jobs_list",
            body: serde_json::json!({ "session_id": id }),
        },
        _ => SlashAction::BadArgs {
            name: "jobs",
            hint: "usage: /jobs [list|stats|session <id>]",
        },
    }
}

/// parse `/genre [list|stats|songs <id>|create <name>|delete <id>|add <album_id> <genre_id>|remove <album_id> <genre_id>]`.
/// bare and `list` show all genres.
fn parse_genre_sub(arg: Option<&str>) -> SlashAction {
    let (sub, rest) = split_sub(arg);
    let mut tokens = rest.split_whitespace();
    let first = tokens.next().unwrap_or("").trim();
    let second_and_rest = rest
        .trim_start()
        .strip_prefix(first)
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let second = tokens.next().unwrap_or("").trim();
    match sub.as_str() {
        "" | "list" | "ls" => SlashAction::AdminDispatch {
            name: "genres_list_with_stats",
            body: serde_json::json!({}),
        },
        "stats" => SlashAction::AdminDispatch {
            name: "genres_stats",
            body: serde_json::json!({}),
        },
        "songs" if !first.is_empty() => SlashAction::AdminDispatch {
            name: "genres_songs",
            body: serde_json::json!({ "genre_id": first }),
        },
        "get" if !first.is_empty() => SlashAction::AdminDispatch {
            name: "genres_get",
            body: serde_json::json!({ "genre_id": first }),
        },
        "create" | "new" if !second_and_rest.is_empty() => SlashAction::AdminDispatch {
            name: "genres_create",
            body: serde_json::json!({ "name": format!("{first} {second_and_rest}").trim().to_string() }),
        },
        "delete" | "rm" if !first.is_empty() => SlashAction::AdminDispatch {
            name: "genres_delete",
            body: serde_json::json!({ "genre_id": first }),
        },
        "add" if !first.is_empty() && !second.is_empty() => SlashAction::AdminDispatch {
            name: "genres_add_to_album",
            body: serde_json::json!({ "album_id": first, "genre_id": second }),
        },
        "remove" | "unlink" if !first.is_empty() && !second.is_empty() => {
            SlashAction::AdminDispatch {
                name: "genres_remove_from_album",
                body: serde_json::json!({ "album_id": first, "genre_id": second }),
            }
        }
        "of" | "for" if !first.is_empty() => SlashAction::AdminDispatch {
            name: "genres_album_genres",
            body: serde_json::json!({ "album_id": first }),
        },
        _ => SlashAction::BadArgs {
            name: "genre",
            hint: "usage: /genre [list|stats|songs <id>|of <album_id>|add <album_id> <genre_id>|remove <album_id> <genre_id>|create <name>|delete <id>]",
        },
    }
}

/// parse `/tag [list|search <q>|of <album_id>|add <album_id> <name>|remove <album_id> <tag_id>|create <name>|delete <id>]`.
fn parse_tag_sub(arg: Option<&str>) -> SlashAction {
    let (sub, rest) = split_sub(arg);
    let mut tokens = rest.split_whitespace();
    let first = tokens.next().unwrap_or("").trim();
    let second_and_rest = rest
        .trim_start()
        .strip_prefix(first)
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let second = tokens.next().unwrap_or("").trim();
    match sub.as_str() {
        "" | "list" | "ls" => SlashAction::AdminDispatch {
            name: "tags_list",
            body: serde_json::json!({}),
        },
        "search" | "find" | "q" if !first.is_empty() => SlashAction::AdminDispatch {
            name: "tags_query",
            body: serde_json::json!({ "search": format!("{first} {second_and_rest}").trim().to_string() }),
        },
        "get" if !first.is_empty() => SlashAction::AdminDispatch {
            name: "tags_get",
            body: serde_json::json!({ "tag_id": first }),
        },
        "of" | "for" if !first.is_empty() => SlashAction::AdminDispatch {
            name: "tags_album_tags",
            body: serde_json::json!({ "album_id": first }),
        },
        "add" if !first.is_empty() && !second.is_empty() => SlashAction::AdminDispatch {
            name: "tags_add_to_album",
            body: serde_json::json!({ "album_id": first, "tag_name": format!("{second} {}", tokens.collect::<Vec<_>>().join(" ")).trim().to_string() }),
        },
        "remove" | "unlink" if !first.is_empty() && !second.is_empty() => {
            SlashAction::AdminDispatch {
                name: "tags_remove_from_album",
                body: serde_json::json!({ "album_id": first, "tag_id": second }),
            }
        }
        "create" | "new" if !first.is_empty() => SlashAction::AdminDispatch {
            name: "tags_create",
            body: serde_json::json!({ "name": format!("{first} {second_and_rest}").trim().to_string() }),
        },
        "delete" | "rm" if !first.is_empty() => SlashAction::AdminDispatch {
            name: "tags_delete",
            body: serde_json::json!({ "tag_id": first }),
        },
        _ => SlashAction::BadArgs {
            name: "tag",
            hint: "usage: /tag [list|search <q>|of <album_id>|add <album_id> <name>|remove <album_id> <tag_id>|create <name>|delete <id>]",
        },
    }
}

/// parse `/radio [list|start <id>|stop <id>|tune <name>]`. bare and
/// `list` list stations. unknown subs fall back to legacy
/// fuzzy-match-and-tune so `/radio mellow` still works.
fn parse_radio_sub(arg: Option<&str>) -> SlashAction {
    let raw = arg.unwrap_or("").trim();
    if raw.is_empty() {
        return SlashAction::Library {
            kind: "radio",
            query: None,
        };
    }
    let (sub, rest) = match raw.split_once(char::is_whitespace) {
        Some((s, r)) => (s.to_ascii_lowercase(), r.trim().to_string()),
        None => (raw.to_ascii_lowercase(), String::new()),
    };
    let id = rest.trim();
    match sub.as_str() {
        "list" => SlashAction::Library {
            kind: "radio",
            query: None,
        },
        "start" | "play" if !id.is_empty() => SlashAction::AdminDispatch {
            name: "radio_supervisor_start",
            body: serde_json::json!({ "station_id": id }),
        },
        "stop" if !id.is_empty() => SlashAction::AdminDispatch {
            name: "radio_supervisor_stop",
            body: serde_json::json!({ "station_id": id }),
        },
        "tune" if !id.is_empty() => SlashAction::Library {
            kind: "radio",
            query: Some(id.to_string()),
        },
        // start/stop/tune without an id is a usage error.
        "start" | "stop" | "play" | "tune" => SlashAction::BadArgs {
            name: "radio",
            hint: "usage: /radio [list|start <id>|stop <id>|tune <name>]",
        },
        // unknown sub - legacy fuzzy-match-and-tune.
        _ => SlashAction::Library {
            kind: "radio",
            query: Some(raw.to_string()),
        },
    }
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

/// best-match autocompletion for a `/group <sub>` partial. returns
/// the matching subcommand names from the [`GROUPS`] table for the
/// given `group`, filtered by `sub_partial` prefix. used by the
/// flyout (and tab-completion) so users discover subcommands
/// without needing to know them upfront. returns an empty vec when
/// the group is unknown.
pub fn complete_sub(group: &str, sub_partial: &str) -> Vec<&'static str> {
    let g = group.to_ascii_lowercase();
    let p = sub_partial.trim().to_ascii_lowercase();
    let Some((_, subs)) = GROUPS
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(&g))
    else {
        return vec![];
    };
    subs.iter()
        .filter_map(|(n, _)| {
            if p.is_empty() || n.starts_with(&p) {
                Some(*n)
            } else {
                None
            }
        })
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

/// parse `/maintenance <sub> [args...]`. dispatches to the
/// `maintenance_*` admin-rpc commands. flag tokens accepted:
/// `dry-run`, `dry`, `--dry-run`.
fn parse_maintenance_sub(arg: Option<&str>) -> SlashAction {
    let (sub, rest) = split_sub(arg);
    let tokens: Vec<&str> = rest.split_whitespace().collect();
    let has_flag = |name: &str| {
        tokens
            .iter()
            .any(|t| matches!(*t, "dry-run" | "dry" | "--dry-run") && name == "dry-run")
    };
    // first positional token that's not a known flag
    let first_positional = tokens
        .iter()
        .find(|t| !matches!(**t, "dry-run" | "dry" | "--dry-run"))
        .copied();
    let bad = |hint: &'static str| SlashAction::BadArgs {
        name: "maintenance",
        hint,
    };
    match sub.as_str() {
        "" | "help" | "list" => bad(
            "usage: /maintenance <cleanup-tags|cleanup-genres|cleanup-blobs|cleanup-all|backfill-blake3|backfill-thumbs|hard-delete|run-full|update-image|update-spume> [args]",
        ),
        "cleanup-tags" | "cleanup_tags" => SlashAction::AdminDispatch {
            name: "maintenance_cleanup_orphaned_tags",
            body: serde_json::json!({ "dry_run": has_flag("dry-run") }),
        },
        "cleanup-genres" | "cleanup_genres" => SlashAction::AdminDispatch {
            name: "maintenance_cleanup_orphaned_genres",
            body: serde_json::json!({ "dry_run": has_flag("dry-run") }),
        },
        "cleanup-all" | "cleanup_all" => SlashAction::AdminDispatch {
            name: "maintenance_cleanup_all",
            body: serde_json::json!({ "dry_run": has_flag("dry-run") }),
        },
        "cleanup-blobs" | "cleanup_blobs" => {
            let min_age_days = first_positional
                .and_then(|t| t.parse::<f64>().ok())
                .unwrap_or(30.0);
            if min_age_days < 0.0 {
                return bad("usage: /maintenance cleanup-blobs [min-age-days >= 0, default 30]");
            }
            SlashAction::AdminDispatch {
                name: "maintenance_cleanup_orphaned_blobs",
                body: serde_json::json!({ "min_age_days": min_age_days }),
            }
        }
        "backfill-blake3" | "backfill_blake3" | "blake3" => {
            let batch_size = first_positional
                .and_then(|t| t.parse::<i64>().ok())
                .unwrap_or(100);
            if batch_size <= 0 {
                return bad("usage: /maintenance backfill-blake3 [batch_size > 0, default 100]");
            }
            SlashAction::AdminDispatch {
                name: "maintenance_backfill_blake3",
                body: serde_json::json!({ "batch_size": batch_size }),
            }
        }
        "backfill-thumbs" | "backfill_thumbs" | "backfill-thumbnails" | "thumbs" => {
            let limit = first_positional.and_then(|t| t.parse::<u32>().ok());
            let mut body = serde_json::json!({ "dry_run": has_flag("dry-run") });
            if let Some(l) = limit {
                body["limit"] = serde_json::json!(l);
            }
            SlashAction::AdminDispatch {
                name: "maintenance_backfill_thumbnails",
                body,
            }
        }
        "hard-delete" | "hard_delete" => {
            let retention_days = first_positional
                .and_then(|t| t.parse::<u32>().ok())
                .unwrap_or(30);
            SlashAction::AdminDispatch {
                name: "maintenance_hard_delete_old_records",
                body: serde_json::json!({
                    "retention_days": retention_days,
                    "dry_run": has_flag("dry-run"),
                }),
            }
        }
        "run-full" | "run_full" | "full" => {
            let retention_days = first_positional
                .and_then(|t| t.parse::<u32>().ok())
                .unwrap_or(30);
            SlashAction::AdminDispatch {
                name: "maintenance_run_full",
                body: serde_json::json!({
                    "retention_days": retention_days,
                    "dry_run": has_flag("dry-run"),
                }),
            }
        }
        "update-image" | "update_image" | "server-image" => SlashAction::AdminDispatch {
            name: "maintenance_update_server_image",
            body: serde_json::json!({}),
        },
        "update-spume" | "update_spume" | "spume" => SlashAction::AdminDispatch {
            name: "maintenance_update_spume",
            body: serde_json::json!({}),
        },
        _ => bad(
            "usage: /maintenance <cleanup-tags|cleanup-genres|cleanup-blobs|cleanup-all|backfill-blake3|backfill-thumbs|hard-delete|run-full|update-image|update-spume> [args]",
        ),
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

    #[test]
    fn parses_serve_subcommands() {
        assert!(matches!(
            parse("/serve"),
            SlashAction::ServeStart {
                kind: ServeKindArg::Auto
            }
        ));
        assert!(matches!(
            parse("/serve http"),
            SlashAction::ServeStart {
                kind: ServeKindArg::Http
            }
        ));
        assert!(matches!(
            parse("/serve p2p"),
            SlashAction::ServeStart {
                kind: ServeKindArg::P2p
            }
        ));
        assert!(matches!(parse("/serve stop"), SlashAction::ServeStop));
        assert!(matches!(parse("/serve nope"), SlashAction::BadArgs { .. }));
    }

    #[test]
    fn parses_queue_subcommands() {
        assert_eq!(parse("/queue"), SlashAction::Queue);
        assert_eq!(parse("/queue clear"), SlashAction::ClearQueue);
        assert!(matches!(parse("/queue nope"), SlashAction::BadArgs { .. }));
    }

    #[test]
    fn parses_library_subcommands() {
        assert_eq!(
            parse("/library album"),
            SlashAction::Library {
                kind: "album",
                query: None
            }
        );
        assert_eq!(
            parse("/library artist coltrane"),
            SlashAction::Library {
                kind: "artist",
                query: Some("coltrane".into())
            }
        );
        assert_eq!(
            parse("/library favorites"),
            SlashAction::Library {
                kind: "favorites",
                query: None
            }
        );
        assert!(matches!(parse("/library"), SlashAction::BadArgs { .. }));
        assert!(matches!(
            parse("/library bogus"),
            SlashAction::BadArgs { .. }
        ));
    }

    #[test]
    fn complete_sub_returns_known_subs() {
        assert!(complete_sub("serve", "").contains(&"http"));
        assert!(complete_sub("serve", "h").contains(&"http"));
        assert!(complete_sub("library", "a").contains(&"album"));
        assert!(complete_sub("library", "a").contains(&"artist"));
        assert!(complete_sub("queue", "").contains(&"clear"));
        assert!(complete_sub("unknown", "").is_empty());
        assert!(complete_sub("knock", "").contains(&"accept"));
        assert!(complete_sub("users", "").contains(&"grant"));
        assert!(complete_sub("analytics", "top-").contains(&"top-songs"));
        assert!(complete_sub("radio", "").contains(&"start"));
    }

    #[test]
    fn parses_knock_subcommands() {
        assert!(matches!(
            parse("/knock"),
            SlashAction::AdminDispatch {
                name: "knocks_list",
                ..
            }
        ));
        assert!(matches!(
            parse("/knock list"),
            SlashAction::AdminDispatch {
                name: "knocks_list",
                ..
            }
        ));
        assert!(matches!(
            parse("/knock accept abc123"),
            SlashAction::AdminDispatch {
                name: "knocks_accept",
                ..
            }
        ));
        assert!(matches!(
            parse("/knock reject abc123"),
            SlashAction::AdminDispatch {
                name: "knocks_reject",
                ..
            }
        ));
        assert!(matches!(
            parse("/knock reject-all"),
            SlashAction::AdminDispatch {
                name: "knocks_reject_all",
                ..
            }
        ));
        assert!(matches!(
            parse("/knock delete abc123"),
            SlashAction::AdminDispatch {
                name: "knocks_delete",
                ..
            }
        ));
        // missing id => bad args
        assert!(matches!(
            parse("/knock accept"),
            SlashAction::BadArgs { name: "knock", .. }
        ));
    }

    #[test]
    fn parses_users_subcommands() {
        assert!(matches!(
            parse("/users"),
            SlashAction::AdminDispatch {
                name: "users_list",
                ..
            }
        ));
        assert!(matches!(
            parse("/users grant uid Admin"),
            SlashAction::AdminDispatch {
                name: "users_update_role",
                ..
            }
        ));
        assert!(matches!(
            parse("/users revoke uid"),
            SlashAction::AdminDispatch {
                name: "users_update_role",
                ..
            }
        ));
        assert!(matches!(
            parse("/users delete uid"),
            SlashAction::AdminDispatch {
                name: "users_delete",
                ..
            }
        ));
        assert!(matches!(
            parse("/users grant uid"),
            SlashAction::BadArgs { name: "users", .. }
        ));
    }

    #[test]
    fn parses_analytics_subcommands() {
        assert!(matches!(
            parse("/analytics"),
            SlashAction::AdminDispatch {
                name: "analytics_top_songs",
                ..
            }
        ));
        assert!(matches!(
            parse("/analytics top-artists"),
            SlashAction::AdminDispatch {
                name: "analytics_top_artists",
                ..
            }
        ));
        assert!(matches!(
            parse("/analytics listens"),
            SlashAction::AdminDispatch {
                name: "analytics_all_user_stats",
                ..
            }
        ));
    }

    #[test]
    fn parses_radio_subcommands() {
        // bare + list both list stations.
        assert_eq!(
            parse("/radio"),
            SlashAction::Library {
                kind: "radio",
                query: None
            }
        );
        assert_eq!(
            parse("/radio list"),
            SlashAction::Library {
                kind: "radio",
                query: None
            }
        );
        assert!(matches!(
            parse("/radio start station-1"),
            SlashAction::AdminDispatch {
                name: "radio_supervisor_start",
                ..
            }
        ));
        assert!(matches!(
            parse("/radio stop station-1"),
            SlashAction::AdminDispatch {
                name: "radio_supervisor_stop",
                ..
            }
        ));
        assert_eq!(
            parse("/radio tune mellow"),
            SlashAction::Library {
                kind: "radio",
                query: Some("mellow".into()),
            }
        );
        // legacy fuzzy match still works.
        assert_eq!(
            parse("/radio mellow jams"),
            SlashAction::Library {
                kind: "radio",
                query: Some("mellow jams".into()),
            }
        );
    }

    #[test]
    fn parses_fetch_with_url() {
        match parse("/fetch https://www.youtube.com/watch?v=abc") {
            SlashAction::AdminDispatch { name, body } => {
                assert_eq!(name, "library_fetch");
                assert_eq!(
                    body.get("url").and_then(|v| v.as_str()),
                    Some("https://www.youtube.com/watch?v=abc")
                );
            }
            other => panic!("expected AdminDispatch, got {other:?}"),
        }
    }

    #[test]
    fn rejects_bare_fetch() {
        assert!(matches!(
            parse("/fetch"),
            SlashAction::BadArgs { name: "fetch", .. }
        ));
        assert!(matches!(
            parse("/fetch   "),
            SlashAction::BadArgs { name: "fetch", .. }
        ));
    }

    #[test]
    fn fetch_aliases() {
        for alias in [
            "/dl https://x.test/y",
            "/download https://x.test/y",
            "/yt https://x.test/y",
        ] {
            match parse(alias) {
                SlashAction::AdminDispatch {
                    name: "library_fetch",
                    ..
                } => {}
                other => panic!("alias {alias} did not dispatch: {other:?}"),
            }
        }
    }
}
