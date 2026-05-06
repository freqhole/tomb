//! state for the bottom `/` slash-command repl line.
//!
//! the repl is a single-line text input that lives just above the
//! footer hints and is reachable via `ctrl-k` from any focus.
//! commands begin with `/` (e.g. `/play metal`, `/pause`,
//! `/search smooth jams`); typed input without a leading `/` is
//! still allowed, just routed to a fallback action by the shell
//! (today: ignored with a hint).
//!
//! parsing happens in `crate::ratcore::slash`. this module just
//! holds the buffer + history + the most recent status line.

#[derive(Debug, Clone, Default)]
pub struct ReplState {
    /// edit buffer (everything typed since last enter / esc).
    pub input: String,
    /// caret position in chars.
    pub cursor: usize,
    /// short status line shown in the repl row when the input is
    /// empty — typically the result of the most recent command
    /// (e.g. `played: led zeppelin — kashmir`) or an error.
    pub status: Option<ReplStatus>,
    /// recent command history (newest last). bounded.
    pub history: Vec<String>,
    /// current history-scroll offset — `Some(idx)` while the user is
    /// browsing with up/down, indexing into `history` from the end.
    /// `None` when not scrolling.
    pub history_cursor: Option<usize>,
    /// the focus we came from, so esc returns there cleanly.
    pub return_focus: Option<super::Focus>,
}

#[derive(Debug, Clone)]
pub struct ReplStatus {
    pub message: String,
    pub level: ReplStatusLevel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplStatusLevel {
    Info,
    Ok,
    Err,
}

impl ReplStatus {
    pub fn ok(msg: impl Into<String>) -> Self {
        Self {
            message: msg.into(),
            level: ReplStatusLevel::Ok,
        }
    }
    pub fn err(msg: impl Into<String>) -> Self {
        Self {
            message: msg.into(),
            level: ReplStatusLevel::Err,
        }
    }
    pub fn info(msg: impl Into<String>) -> Self {
        Self {
            message: msg.into(),
            level: ReplStatusLevel::Info,
        }
    }
}

impl ReplState {
    /// push a command onto the history (deduping consecutive
    /// repeats), capped at 100 entries.
    pub fn push_history(&mut self, cmd: String) {
        if cmd.trim().is_empty() {
            return;
        }
        if self.history.last().map(|s| s.as_str()) == Some(cmd.as_str()) {
            return;
        }
        self.history.push(cmd);
        if self.history.len() > 100 {
            let excess = self.history.len() - 100;
            self.history.drain(0..excess);
        }
    }

    /// clear the edit buffer + cursor + history-scroll.
    pub fn clear_input(&mut self) {
        self.input.clear();
        self.cursor = 0;
        self.history_cursor = None;
    }
}
