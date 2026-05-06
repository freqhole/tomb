//! global player row. one or two lines that sit just above the
//! footer hints and are visible from every view (admin, music, peer
//! input, etc). compact, read-only — full player ui still lives in
//! the music view's now-playing pane.
//!
//! visibility rule: hidden (0 lines) when the player has never had
//! anything loaded — i.e. `PlayerState::Stopped` and no
//! `currently_playing()`. otherwise renders 2 lines: title/artist
//! + state, and a progress bar with times + volume.

use ratatui::{
    layout::Rect,
    style::{Style, Stylize},
    text::{Line, Span},
    widgets::Paragraph,
    Frame,
};

use crate::ratcore::{
    app::{App, Focus, PlayerState},
    player_row_keys::CONTROLS,
    theme::ACCENT,
};

/// returns the number of vertical lines the player row needs in the
/// global chrome layout. 0 when hidden, 2 when active.
pub fn height(app: &App) -> u16 {
    let m = &app.state.ephemeral.music;
    let has_track = m.currently_playing().is_some();
    let active = !matches!(m.player_state, PlayerState::Stopped) || has_track;
    if active {
        2
    } else {
        0
    }
}

pub fn draw(frame: &mut Frame, area: Rect, app: &App) {
    if area.height == 0 {
        return;
    }
    let m = &app.state.ephemeral.music;
    let now = m.currently_playing();

    let state_glyph = match m.player_state {
        PlayerState::Stopped => "■",
        PlayerState::Loading => "…",
        PlayerState::Playing => "▶",
        PlayerState::Paused => "⏸",
    };

    let title = now
        .map(|s| s.title.clone())
        .unwrap_or_else(|| "(nothing loaded)".into());
    let artist = now
        .and_then(|s| s.artist.clone())
        .unwrap_or_else(|| "—".into());

    // line 1: state glyph, title, artist, volume, controls (when
    // the row is focused, controls light up + cursor highlights one).
    let vol_pct = (m.volume * 100.0).round() as i32;
    let focused = matches!(app.state.ephemeral.focus, Focus::PlayerRow);
    let cur = app.state.ephemeral.player_row_cursor;
    let mut spans = vec![
        Span::styled(format!(" {state_glyph} "), Style::new().fg(ACCENT).bold()),
        Span::raw(title).bold(),
        Span::raw("  "),
        Span::raw(artist).dim(),
        Span::raw("  "),
        Span::raw(format!("vol {vol_pct}%")).dim(),
        Span::raw("  "),
    ];
    for (i, (label, action)) in CONTROLS.iter().enumerate() {
        let is_cursor = focused && i == cur;
        let style = if is_cursor {
            Style::new().fg(ACCENT).bold().reversed()
        } else if focused {
            Style::new().fg(ACCENT)
        } else {
            Style::new().dim()
        };
        // swap the heart glyph based on current_favorited; everything
        // else uses its static label.
        let display: &str = if matches!(
            action,
            crate::ratcore::player_row_keys::PlayerRowAction::Favorite,
        ) {
            if m.current_favorited { "♥" } else { "♡" }
        } else {
            label
        };
        spans.push(Span::styled(format!(" {display} "), style));
    }
    let line1 = Line::from(spans);

    // line 2: position, progress bar, total.
    let pos = fmt_ms(m.position_ms);
    let total = if m.duration_ms > 0 {
        fmt_ms(m.duration_ms)
    } else {
        "--:--".into()
    };
    // bar width = full area - " 00:00 " (7) - " 00:00 " (7) - 2 padding.
    let bar_width = (area.width as usize).saturating_sub(16);
    let bar = progress_bar(m.position_ms, m.duration_ms, bar_width);
    let line2 = Line::from(vec![
        Span::raw(format!(" {pos} ")).dim(),
        Span::styled(bar, Style::new().fg(ACCENT)),
        Span::raw(format!(" {total} ")).dim(),
    ]);

    let lines = if area.height >= 2 {
        vec![line1, line2]
    } else {
        vec![line1]
    };
    frame.render_widget(Paragraph::new(lines).on_dark_gray(), area);
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
