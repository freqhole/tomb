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
        SlashAction::Music => {
            state.ephemeral.repl.clear_input();
            state.ephemeral.repl.status = Some(ReplStatus::ok("focus: music"));
            leave(state);
            state.ephemeral.focus = Focus::MusicView;
            state.ephemeral.music.mode = MusicMode::Results;
            ReplOutcome::Done
        }
        SlashAction::Queue => {
            // synthesize a result-panel dispatch listing the current
            // queue. each row is shaped like a search result so the
            // existing row renderer + actions work, with `now_playing`
            // marking the active track and `pending` marking rows
            // whose blob urls are still being resolved (web shell).
            let m = &state.ephemeral.music;
            let cur = m.current;
            let total = m.queue.len();
            let resolving = m.queue_resolving.min(total);
            // resolution is sequential: rows 0..(total - resolving)
            // have been handed to the player; the tail is still
            // pending.
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
                        "position": i,
                        "now_playing": cur == Some(i),
                        "pending": i >= loaded_through,
                    })
                })
                .collect();
            let cur_label = match cur {
                Some(i) => {
                    if resolving > 0 {
                        format!("queue ({total} tracks, playing #{}, loading {resolving} more\u{2026})", i + 1)
                    } else {
                        format!("queue ({total} tracks, playing #{})", i + 1)
                    }
                }
                None => format!("queue ({total} tracks)"),
            };
            state.ephemeral.last_dispatch = Some(crate::ratcore::app::LastDispatch {
                command: "queue".to_string(),
                success: true,
                message: cur_label,
                data_pretty: None,
                rows,
                cursor: cur.unwrap_or(0),
            });
            state.ephemeral.last_dispatch_scroll = 0;
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
