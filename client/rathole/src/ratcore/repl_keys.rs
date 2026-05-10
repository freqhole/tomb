//! shell-shared helpers for the bottom repl line. terminal-agnostic
//! (no crossterm / ratzilla types). shells handle their own
//! key-event mapping and call into these primitives.

use crate::ratcore::{
    app::{AppState, Focus, MusicMode, ReplStatus},
    text_input as ti,
};

/// outcome of pressing enter in the repl. shells inspect this to
/// decide what extra side-effects to fire (player cmds, search,
/// etc.). the repl text + status are mutated by the helper.
#[derive(Debug, Clone)]
pub enum ReplOutcome {
    /// nothing to do — typically empty input or pure focus change.
    Done,
    /// user pressed enter; the shell should run this slash action
    /// (everything not handled by `apply_navigation`).
    Run(crate::ratcore::slash::SlashAction),
}

/// enter the repl from any focus, remembering where to return to.
pub fn enter(state: &mut AppState) {
    state.ephemeral.repl.return_focus = Some(state.ephemeral.focus);
    state.ephemeral.focus = Focus::Repl;
}

/// build the public spume invite url for a given p2p node id.
/// shared by `/info`, `/copy-invite`, and `/open-invite` so the
/// hostname only lives in one place.
fn invite_url(node_id: &str) -> String {
    format!("https://spume.freqhole.net/?r={node_id}")
}

/// enter the repl with `seed` already typed and the cursor placed
/// at the end. used by the `/` keybind so the user can start typing
/// a slash command without first hitting ctrl-k. seed is usually
/// just `"/"` but callers can pre-fill `"/album "` or similar.
pub fn enter_with_seed(state: &mut AppState, seed: &str) {
    enter(state);
    let r = &mut state.ephemeral.repl;
    r.input = seed.to_string();
    r.cursor = r.input.chars().count();
    r.history_cursor = None;
}

/// leave the repl, returning to the previously-focused area.
pub fn leave(state: &mut AppState) {
    let prev = state
        .ephemeral
        .repl
        .return_focus
        .take()
        .unwrap_or(Focus::AdminPalette);
    state.ephemeral.focus = prev;
}

/// synthesize the `/queue` result-panel dispatch from the current
/// music state. each row is shaped like a search result so the
/// existing row renderer + actions work, with `now_playing` marking
/// the active track and `pending` marking rows whose blob urls are
/// still being resolved (web shell). exposed so queue-mutation
/// helpers in the shells can re-render after edits. when
/// `cursor_override` is `Some`, the cursor is clamped to the new
/// queue length; otherwise it defaults to the currently-playing
/// index.
pub fn render_queue_panel(state: &mut AppState, cursor_override: Option<usize>) {
    let m = &state.ephemeral.music;
    let cur = m.current;
    let total = m.queue.len();
    let resolving = m.queue_resolving.min(total);
    let loaded_through = total.saturating_sub(resolving);
    let rows: Vec<serde_json::Value> = m
        .queue
        .iter()
        .enumerate()
        .map(|(i, s)| {
            serde_json::json!({
                "type": "song",
                "id": s.id.clone(),
                "title": s.title.clone(),
                "subtitle": s.artist.clone().unwrap_or_else(|| "\u{2014}".to_string()),
                "album": s.album.clone(),
                "artist": s.artist.clone(),
                "album_id": s.album_id.clone(),
                "artist_id": s.artist_id.clone(),
                "position": i,
                "now_playing": cur == Some(i),
                "pending": i >= loaded_through,
            })
        })
        .collect();
    let cur_label = match cur {
        Some(i) => {
            if resolving > 0 {
                format!(
                    "queue ({total} tracks, playing #{}, loading {resolving} more\u{2026})",
                    i + 1
                )
            } else {
                format!("queue ({total} tracks, playing #{})", i + 1)
            }
        }
        None => format!("queue ({total} tracks)"),
    };
    let cursor = cursor_override
        .unwrap_or(cur.unwrap_or(0))
        .min(total.saturating_sub(1).max(0));
    state.ephemeral.last_dispatch = Some(crate::ratcore::app::LastDispatch {
        command: "queue".to_string(),
        success: true,
        message: cur_label,
        data_pretty: None,
        rows,
        cursor,
    });
    state.ephemeral.last_dispatch_scroll = 0;
}

