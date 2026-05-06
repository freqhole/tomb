//! admin command palette. left pane: scrolling list of every entry
//! in `app.commands` (built by the shell). right pane: details for
//! the selected command + result of the most recent dispatch.
//!
//! m0 dispatches with empty args (no typed forms yet — see
//! [docs/TUI_PLAN.md](../../../../../docs/TUI_PLAN.md) m1).

use ratatui::{
    layout::{Constraint::*, Layout, Rect},
    style::{Style, Stylize},
    text::{Line, Span},
    widgets::{Block, List, ListItem, Paragraph, Wrap},
    Frame,
};

use crate::ratcore::theme::ACCENT;

use crate::ratcore::app::{App, Focus};
use crate::ratcore::views::command_form;

pub fn draw(frame: &mut Frame, area: Rect, app: &mut App) {
    let [left, right] = Layout::horizontal([Length(40), Min(0)]).areas(area);

    let items: Vec<ListItem> = app
        .commands
        .iter()
        .map(|c| ListItem::new(c.name.clone()))
        .collect();

    let list = List::new(items)
        .block(Block::bordered().title(Span::styled(
            format!("commands ({})", app.commands.len()),
            Style::new().fg(ACCENT).bold(),
        )))
        .highlight_style(ratatui::style::Style::new().reversed())
        .highlight_symbol("▶ ");

    frame.render_stateful_widget(list, left, &mut app.state.ephemeral.palette_list);

    draw_detail(frame, right, app);
}

fn draw_detail(frame: &mut Frame, area: Rect, app: &App) {
    let selected = app.state.ephemeral.palette_list.selected().unwrap_or(0);
    let cmd = app.commands.get(selected);

    // give the form a bit more vertical room than the static
    // "selected" details box (each field renders as label + value
    // + optional help line).
    let info_height = if app.state.ephemeral.focus == Focus::CommandForm {
        app.state
            .ephemeral
            .form
            .as_ref()
            .map(|f| (f.fields.len() as u16 * 4).clamp(8, area.height.saturating_sub(6)))
            .unwrap_or(8)
    } else {
        8
    };
    let [info_area, result_area] = Layout::vertical([Length(info_height), Min(0)]).areas(area);

    if app.state.ephemeral.focus == Focus::CommandForm && app.state.ephemeral.form.is_some() {
        command_form::draw(frame, info_area, app);
    } else {
        draw_selected_box(frame, info_area, cmd);
    }

    draw_result_box(frame, result_area, app);
}

fn draw_selected_box(
    frame: &mut Frame,
    info_area: Rect,
    cmd: Option<&crate::ratcore::app::AdminCommand>,
) {
    let info_lines = if let Some(c) = cmd {
        let kind_label = match &c.kind {
            crate::ratcore::app::CommandKind::Admin => "admin".to_string(),
            crate::ratcore::app::CommandKind::Public { route, method } => {
                format!("public ({} {})", method, route)
            }
        };
        vec![
            Line::from(vec![
                Span::raw("name:           "),
                Span::raw(c.name.clone()).bold(),
            ]),
            Line::from(vec![
                Span::raw("request type:   "),
                Span::raw(c.request_type.clone()),
            ]),
            Line::from(vec![
                Span::raw("response type:  "),
                Span::raw(c.response_type.clone()),
            ]),
            Line::from(vec![
                Span::raw("auth:           "),
                Span::raw(c.auth.clone()),
            ]),
            Line::from(vec![Span::raw("channel:        "), Span::raw(kind_label)]),
            Line::from(vec![
                Span::raw("args:           "),
                Span::raw(if c.args.is_empty() {
                    "(none)".to_string()
                } else {
                    c.args
                        .iter()
                        .map(|a| a.name.clone())
                        .collect::<Vec<_>>()
                        .join(", ")
                }),
            ]),
        ]
    } else {
        vec![Line::from("no command selected".dim())]
    };
    frame.render_widget(
        Paragraph::new(info_lines)
            .block(
                Block::bordered().title(Span::styled("selected", Style::new().fg(ACCENT).bold())),
            )
            .wrap(Wrap { trim: false }),
        info_area,
    );
}

