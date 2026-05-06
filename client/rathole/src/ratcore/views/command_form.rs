//! generic inline form for filling in a command's args.
//!
//! rendered inside the admin palette's right pane (replacing the
//! "selected" details box) when `app.state.ephemeral.form` is set.
//! see [`super::admin::palette`] for the layout glue.
//!
//! conventions:
//! - tab / shift-tab: move focus between fields (skips
//!   [`FieldState::HiddenLocalNodeId`])
//! - enter: submit the form
//! - esc: cancel and return to the palette
//! - any printable char / backspace / arrow keys: edit the focused
//!   field (only [`FieldState::Text`] is editable today)
//!
//! [`crate::ratcore::text_input`] backs all the editing.

use ratatui::{
    layout::Rect,
    style::{Style, Stylize},
    text::{Line, Span},
    widgets::{Block, Paragraph, Wrap},
    Frame,
};

use crate::ratcore::app::{AdminCommand, App, ArgKind, ArgSpec, CommandForm, FieldState};
use crate::ratcore::theme::ACCENT;

/// render the form into `area`. caller is responsible for sizing
/// (palette gives us the same slot the "selected" panel occupies).
///
/// rendering is wizard-style: only the focused field (or the
/// confirm step) is shown; a small header tells the user what
/// step they're on.
pub fn draw(frame: &mut Frame, area: Rect, app: &App) {
    let Some(form) = app.state.ephemeral.form.as_ref() else {
        return;
    };
    let Some(cmd) = app.commands.iter().find(|c| c.name == form.command) else {
        return;
    };

    let (step, total) = form.step();
    let mut lines: Vec<Line> = Vec::new();
    lines.push(Line::from(vec![
        Span::raw("command: "),
        Span::raw(cmd.name.clone()).bold(),
        Span::raw("    "),
        Span::styled(format!("step {} of {}", step, total), Style::new().dim()),
    ]));
    lines.push(Line::from(""));

    if form.confirming {
        lines.push(Line::styled(
            "confirm + submit",
            Style::new().fg(ACCENT).bold(),
        ));
        lines.push(Line::from(""));
        match build_body(cmd, form, app.state.ephemeral.local_node_id.as_deref()) {
            Ok(body) => {
                let pretty = serde_json::to_string_pretty(&body).unwrap_or_default();
                for raw_line in pretty.lines() {
                    lines.push(Line::raw(raw_line.to_string()));
                }
            }
            Err(e) => {
                lines.push(Line::from(vec![
                    Span::raw("error: ").red().bold(),
                    Span::raw(e),
                ]));
            }
        }
    } else if let (Some(spec), Some(state)) = (
        cmd.args.get(form.focused),
        form.fields.get(form.focused),
    ) {
        // single-field view, with its label/help/value rendered
        // exactly like the multi-field renderer used to.
        for line in render_field(spec, state, true) {
            lines.push(line);
        }
    }

    if form.inflight {
        lines.push(Line::from(""));
        lines.push(Line::from("submitting…".dim()));
    } else if let Some(err) = &form.error {
        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::raw("error: ").red().bold(),
            Span::raw(err.clone()),
        ]));
    }

    let title = format!("{} (form)", cmd.name);
    let hint = if form.confirming {
        "enter: submit   esc: back".to_string()
    } else {
        "←/→: pick   enter: next step   esc: cancel".to_string()
    };
    let para = Paragraph::new(lines)
        .block(
            Block::bordered()
                .title(Span::styled(title, Style::new().fg(ACCENT).bold()))
                .title_bottom(Span::styled(hint, Style::new().dim())),
        )
        .wrap(Wrap { trim: false });
    frame.render_widget(para, area);
}