/// esc handler: clears the input on first press, leaves the repl
/// (returning to the previous focus) on the second.
pub fn handle_escape(state: &mut AppState) {
    let r = &mut state.ephemeral.repl;
    if r.input.is_empty() {
        leave(state);
    } else {
        r.clear_input();
    }
}

/// tab-complete the current command name from the canonical list.
///
/// behavior:
///   - 0 matches → no-op.
///   - 1 match  → complete the input with `/name ` (trailing space
///     so the user can keep typing args).
///   - >1 matches → cycle. each tab rotates `flyout_cursor`
///     through the match list and rewrites the input to the
///     highlighted name (no trailing space, so subsequent tabs
///     keep cycling). the original prefix is captured in
///     `cycle_stem` so the candidate list stays stable across
///     cycles — it would otherwise narrow to one match after the
///     first cycle and lock the rotation. cycling clears as soon
///     as the user edits the input (insert/backspace/delete) or
///     submits with enter.
pub fn handle_tab(state: &mut AppState) {
    let matches = flyout_matches(state);
    if matches.is_empty() {
        return;
    }
    if matches.len() == 1 {
        // single hit — finalize with trailing space and clear any
        // previous cycling state.
        flyout_complete(state);
        let r = &mut state.ephemeral.repl;
        r.cycle_stem = None;
        return;
    }
    // multiple hits — capture stem on first tab so subsequent
    // tabs rotate over the same list.
    let raw = state.ephemeral.repl.input.as_str();
    let trimmed_left = raw.trim_start();
    let body = trimmed_left.strip_prefix('/').unwrap_or(trimmed_left);
    if state.ephemeral.repl.cycle_stem.is_none() {
        state.ephemeral.repl.cycle_stem = Some(body.to_string());
        state.ephemeral.repl.flyout_cursor = 0;
    } else {
        let cur = state.ephemeral.repl.flyout_cursor;
        state.ephemeral.repl.flyout_cursor = (cur + 1) % matches.len();
    }
    let pick_idx = state.ephemeral.repl.flyout_cursor;
    let pick = matches[pick_idx].0.clone();
    // preserve the group prefix when we're cycling subcommands
    // (`/group <sub>`).
    let new_input = if let Some(idx) = body.find(char::is_whitespace) {
        let group = &body[..idx];
        format!("/{group} {pick}")
    } else {
        format!("/{pick}")
    };
    let r = &mut state.ephemeral.repl;
    r.input = new_input;
    r.cursor = r.input.chars().count();
    r.history_cursor = None;
}

