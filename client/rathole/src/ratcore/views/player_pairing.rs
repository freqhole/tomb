//! `--player`/`/player` pairing view: qr/pin, connected controllers,
//! settings sub-focus (session mode, regenerate pin, remove peer,
//! local audio-device picker), queue glance when playing.
//!
//! key map (shell handles input; this file is render-only):
//! - overview: tab: settings   d/↑/↓: pick connected controller
//!   y/n: confirm/cancel removing the picked controller   esc: home
//! - settings: tab: overview   e: toggle everyone/selected mode
//!   a: regenerate admin pin   r: regenerate session pin   esc: home

use ratatui::{
    layout::{Alignment, Constraint::*, Layout, Rect},
    style::{Style, Stylize},
    text::{Line, Span},
    widgets::{Block, List, ListItem, ListState, Paragraph, Wrap},
    Frame,
};
use tui_big_text::{BigText, PixelSize};

use crate::ratcore::app::{App, PairingViewMode, SessionMode};
use crate::ratcore::theme::ACCENT;

pub fn draw(frame: &mut Frame, area: Rect, app: &mut App) {
    match app.state.ephemeral.player_pairing.mode {
        PairingViewMode::Overview => draw_overview(frame, area, app),
        PairingViewMode::Settings => draw_settings(frame, area, app),
    }
}

/// candidate big-text sizes for the pin, largest first, as (pixel_size,
/// terminal cols per glyph, terminal rows per glyph) for an 8x8 font -
/// mirrors `tui_big_text::PixelSize::pixels_per_cell` (private upstream).
/// picked dynamically so the pin shrinks just enough to fit instead of an
/// all-or-nothing fall back to plain small text.
const PIN_SIZE_CANDIDATES: &[(PixelSize, u16, u16)] = &[
    (PixelSize::Full, 8, 8),
    (PixelSize::HalfWidth, 4, 8),
    (PixelSize::Quadrant, 4, 4),
    (PixelSize::Octant, 4, 2),
];

struct PinLayout {
    pixel_size: PixelSize,
    text: String,
    rows: u16,
}

/// picks the largest pin size (trying digit-spaced first, then tight) that
/// fits within `avail_w` x `avail_h`. returns `None` if even the smallest
/// candidate, tightly packed, doesn't fit.
fn fit_pin_layout(pin: &str, avail_w: u16, avail_h: u16) -> Option<PinLayout> {
    let digits: Vec<char> = pin.chars().collect();
    let n = digits.len() as u16;
    for &(pixel_size, cols, rows) in PIN_SIZE_CANDIDATES {
        if rows > avail_h || n == 0 {
            continue;
        }
        let spaced_width = n * cols + n.saturating_sub(1) * cols;
        if spaced_width <= avail_w {
            return Some(PinLayout {
                pixel_size,
                text: spaced_pin(pin),
                rows,
            });
        }
        let tight_width = n * cols;
        if tight_width <= avail_w {
            return Some(PinLayout {
                pixel_size,
                text: pin.to_string(),
                rows,
            });
        }
    }
    None
}

/// pin digits spaced out (e.g. "0 1 2 3 4 5") so each digit reads as its
/// own big glyph instead of a solid, hard-to-parse block.
fn spaced_pin(pin: &str) -> String {
    pin.chars().map(String::from).collect::<Vec<_>>().join(" ")
}