fn render_field(spec: &ArgSpec, state: &FieldState, focused: bool) -> Vec<Line<'static>> {
    let label_style = if focused {
        Style::new().fg(ACCENT).bold()
    } else {
        Style::new().bold()
    };
    let label = if spec.required {
        format!("{} *", spec.name)
    } else {
        spec.name.clone()
    };
    let mut out = vec![Line::from(Span::styled(label, label_style))];

    let body: Line<'static> = match (state, &spec.kind) {
        (FieldState::Text { buf, cursor }, ArgKind::Text { placeholder })
        | (FieldState::Text { buf, cursor }, ArgKind::LongText { placeholder }) => {
            if buf.is_empty() && !focused {
                Line::from(Span::styled(placeholder.clone(), Style::new().dim()))
            } else {
                let cur = (*cursor).min(buf.chars().count());
                let before: String = buf.chars().take(cur).collect();
                let at: String = buf.chars().nth(cur).map(String::from).unwrap_or_default();
                let after: String = buf.chars().skip(cur + 1).collect();
                let prefix = if focused { "> " } else { "  " };
                let mut spans = vec![Span::styled(prefix, Style::new().fg(ACCENT).bold())];
                spans.push(Span::raw(before));
                if focused {
                    if at.is_empty() {
                        spans.push(Span::styled("█", Style::new().fg(ACCENT)));
                    } else {
                        spans.push(Span::styled(
                            at,
                            Style::new().fg(ACCENT).bold().reversed(),
                        ));
                    }
                } else if !at.is_empty() {
                    spans.push(Span::raw(at));
                }
                spans.push(Span::raw(after));
                Line::from(spans)
            }
        }
        (FieldState::OneOf { selected }, ArgKind::OneOf { choices }) => {
            let mut spans = vec![Span::styled(
                if focused { "> " } else { "  " },
                Style::new().fg(ACCENT).bold(),
            )];
            for (i, c) in choices.iter().enumerate() {
                let style = if i == *selected {
                    Style::new().fg(ACCENT).bold().reversed()
                } else {
                    Style::new().dim()
                };
                spans.push(Span::styled(format!(" {} ", c), style));
                if i + 1 < choices.len() {
                    spans.push(Span::raw(" "));
                }
            }
            Line::from(spans)
        }
        (
            FieldState::SelectFrom {
                options,
                loading,
                error,
                selected,
            },
            ArgKind::SelectFrom { source_command, .. },
        ) => {
            let prefix = if focused { "> " } else { "  " };
            if *loading {
                Line::from(vec![
                    Span::styled(prefix, Style::new().fg(ACCENT).bold()),
                    Span::styled(
                        format!("loading {}…", source_command),
                        Style::new().dim(),
                    ),
                ])
            } else if let Some(err) = error {
                Line::from(vec![
                    Span::styled(prefix, Style::new().fg(ACCENT).bold()),
                    Span::styled(format!("error: {}", err), Style::new().red()),
                ])
            } else if let Some(opts) = options {
                if opts.is_empty() {
                    Line::from(vec![
                        Span::styled(prefix, Style::new().fg(ACCENT).bold()),
                        Span::styled(
                            format!("(no {} found)", source_command),
                            Style::new().dim(),
                        ),
                    ])
                } else {
                    let sel = (*selected).min(opts.len() - 1);
                    let opt = &opts[sel];
                    let style = if focused {
                        Style::new().fg(ACCENT).bold().reversed()
                    } else {
                        Style::new().fg(ACCENT)
                    };
                    Line::from(vec![
                        Span::styled(prefix, Style::new().fg(ACCENT).bold()),
                        Span::styled(format!(" {} ", opt.label.clone()), style),
                        Span::styled(
                            format!("  ({}/{})", sel + 1, opts.len()),
                            Style::new().dim(),
                        ),
                    ])
                }
            } else {
                Line::from(vec![
                    Span::styled(prefix, Style::new().fg(ACCENT).bold()),
                    Span::styled("(focus to load)", Style::new().dim()),
                ])
            }
        }
        _ => Line::from(""),
    };
    out.push(body);

    if let Some(help) = &spec.help {
        out.push(Line::from(Span::styled(
            format!("  {}", help),
            Style::new().dim(),
        )));
    }
    out
}

/// build a JSON args body from the form, or return `Err(message)` if a
/// required field is missing or the local node id is not yet known.
/// the form remains open on `Err`; the caller surfaces `message`
/// in `form.error`.
pub fn build_body(
    cmd: &AdminCommand,
    form: &CommandForm,
    local_node_id: Option<&str>,
) -> Result<serde_json::Value, String> {
    let mut map = serde_json::Map::new();
    for (spec, state) in cmd.args.iter().zip(form.fields.iter()) {
        match (&spec.kind, state) {
            (ArgKind::Text { .. }, FieldState::Text { buf, .. })
            | (ArgKind::LongText { .. }, FieldState::Text { buf, .. }) => {
                let trimmed = buf.trim();
                if trimmed.is_empty() {
                    if spec.required {
                        return Err(format!("`{}` is required", spec.name));
                    }
                } else {
                    map.insert(spec.name.clone(), serde_json::Value::String(trimmed.to_string()));
                }
            }
            (ArgKind::OneOf { choices }, FieldState::OneOf { selected }) => {
                let val = choices
                    .get(*selected)
                    .cloned()
                    .ok_or_else(|| format!("`{}` selection out of range", spec.name))?;
                map.insert(spec.name.clone(), serde_json::Value::String(val));
            }
            (
                ArgKind::SelectFrom { .. },
                FieldState::SelectFrom {
                    options, selected, ..
                },
            ) => {
                let opts = options
                    .as_ref()
                    .ok_or_else(|| format!("`{}` not loaded yet", spec.name))?;
                if opts.is_empty() {
                    return Err(format!("`{}` has no options to pick from", spec.name));
                }
                let sel = (*selected).min(opts.len() - 1);
                map.insert(
                    spec.name.clone(),
                    serde_json::Value::String(opts[sel].value.clone()),
                );
            }
            (ArgKind::HiddenLocalNodeId, FieldState::HiddenLocalNodeId) => {
                let id = local_node_id
                    .ok_or_else(|| "local node id not ready yet".to_string())?;
                map.insert(spec.name.clone(), serde_json::Value::String(id.to_string()));
            }
            _ => return Err(format!("field `{}` shape mismatch", spec.name)),
        }
    }
    Ok(serde_json::Value::Object(map))
}
