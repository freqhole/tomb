//! video view — browse, detail, and edit modes.
//!
//! key map (shell handles input; this file is render-only):
//! - Results mode:
//!   - j/k or up/down: move cursor
//!   - enter: show detail for selected video
//!   - d: delete selected video (with confirmation)
//!   - e: edit selected video
//!   - esc: back to landing
//! - Detail mode:
//!   - e: enter edit mode
//!   - d: delete video (with confirmation)
//!   - r: browse transcoded renditions
//!   - esc: back to results
//! - Edit mode:
//!   - tab: cycle through fields
//!   - enter: save changes
//!   - esc: cancel and return to detail
//!   - standard text editing keys within fields
//! - Renditions mode:
//!   - up/down: move cursor
//!   - d: hard-delete selected rendition (with confirmation)
//!   - y/n: confirm/cancel a pending hard-delete
//!   - esc: back to detail

use ratatui::{
    layout::Rect,
    style::{Style, Stylize},
    text::{Line, Span},
    widgets::{Block, List, ListItem, ListState, Paragraph, Wrap},
    Frame,
};

use crate::ratcore::app::{App, VideoMode};
use crate::ratcore::theme::ACCENT;

pub fn draw(frame: &mut Frame, area: Rect, app: &mut App) {
    let v = &app.state.ephemeral.video;
    match v.mode {
        VideoMode::Results => draw_results(frame, area, app),
        VideoMode::Detail => draw_detail(frame, area, app),
        VideoMode::Edit => draw_edit(frame, area, app),
        VideoMode::Renditions => draw_renditions(frame, area, app),
    }
}

fn draw_results(frame: &mut Frame, area: Rect, app: &mut App) {
    let v = &app.state.ephemeral.video;
    let items: Vec<ListItem> = if v.results.is_empty() {
        let hint = if let Some(err) = &v.search_error {
            format!("search failed: {err}")
        } else if v.searching {
            "(loading\u{2026})".to_string()
        } else if !v.query.is_empty() {
            format!("(no results for `{}` — try /video <query>)", v.query)
        } else {
            "(empty — press ctrl-k then `/video` to search, or `/video-list` for recent videos)"
                .to_string()
        };
        vec![ListItem::new(Line::from(hint.dim()))]
    } else {
        v.results
            .iter()
            .map(|vr| ListItem::new(format_row(vr)))
            .collect()
    };
    let mut list_state = ListState::default();
    if !v.results.is_empty() {
        list_state.select(Some(v.results_cursor.min(v.results.len() - 1)));
    }
    let mut title = format!("videos  ({})", v.results.len());
    if v.searching {
        title.push_str("  — searching…");
    }
    if v.pending_delete_confirm {
        title.push_str("  — press y to confirm delete, n to cancel");
    }
    let list = List::new(items)
        .block(Block::bordered().title(Span::styled(title, Style::new().fg(ACCENT).bold())))
        .highlight_style(Style::new().fg(ACCENT).bold().reversed())
        .highlight_symbol("> ");
    frame.render_stateful_widget(list, area, &mut list_state);
}

fn draw_detail(frame: &mut Frame, area: Rect, app: &mut App) {
    let v = &app.state.ephemeral.video;
    let Some(video) = &v.selected_video else {
        frame.render_widget(Paragraph::new("(no video selected)").dim(), area);
        return;
    };

    let mut lines = vec![
        Line::from(vec![
            Span::styled("Title: ", Style::new().bold()),
            Span::raw(&video.title),
        ]),
        Line::from(""),
    ];

    if let Some(desc) = &video.description {
        lines.push(Line::from(vec![
            Span::styled("Description: ", Style::new().bold()),
            Span::raw(desc),
        ]));
        lines.push(Line::from(""));
    }

    if let Some(series_id) = &video.series_id {
        let series_name = video
            .series_name
            .as_ref()
            .map(|s| s.as_str())
            .unwrap_or("<unknown>");
        lines.push(Line::from(vec![
            Span::styled("Series: ", Style::new().bold()),
            Span::raw(format!("{} ({})", series_name, series_id)),
        ]));
    }

    if let Some(episode) = video.episode_number {
        lines.push(Line::from(vec![
            Span::styled("Episode: ", Style::new().bold()),
            Span::raw(episode.to_string()),
        ]));
    }

    if let Some(dur) = video.duration_seconds {
        lines.push(Line::from(vec![
            Span::styled("Duration: ", Style::new().bold()),
            Span::raw(format_duration(dur)),
        ]));
    }

    if let Some(date) = &video.release_date {
        lines.push(Line::from(vec![
            Span::styled("Release Date: ", Style::new().bold()),
            Span::raw(date),
        ]));
    }

    lines.push(Line::from(""));
    lines.push(Line::from(vec![
        Span::styled("Media Blob: ", Style::new().bold()),
        Span::raw(&video.media_blob_id).dim(),
    ]));

    lines.push(Line::from(""));
    lines.push(Line::from(
        "press e to edit, d to delete, r for renditions, esc to return".dim(),
    ));

    if let Some(err) = &v.last_error {
        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::styled("Error: ", Style::new().bold().red()),
            Span::raw(err).red(),
        ]));
    }

    let para = Paragraph::new(lines)
        .block(
            Block::bordered().title(Span::styled("video detail", Style::new().fg(ACCENT).bold())),
        )
        .wrap(Wrap { trim: false });
    frame.render_widget(para, area);
}