fn draw_overview(frame: &mut Frame, area: Rect, app: &mut App) {
    let snapshot = app.pairing.as_ref().map(|p| p.snapshot());
    let [left, right] = Layout::horizontal([Percentage(55), Percentage(45)]).areas(area);

    let outer_block = Block::bordered().title(Span::styled(
        "pair a device",
        Style::new().fg(ACCENT).bold(),
    ));
    let inner = outer_block.inner(left);
    frame.render_widget(outer_block, left);

    let session = snapshot.as_ref().and_then(|s| s.session.as_ref());
    let qr_text = match &snapshot {
        Some(snap) if snap.node_id.is_some() => {
            app.state.ephemeral.player_pairing.qr_text.as_deref()
        }
        _ => None,
    };
    let qr_size = qr_text.map(|t| {
        let height = t.lines().count() as u16;
        let width = t.lines().map(str::chars).map(Iterator::count).max().unwrap_or(0) as u16;
        (width, height)
    });

    // qr must fit outright (its own module count is fixed, can't shrink);
    // one row is always reserved below it for an admin-grant/error message.
    let qr_fits = qr_size.is_none_or(|(w, h)| w <= inner.width && h + 1 <= inner.height);
    let pin_layout = session.and_then(|s| {
        let qr_h = qr_size.map(|(_, h)| h).unwrap_or(0);
        let avail_h = inner.height.saturating_sub(qr_h).saturating_sub(1);
        fit_pin_layout(&s.pin, inner.width, avail_h)
    });

    if !qr_fits || (session.is_some() && pin_layout.is_none()) {
        draw_too_small_fallback(frame, inner, app, snapshot.as_ref(), qr_text, session);
    } else {
        let pin_rows = pin_layout.as_ref().map(|p| p.rows + 1).unwrap_or(0);
        let needed_height = qr_size.map(|(_, h)| h).unwrap_or(1) + pin_rows;
        // enough room: center the whole qr+pin block within any extra
        // vertical space rather than pinning it to the top.
        let [_pad_top, content, _pad_bottom] =
            Layout::vertical([Min(0), Length(needed_height), Min(0)]).areas(inner);
        let [qr_area, pin_area] =
            Layout::vertical([Length(needed_height.saturating_sub(pin_rows)), Length(pin_rows)])
                .areas(content);

        draw_qr(frame, qr_area, &snapshot, qr_text);
        if let (Some(session), Some(layout)) = (session, pin_layout) {
            draw_big_pin(frame, pin_area, app, session, layout);
        }
    }

    let [connected_area, queue_area] =
        Layout::vertical([Percentage(50), Percentage(50)]).areas(right);
    draw_connected(frame, connected_area, app, snapshot.as_ref());
    draw_queue_glance(frame, queue_area, app);
}

fn draw_qr(
    frame: &mut Frame,
    area: Rect,
    snapshot: &Option<crate::ratcore::app::PairingSnapshot>,
    qr_text: Option<&str>,
) {
    let mut qr_lines: Vec<Line> = Vec::new();
    match snapshot {
        None => qr_lines.push(Line::from("pairing endpoint not started yet.".dim())),
        Some(snap) => match &snap.node_id {
            None => qr_lines.push(Line::from("starting endpoint\u{2026}".dim())),
            Some(_) => match qr_text {
                Some(qr) => qr_lines.extend(qr.lines().map(|l| Line::from(l.to_string()))),
                None => qr_lines.push(Line::from("(qr rendering unavailable)".dim())),
            },
        },
    }
    frame.render_widget(
        Paragraph::new(qr_lines)
            .alignment(Alignment::Center)
            .wrap(Wrap { trim: false }),
        area,
    );
}

fn draw_big_pin(
    frame: &mut Frame,
    area: Rect,
    app: &App,
    session: &crate::ratcore::app::PlayerSession,
    layout: PinLayout,
) {
    let [big_area, footer_area] = Layout::vertical([Length(layout.rows), Min(0)]).areas(area);
    let big_pin = BigText::builder()
        .pixel_size(layout.pixel_size)
        .style(Style::new().fg(ACCENT).bold())
        .alignment(Alignment::Center)
        .lines(vec![Line::from(layout.text)])
        .build();
    frame.render_widget(big_pin, big_area);

    let mut footer_lines: Vec<Line> = Vec::new();
    if session.admin_grant_pending {
        footer_lines.push(Line::from("(next redemption grants admin)".yellow()));
    }
    if let Some(err) = &app.state.ephemeral.player_pairing.last_error {
        footer_lines.push(Line::from(vec![Span::styled(
            format!("error: {err}"),
            Style::new().red(),
        )]));
    }
    frame.render_widget(
        Paragraph::new(footer_lines)
            .alignment(Alignment::Center)
            .wrap(Wrap { trim: false }),
        footer_area,
    );
}

