//! slash-completion flyout: a small bordered popup rendered above
//! the bottom repl row when the user has typed a partial command
//! and matches narrow. up/down navigate the cursor, tab completes
//! to the highlighted entry, enter still dispatches the input
//! as-is. drawn on top of the body via [`Clear`] so it doesn't
//! reflow anything else.

use ratatui::{
    layout::Rect,
    style::Style,
    text::{Line, Span},
    widgets::{Block, Clear, Paragraph},
    Frame,
};

use crate::ratcore::app::{App, Focus};
use crate::ratcore::theme::ACCENT;

/// max rows shown before the flyout starts scrolling internally.
const MAX_ROWS: u16 = 8;

/// draw the flyout above `repl_area`. no-op unless the repl is the
/// active focus and [`flyout_matches`](crate::ratcore::repl_keys::flyout_matches)
/// returns at least one match.
pub fn draw(frame: &mut Frame, repl_area: Rect, app: &App) {
    if app.state.ephemeral.focus != Focus::Repl {
        return;
    }
    let matches = crate::ratcore::repl_keys::flyout_matches(&app.state);
    if matches.is_empty() {
        return;
    }
    let cursor = app
        .state
        .ephemeral
        .repl
        .flyout_cursor
        .min(matches.len() - 1);

    let visible = (matches.len() as u16).min(MAX_ROWS);
    // borders take 2 lines.
    let height = visible + 2;
    if repl_area.y < height {
        // not enough vertical room above the repl row to render
        // the popup; skip silently.
        return;
    }

    let max_label = matches
        .iter()
        .map(|(l, _)| l.chars().count())
        .max()
        .unwrap_or(0);
    let max_desc = matches
        .iter()
        .map(|(_, d)| d.chars().count())
        .max()
        .unwrap_or(0);
    // " /label  \u2014 desc " plus 2-cell border padding on each side.
    let want_w = (max_label + max_desc + 8).clamp(20, repl_area.width as usize) as u16;

    let area = Rect {
        x: repl_area.x,
        y: repl_area.y - height,
        width: want_w.min(repl_area.width),
        height,
    };
    frame.render_widget(Clear, area);

    // scroll window so the cursor is always in view.
    let viewport = visible as usize;
    let top = if cursor >= viewport {
        cursor + 1 - viewport
    } else {
        0
    };

    let lines: Vec<Line> = matches
        .iter()
        .enumerate()
        .skip(top)
        .take(viewport)
        .map(|(i, (label, desc))| {
            let selected = i == cursor;
            let name_style = if selected {
                Style::new().fg(ACCENT).bold().reversed()
            } else {
                Style::new().fg(ACCENT)
            };
            let mut spans = vec![Span::styled(format!(" /{label}"), name_style)];
            if !desc.is_empty() {
                spans.push(Span::styled(
                    format!("  \u{2014} {desc} "),
                    Style::new().dim(),
                ));
            }
            Line::from(spans)
        })
        .collect();

    let title = format!(" {} matchz ", matches.len());
    frame.render_widget(
        Paragraph::new(lines)
            .block(Block::bordered().title(Span::styled(title, Style::new().fg(ACCENT).bold()))),
        area,
    );
}