fn draw_edit(frame: &mut Frame, area: Rect, app: &mut App) {
    let v = &app.state.ephemeral.video;
    let fields = [
        ("Title", &v.edit_title),
        ("Description", &v.edit_description),
        ("Episode Number", &v.edit_episode_number),
    ];

    let mut lines = vec![Line::from("editing video metadata".bold()), Line::from("")];

    for (i, (label, value)) in fields.iter().enumerate() {
        let style = if i == v.edit_field_cursor {
            Style::new().fg(ACCENT).bold()
        } else {
            Style::new()
        };
        let prefix = if i == v.edit_field_cursor { "> " } else { "  " };
        lines.push(Line::from(vec![
            Span::styled(prefix, style),
            Span::styled(format!("{}: ", label), style),
            Span::styled(*value, style),
        ]));
        // render caret on the active field
        if i == v.edit_field_cursor {
            let caret_offset = label.len() + 2 + v.edit_field_caret; // +2 for ": "
            lines.push(Line::from(vec![
                Span::raw(" ".repeat(prefix.len() + caret_offset)),
                Span::styled("^", Style::new().fg(ACCENT)),
            ]));
        }
    }

    lines.push(Line::from(""));
    lines.push(Line::from(
        "tab: next field, enter: save, esc: cancel".dim(),
    ));

    if let Some(err) = &v.last_error {
        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::styled("Error: ", Style::new().bold().red()),
            Span::raw(err).red(),
        ]));
    }

    let para = Paragraph::new(lines)
        .block(Block::bordered().title(Span::styled("edit video", Style::new().fg(ACCENT).bold())))
        .wrap(Wrap { trim: false });
    frame.render_widget(para, area);
}

fn draw_renditions(frame: &mut Frame, area: Rect, app: &mut App) {
    let v = &app.state.ephemeral.video;
    let items: Vec<ListItem> = if v.renditions_loading {
        vec![ListItem::new(Line::from("(loading\u{2026})".dim()))]
    } else if v.renditions.is_empty() {
        vec![ListItem::new(Line::from(
            "(no transcoded renditions yet)".dim(),
        ))]
    } else {
        v.renditions
            .iter()
            .map(|r| ListItem::new(format_rendition_row(r)))
            .collect()
    };
    let mut list_state = ListState::default();
    if !v.renditions.is_empty() {
        list_state.select(Some(v.renditions_cursor.min(v.renditions.len() - 1)));
    }
    let mut title = format!("renditions  ({})", v.renditions.len());
    if v.pending_rendition_delete_confirm {
        title.push_str("  \u{2014} press y to confirm hard-delete, n to cancel");
    }
    let list = List::new(items)
        .block(Block::bordered().title(Span::styled(title, Style::new().fg(ACCENT).bold())))
        .highlight_style(Style::new().fg(ACCENT).bold().reversed())
        .highlight_symbol("> ");
    frame.render_stateful_widget(list, area, &mut list_state);

    if let Some(err) = &v.last_error {
        let error_area = Rect {
            y: area.y + area.height.saturating_sub(1),
            height: 1.min(area.height),
            ..area
        };
        frame.render_widget(
            Paragraph::new(Line::from(vec![
                Span::styled("Error: ", Style::new().bold().red()),
                Span::raw(err.as_str()).red(),
            ])),
            error_area,
        );
    }
}

fn format_rendition_row(r: &crate::ratcore::app::RenditionRow) -> Line<'_> {
    Line::from(vec![
        Span::raw(format!("{:<10}", r.label)).bold(),
        Span::raw(format!(".{:<5} ", r.extension)).dim(),
        Span::raw(r.mime.as_deref().unwrap_or("").to_string()).dim(),
        Span::raw("  "),
        Span::raw(r.blob_id.clone()).dim(),
    ])
}

fn format_row(v: &crate::ratcore::app::VideoRow) -> Line<'_> {
    let dur = v
        .duration_seconds
        .map(format_duration)
        .unwrap_or_else(|| "--:--".to_string());
    let episode = v
        .episode_number
        .map(|e| format!("E{:02}", e))
        .unwrap_or_else(|| "    ".to_string());
    let series = v
        .series_name
        .as_ref()
        .map(|s| s.as_str())
        .unwrap_or("<standalone>");
    Line::from(vec![
        Span::raw(format!("{:>6}  ", dur)).dim(),
        Span::raw(format!("{:5} ", episode)).dim(),
        Span::raw(v.title.clone()).bold(),
        Span::raw("  "),
        Span::raw(series.to_string()).dim(),
    ])
}

fn format_duration(seconds: f64) -> String {
    let total_s = seconds as u64;
    let h = total_s / 3600;
    let m = (total_s % 3600) / 60;
    let s = total_s % 60;
    if h > 0 {
        format!("{:02}:{:02}:{:02}", h, m, s)
    } else {
        format!("{:02}:{:02}", m, s)
    }
}
