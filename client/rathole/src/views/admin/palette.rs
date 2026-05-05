//! admin command palette. left pane: scrolling list of every entry
//! in `grimoire::admin_dispatch::registry::all_commands()`. right
//! pane: details for the selected command + result of the most
//! recent dispatch.
//!
//! m0 dispatches with empty args (no typed forms yet — see
//! [docs/TUI_PLAN.md](../../../../docs/TUI_PLAN.md) m1).

use ratatui::{
    layout::{Constraint::*, Layout, Rect},
    style::Stylize,
    text::{Line, Span},
    widgets::{Block, List, ListItem, Paragraph, Wrap},
    Frame,
};

use crate::app::App;

pub fn draw(frame: &mut Frame, area: Rect, app: &mut App) {
    let [left, right] = Layout::horizontal([Length(40), Min(0)]).areas(area);

    let commands = grimoire::admin_dispatch::registry::all_commands();
    let items: Vec<ListItem> = commands
        .iter()
        .map(|c| ListItem::new(c.name))
        .collect();

    let list = List::new(items)
        .block(
            Block::bordered()
                .title(format!("commands ({})", commands.len()).cyan().bold()),
        )
        .highlight_style(ratatui::style::Style::new().reversed())
        .highlight_symbol("▶ ");

    frame.render_stateful_widget(list, left, &mut app.state.ephemeral.palette_list);

    draw_detail(frame, right, app);
}

fn draw_detail(frame: &mut Frame, area: Rect, app: &App) {
    let commands = grimoire::admin_dispatch::registry::all_commands();
    let selected = app.state.ephemeral.palette_list.selected().unwrap_or(0);
    let cmd = commands.get(selected);

    let [info_area, result_area] =
        Layout::vertical([Length(8), Min(0)]).areas(area);

    let info_lines = if let Some(c) = cmd {
        vec![
            Line::from(vec![
                Span::raw("name:           "),
                Span::raw(c.name).bold(),
            ]),
            Line::from(vec![
                Span::raw("request type:   "),
                Span::raw(c.request_type),
            ]),
            Line::from(vec![
                Span::raw("response type:  "),
                Span::raw(c.response_type),
            ]),
            Line::from(vec![
                Span::raw("auth:           "),
                Span::raw(c.auth.as_str()),
            ]),
        ]
    } else {
        vec![Line::from("no command selected".dim())]
    };
    frame.render_widget(
        Paragraph::new(info_lines)
            .block(Block::bordered().title("selected".cyan().bold()))
            .wrap(Wrap { trim: false }),
        info_area,
    );

    let result_text = match &app.state.ephemeral.last_dispatch {
        Some(d) => {
            let mut lines = vec![
                Line::from(vec![
                    Span::raw("command: "),
                    Span::raw(d.command.clone()).bold(),
                ]),
                Line::from(vec![
                    Span::raw("status:  "),
                    if d.success {
                        Span::raw("ok").green()
                    } else {
                        Span::raw("fail").red()
                    },
                ]),
                Line::from(vec![
                    Span::raw("message: "),
                    Span::raw(d.message.clone()),
                ]),
                Line::from(""),
            ];
            if let Some(pretty) = &d.data_pretty {
                for l in pretty.lines() {
                    lines.push(Line::from(l.to_string()));
                }
            }
            lines
        }
        None => vec![Line::from(
            "press enter to dispatch the selected command (m0: empty args)".dim(),
        )],
    };

    frame.render_widget(
        Paragraph::new(result_text)
            .block(Block::bordered().title("last dispatch".cyan().bold()))
            .wrap(Wrap { trim: false }),
        result_area,
    );
}