fn draw_result_box(frame: &mut Frame, result_area: Rect, app: &App) {
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
                Line::from(vec![Span::raw("message: "), Span::raw(d.message.clone())]),
            ];
            if !d.rows.is_empty() {
                let cursor = d.cursor.min(d.rows.len().saturating_sub(1));
                lines.push(Line::from(vec![
                    Span::raw("rows:    "),
                    Span::styled(
                        format!("{} / {}", cursor + 1, d.rows.len()),
                        Style::new().fg(ACCENT).bold(),
                    ),
                    Span::raw("   "),
                    Span::styled("(j/k navigate, a or enter for actions)", Style::new().dim()),
                ]));
            }
            lines.push(Line::from(""));
            if !d.rows.is_empty() {
                let cursor = d.cursor.min(d.rows.len().saturating_sub(1));
                for (idx, row) in d.rows.iter().enumerate() {
                    let marker = if idx == cursor { "> " } else { "  " };
                    let summary = row_summary(row);
                    let style = if idx == cursor {
                        Style::new().fg(ACCENT).bold()
                    } else {
                        Style::new()
                    };
                    lines.push(Line::from(vec![Span::styled(
                        format!("{}{}", marker, summary),
                        style,
                    )]));
                }
                if let Some(focused_row) = d.rows.get(cursor) {
                    lines.push(Line::from(""));
                    lines.push(Line::from(Span::styled("focused row:", Style::new().dim())));
                    let pretty = serde_json::to_string_pretty(focused_row)
                        .unwrap_or_else(|_| focused_row.to_string());
                    for l in pretty.lines() {
                        lines.push(Line::from(l.to_string()));
                    }
                }
            } else if let Some(pretty) = &d.data_pretty {
                for l in pretty.lines() {
                    lines.push(Line::from(l.to_string()));
                }
            }
            lines
        }
        None => vec![Line::from(
            "press enter to dispatch the selected command (forms open inline if it has args)".dim(),
        )],
    };

    // clamp the scroll offset to the actual content height. the
    // inner-area height excludes the border, hence the -2.
    let content_lines = result_text.len() as u16;
    let viewport = result_area.height.saturating_sub(2);
    let max_scroll = content_lines.saturating_sub(viewport);
    let scroll = app.state.ephemeral.last_dispatch_scroll.min(max_scroll);

    let title_style = if app.state.ephemeral.focus == Focus::ResultPanel {
        Style::new().fg(ACCENT).bold().reversed()
    } else {
        Style::new().fg(ACCENT).bold()
    };
    let title = if max_scroll > 0 {
        format!("last dispatch  [{}/{}]", scroll, max_scroll)
    } else {
        "last dispatch".to_string()
    };

    frame.render_widget(
        Paragraph::new(result_text)
            .block(Block::bordered().title(Span::styled(title, title_style)))
            .wrap(Wrap { trim: false })
            .scroll((scroll, 0)),
        result_area,
    );
}

/// produce a one-line, vaguely-readable summary of a JSON-object row
/// for the result-pane row list. picks a few common identifying keys
/// (name, label, username, code, id) when present; falls back to the
/// row's serialized form (truncated) otherwise.
fn row_summary(row: &serde_json::Value) -> String {
    let Some(obj) = row.as_object() else {
        return row.to_string();
    };
    let pick = |k: &str| -> Option<String> {
        obj.get(k)
            .and_then(|v| match v {
                serde_json::Value::String(s) => Some(s.clone()),
                serde_json::Value::Number(n) => Some(n.to_string()),
                serde_json::Value::Bool(b) => Some(b.to_string()),
                _ => None,
            })
    };
    let mut parts: Vec<String> = vec![];
    for k in ["name", "label", "username", "code", "filter_value", "node_id"] {
        if let Some(v) = pick(k) {
            parts.push(format!("{}={}", k, v));
        }
    }
    if let Some(id) = pick("id") {
        parts.insert(0, format!("id={}", id));
    }
    if parts.is_empty() {
        let s = row.to_string();
        if s.len() > 80 { format!("{}…", &s[..80]) } else { s }
    } else {
        parts.join("  ")
    }
}