/// compute the current flyout entries `(label, description)` for
/// the repl input. shape:
///   - bare partial like `/se` \u2192 top-level commands prefixed by
///     "se" (from [`crate::ratcore::slash::COMMANDS`]); only when
///     matches narrow (1..total).
///   - `/group ` or `/group <partial>` \u2192 subcommands of the
///     group from [`crate::ratcore::slash::GROUPS`] filtered by
///     prefix. always shown when the group is recognized so users
///     can discover subcommands.
///   - empty input or fully-typed args \u2192 empty (no flyout).
pub fn flyout_matches(state: &AppState) -> Vec<(String, String)> {
    use crate::ratcore::slash::{complete, complete_sub, COMMANDS, GROUPS};
    // when the user is mid-cycle, anchor matches to the original
    // stem so the candidate list doesn't collapse as we rewrite
    // input to each cycled name.
    let owned_input;
    let raw = if let Some(stem) = state.ephemeral.repl.cycle_stem.as_deref() {
        owned_input = format!("/{stem}");
        owned_input.as_str()
    } else {
        state.ephemeral.repl.input.as_str()
    };
    let trimmed_left = raw.trim_start();
    let body = trimmed_left.strip_prefix('/').unwrap_or(trimmed_left);
    if body.is_empty() {
        return vec![];
    }
    // sub completion: input has whitespace after the group name.
    if let Some(idx) = body.find(char::is_whitespace) {
        let group = &body[..idx];
        let after = body[idx..].trim_start();
        // more than one whitespace-separated token after the group
        // means we're typing args, not a subcommand. hide flyout.
        let mut tokens = after.split_whitespace();
        let sub_partial = tokens.next().unwrap_or("");
        if tokens.next().is_some() {
            return vec![];
        }
        let subs = complete_sub(group, sub_partial);
        if subs.is_empty() {
            return vec![];
        }
        let group_lower = group.to_ascii_lowercase();
        let descs: &[(&str, &str)] = GROUPS
            .iter()
            .find(|(g, _)| g.eq_ignore_ascii_case(&group_lower))
            .map(|(_, s)| *s)
            .unwrap_or(&[]);
        return subs
            .into_iter()
            .map(|s| {
                let desc = descs
                    .iter()
                    .find(|(n, _)| *n == s)
                    .map(|(_, d)| (*d).to_string())
                    .unwrap_or_default();
                (s.to_string(), desc)
            })
            .collect();
    }
    // top-level partial. only show when matches narrow (less than
    // the full command set) so users don't see the whole list when
    // they haven't typed anything meaningful yet.
    let matches = complete(body);
    if matches.is_empty() || matches.len() >= COMMANDS.len() {
        return vec![];
    }
    matches
        .into_iter()
        .map(|name| {
            let desc = COMMANDS
                .iter()
                .find(|(n, _)| *n == name)
                .map(|(_, h)| (*h).to_string())
                .unwrap_or_default();
            (name.to_string(), desc)
        })
        .collect()
}

/// move the flyout cursor up by one. returns `true` when the
/// flyout is visible (so shells can fall through to history nav
/// when it isn't).
pub fn flyout_up(state: &mut AppState) -> bool {
    if flyout_matches(state).is_empty() {
        return false;
    }
    let r = &mut state.ephemeral.repl;
    if r.flyout_cursor > 0 {
        r.flyout_cursor -= 1;
    }
    true
}

/// move the flyout cursor down by one. returns `true` when the
/// flyout is visible.
pub fn flyout_down(state: &mut AppState) -> bool {
    let len = flyout_matches(state).len();
    if len == 0 {
        return false;
    }
    let r = &mut state.ephemeral.repl;
    if r.flyout_cursor + 1 < len {
        r.flyout_cursor += 1;
    }
    true
}

/// replace the input with the currently-highlighted flyout entry
/// (plus a trailing space so the user can keep typing args).
/// no-op when the flyout has no matches.
pub fn flyout_complete(state: &mut AppState) {
    let matches = flyout_matches(state);
    if matches.is_empty() {
        return;
    }
    let cursor = state.ephemeral.repl.flyout_cursor.min(matches.len() - 1);
    let pick = matches[cursor].0.clone();
    let raw = state.ephemeral.repl.input.as_str();
    let trimmed_left = raw.trim_start();
    let body = trimmed_left.strip_prefix('/').unwrap_or(trimmed_left);
    let new_input = if let Some(idx) = body.find(char::is_whitespace) {
        let group = &body[..idx];
        format!("/{group} {pick} ")
    } else {
        format!("/{pick} ")
    };
    let r = &mut state.ephemeral.repl;
    r.input = new_input;
    r.cursor = r.input.chars().count();
    r.history_cursor = None;
    r.flyout_cursor = 0;
}

/// browse history backwards (older entries).
pub fn history_prev(state: &mut AppState) {
    let r = &mut state.ephemeral.repl;
    if r.history.is_empty() {
        return;
    }
    let next_idx = match r.history_cursor {
        None => r.history.len() - 1,
        Some(0) => 0,
        Some(i) => i - 1,
    };
    r.history_cursor = Some(next_idx);
    r.input = r.history[next_idx].clone();
    r.cursor = r.input.chars().count();
    r.flyout_cursor = 0;
}

