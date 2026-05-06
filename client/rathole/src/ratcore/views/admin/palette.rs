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

    // when a form is open, give it the entire right pane — args
    // previews, long help text, and the confirm summary all need
    // room to breathe. when not, the upper "selected" details box
    // is fixed at 8 lines and the rest is the resultz pane.
    if app.state.ephemeral.focus == Focus::CommandForm && app.state.ephemeral.form.is_some() {
        command_form::draw(frame, area, app);
        return;
    }

    let info_height = 8u16;
    let [info_area, result_area] = Layout::vertical([Length(info_height), Min(0)]).areas(area);

    draw_selected_box(frame, info_area, cmd);
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
    let Some(d) = &app.state.ephemeral.last_dispatch else {
        let title_style = title_style(app);
        let para = Paragraph::new(vec![Line::from(
            "press enter to dispatch the selected command (forms open inline if it has args)".dim(),
        )])
        .block(Block::bordered().title(Span::styled("resultz", title_style)));
        frame.render_widget(para, result_area);
        return;
    };

    // common header: command + status + message.
    let header_lines: Vec<Line> = vec![
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

    if d.rows.is_empty() {
        // no rows: show pretty json (or "(no data)") with vertical
        // scroll driven by `last_dispatch_scroll`.
        let mut lines = header_lines;
        lines.push(Line::from(""));
        if let Some(pretty) = &d.data_pretty {
            for l in pretty.lines() {
                lines.push(Line::from(l.to_string()));
            }
        } else {
            lines.push(Line::from("(no data)".dim()));
        }
        let viewport = result_area.height.saturating_sub(2);
        let max_scroll = (lines.len() as u16).saturating_sub(viewport);
        let scroll = app.state.ephemeral.last_dispatch_scroll.min(max_scroll);
        let title = if max_scroll > 0 {
            format!("resultz  [{}/{}]", scroll, max_scroll)
        } else {
            "resultz".to_string()
        };
        frame.render_widget(
            Paragraph::new(lines)
                .block(Block::bordered().title(Span::styled(title, title_style(app))))
                .wrap(Wrap { trim: false })
                .scroll((scroll, 0)),
            result_area,
        );
        return;
    }

    // rows: split into header + row list (auto-scrolling) + focused-row json.
    let cursor = d.cursor.min(d.rows.len() - 1);
    let header_h = (header_lines.len() as u16) + 2; // +2 for box borders
    let footer_summary = Line::from(vec![
        Span::raw("rows:    "),
        Span::styled(
            format!("{} / {}", cursor + 1, d.rows.len()),
            Style::new().fg(ACCENT).bold(),
        ),
        Span::raw("   "),
        Span::styled("(j/k navigate, a or enter for actions)", Style::new().dim()),
    ]);

    // give the row list ~40% of remaining vertical space, but at
    // least 5 rows when room exists; rest goes to focused-row json.
    let avail = result_area.height.saturating_sub(header_h);
    let list_h = (avail * 4 / 10).max(5).min(avail.saturating_sub(3));
    let detail_h = avail.saturating_sub(list_h);
    let [hdr_a, list_a, det_a] = Layout::vertical([
        Length(header_h),
        Length(list_h.max(3)),
        Length(detail_h.max(3)),
    ])
    .areas(result_area);

    // header box.
    let mut hdr_lines = header_lines.clone();
    hdr_lines.push(footer_summary);
    frame.render_widget(
        Paragraph::new(hdr_lines)
            .block(Block::bordered().title(Span::styled("resultz", title_style(app))))
            .wrap(Wrap { trim: false }),
        hdr_a,
    );

    // row list with auto-scroll: keep cursor on screen.
    let visible = list_a.height.saturating_sub(2) as usize;
    let row_top = if cursor >= visible.saturating_sub(1) {
        cursor + 1 - visible.max(1)
    } else {
        0
    };
    let mut row_lines: Vec<Line> = vec![];
    for (idx, row) in d.rows.iter().enumerate().skip(row_top).take(visible.max(1)) {
        let marker = if idx == cursor { "> " } else { "  " };
        let summary = row_summary(row);
        let style = if idx == cursor {
            Style::new().fg(ACCENT).bold()
        } else {
            Style::new()
        };
        row_lines.push(Line::from(vec![Span::styled(
            format!("{}{}", marker, summary),
            style,
        )]));
    }
    let list_title = format!("rows  ({} of {})", cursor + 1, d.rows.len());
    frame.render_widget(
        Paragraph::new(row_lines).block(
            Block::bordered().title(Span::styled(list_title, Style::new().fg(ACCENT).bold())),
        ),
        list_a,
    );

    // focused-row json detail with scroll.
    let mut det_lines: Vec<Line> = vec![];
    if let Some(focused_row) = d.rows.get(cursor) {
        let pretty =
            serde_json::to_string_pretty(focused_row).unwrap_or_else(|_| focused_row.to_string());
        for l in pretty.lines() {
            det_lines.push(Line::from(l.to_string()));
        }
    }
    let det_viewport = det_a.height.saturating_sub(2);
    let det_max_scroll = (det_lines.len() as u16).saturating_sub(det_viewport);
    let det_scroll = app.state.ephemeral.last_dispatch_scroll.min(det_max_scroll);
    let det_title = if det_max_scroll > 0 {
        format!(
            "focused row  [{}/{}]   shift+↑/↓ scrolls",
            det_scroll, det_max_scroll
        )
    } else {
        "focused row".to_string()
    };
    frame.render_widget(
        Paragraph::new(det_lines)
            .block(Block::bordered().title(Span::styled(det_title, Style::new().fg(ACCENT).bold())))
            .wrap(Wrap { trim: false })
            .scroll((det_scroll, 0)),
        det_a,
    );
}

fn title_style(app: &App) -> Style {
    if app.state.ephemeral.focus == Focus::ResultPanel {
        Style::new().fg(ACCENT).bold().reversed()
    } else {
        Style::new().fg(ACCENT).bold()
    }
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
        obj.get(k).and_then(|v| match v {
            serde_json::Value::String(s) => Some(s.clone()),
            serde_json::Value::Number(n) => Some(n.to_string()),
            serde_json::Value::Bool(b) => Some(b.to_string()),
            _ => None,
        })
    };
    // unified-search-style rows: `[type] title — subtitle`.
    if let Some(ty) = pick("type") {
        let title = pick("title").unwrap_or_else(|| pick("name").unwrap_or_default());
        let subtitle = pick("subtitle").unwrap_or_default();
        let mut s = format!("[{ty}] {title}");
        if !subtitle.is_empty() {
            s.push_str(&format!(" \u{2014} {subtitle}"));
        }
        return s;
    }
    let mut parts: Vec<String> = vec![];
    for k in [
        "name",
        "label",
        "username",
        "code",
        "filter_value",
        "node_id",
    ] {
        if let Some(v) = pick(k) {
            parts.push(format!("{}={}", k, v));
        }
    }
    if let Some(id) = pick("id") {
        parts.insert(0, format!("id={}", id));
    }
    if parts.is_empty() {
        let s = row.to_string();
        if s.len() > 80 {
            format!("{}…", &s[..80])
        } else {
            s
        }
    } else {
        parts.join("  ")
    }
}
