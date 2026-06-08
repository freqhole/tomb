//! list view for saved remotes ([`Focus::RemoteList`]).
//!
//! shells fill [`EphemeralState::remotes_view`] from their storage
//! (web reads spume's IndexedDB; tty would read grimoire's `remotez`
//! table — not wired today). this module is render-only.

use ratatui::{
    layout::{Constraint::*, Flex, Layout, Rect},
    style::{Color, Style, Stylize},
    text::{Line, Span},
    widgets::{Block, Clear, List, ListItem, ListState, Paragraph},
    Frame,
};

use crate::ratcore::app::App;
use crate::ratcore::theme::ACCENT;

pub fn draw(frame: &mut Frame, app: &App) {
    let area = centered(frame.area(), 78, 22);
    frame.render_widget(Clear, area);

    let block = Block::bordered()
        .title(Span::styled("remotes", Style::new().fg(ACCENT).bold()))
        .title_bottom(
            Line::from(vec![
                Span::styled("\u{2191}/\u{2193}", Style::new().fg(ACCENT)),
                Span::raw(" select  "),
                Span::styled("enter", Style::new().fg(ACCENT)),
                Span::raw(" connect  "),
                Span::styled("a", Style::new().fg(ACCENT)),
                Span::raw(" add  "),
                Span::styled("d", Style::new().fg(ACCENT)),
                Span::raw(" delete  "),
                Span::styled("esc", Style::new().fg(ACCENT)),
                Span::raw(" back"),
            ])
            .right_aligned(),
        );
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let remotes = &app.state.ephemeral.remotes_view;
    let cursor = app.state.ephemeral.remotes_view_cursor;
    let active_peer = app.state.ephemeral.connected_peer.clone();

    if remotes.is_empty() {
        let lines = vec![
            Line::from(""),
            Line::from(Span::raw("no saved remotes yet").dim()).centered(),
            Line::from(""),
            Line::from(Span::raw("press `a` to add one, or `esc` to go back").dim()).centered(),
        ];
        frame.render_widget(Paragraph::new(lines), inner);
        return;
    }

    let items: Vec<ListItem> = remotes
        .iter()
        .map(|r| {
            let is_active = active_peer
                .as_deref()
                .map(|p| Some(p) == r.peer_addr.as_deref())
                .unwrap_or(false);
            let prefix = if is_active { "* " } else { "  " };
            let name = if r.name.is_empty() {
                "(unnamed)".to_string()
            } else {
                r.name.clone()
            };
            let addr_short = r
                .peer_addr
                .as_deref()
                .map(|a| {
                    let n = a.len().min(16);
                    format!("{}\u{2026}", &a[..n])
                })
                .unwrap_or_else(|| "(no addr)".to_string());

            let name_span = if is_active {
                Span::styled(name, Style::new().fg(ACCENT).bold())
            } else {
                Span::styled(name, Style::new().fg(Color::White).bold())
            };

            ListItem::new(Line::from(vec![
                Span::raw(prefix),
                name_span,
                Span::raw("  "),
                Span::raw(addr_short).dim(),
                Span::raw("  "),
                Span::styled(format!("[{}]", r.transport), Style::new().dim()),
            ]))
        })
        .collect();

    let mut list_state = ListState::default();
    list_state.select(Some(cursor.min(remotes.len().saturating_sub(1))));
    let list = List::new(items)
        .highlight_style(Style::new().bg(Color::DarkGray))
        .highlight_symbol("> ");
    frame.render_stateful_widget(list, inner, &mut list_state);
}

fn centered(area: Rect, width: u16, height: u16) -> Rect {
    let w = width.min(area.width);
    let h = height.min(area.height);
    let [vert] = Layout::vertical([Length(h)]).flex(Flex::Center).areas(area);
    let [horiz] = Layout::horizontal([Length(w)])
        .flex(Flex::Center)
        .areas(vert);
    horiz
}
