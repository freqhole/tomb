//! single-line `/` slash-command repl that lives just above the
//! footer hints. always present (1 line). when focused, shows a
//! cursor block and the user's input; when unfocused, shows the
//! most recent status line (or a hint to press ctrl-k).

use ratatui::{
    layout::Rect,
    style::{Style, Stylize},
    text::{Line, Span},
    widgets::Paragraph,
    Frame,
};

use crate::ratcore::{
    app::{App, Focus, ReplStatusLevel},
    theme::ACCENT,
};

pub fn draw(frame: &mut Frame, area: Rect, app: &App) {
    let focused = app.state.ephemeral.focus == Focus::Repl;
    let r = &app.state.ephemeral.repl;

    let prompt = Span::styled(
        if focused { " / " } else { " > " },
        Style::new().fg(ACCENT).bold(),
    );

    let line = if focused {
        // input + cursor block at the caret position.
        let chars: Vec<char> = r.input.chars().collect();
        let cursor = r.cursor.min(chars.len());
        let before: String = chars[..cursor].iter().collect();
        let at: String = chars
            .get(cursor)
            .map(|c| c.to_string())
            .unwrap_or_else(|| " ".to_string());
        let after: String = chars[cursor.saturating_add(1).min(chars.len())..]
            .iter()
            .collect();
        let after = if cursor >= chars.len() {
            String::new()
        } else {
            after
        };
        Line::from(vec![
            prompt,
            Span::raw(before),
            Span::styled(at, Style::new().on_white().black()),
            Span::raw(after),
        ])
    } else if !r.input.is_empty() {
        // not focused but holding pending input — show it dim.
        Line::from(vec![prompt, Span::raw(r.input.clone()).dim()])
    } else if let Some(status) = &r.status {
        let style = match status.level {
            ReplStatusLevel::Ok => Style::new().fg(ACCENT),
            ReplStatusLevel::Err => Style::new().red(),
            ReplStatusLevel::Info => Style::new().dim(),
        };
        Line::from(vec![prompt, Span::styled(status.message.clone(), style)])
    } else {
        Line::from(vec![prompt, Span::raw("").dim()])
    };

    frame.render_widget(Paragraph::new(line), area);
}
