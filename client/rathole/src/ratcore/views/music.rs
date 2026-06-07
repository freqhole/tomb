//! music view — results list only. search input and now-playing
//! pane have been removed; the persistent player row at the bottom
//! of the chrome covers transport state, and search is initiated
//! exclusively via the slash repl (`/search <query>`,
//! `/play <query>`).
//!
//! key map (shell handles input; this file is render-only):
//! - j/k or up/down: move cursor
//! - enter: load results[cursor..] into queue and play
//! - space: toggle play/pause
//! - n/p: next/previous track
//! - left/right: seek -/+ 5s
//! - -/=: volume down/up
//! - f: toggle favorite for the highlighted row
//! - esc: back to landing

use ratatui::{
    layout::Rect,
    style::{Style, Stylize},
    text::{Line, Span},
    widgets::{Block, List, ListItem, ListState},
    Frame,
};

use crate::ratcore::app::{App, SongRow};
use crate::ratcore::theme::ACCENT;

pub fn draw(frame: &mut Frame, area: Rect, app: &mut App) {
    let m = &app.state.ephemeral.music;
    let items: Vec<ListItem> = if m.results.is_empty() {
        let hint = if let Some(err) = &m.search_error {
            format!("search failed: {err}")
        } else if m.searching {
            "(loading\u{2026})".to_string()
        } else if !m.query.is_empty() {
            format!(
                "(no results for `{}` \u{2014} try /search <query>)",
                m.query
            )
        } else {
            "(empty \u{2014} press ctrl-k then `/local` for downloaded songs, or `/search <query>` to search)".to_string()
        };
        vec![ListItem::new(Line::from(hint.dim()))]
    } else {
        m.results
            .iter()
            .map(|s| ListItem::new(format_row(s)))
            .collect()
    };
    let mut list_state = ListState::default();
    if !m.results.is_empty() {
        list_state.select(Some(m.results_cursor.min(m.results.len() - 1)));
    }
    let mut title = format!("results  ({})", m.results.len());
    if m.searching {
        title.push_str("  — searching…");
    }
    let list = List::new(items)
        .block(Block::bordered().title(Span::styled(title, Style::new().fg(ACCENT).bold())))
        .highlight_style(Style::new().fg(ACCENT).bold().reversed())
        .highlight_symbol("> ");
    frame.render_stateful_widget(list, area, &mut list_state);
}

fn format_row(s: &SongRow) -> Line<'static> {
    let dur = s.duration_ms.map(fmt_ms).unwrap_or_else(|| "--:--".into());
    let artist = s.artist.clone().unwrap_or_else(|| "<unknown>".into());
    Line::from(vec![
        Span::raw(format!("{:>6}  ", dur)).dim(),
        Span::raw(s.title.clone()).bold(),
        Span::raw("  "),
        Span::raw(artist).dim(),
    ])
}

fn fmt_ms(ms: u64) -> String {
    let total_s = ms / 1000;
    let m = total_s / 60;
    let s = total_s % 60;
    format!("{:02}:{:02}", m, s)
}
