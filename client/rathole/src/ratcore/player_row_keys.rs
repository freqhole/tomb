//! terminal-agnostic helpers for the global player-row focus mode.
//!
//! both shells (tty + web) call into these from their own KeyCode
//! handlers. the helpers operate on `AppState` and return a tagged
//! [`PlayerRowAction`] when the user actuates a control with enter;
//! the calling shell then dispatches the action to its
//! `MusicPlayer` (tty: libmpv over `send_player`; web: noop until
//! the html-audio runtime lands — see RATHOLE_TUI_PLAN §10).

use super::app::{AppState, Focus, MusicMode, PlayerState, VideoMode};

/// actuated control. the shell turns these into player commands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlayerRowAction {
    /// previous track in queue.
    Previous,
    /// toggle play/pause based on current player state.
    PlayPause,
    /// next track in queue.
    Next,
    /// seek backwards by 15 seconds.
    SeekBack,
    /// seek forwards by 15 seconds.
    SeekForward,
    /// nudge volume down by 5%.
    VolumeDown,
    /// nudge volume up by 5%.
    VolumeUp,
    /// toggle favorite for the now-playing song.
    /// (real grimoire wiring lands with the favorites feature.)
    Favorite,
}

/// canonical control list for the focused player row, in cycle
/// order. exposed so the view can render labels in the same order
/// as the cursor cycles them.
pub const CONTROLS: &[(&str, PlayerRowAction)] = &[
    ("⏮", PlayerRowAction::Previous),
    ("⏯", PlayerRowAction::PlayPause),
    ("⏭", PlayerRowAction::Next),
    ("«15", PlayerRowAction::SeekBack),
    ("15»", PlayerRowAction::SeekForward),
    ("vol-", PlayerRowAction::VolumeDown),
    ("vol+", PlayerRowAction::VolumeUp),
    ("♡", PlayerRowAction::Favorite),
];

/// whether the global player row is currently showing (mirrors
/// `views::player_row::height() > 0`): hidden only while nothing has
/// ever been loaded.
pub fn is_visible(state: &AppState) -> bool {
    let m = &state.ephemeral.music;
    m.currently_playing().is_some() || !matches!(m.player_state, PlayerState::Stopped)
}

/// whether a plain Tab on the current focus should jump to the player
/// row. only foci where Tab has no meaning of its own (or nothing left
/// to do, e.g. an empty repl completion list) qualify - the rest keep
/// their local Tab behavior and reach the player through the existing
/// palette -> result panel -> player chain, or (forms, modals) by
/// leaving first. always false while the player row is hidden.
pub fn tab_should_enter(state: &AppState) -> bool {
    if !is_visible(state) {
        return false;
    }
    let eph = &state.ephemeral;
    match eph.focus {
        Focus::Landing | Focus::RemoteList => true,
        Focus::MusicView => match eph.music.mode {
            MusicMode::Results => true,
            MusicMode::Search => eph.music.results.is_empty(),
        },
        Focus::VideoView => !matches!(eph.video.mode, VideoMode::Edit),
        Focus::Repl => super::repl_keys::flyout_matches(state).is_empty(),
        _ => false,
    }
}

/// enter the player row from any focus, remembering where to return.
pub fn enter(state: &mut AppState) {
    let eph = &mut state.ephemeral;
    if matches!(eph.focus, Focus::PlayerRow) {
        return;
    }
    eph.player_row_return_focus = Some(eph.focus);
    eph.focus = Focus::PlayerRow;
    if eph.player_row_cursor >= CONTROLS.len() {
        eph.player_row_cursor = 0;
    }
}

/// [`enter`], but only when the player row is actually showing.
pub fn enter_if_visible(state: &mut AppState) {
    if is_visible(state) {
        enter(state);
    }
}

/// leave the player row, returning to the saved focus (default
/// admin palette if none was saved).
pub fn leave(state: &mut AppState) {
    let eph = &mut state.ephemeral;
    let prev = eph
        .player_row_return_focus
        .take()
        .unwrap_or(Focus::AdminPalette);
    eph.focus = prev;
}

/// move the focused-control cursor one slot left, wrapping.
pub fn cursor_left(state: &mut AppState) {
    let n = CONTROLS.len();
    let cur = &mut state.ephemeral.player_row_cursor;
    *cur = if *cur == 0 { n - 1 } else { *cur - 1 };
}

/// move the focused-control cursor one slot right, wrapping.
pub fn cursor_right(state: &mut AppState) {
    let n = CONTROLS.len();
    let cur = &mut state.ephemeral.player_row_cursor;
    *cur = (*cur + 1) % n;
}

/// tab forward through the controls; once past the last control,
/// leave the player row instead of wrapping. that way the user
/// isn't trapped in the player when tab-cycling through panes.
pub fn tab_or_leave(state: &mut AppState) {
    let n = CONTROLS.len();
    let cur = state.ephemeral.player_row_cursor;
    if cur + 1 >= n {
        leave(state);
    } else {
        state.ephemeral.player_row_cursor = cur + 1;
    }
}

/// shift-tab backward; leave the player row when already on the
/// first control.
pub fn back_tab_or_leave(state: &mut AppState) {
    let cur = state.ephemeral.player_row_cursor;
    if cur == 0 {
        leave(state);
    } else {
        state.ephemeral.player_row_cursor = cur - 1;
    }
}

/// activate the focused control. returns the action the shell
/// should dispatch.
pub fn activate(state: &AppState) -> PlayerRowAction {
    let cur = state.ephemeral.player_row_cursor.min(CONTROLS.len() - 1);
    CONTROLS[cur].1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enter_remembers_focus() {
        let mut s = AppState::default();
        s.ephemeral.focus = Focus::MusicView;
        enter(&mut s);
        assert_eq!(s.ephemeral.focus, Focus::PlayerRow);
        assert_eq!(s.ephemeral.player_row_return_focus, Some(Focus::MusicView));
        leave(&mut s);
        assert_eq!(s.ephemeral.focus, Focus::MusicView);
    }

    #[test]
    fn tab_enters_player_only_when_visible_and_tab_is_unused() {
        let mut s = AppState::default();
        s.ephemeral.focus = Focus::Landing;
        assert!(!tab_should_enter(&s), "hidden player must not be tabbable");

        s.ephemeral.music.player_state = PlayerState::Playing;
        assert!(tab_should_enter(&s));

        s.ephemeral.focus = Focus::MusicView;
        s.ephemeral.music.mode = MusicMode::Results;
        assert!(tab_should_enter(&s));
        s.ephemeral.music.mode = MusicMode::Search;
        assert!(
            tab_should_enter(&s),
            "search with no results has nothing to tab to"
        );

        // modals / forms / the palette keep their own tab behavior.
        s.ephemeral.focus = Focus::CommandForm;
        assert!(!tab_should_enter(&s));
        s.ephemeral.focus = Focus::AdminPalette;
        assert!(!tab_should_enter(&s));
    }

    #[test]
    fn cursor_wraps() {
        let mut s = AppState::default();
        enter(&mut s);
        cursor_left(&mut s);
        assert_eq!(s.ephemeral.player_row_cursor, CONTROLS.len() - 1);
        cursor_right(&mut s);
        assert_eq!(s.ephemeral.player_row_cursor, 0);
    }
}
