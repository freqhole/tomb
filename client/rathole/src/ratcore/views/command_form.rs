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
        // tailor the hint when the focused step is a multi-line text
        // editor — Enter inserts a newline, Tab advances.
        let is_long = form
            .fields
            .get(form.focused)
            .map(|f| matches!(f, FieldState::LongText { .. }))
            .unwrap_or(false);
        if is_long {
            "enter: newline   tab: next step   esc: cancel".to_string()
        } else {
            "←/→: pick   enter: next step   esc: cancel".to_string()
        }
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

    // LongText needs multi-line rendering; do it inline so we can
    // push more than one Line into `out`.
    if let (FieldState::LongText { buf, cursor }, ArgKind::LongText { placeholder }) =
        (state, &spec.kind)
    {
        if buf.is_empty() && !focused {
            out.push(Line::from(Span::styled(
                placeholder.clone(),
                Style::new().dim(),
            )));
            return out;
        }
        // split on '\n', keeping cursor positioning by char index.
        let total = buf.chars().count();
        let cur = (*cursor).min(total);
        // find which logical line the cursor is on, plus the column.
        let mut line_starts = vec![0usize];
        for (i, ch) in buf.chars().enumerate() {
            if ch == '\n' {
                line_starts.push(i + 1);
            }
        }
        let cursor_line = line_starts
            .iter()
            .rposition(|&s| s <= cur)
            .unwrap_or(0);
        let cursor_col = cur - line_starts[cursor_line];
        let lines_iter: Vec<&str> = if buf.is_empty() {
            vec![""]
        } else {
            // collect by splitting on '\n'; this preserves empty
            // trailing line if buf ends with newline.
            buf.split('\n').collect()
        };
        for (idx, line_text) in lines_iter.iter().enumerate() {
            let prefix = if focused && idx == 0 {
                "> "
            } else {
                "  "
            };
            let mut spans = vec![Span::styled(prefix, Style::new().fg(ACCENT).bold())];
            if focused && idx == cursor_line {
                let before: String = line_text.chars().take(cursor_col).collect();
                let at: String = line_text
                    .chars()
                    .nth(cursor_col)
                    .map(String::from)
                    .unwrap_or_default();
                let after: String = line_text.chars().skip(cursor_col + 1).collect();
                spans.push(Span::raw(before));
                if at.is_empty() {
                    spans.push(Span::styled("█", Style::new().fg(ACCENT)));
                } else {
                    spans.push(Span::styled(
                        at,
                        Style::new().fg(ACCENT).bold().reversed(),
                    ));
                }
                spans.push(Span::raw(after));
            } else {
                spans.push(Span::raw(line_text.to_string()));
            }
            out.push(Line::from(spans));
        }
        return out;
    }

    let body: Line<'static> = match (state, &spec.kind) {
        (FieldState::Text { buf, cursor }, ArgKind::Text { placeholder })
        | (FieldState::Number { buf, cursor, .. }, ArgKind::Number { placeholder, .. }) => {
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
        (FieldState::Bool { value }, ArgKind::Bool { .. }) => {
            let mut spans = vec![Span::styled(
                if focused { "> " } else { "  " },
                Style::new().fg(ACCENT).bold(),
            )];
            for (label, is_sel) in [("true", *value), ("false", !*value)] {
                let style = if is_sel {
                    Style::new().fg(ACCENT).bold().reversed()
                } else {
                    Style::new().dim()
                };
                spans.push(Span::styled(format!(" {} ", label), style));
                spans.push(Span::raw(" "));
            }
            Line::from(spans)
        }
        (FieldState::OptionalBool { value }, ArgKind::OptionalBool { .. }) => {
            let mut spans = vec![Span::styled(
                if focused { "> " } else { "  " },
                Style::new().fg(ACCENT).bold(),
            )];
            let states: [(&str, bool); 3] = [
                ("unset", value.is_none()),
                ("true", *value == Some(true)),
                ("false", *value == Some(false)),
            ];
            for (label, is_sel) in states {
                let style = if is_sel {
                    Style::new().fg(ACCENT).bold().reversed()
                } else {
                    Style::new().dim()
                };
                spans.push(Span::styled(format!(" {} ", label), style));
                spans.push(Span::raw(" "));
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
            (ArgKind::Text { .. }, FieldState::Text { buf, .. }) => {
                let trimmed = buf.trim();
                if trimmed.is_empty() {
                    if spec.required {
                        return Err(format!("`{}` is required", spec.name));
                    }
                } else {
                    map.insert(spec.name.clone(), serde_json::Value::String(trimmed.to_string()));
                }
            }
            (ArgKind::LongText { .. }, FieldState::LongText { buf, .. }) => {
                // multi-line: only strip leading/trailing whitespace,
                // preserve embedded newlines.
                let trimmed = buf.trim();
                if trimmed.is_empty() {
                    if spec.required {
                        return Err(format!("`{}` is required", spec.name));
                    }
                } else {
                    map.insert(spec.name.clone(), serde_json::Value::String(trimmed.to_string()));
                }
            }
            (ArgKind::Number { min, max, .. }, FieldState::Number { buf, .. }) => {
                let trimmed = buf.trim();
                if trimmed.is_empty() {
                    if spec.required {
                        return Err(format!("`{}` is required", spec.name));
                    }
                } else {
                    let parsed: i64 = trimmed.parse().map_err(|_| {
                        format!("`{}` must be a whole number, got `{}`", spec.name, trimmed)
                    })?;
                    if let Some(lo) = min {
                        if parsed < *lo {
                            return Err(format!("`{}` must be >= {}", spec.name, lo));
                        }
                    }
                    if let Some(hi) = max {
                        if parsed > *hi {
                            return Err(format!("`{}` must be <= {}", spec.name, hi));
                        }
                    }
                    map.insert(
                        spec.name.clone(),
                        serde_json::Value::Number(serde_json::Number::from(parsed)),
                    );
                }
            }
            (ArgKind::Bool { .. }, FieldState::Bool { value }) => {
                map.insert(spec.name.clone(), serde_json::Value::Bool(*value));
            }
            (ArgKind::OptionalBool { .. }, FieldState::OptionalBool { value }) => {
                match value {
                    Some(b) => {
                        map.insert(spec.name.clone(), serde_json::Value::Bool(*b));
                    }
                    None => {
                        if spec.required {
                            return Err(format!("`{}` is required", spec.name));
                        }
                        // unset + optional = drop the field entirely.
                    }
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
            (
                ArgKind::Mirror {
                    from_field,
                    source_row_field,
                },
                FieldState::Mirror,
            ) => {
                // find the sibling SelectFrom field by name; pull its
                // currently-selected row's `source_row_field`.
                let sibling_idx = cmd
                    .args
                    .iter()
                    .position(|a| &a.name == from_field)
                    .ok_or_else(|| {
                        format!("`{}` mirrors unknown field `{}`", spec.name, from_field)
                    })?;
                let sibling_state = form.fields.get(sibling_idx).ok_or_else(|| {
                    format!("`{}` mirrors missing field `{}`", spec.name, from_field)
                })?;
                let FieldState::SelectFrom {
                    options, selected, ..
                } = sibling_state
                else {
                    return Err(format!(
                        "`{}` can only mirror a SelectFrom field",
                        spec.name
                    ));
                };
                let opts = options.as_ref().ok_or_else(|| {
                    format!("`{}` source `{}` not loaded yet", spec.name, from_field)
                })?;
                if opts.is_empty() {
                    return Err(format!(
                        "`{}` source `{}` has no rows",
                        spec.name, from_field
                    ));
                }
                let sel = (*selected).min(opts.len() - 1);
                let raw = opts[sel].row.get(source_row_field).ok_or_else(|| {
                    format!(
                        "`{}` row missing field `{}`",
                        from_field, source_row_field
                    )
                })?;
                map.insert(spec.name.clone(), raw.clone());
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

/// build the request body for a `SelectFrom` field's source command.
/// starts from `source_body`; for each `(body_key, sibling_field)`
/// in `body_from_fields`, look the sibling up in `cmd.args` and pull
/// its currently-selected value off `form.fields`. errors out with
/// a friendly message if a sibling isn't ready yet.
pub fn build_select_source_body(
    cmd: &AdminCommand,
    form: &CommandForm,
    source_body: &serde_json::Value,
    body_from_fields: &[(String, String)],
) -> Result<serde_json::Value, String> {
    let mut body = source_body.clone();
    if body_from_fields.is_empty() {
        return Ok(body);
    }
    let obj = match body.as_object_mut() {
        Some(o) => o,
        None => {
            // source_body wasn't an object — replace with a fresh
            // map so we can splice the sibling values in.
            body = serde_json::Value::Object(serde_json::Map::new());
            body.as_object_mut().unwrap()
        }
    };
    for (body_key, sibling_name) in body_from_fields {
        let sib_idx = cmd
            .args
            .iter()
            .position(|a| &a.name == sibling_name)
            .ok_or_else(|| format!("source body refs unknown field `{}`", sibling_name))?;
        let sib_state = form
            .fields
            .get(sib_idx)
            .ok_or_else(|| format!("source body sibling `{}` missing", sibling_name))?;
        let value: serde_json::Value = match sib_state {
            FieldState::Text { buf, .. } | FieldState::LongText { buf, .. } => {
                if buf.trim().is_empty() {
                    return Err(format!("`{}` needs a value first", sibling_name));
                }
                serde_json::Value::String(buf.trim().to_string())
            }
            FieldState::SelectFrom {
                options, selected, ..
            } => {
                let opts = options.as_ref().ok_or_else(|| {
                    format!("`{}` not loaded yet — pick it first", sibling_name)
                })?;
                if opts.is_empty() {
                    return Err(format!("`{}` has no options", sibling_name));
                }
                let s = (*selected).min(opts.len() - 1);
                serde_json::Value::String(opts[s].value.clone())
            }
            FieldState::OneOf { selected } => {
                if let Some(ArgKind::OneOf { choices }) =
                    cmd.args.get(sib_idx).map(|a| &a.kind)
                {
                    let v = choices
                        .get(*selected)
                        .cloned()
                        .ok_or_else(|| format!("`{}` out of range", sibling_name))?;
                    serde_json::Value::String(v)
                } else {
                    return Err(format!("`{}` shape mismatch", sibling_name));
                }
            }
            _ => return Err(format!("`{}` not usable as a body source", sibling_name)),
        };
        obj.insert(body_key.clone(), value);
    }
    Ok(body)
}