/// browse history forwards (newer entries; clears input at end).
pub fn history_next(state: &mut AppState) {
    let r = &mut state.ephemeral.repl;
    match r.history_cursor {
        None => {}
        Some(i) if i + 1 >= r.history.len() => {
            r.history_cursor = None;
            r.clear_input();
        }
        Some(i) => {
            let next = i + 1;
            r.history_cursor = Some(next);
            r.input = r.history[next].clone();
            r.cursor = r.input.chars().count();
            r.flyout_cursor = 0;
        }
    }
}

pub fn move_left(state: &mut AppState) {
    let r = &mut state.ephemeral.repl;
    ti::move_left(&mut r.cursor);
}
pub fn move_right(state: &mut AppState) {
    let r = &mut state.ephemeral.repl;
    ti::move_right(&r.input, &mut r.cursor);
}
pub fn move_home(state: &mut AppState) {
    state.ephemeral.repl.cursor = 0;
}
pub fn move_end(state: &mut AppState) {
    let r = &mut state.ephemeral.repl;
    r.cursor = r.input.chars().count();
}
pub fn backspace(state: &mut AppState) {
    let r = &mut state.ephemeral.repl;
    ti::backspace(&mut r.input, &mut r.cursor);
    r.history_cursor = None;
    r.flyout_cursor = 0;
    r.cycle_stem = None;
}
pub fn delete(state: &mut AppState) {
    let r = &mut state.ephemeral.repl;
    ti::delete(&mut r.input, &mut r.cursor);
    r.history_cursor = None;
    r.flyout_cursor = 0;
    r.cycle_stem = None;
}
pub fn insert_char(state: &mut AppState, c: char) {
    let r = &mut state.ephemeral.repl;
    ti::insert_char(&mut r.input, &mut r.cursor, c);
    r.history_cursor = None;
    r.flyout_cursor = 0;
    r.cycle_stem = None;
}

