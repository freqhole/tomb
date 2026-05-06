//! music view — search box, results list, now-playing status bar.
//!
//! key map (shell handles input; this file is render-only):
//!
//! - `Search` mode:
//!   - type / paste: edit query
//!   - enter: run search → moves to `Results`
//!   - tab / down: jump to results list
//!   - esc: back to admin palette
//!
//! - `Results` mode:
//!   - j/k or up/down: move cursor
//!   - enter: load results[cursor..] into queue and play from cursor
//!   - space: toggle play/pause
//!   - n/p: next/previous track
//!   - left/right: seek -/+ 5s
//!   - -/=: volume down/up
//!   - /: jump back to search box (preserves text)
//!   - esc: back to admin palette
//!   - tab: focus the now-playing bar (no-op for now; reserved)

use ratatui::{
    layout::{Constraint::*, Layout, Rect},
    style::{Style, Stylize},
    text::{Line, Span},
    widgets::{Block, List, ListItem, ListState, Paragraph},
    Frame,
};

use crate::ratcore::app::{App, MusicMode, PlayerState, SongRow};
use crate::ratcore::theme::ACCENT;

pub fn draw(frame: &mut Frame, area: Rect, app: &mut App) {
    let [search, results, status] =
        Layout::vertical([Length(3), Min(0), Length(3)]).areas(area);
    draw_search(frame, search, app);
    draw_results(frame, results, app);
    draw_status(frame, status, app);
}

fn draw_search(frame: &mut Frame, area: Rect, app: &App) {
    let m = &app.state.ephemeral.music;
    let focused = m.mode == MusicMode::Search;
    let buf = &m.query;
    let cursor = m.query_cursor.min(buf.chars().count());
    let before: String = buf.chars().take(cursor).collect();
    let at: String = buf.chars().nth(cursor).map(String::from).unwrap_or_default();
    let after: String = buf.chars().skip(cursor + 1).collect();

    let cursor_span = if !focused {
        Span::raw("")
    } else if at.is_empty() {
        Span::styled("█", Style::new().fg(ACCENT))
    } else {
        Span::styled(at.clone(), Style::new().fg(ACCENT).bold().reversed())
    };

    let line = if focused {
        Line::from(vec![
            Span::styled("> ", Style::new().fg(ACCENT).bold()),
            Span::raw(before),
            cursor_span,
            Span::raw(after),
        ])
    } else {
        let display = if buf.is_empty() {
            "(empty — press / to search)".dim().italic()
        } else {
            Span::raw(buf.clone())
        };
        Line::from(vec![Span::raw("  "), display])
    };

    let mut title = "search".to_string();
    if m.searching {
        title.push_str("  (searching…)");
    }
    let mut block = Block::bordered().title(Span::styled(title, Style::new().fg(ACCENT).bold()));
    if let Some(err) = &m.search_error {
        block = block.title_bottom(format!("error: {err}").red().bold());
    }
    frame.render_widget(Paragraph::new(line).block(block), area);
}

fn draw_results(frame: &mut Frame, area: Rect, app: &mut App) {
    let m = &app.state.ephemeral.music;
    let items: Vec<ListItem> = if m.results.is_empty() {
        vec![ListItem::new(
            Line::from("(no results — type a query above and press enter)".dim()),
        )]
    } else {
        m.results
            .iter()
            .enumerate()
            .map(|(i, s)| ListItem::new(format_row(s, m.currently_playing().map(|c| (i, c, &m.results)))))
            .collect()
    };
    let mut list_state = ListState::default();
    if !m.results.is_empty() {
        list_state.select(Some(m.results_cursor.min(m.results.len() - 1)));
    }
    let title = format!("results  ({}) ", m.results.len());
    let highlight = if m.mode == MusicMode::Results {
        Style::new().fg(ACCENT).bold().reversed()
    } else {
        Style::new().dim()
    };
    let list = List::new(items)
        .block(Block::bordered().title(Span::styled(title, Style::new().fg(ACCENT).bold())))
        .highlight_style(highlight)
        .highlight_symbol("> ");
    frame.render_stateful_widget(list, area, &mut list_state);
}

fn format_row(s: &SongRow, _now: Option<(usize, &SongRow, &Vec<SongRow>)>) -> Line<'static> {
    let dur = s.duration_ms.map(fmt_ms).unwrap_or_else(|| "--:--".into());
    let artist = s.artist.clone().unwrap_or_else(|| "<unknown>".into());
    Line::from(vec![
        Span::raw(format!("{:>6}  ", dur)).dim(),
        Span::raw(s.title.clone()).bold(),
        Span::raw("  "),
        Span::raw(artist).dim(),
    ])
}

fn draw_status(frame: &mut Frame, area: Rect, app: &App) {
    let m = &app.state.ephemeral.music;
    let state_label = match m.player_state {
        PlayerState::Stopped => "stopped",
        PlayerState::Loading => "loading",
        PlayerState::Playing => "playing",
        PlayerState::Paused => "paused",
    };
    let now = m.currently_playing();
    let title = now
        .map(|s| s.title.clone())
        .unwrap_or_else(|| "(nothing playing)".into());
    let artist = now
        .and_then(|s| s.artist.clone())
        .unwrap_or_else(|| "—".into());
    let pos = fmt_ms(m.position_ms);
    let total = if m.duration_ms > 0 {
        fmt_ms(m.duration_ms)
    } else {
        "--:--".into()
    };
    let bar = progress_bar(m.position_ms, m.duration_ms, area.width.saturating_sub(4) as usize);
    let vol_pct = (m.volume * 100.0).round() as i32;
    let header = Line::from(vec![
        Span::styled(format!("[{state_label}] "), Style::new().fg(ACCENT).bold()),
        Span::raw(title).bold(),
        Span::raw("   "),
        Span::raw(artist).dim(),
        Span::raw("   "),
        Span::raw(format!("vol {vol_pct}%")).dim(),
    ]);
    let progress = Line::from(vec![
        Span::raw(format!("{pos} ")).dim(),
        Span::styled(bar, Style::new().fg(ACCENT)),
        Span::raw(format!(" {total}")).dim(),
    ]);
    let mut lines = vec![header, progress];
    if let Some(err) = &m.last_event_error {
        lines.push(Line::from(vec![
            Span::raw("err: ").red().bold(),
            Span::raw(err.clone()),
        ]));
    }
    let block = Block::bordered().title(Span::styled("now playing", Style::new().fg(ACCENT).bold()));
    frame.render_widget(Paragraph::new(lines).block(block), area);
}

fn progress_bar(pos: u64, total: u64, width: usize) -> String {
    if width == 0 {
        return String::new();
    }
    if total == 0 {
        return "─".repeat(width);
    }
    let frac = (pos as f64 / total as f64).clamp(0.0, 1.0);
    let filled = (frac * width as f64).round() as usize;
    let mut s = String::with_capacity(width);
    for _ in 0..filled {
        s.push('█');
    }
    for _ in filled..width {
        s.push('░');
    }
    s
}

fn fmt_ms(ms: u64) -> String {
    let total_s = ms / 1000;
    let m = total_s / 60;
    let s = total_s % 60;
    format!("{:02}:{:02}", m, s)
}