/// terminal's too small to fit the full-size qr + pin - falls back to a
/// compact, unstyled rendering (still fully usable for pairing) plus a
/// hint that resizing gets the bigger, couch-distance-friendly version.
fn draw_too_small_fallback(
    frame: &mut Frame,
    area: Rect,
    app: &App,
    snapshot: Option<&crate::ratcore::app::PairingSnapshot>,
    qr_text: Option<&str>,
    session: Option<&crate::ratcore::app::PlayerSession>,
) {
    let mut lines: Vec<Line> = vec![Line::from(
        "(terminal too small for the full qr+pin display - resize for a bigger view)".yellow(),
    )];
    match snapshot {
        None => lines.push(Line::from("pairing endpoint not started yet.".dim())),
        Some(snap) => match &snap.node_id {
            None => lines.push(Line::from("starting endpoint\u{2026}".dim())),
            Some(_) => match qr_text {
                Some(qr) => lines.extend(qr.lines().map(|l| Line::from(l.to_string()))),
                None => lines.push(Line::from("(qr rendering unavailable)".dim())),
            },
        },
    }
    if let Some(session) = session {
        lines.push(Line::from(vec![
            Span::styled("pin: ", Style::new().bold()),
            Span::styled(session.pin.clone(), Style::new().fg(ACCENT).bold()),
        ]));
        if session.admin_grant_pending {
            lines.push(Line::from("(next redemption grants admin)".yellow()));
        }
    }
    if let Some(err) = &app.state.ephemeral.player_pairing.last_error {
        lines.push(Line::from(vec![Span::styled(
            format!("error: {err}"),
            Style::new().red(),
        )]));
    }
    frame.render_widget(Paragraph::new(lines).wrap(Wrap { trim: false }), area);
}

fn draw_connected(
    frame: &mut Frame,
    area: Rect,
    app: &App,
    snapshot: Option<&crate::ratcore::app::PairingSnapshot>,
) {
    let v = &app.state.ephemeral.player_pairing;
    let connected = snapshot.map(|s| s.connected.as_slice()).unwrap_or(&[]);
    let mode_label = match snapshot.and_then(|s| s.session.as_ref()).map(|s| s.mode) {
        Some(SessionMode::Everyone) => Some("mode: everyone (no pin needed)"),
        Some(SessionMode::Selected) => Some("mode: selected peers only"),
        None => None,
    };
    let mut items: Vec<ListItem> = Vec::new();
    if let Some(label) = mode_label {
        items.push(ListItem::new(Line::from(label.dim())));
    }
    if connected.is_empty() {
        items.push(ListItem::new(Line::from("(no controllers connected)".dim())));
    } else {
        items.extend(connected.iter().map(|c| {
            let label = format!("{}  ({})", c.display_name, short_id(&c.node_id));
            if v.pending_remove_confirm.as_deref() == Some(c.node_id.as_str()) {
                ListItem::new(Line::from(vec![Span::styled(
                    format!("{label} \u{2014} remove? y/n"),
                    Style::new().yellow(),
                )]))
            } else {
                ListItem::new(Line::from(label))
            }
        }));
    }
    let mut list_state = ListState::default();
    if !connected.is_empty() {
        // account for the leading mode line (if present) so the cursor
        // still lands on the right controller row.
        let offset = if mode_label.is_some() { 1 } else { 0 };
        list_state.select(Some(offset + v.connected_cursor.min(connected.len() - 1)));
    }
    let list = List::new(items)
        .block(
            Block::bordered()
                .title(Span::styled("connected", Style::new().fg(ACCENT).bold())),
        )
        .highlight_style(Style::new().fg(ACCENT).bold().reversed())
        .highlight_symbol("> ");
    frame.render_stateful_widget(list, area, &mut list_state);
}

