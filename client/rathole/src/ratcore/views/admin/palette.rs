//! admin command palette body. just the result container now —
//! the left commands list and "selected" info box were dropped in
//! favor of driving everything from the bottom slash repl + flyout.
//! command forms still render full-body when one is open.

use ratatui::{
    layout::{Constraint::*, Layout, Rect},
    style::{Style, Stylize},
    text::{Line, Span},
    widgets::{Block, Paragraph, Wrap},
    Frame,
};

use crate::ratcore::theme::ACCENT;

use crate::ratcore::app::{App, Focus};
use crate::ratcore::views::command_form;

pub fn draw(frame: &mut Frame, area: Rect, app: &mut App) {
    // when a form is open, give it the entire body. otherwise show
    // the resultz container full-width.
    if app.state.ephemeral.focus == Focus::CommandForm && app.state.ephemeral.form.is_some() {
        command_form::draw(frame, area, app);
        return;
    }
    draw_result_box(frame, area, app);
}

/// human-friendly title for the resultz container, keyed off the
/// last-dispatch command name. unrecognized commands fall through
/// to a tidied version of the raw name.
fn friendly_title(command: &str, row_count: usize) -> String {
    let pretty = match command {
        "help" => "slash commandz".to_string(),
        "info" => "local info".to_string(),
        "log" | "logs" => "logz".to_string(),
        "queue" => "queue".to_string(),
        "remotes" => "remotez".to_string(),
        "library_album" | "album" => "albumz".to_string(),
        "library_artist" | "artist" => "artistz".to_string(),
        "library_playlist" | "playlist" => "playlistz".to_string(),
        "library_favorites" | "favorites" => "favoritez".to_string(),
        "library_radio" | "radio" => "radio stationz".to_string(),
        other => {
            // turn snake_case into spaces for readability.
            other.replace('_', " ")
        }
    };
    if row_count > 0 {
        format!("{pretty} ({row_count})")
    } else {
        pretty
    }
}

