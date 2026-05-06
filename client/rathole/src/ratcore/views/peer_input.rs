//! modal text-input for setting the active peer node id. centered
//! popup, single-line input, shows last error if any.

use ratatui::{
    layout::{Constraint::*, Flex, Layout, Rect},
    style::{Style, Stylize},
    text::{Line, Span},
    widgets::{Block, Clear, Paragraph},
    Frame,
};

use crate::ratcore::app::App;
use crate::ratcore::theme::ACCENT;

pub fn draw(frame: &mut Frame, app: &App) {
    let area = centered(frame.area(), 70, 7);
    frame.render_widget(Clear, area);

    let buf = &app.state.ephemeral.peer_input;
    let cursor = app.state.ephemeral.peer_cursor.min(buf.chars().count());
    // split buffer at the caret so we can render the block-cursor over
    // the character it sits on (or as a trailing block at end-of-line).
    let before: String = buf.chars().take(cursor).collect();
    let at: String = buf.chars().nth(cursor).map(String::from).unwrap_or_default();
    let after: String = buf.chars().skip(cursor + 1).collect();

    let cursor_span = if at.is_empty() {
        Span::styled("█", Style::new().fg(ACCENT))
    } else {
        Span::styled(at, Style::new().fg(ACCENT).bold().reversed())
    };

    let mut lines: Vec<Line> = vec![
        Line::from(vec![
            Span::styled("> ", Style::new().fg(ACCENT).bold()),
            Span::raw(before),
            cursor_span,
            Span::raw(after),
        ]),
        Line::from(""),
    ];

    if let Some(err) = &app.state.ephemeral.peer_error {
        lines.push(Line::from(vec![
            Span::raw("error: ").red().bold(),
            Span::raw(err.clone()),
        ]));
    } else {
        lines.push(Line::from(
            "type or paste a peer node id, then press enter".dim(),
        ));
    }

    let para = Paragraph::new(lines).block(
        Block::bordered()
            .title(Span::styled("connect to peer", Style::new().fg(ACCENT).bold()))
            .title_bottom("enter: connect   esc: cancel".dim()),
    );
    frame.render_widget(para, area);
}

fn centered(area: Rect, width: u16, height: u16) -> Rect {
    let [vert] = Layout::vertical([Length(height)])
        .flex(Flex::Center)
        .areas(area);
    let [horiz] = Layout::horizontal([Length(width)])
        .flex(Flex::Center)
        .areas(vert);
    horiz
}
