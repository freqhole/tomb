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
pub fn handle_tab(state: &mut AppState) {
    let r = &mut state.ephemeral.repl;
    let completions = crate::ratcore::slash::complete(&r.input);
    if let Some(first) = completions.first() {
        r.input = format!("/{first} ");
        r.cursor = r.input.chars().count();
        r.history_cursor = None;
    }
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
}
pub fn delete(state: &mut AppState) {
    let r = &mut state.ephemeral.repl;
    ti::delete(&mut r.input, &mut r.cursor);
    r.history_cursor = None;
}
pub fn insert_char(state: &mut AppState, c: char) {
    let r = &mut state.ephemeral.repl;
    ti::insert_char(&mut r.input, &mut r.cursor, c);
    r.history_cursor = None;
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
            state.ephemeral.repl.status = Some(ReplStatus::ok("focus: admin"));
            leave(state);
            state.ephemeral.focus = Focus::AdminPalette;
            ReplOutcome::Done
        }
        SlashAction::Commands => {
            state.ephemeral.repl.clear_input();
            state.ephemeral.repl.status = Some(ReplStatus::ok("commands"));
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
                .map(|(i, (name, help))| {
                    serde_json::json!({
                        "type": "slash_command",
                        "id": (*name).to_string(),
                        "title": format!("/{name}"),
                        "subtitle": help.to_string(),
                        "position": i,
                    })
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
            let seed = state
                .ephemeral
                .connected_peer
                .clone()
                .unwrap_or_default();
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
                if !saved.iter().any(|r| r.peer_addr.as_deref() == Some(me.as_str())) {
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