/// reuses the existing music now-playing/queue state rather than a
/// second queue representation - see phase-4 plan doc.
fn draw_queue_glance(frame: &mut Frame, area: Rect, app: &App) {
    let m = &app.state.ephemeral.music;
    let mut lines: Vec<Line> = Vec::new();
    match m.current.and_then(|i| m.queue.get(i)) {
        Some(entry) => {
            let kind_glyph = match entry.kind() {
                crate::ratcore::app::MediaKind::Video => "\u{1f3ac} ",
                crate::ratcore::app::MediaKind::Audio => "",
            };
            lines.push(Line::from(vec![
                Span::styled("now playing: ", Style::new().bold()),
                Span::raw(format!("{kind_glyph}{}", entry.title())),
            ]));
            if let Some(artist) = entry.artist() {
                lines.push(Line::from(artist.to_string()).dim());
            }
        }
        None => lines.push(Line::from("(nothing playing)".dim())),
    }
    if let Some(progress) = &app.state.ephemeral.player_pairing.download_progress {
        lines.push(Line::from(""));
        lines.push(download_progress_line(progress));
    }
    if m.queue.len() > 1 {
        lines.push(Line::from(""));
        lines.push(Line::from(format!("queue ({} tracks):", m.queue.len())).bold());
        for (i, entry) in m.queue.iter().enumerate().take(6) {
            let marker = if Some(i) == m.current { "\u{25b6} " } else { "  " };
            let kind_glyph = match entry.kind() {
                crate::ratcore::app::MediaKind::Video => "\u{1f3ac} ",
                crate::ratcore::app::MediaKind::Audio => "",
            };
            lines.push(Line::from(format!("{marker}{kind_glyph}{}", entry.title())));
        }
    }
    let block = Paragraph::new(lines)
        .block(Block::bordered().title(Span::styled("queue", Style::new().fg(ACCENT).bold())))
        .wrap(Wrap { trim: false });
    frame.render_widget(block, area);
}

/// renders "downloading 2/5: <title> [####------] 43%" (or a
/// byte-count instead of a percent when the item's size isn't known
/// yet - e.g. a controller that didn't set `size_bytes` on the
/// `MediaRef`).
fn download_progress_line(progress: &crate::ratcore::app::PairingDownloadProgress) -> Line<'static> {
    let position = format!("{}/{}", progress.item_index + 1, progress.item_count);
    let title = progress.title.clone().unwrap_or_else(|| "(untitled)".into());
    let amount = match progress.total_bytes {
        Some(total) if total > 0 => {
            let pct = ((progress.bytes as f64 / total as f64) * 100.0).clamp(0.0, 100.0) as u32;
            let bar_width = 10usize;
            let filled = ((pct as usize * bar_width) / 100).min(bar_width);
            let bar = format!("[{}{}]", "#".repeat(filled), "-".repeat(bar_width - filled));
            format!("{bar} {pct}%")
        }
        _ => format!("{} KB", progress.bytes / 1024),
    };
    Line::from(vec![
        Span::styled("downloading ", Style::new().fg(ACCENT)),
        Span::raw(format!("{position}: {title}  ")).dim(),
        Span::styled(amount, Style::new().fg(ACCENT)),
    ])
}