fn draw_result_box(frame: &mut Frame, result_area: Rect, app: &App) {
    let Some(d) = &app.state.ephemeral.last_dispatch else {
        let title_style = title_style(app);
        let para = Paragraph::new(vec![
            Line::from(""),
            Line::from("  type a slash command in the prompt below to get started".dim()),
            Line::from(
                "  try /help to list every command, or /admin to browse all admin RPC".dim(),
            ),
        ])
        .block(Block::bordered().title(Span::styled("resultz", title_style)));
        frame.render_widget(para, result_area);
        return;
    };

    // friendly title carries the command identity + row count;
    // the message slides under it as a single header line so the
    // body has more room for actual rows.
    let title_text = friendly_title(&d.command, d.rows.len());
    let (status_glyph, status_style) = if d.pending {
        ("\u{29D6}", Style::new().yellow())
    } else if d.success {
        ("\u{2713}", Style::new().green())
    } else {
        ("\u{2717}", Style::new().red())
    };
    let header_lines: Vec<Line> = vec![Line::from(vec![
        Span::styled(format!(" {status_glyph} "), status_style),
        Span::raw(d.message.clone()).dim(),
    ])];

    if d.rows.is_empty() {
        // no rows: show pretty json (or "(no data)") with vertical
        // scroll driven by `last_dispatch_scroll`. while a dispatch
        // is in flight we render streamed progress lines instead so
        // the user has live feedback.
        let mut lines = header_lines;
        lines.push(Line::from(""));
        let has_progress = !d.progress.is_empty();
        if d.pending && has_progress {
            for l in &d.progress {
                lines.push(Line::from(l.clone()).dim());
            }
        } else if let Some(pretty) = &d.data_pretty {
            // include any captured progress above the final payload
            // so the user can review the run timeline.
            if has_progress {
                for l in &d.progress {
                    lines.push(Line::from(l.clone()).dim());
                }
                lines.push(Line::from(""));
            }
            for l in pretty.lines() {
                lines.push(Line::from(l.to_string()));
            }
        } else if has_progress {
            for l in &d.progress {
                lines.push(Line::from(l.clone()).dim());
            }
        } else if d.pending {
            lines.push(Line::from("(waiting for progress\u{2026})".dim()));
        } else {
            lines.push(Line::from("(no data)".dim()));
        }
        let viewport = result_area.height.saturating_sub(2);
        let max_scroll = (lines.len() as u16).saturating_sub(viewport);
        // while pending, follow the tail so newest progress is visible.
        let scroll = if d.pending {
            max_scroll
        } else {
            app.state.ephemeral.last_dispatch_scroll.min(max_scroll)
        };
        let title = if max_scroll > 0 {
            format!("{title_text}  [{}/{}]", scroll, max_scroll)
        } else {
            title_text.clone()
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

    // rows: a single "resultz" container holds the header summary
    // (command + status + message + cursor count) on the top lines
    // followed by the row list filling the rest. when the result
    // pane is wide enough, split horizontally and render an info
    // pane on the right showing pretty-printed json of the focused
    // row — gives users at-a-glance detail while navigating.
    let cursor = d.cursor.min(d.rows.len() - 1);
    // /help rows are self-explanatory (title + blurb); skip the
    // info pane to give the row list the full width.
    let show_info = d.command != "help";
    let (rows_area, info_area) = if show_info && result_area.width >= 80 {
        let [a, b] = Layout::horizontal([Min(0), Length(result_area.width / 2)]).areas(result_area);
        (a, Some(b))
    } else {
        (result_area, None)
    };
    let summary_line = Line::from(vec![
        Span::styled(
            format!(" {} / {} ", cursor + 1, d.rows.len()),
            Style::new().fg(ACCENT).bold(),
        ),
        Span::styled(
            " \u{2191}/\u{2193} navigate, enter for actions",
            Style::new().dim(),
        ),
    ]);

    // /help is self-explanatory: drop the status/count header so the
    // row list starts flush against the top border.
    let header: Vec<Line> = if d.command == "help" {
        Vec::new()
    } else {
        let mut h = header_lines.clone();
        h.push(summary_line);
        h.push(Line::from(""));
        h
    };

    // build row lines beneath the header. cursor stays on screen by
    // computing a top offset against the rendered viewport (full
    // rows_area minus borders minus header lines).
    let header_h = header.len() as u16;
    let viewport = rows_area.height.saturating_sub(2).saturating_sub(header_h) as usize;
    let row_top = if cursor >= viewport.saturating_sub(1) {
        cursor + 1 - viewport.max(1)
    } else {
        0
    };
    let mut lines = header;
    for (idx, row) in d
        .rows
        .iter()
        .enumerate()
        .skip(row_top)
        .take(viewport.max(1))
    {
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
    frame.render_widget(
        Paragraph::new(lines)
            .block(Block::bordered().title(Span::styled(title_text, title_style(app)))),
        rows_area,
    );

    if let Some(info_area) = info_area {
        let row = &d.rows[cursor];
        let pretty = serde_json::to_string_pretty(row).unwrap_or_else(|_| row.to_string());
        let info_lines: Vec<Line<'static>> =
            pretty.lines().map(|l| Line::from(l.to_string())).collect();
        frame.render_widget(
            Paragraph::new(info_lines)
                .block(
                    Block::bordered().title(Span::styled("info", Style::new().fg(ACCENT).bold())),
                )
                .wrap(Wrap { trim: false }),
            info_area,
        );
    }
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
        // /help rows: just `/name   blurb`. no position, no type tag,
        // no glyph — the result panel title already says "slash
        // commandz" and the title field already starts with `/`.
        if ty == "slash_command" {
            if subtitle.is_empty() {
                return title;
            }
            return format!("{title:<18} {subtitle}");
        }
        // remote rows: status glyph (filled = active, hollow = idle)
        // followed by name, transport in parens, and a peer hint.
        // long node ids get middle-truncated so the row fits.
        if ty == "remote" {
            let transport = pick("transport").unwrap_or_default();
            let active = obj.get("active").and_then(|v| v.as_bool()).unwrap_or(false);
            let glyph = if active { "\u{25CF}" } else { "\u{25CB}" };
            let mut s = format!("{glyph} {title}");
            if !transport.is_empty() {
                s.push_str(&format!("  ({transport})"));
            }
            if !subtitle.is_empty() && subtitle != transport {
                let short = if subtitle.chars().count() > 40 {
                    let chars: Vec<char> = subtitle.chars().collect();
                    let head: String = chars.iter().take(20).collect();
                    let tail: String = chars.iter().skip(chars.len().saturating_sub(8)).collect();
                    format!("{head}\u{2026}{tail}")
                } else {
                    subtitle.clone()
                };
                s.push_str(&format!("  \u{00B7} {short}"));
            }
            return s;
        }
        // queue rows carry a `position`, `now_playing`, `pending`
        // status. render with a leading glyph + position so the
        // /queue view reads as an ordered list.
        if let Some(pos) = obj.get("position").and_then(|v| v.as_i64()) {
            let now_playing = obj
                .get("now_playing")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let pending = obj
                .get("pending")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let glyph = if now_playing {
                "\u{25B6}"
            } else if pending {
                "\u{25CB}"
            } else {
                "\u{25CF}"
            };
            let mut s = format!("{glyph} {pos:>3}  [{ty}] {title}");
            if !subtitle.is_empty() {
                s.push_str(&format!("  \u{2014} {subtitle}"));
            }
            return s;
        }
        let mut s = format!("[{ty}] {title}");
        if !subtitle.is_empty() {
            s.push_str(&format!(" \u{2014} {subtitle}"));
        }
        return s;
    }
    // music wrapper rows: `{ playlist: {...}, song_count: N }`,
    // `{ album: {...}, artist: {...} }`, `{ artist: {...}, song_count }`,
    // `{ song: {...}, artist, album, ... }`. unwrap to the inner entity.
    // song is checked FIRST so song-with-joined-album rows (e.g.
    // /goto-album results) render the per-track title instead of
    // collapsing every row into the same album label.
    for (kind, glyph) in [
        ("song", "[song]"),
        ("playlist", "[playlist]"),
        ("album", "[album]"),
        ("artist", "[artist]"),
        ("genre", "[genre]"),
    ] {
        if let Some(inner) = obj.get(kind).and_then(|v| v.as_object()) {
            let title = inner
                .get("title")
                .or_else(|| inner.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("(untitled)");
            let mut s = format!("{glyph} {title}");
            // for song rows, append the track number prefix (when
            // present) and the joined artist name suffix so the
            // album-detail listing is scannable.
            if kind == "song" {
                if let Some(tn) = inner.get("track_number").and_then(|v| v.as_i64()) {
                    s = format!("{glyph} {tn:>3}  {title}");
                }
                if let Some(artist) = obj
                    .get("artist")
                    .and_then(|v| v.as_object())
                    .and_then(|a| a.get("name"))
                    .and_then(|v| v.as_str())
                    .filter(|x| !x.is_empty())
                {
                    s.push_str(&format!("  \u{2014} {artist}"));
                }
            }
            if let Some(desc) = inner
                .get("description")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            {
                let trimmed = if desc.chars().count() > 60 {
                    format!("{}\u{2026}", desc.chars().take(60).collect::<String>())
                } else {
                    desc.to_string()
                };
                s.push_str(&format!("  \u{2014} {trimmed}"));
            }
            // append a small stat suffix when present.
            let extras = ["song_count", "album_count", "play_count"];
            let mut bits: Vec<String> = vec![];
            for k in extras {
                if let Some(n) = obj.get(k).and_then(|v| v.as_i64()) {
                    bits.push(format!("{k}={n}"));
                }
            }
            if !bits.is_empty() {
                s.push_str(&format!("   {}", bits.join(" ")));
            }
            return s;
        }
    }
    // playlist-song-result rows: `{ details: { song: {...}, ... }, position }`
    if let Some(details) = obj.get("details").and_then(|v| v.as_object()) {
        if let Some(song) = details.get("song").and_then(|v| v.as_object()) {
            let title = song
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("(untitled)");
            let pos = obj.get("position").and_then(|v| v.as_i64()).unwrap_or(0);
            return format!("[song]  {pos:>3}  {title}");
        }
    }
    let mut parts: Vec<String> = vec![];
    for k in [
        "name",
        "title",
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
            format!("{}\u{2026}", &s[..80])
        } else {
            s
        }
    } else {
        parts.join("  ")
    }
}