/// handle the pure-state slice of a parsed slash action — focus
/// changes, quit, bad-args, unknown. returns `Run(action)` for
/// anything that needs the shell's player/transport, or `Done` if
/// the action was fully handled here.
pub fn apply_navigation(
    state: &mut AppState,
    exit: &mut bool,
    raw: &str,
    action: crate::ratcore::slash::SlashAction,
) -> ReplOutcome {
    use crate::ratcore::slash::SlashAction;

    // record everything except empty/bad-args/unknown in history.
    match &action {
        SlashAction::Empty | SlashAction::BadArgs { .. } | SlashAction::Unknown { .. } => {}
        _ => state.ephemeral.repl.push_history(raw.to_string()),
    }

    match action {
        SlashAction::Empty => {
            leave(state);
            ReplOutcome::Done
        }
        SlashAction::Quit => {
            *exit = true;
            ReplOutcome::Done
        }
        SlashAction::Admin => {
            state.ephemeral.repl.clear_input();
            state.ephemeral.repl.status = Some(ReplStatus::ok("admin"));
            leave(state);
            state.ephemeral.focus = Focus::AdminPalette;
            ReplOutcome::Done
        }
        SlashAction::Help => {
            // synthesize a result panel listing every slash command +
            // its one-line help so users can discover the full repl
            // vocabulary without consulting docs. shape mirrors a
            // standard list response.
            let rows: Vec<serde_json::Value> = crate::ratcore::slash::COMMANDS
                .iter()
                .enumerate()
                .flat_map(|(i, (name, help))| {
                    // strip the leading `/name` from the help blurb
                    // so the row doesn't render the command name
                    // twice (title already shows it).
                    let prefix = format!("/{name}");
                    let blurb = help
                        .strip_prefix(prefix.as_str())
                        .unwrap_or(help)
                        .trim_start()
                        .to_string();
                    let mut entries = vec![serde_json::json!({
                        "type": "slash_command",
                        "id": (*name).to_string(),
                        "title": format!("/{name}"),
                        "subtitle": blurb,
                        "position": i,
                    })];
                    // expand grouped subcommands as their own rows so
                    // /help is the one-stop reference.
                    if let Some((_, subs)) = crate::ratcore::slash::GROUPS
                        .iter()
                        .find(|(g, _)| g == name)
                    {
                        for (sub, sub_help) in *subs {
                            entries.push(serde_json::json!({
                                "type": "slash_command",
                                "id": format!("{name} {sub}"),
                                "title": format!("/{name} {sub}"),
                                "subtitle": (*sub_help).to_string(),
                                "position": i,
                            }));
                        }
                    }
                    entries
                })
                .collect();
            let total = rows.len();
            state.ephemeral.last_dispatch = Some(crate::ratcore::app::LastDispatch {
                command: "help".to_string(),
                success: true,
                message: format!("slash commands ({total} available)"),
                data_pretty: None,
                rows,
                cursor: 0,
            });
            state.ephemeral.last_dispatch_scroll = 0;
            state.ephemeral.repl.clear_input();
            state.ephemeral.repl.status = Some(ReplStatus::ok("help"));
            leave(state);
            state.ephemeral.focus = Focus::ResultPanel;
            ReplOutcome::Done
        }
        #[cfg(not(target_arch = "wasm32"))]
        SlashAction::Info => {
            // synthesize a result-panel snapshot of "everything you
            // might want to know about this rathole instance":
            // server config (name/desc/version/image), p2p identity
            // (node_id, keypair path, federation flags), serve
            // subprocess status, and key filesystem paths. all
            // values come from sync grimoire helpers so we don't
            // have to await anything in this navigation slice.
            let cfg = grimoire::config::get_config();
            let mut rows: Vec<serde_json::Value> = Vec::new();
            let mut idx: usize = 0;
            let push = |rows: &mut Vec<serde_json::Value>,
                        idx: &mut usize,
                        section: &str,
                        label: &str,
                        value: String| {
                rows.push(serde_json::json!({
                    "type": "info_field",
                    "id": format!("{section}.{label}"),
                    "title": format!("{section}: {label}"),
                    "subtitle": value,
                    "position": *idx,
                }));
                *idx += 1;
            };
            // --- server section ---
            if let Some(s) = cfg.server.as_ref() {
                push(&mut rows, &mut idx, "server", "name", s.name.clone());
                push(
                    &mut rows,
                    &mut idx,
                    "server",
                    "description",
                    s.description.clone().unwrap_or_else(|| "(none)".into()),
                );
                push(&mut rows, &mut idx, "server", "version", s.version.clone());
                push(
                    &mut rows,
                    &mut idx,
                    "server",
                    "host:port",
                    format!("{}:{}", s.host, s.port),
                );
                push(
                    &mut rows,
                    &mut idx,
                    "server",
                    "enabled",
                    s.enabled.to_string(),
                );
                push(
                    &mut rows,
                    &mut idx,
                    "server",
                    "image_blob_id",
                    s.image_blob_id.clone().unwrap_or_else(|| "(none)".into()),
                );
            } else {
                push(
                    &mut rows,
                    &mut idx,
                    "server",
                    "config",
                    "(no [server] section in config)".to_string(),
                );
            }
            // --- p2p / federation section ---
            let identity = grimoire::federation::get_identity_info();
            push(
                &mut rows,
                &mut idx,
                "p2p",
                "node_id",
                identity
                    .node_id
                    .clone()
                    .unwrap_or_else(|| "(no keypair on disk)".into()),
            );
            push(
                &mut rows,
                &mut idx,
                "p2p",
                "keypair_path",
                identity.keypair_path.display().to_string(),
            );
            push(
                &mut rows,
                &mut idx,
                "p2p",
                "keypair_exists",
                identity.keypair_exists.to_string(),
            );
            // spume invite url — handy to share so a peer can land
            // directly on the spume webclient pre-targeted at this
            // node id. /copy-invite + /open-invite act on this same
            // url. only meaningful when the keypair is on disk.
            if let Some(node_id) = identity.node_id.as_deref() {
                push(
                    &mut rows,
                    &mut idx,
                    "p2p",
                    "invite_url",
                    invite_url(node_id),
                );
            }
            if let Some(f) = cfg.federation.as_ref() {
                push(
                    &mut rows,
                    &mut idx,
                    "federation",
                    "enabled",
                    f.enabled.to_string(),
                );
                push(
                    &mut rows,
                    &mut idx,
                    "federation",
                    "knocking_enabled",
                    f.knocking_enabled.to_string(),
                );
                if let Some(p) = f.bind_port {
                    push(
                        &mut rows,
                        &mut idx,
                        "federation",
                        "bind_port",
                        p.to_string(),
                    );
                }
            } else {
                push(
                    &mut rows,
                    &mut idx,
                    "federation",
                    "config",
                    "(no [federation] section in config)".to_string(),
                );
            }
            // --- serve subprocess section (rathole-managed) ---
            let serve = &state.ephemeral.serve;
            push(
                &mut rows,
                &mut idx,
                "serve",
                "subprocess",
                if serve.running {
                    format!(
                        "running ({}{})",
                        serve.mode.label(),
                        serve.pid.map(|p| format!(", pid {p}")).unwrap_or_default()
                    )
                } else if let Some(msg) = serve.last_message.as_deref() {
                    format!("stopped ({msg})")
                } else {
                    "not started".into()
                },
            );
            // --- paths section ---
            if let Some(p) = grimoire::config::get_config_path() {
                push(
                    &mut rows,
                    &mut idx,
                    "paths",
                    "config_file",
                    p.display().to_string(),
                );
            }
            push(
                &mut rows,
                &mut idx,
                "paths",
                "data_dir",
                cfg.data_dir.display().to_string(),
            );
            if let Some(p) = cfg.log_file_path() {
                push(
                    &mut rows,
                    &mut idx,
                    "paths",
                    "log_file",
                    p.display().to_string(),
                );
            }
            // --- remote section (currently-connected peer) ---
            if let Some(peer) = state.ephemeral.connected_peer.as_deref() {
                push(
                    &mut rows,
                    &mut idx,
                    "remote",
                    "connected_to",
                    peer.to_string(),
                );
                if let Some(name) = state.ephemeral.remote_name.as_deref() {
                    push(&mut rows, &mut idx, "remote", "name", name.to_string());
                }
            }

            let total = rows.len();
            state.ephemeral.last_dispatch = Some(crate::ratcore::app::LastDispatch {
                command: "info".to_string(),
                success: true,
                message: format!("local info ({total} fields)"),
                data_pretty: None,
                rows,
                cursor: 0,
            });
            state.ephemeral.last_dispatch_scroll = 0;
            state.ephemeral.repl.clear_input();
            state.ephemeral.repl.status = Some(ReplStatus::ok("info"));
            leave(state);
            state.ephemeral.focus = Focus::ResultPanel;
            ReplOutcome::Done
        }
        #[cfg(not(target_arch = "wasm32"))]
        SlashAction::CopyInvite => {
            // copy the spume invite link to the system clipboard.
            // requires a node id (i.e. the local p2p keypair must
            // have been generated). errors surface in the repl
            // status line so the user knows what went wrong.
            let identity = grimoire::federation::get_identity_info();
            state.ephemeral.repl.clear_input();
            match identity.node_id.as_deref() {
                None => {
                    state.ephemeral.repl.status = Some(ReplStatus::err(
                        "no p2p node id yet — run /serve or /p2p first",
                    ));
                }
                Some(node_id) => {
                    let url = invite_url(node_id);
                    match arboard::Clipboard::new().and_then(|mut c| c.set_text(url.clone())) {
                        Ok(()) => {
                            state.ephemeral.repl.status =
                                Some(ReplStatus::ok(format!("copied: {url}")));
                        }
                        Err(e) => {
                            state.ephemeral.repl.status =
                                Some(ReplStatus::err(format!("clipboard error: {e}")));
                        }
                    }
                }
            }
            leave(state);
            ReplOutcome::Done
        }
        #[cfg(not(target_arch = "wasm32"))]
        SlashAction::Logs => {
            // dump the most recent log lines into the result
            // panel. requires that the rathole bin (or `freqhole
            // rathole` cli wrapper) installed the in-memory ring
            // buffer at log-init time. if not, we report a clear
            // error rather than silently producing zero rows.
            use crate::ratcore::app::LastDispatch;
            state.ephemeral.repl.clear_input();
            let snapshot = crate::log_buffer::global().map(|b| b.snapshot());
            let lines = match snapshot {
                None => {
                    state.ephemeral.repl.status = Some(ReplStatus::err(
                        "log buffer not installed (rebuild + relaunch rathole)",
                    ));
                    leave(state);
                    return ReplOutcome::Done;
                }
                Some(v) => v,
            };
            // newest-first feels right for an interactive log
            // dump: the user almost always wants the latest line
            // at the top of the result panel.
            let total = lines.len();
            let mut rows: Vec<serde_json::Value> = Vec::with_capacity(total);
            for (i, line) in lines.iter().rev().enumerate() {
                rows.push(serde_json::json!({
                    "type": "log_line",
                    "id": format!("log-{i}"),
                    "title": line,
                    "subtitle": "",
                    "position": i,
                }));
            }
            let message = if total == 0 {
                "no log lines yet".to_string()
            } else {
                format!("{total} log lines (newest first)")
            };
            state.ephemeral.last_dispatch = Some(LastDispatch {
                command: "log".to_string(),
                success: true,
                message,
                data_pretty: None,
                rows,
                cursor: 0,
            });
            state.ephemeral.last_dispatch_scroll = 0;
            state.ephemeral.repl.status = Some(ReplStatus::ok("log"));
            leave(state);
            state.ephemeral.focus = Focus::ResultPanel;
            ReplOutcome::Done
        }
        #[cfg(not(target_arch = "wasm32"))]
        SlashAction::OpenInvite => {
            // open the spume invite link in the system default
            // browser. same node-id precondition as /copy-invite.
            let identity = grimoire::federation::get_identity_info();
            state.ephemeral.repl.clear_input();
            match identity.node_id.as_deref() {
                None => {
                    state.ephemeral.repl.status = Some(ReplStatus::err(
                        "no p2p node id yet — run /serve or /p2p first",
                    ));
                }
                Some(node_id) => {
                    let url = invite_url(node_id);
                    match open::that_detached(&url) {
                        Ok(()) => {
                            state.ephemeral.repl.status =
                                Some(ReplStatus::ok(format!("opened: {url}")));
                        }
                        Err(e) => {
                            state.ephemeral.repl.status =
                                Some(ReplStatus::err(format!("could not open browser: {e}")));
                        }
                    }
                }
            }
            leave(state);
            ReplOutcome::Done
        }
        // wasm fallback for the native-only commands above. these all
        // depend on grimoire/arboard/open/log_buffer which aren't
        // available in the browser shell — surface a friendly status
        // line instead of failing to compile.
        #[cfg(target_arch = "wasm32")]
        SlashAction::Info
        | SlashAction::CopyInvite
        | SlashAction::OpenInvite
        | SlashAction::Logs => {
            state.ephemeral.repl.clear_input();
            state.ephemeral.repl.status = Some(ReplStatus::err("not available in the web shell"));
            leave(state);
            ReplOutcome::Done
        }
        SlashAction::Music => {
            state.ephemeral.repl.clear_input();
            state.ephemeral.repl.status = Some(ReplStatus::ok("focus: music"));
            leave(state);
            state.ephemeral.focus = Focus::MusicView;
            state.ephemeral.music.mode = MusicMode::Results;
            ReplOutcome::Done
        }
        SlashAction::AddRemote => {
            // open the peer-input modal seeded with the
            // currently-connected remote (if any) so the user can
            // either edit it or paste a new addr.
            let seed = state.ephemeral.connected_peer.clone().unwrap_or_default();
            let cursor = seed.chars().count();
            state.ephemeral.peer_input = seed;
            state.ephemeral.peer_cursor = cursor;
            state.ephemeral.peer_error = None;
            state.ephemeral.repl.clear_input();
            state.ephemeral.repl.status = Some(ReplStatus::ok("add remote"));
            leave(state);
            state.ephemeral.focus = Focus::PeerInput;
            ReplOutcome::Done
        }
        SlashAction::ListRemotes => {
            // synthesize a result-panel dispatch listing all saved
            // remotes from the persisted statefile. shape mirrors a
            // standard list response so the existing row renderer
            // works.
            let active = state.persisted.active_remote_id.clone();
            let connected = state.ephemeral.connected_peer.clone();
            let local = state.ephemeral.local_node_id.clone();
            let saved = state.persisted.remotes.clone();
            let total = saved.len();
            let mut rows: Vec<serde_json::Value> = saved
                .iter()
                .enumerate()
                .map(|(i, r)| {
                    let is_active = active.as_deref() == Some(r.remote_id.as_str())
                        || r.is_active
                        || (r.peer_addr.is_some() && r.peer_addr == connected);
                    serde_json::json!({
                        "type": "remote",
                        "id": r.remote_id.clone(),
                        "title": r.name.clone(),
                        "subtitle": r
                            .peer_addr
                            .clone()
                            .or_else(|| r.base_url.clone())
                            .unwrap_or_else(|| r.transport.clone()),
                        "transport": r.transport.clone(),
                        "active": is_active,
                        "position": i,
                    })
                })
                .collect();
            // surface the live local node (web shell) if it isn't
            // already in the saved list.
            if let Some(me) = local {
                if !saved
                    .iter()
                    .any(|r| r.peer_addr.as_deref() == Some(me.as_str()))
                {
                    rows.push(serde_json::json!({
                        "type": "remote",
                        "id": me.clone(),
                        "title": "this node",
                        "subtitle": me,
                        "transport": "midden",
                        "active": false,
                        "position": rows.len(),
                    }));
                }
            }
            let label = if total == 0 {
                "remotes (none saved \u{2014} use /remote to add one)".to_string()
            } else {
                format!("remotes ({total} saved)")
            };
            state.ephemeral.last_dispatch = Some(crate::ratcore::app::LastDispatch {
                command: "remotes".to_string(),
                success: true,
                message: label,
                data_pretty: None,
                rows,
                cursor: 0,
            });
            state.ephemeral.last_dispatch_scroll = 0;
            state.ephemeral.repl.clear_input();
            state.ephemeral.repl.status = Some(ReplStatus::ok("remotes"));
            leave(state);
            state.ephemeral.focus = Focus::ResultPanel;
            ReplOutcome::Done
        }
        SlashAction::Queue => {
            render_queue_panel(state, None);
            state.ephemeral.repl.clear_input();
            state.ephemeral.repl.status = Some(ReplStatus::ok("queue"));
            leave(state);
            state.ephemeral.focus = Focus::ResultPanel;
            ReplOutcome::Done
        }
        SlashAction::BadArgs { name, hint } => {
            state.ephemeral.repl.status = Some(ReplStatus::err(format!("/{name}: {hint}")));
            ReplOutcome::Done
        }
        SlashAction::Unknown { name } => {
            state.ephemeral.repl.status = Some(ReplStatus::err(format!(
                "/{name}: unknown — try /search /play /pause /next /vol …"
            )));
            ReplOutcome::Done
        }
        // everything below needs player/transport access — defer to caller.
        other => ReplOutcome::Run(other),
    }
}