fn draw_settings(frame: &mut Frame, area: Rect, app: &mut App) {
    let snapshot = app.pairing.as_ref().map(|p| p.snapshot());
    let session = snapshot.as_ref().and_then(|s| s.session.as_ref());

    let mode_label = match session.map(|s| s.mode) {
        Some(SessionMode::Everyone) => "everyone",
        Some(SessionMode::Selected) | None => "selected peers only",
    };

    // full node id up top (not `short_id()`'d, unlike the connected-
    // controllers list) - this is the id a remote controller needs to
    // paste in to dial/add this device, so it must be copyable in full
    // (select-and-copy in the terminal).
    let node_id_line = match snapshot.as_ref().and_then(|s| s.node_id.as_deref()) {
        Some(id) => Line::from(vec![
            Span::styled("node id: ", Style::new().bold()),
            Span::styled(id.to_string(), Style::new().fg(ACCENT)),
        ]),
        None => Line::from("node id: (starting endpoint\u{2026})".dim()),
    };

    let devices = &app.state.ephemeral.music.output_devices;
    let device_label = app
        .state
        .ephemeral
        .music
        .selected_output_device
        .as_deref()
        .unwrap_or("(default)");
    let autostart_label = if grimoire::config::get_config().player_pairing.enabled {
        "enabled"
    } else {
        "disabled"
    };
    let items = [
        format!("session mode: {mode_label}   (e: toggle)"),
        "regenerate admin pairing code   (a)".to_string(),
        "regenerate session pin          (r)".to_string(),
        format!(
            "audio output device: {device_label}   ({} known, enter to pick)",
            devices.len()
        ),
        format!("auto-start pairing on launch: {autostart_label}   (p: toggle)"),
    ];
    let list_items: Vec<ListItem> = items
        .iter()
        .enumerate()
        .map(|(i, label)| {
            let cursor = app.state.ephemeral.player_pairing.settings_cursor;
            if i == cursor {
                ListItem::new(Line::from(label.clone())).style(Style::new().fg(ACCENT).bold())
            } else {
                ListItem::new(Line::from(label.clone()))
            }
        })
        .collect();
    let list = List::new(list_items).block(
        Block::bordered().title(Span::styled(
            "player settings",
            Style::new().fg(ACCENT).bold(),
        )),
    );
    let [node_area, list_area] = Layout::vertical([Length(1), Min(0)]).areas(area);
    frame.render_widget(Paragraph::new(node_id_line), node_area);
    frame.render_widget(list, list_area);

    if app.state.ephemeral.player_pairing.device_picker_open {
        draw_device_picker(frame, area, app);
    }
}

/// centered overlay listing rodio's known output devices - opened from
/// the "audio output device" settings row (enter), closed with esc or
/// by picking a device (enter).
fn draw_device_picker(frame: &mut Frame, area: Rect, app: &App) {
    let popup_w = (area.width.saturating_sub(4)).min(50);
    let popup_h = (area.height.saturating_sub(4)).min(12).max(3);
    let x = area.x + (area.width.saturating_sub(popup_w)) / 2;
    let y = area.y + (area.height.saturating_sub(popup_h)) / 2;
    let popup = Rect::new(x, y, popup_w, popup_h);

    let devices = &app.state.ephemeral.music.output_devices;
    let cursor = app.state.ephemeral.player_pairing.device_picker_cursor;
    let items: Vec<ListItem> = if devices.is_empty() {
        vec![ListItem::new(Line::from(
            "(no output devices reported yet\u{2026})".dim(),
        ))]
    } else {
        devices
            .iter()
            .map(|d| ListItem::new(Line::from(d.description.clone())))
            .collect()
    };
    let mut list_state = ListState::default();
    if !devices.is_empty() {
        list_state.select(Some(cursor.min(devices.len() - 1)));
    }
    frame.render_widget(ratatui::widgets::Clear, popup);
    let list = List::new(items)
        .block(Block::bordered().title(Span::styled(
            "audio output device (enter: pick, esc: cancel)",
            Style::new().fg(ACCENT).bold(),
        )))
        .highlight_style(Style::new().fg(ACCENT).bold().reversed())
        .highlight_symbol("> ");
    frame.render_stateful_widget(list, popup, &mut list_state);
}

fn short_id(s: &str) -> String {
    if s.len() <= 16 {
        s.to_string()
    } else {
        format!("{}\u{2026}{}", &s[..8], &s[s.len() - 6..])
    }
}
