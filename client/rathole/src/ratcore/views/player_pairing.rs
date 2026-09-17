//! `--player`/`/player` pairing view: qr/pin, connected controllers,
//! settings sub-focus (session mode, regenerate pin, remove peer,
//! local audio-device picker), queue glance when playing.
//!
//! key map (shell handles input; this file is render-only):
//! - overview: tab: player-row controls   s: settings   d/↑/↓: pick connected controller
//!   y/n: confirm/cancel removing the picked controller   esc: home
//! - settings: tab: player-row controls   s: overview   e: toggle everyone/selected mode
//!   a: regenerate admin pin   r: regenerate session pin   p: toggle autostart
//!   i: toggle qr/art display mode   u: toggle unix control socket   esc: home

use ratatui::{
    layout::{Alignment, Constraint::*, Layout, Rect},
    style::{Style, Stylize},
    text::{Line, Span},
    widgets::{Block, List, ListItem, ListState, Paragraph, Wrap},
    Frame,
};
use tui_big_text::{BigText, PixelSize};

use crate::ratcore::app::{App, PairingViewMode, SessionMode};
use crate::ratcore::theme::{ACCENT, ACCENT_SECONDARY};

pub fn draw(frame: &mut Frame, area: Rect, app: &mut App) {
    match app.state.ephemeral.player_pairing.mode {
        PairingViewMode::Overview => draw_overview(frame, area, app),
        PairingViewMode::Settings => draw_settings(frame, area, app),
    }
}

/// big-text size used for the pin, now-playing title/artist, and queue
/// rows - fixed at `HalfHeight` everywhere for visual consistency
/// (previously picked dynamically from `Full`/`HalfWidth`/`Quadrant` based
/// on available space). still falls back to plain text (`None`) when even
/// `HalfHeight` doesn't fit `avail_w`/`avail_h`.
///
/// **why `HalfHeight` and not `Quadrant`**: `tui_big_text` renders from a
/// fixed 8x8 source bitmap per glyph, and each `PixelSize` variant just
/// picks how many of those 8x8 source pixels get packed into one
/// terminal character cell (see `PixelSize::pixels_per_cell`). `Quadrant`
/// packs 2x2 source pixels per cell - i.e. it shrinks width and height by
/// the SAME factor, so it exactly preserves whatever aspect ratio the
/// console's own character cell already has. most console/tty bitmap
/// fonts (including this project's tested `Unifont-APL8x16`) use an 8-
/// wide by 16-tall cell - a 1:2 (width:height) ratio - so `Quadrant`
/// glyphs come out looking vertically squished/"wonky", and the qr code
/// (rendered separately, via `qrcode`'s own `Dense1x2` half-block
/// renderer in `tty::qr` - ALSO a 1:2-correcting technique) ends up on a
/// different visual scale than the pin/text right next to it. `HalfHeight`
/// packs 1x2 source pixels per cell instead - halving only the VERTICAL
/// resolution - which is exactly what turns a 1:2 (8x16-ish) cell into
/// genuinely square glyph pixels, and matches the qr renderer's own
/// convention. found via a real report: pin/now-playing text and the qr
/// code looked inconsistently stretched/close together on a raspberry pi
/// console using an 8x16 font.
///
/// deliberately excludes `PixelSize::Sextant`/`Octant`: those render using
/// sextant/octant block-drawing glyphs from unicode's "Symbols for Legacy
/// Computing" block, added in unicode 13.0/16.0 respectively - very recent
/// additions most terminal fonts don't have yet, especially a bare linux
/// console (no GUI terminal emulator) on something like a raspberry pi,
/// where they render as tofu/garbled boxes instead of text. `HalfHeight`
/// (using ▀/▄, from the original 1.1-era Block Elements range - the same
/// range `Quadrant`'s own glyphs come from) is safe on effectively any
/// terminal.
const PIN_SIZE_CANDIDATES: &[(PixelSize, u16, u16)] = &[(PixelSize::HalfHeight, 8, 4)];

/// candidates for `fit_text_layout` (now-playing title/artist, queue
/// rows) - unlike the fixed 6-digit pin, these strings are often long
/// (song/video titles), so `HalfHeight` (8 cols/char) alone gives up to
/// plain text far too readily. `Quadrant` is tried next (4 cols/char -
/// half the width cost, same 4-row height) so longer titles still
/// render big instead of shrinking to tiny text; its per-cell aspect
/// squish (see `PIN_SIZE_CANDIDATES`'s doc comment) is an acceptable
/// trade for readability at couch distance in a scrolling queue list.
const TEXT_SIZE_CANDIDATES: &[(PixelSize, u16, u16)] =
    &[(PixelSize::HalfHeight, 8, 4), (PixelSize::Quadrant, 4, 4)];

struct PinLayout {
    pixel_size: PixelSize,
    text: String,
    rows: u16,
}

/// picks the pin's big-text layout (always `PixelSize::HalfHeight` - see
/// `PIN_SIZE_CANDIDATES`) if it fits within `avail_w` x `avail_h`, `None`
/// otherwise.
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
    // "pair a device" only needs enough room for the qr+pin (fixed
    // size, doesn't benefit from extra width) - give the rest to
    // connected/queue, which does.
    let [left, right] = Layout::horizontal([Percentage(38), Percentage(62)]).areas(area);

    let outer_block = Block::bordered().title(Span::styled(
        "pair a device",
        Style::new().fg(ACCENT).bold(),
    ));
    let inner = outer_block.inner(left);
    frame.render_widget(outer_block, left);

    let qr_text = match &snapshot {
        Some(snap) if snap.node_id.is_some() => app.state.ephemeral.player_pairing.qr_text.clone(),
        _ => None,
    };

    // terminal mode, and a song's playing with resolved art: show the
    // rasterized art in place of the qr+pin (rendering a pin makes no
    // sense mid-playback anyway - it's only for the pairing exchange).
    // idle, or no art resolved yet, falls through to qr+pin as usual.
    let art_path = if app.state.ephemeral.player_pairing.image_mode
        == crate::ratcore::app::ImageMode::Terminal
        && !app.state.ephemeral.music.queue_video_active
        && app.state.ephemeral.music.currently_playing().is_some()
    {
        app.state
            .ephemeral
            .player_pairing
            .art_paths
            .first()
            .cloned()
    } else {
        None
    };

    let mut showed_art = false;
    if let Some(path) = &art_path {
        #[cfg(not(target_arch = "wasm32"))]
        {
            showed_art = crate::tty::art_render::draw_art(frame, inner, path);
        }
    }
    if !showed_art {
        draw_qr_and_pin(frame, inner, app, &snapshot, qr_text.as_deref());
    }

    let [connected_area, queue_area] = Layout::vertical([Length(7), Min(0)]).areas(right);
    draw_connected(frame, connected_area, app, snapshot.as_ref());
    draw_queue_glance(frame, queue_area, app);
}

/// the qr-code-plus-pin layout: sizes/centers the pair, falling back to
/// a compact rendering when the terminal's too small for the full-size
/// version. split out of `draw_overview` so the "show rasterized art
/// instead" path (see above) can skip straight past all of this.
fn draw_qr_and_pin(
    frame: &mut Frame,
    inner: Rect,
    app: &mut App,
    snapshot: &Option<crate::ratcore::app::PairingSnapshot>,
    qr_text: Option<&str>,
) {
    let qr_size = qr_text.map(|t| {
        let height = t.lines().count() as u16;
        let width = t
            .lines()
            .map(str::chars)
            .map(Iterator::count)
            .max()
            .unwrap_or(0) as u16;
        (width, height)
    });

    // qr must fit outright (its own module count is fixed, can't shrink);
    // one row is always reserved below it for an admin-grant/error message.
    let qr_fits = qr_size.is_none_or(|(w, h)| w <= inner.width && h < inner.height);
    let code = snapshot.as_ref().and_then(|s| s.current_code.as_ref());
    let pin_layout = code.and_then(|c| {
        let qr_h = qr_size.map(|(_, h)| h).unwrap_or(0);
        let avail_h = inner.height.saturating_sub(qr_h).saturating_sub(1);
        fit_pin_layout(&c.code, inner.width, avail_h)
    });

    if !qr_fits || (code.is_some() && pin_layout.is_none()) {
        draw_too_small_fallback(frame, inner, app, snapshot.as_ref(), qr_text, code);
    } else {
        let pin_rows = pin_layout.as_ref().map(|p| p.rows + 1).unwrap_or(0);
        let needed_height = qr_size.map(|(_, h)| h).unwrap_or(1) + pin_rows;
        // enough room: center the whole qr+pin block within any extra
        // vertical space rather than pinning it to the top.
        let [_pad_top, content, _pad_bottom] =
            Layout::vertical([Min(0), Length(needed_height), Min(0)]).areas(inner);
        let [qr_area, pin_area] = Layout::vertical([
            Length(needed_height.saturating_sub(pin_rows)),
            Length(pin_rows),
        ])
        .areas(content);

        draw_qr(frame, qr_area, snapshot, qr_text);
        if let (Some(code), Some(layout)) = (code, pin_layout) {
            draw_big_pin(frame, pin_area, app, code, layout);
        }
    }
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
    code: &crate::ratcore::app::PairingCode,
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
    if code.is_admin_bootstrap() {
        footer_lines.push(Line::from("(this code grants admin)".yellow()));
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
    code: Option<&crate::ratcore::app::PairingCode>,
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
    if let Some(code) = code {
        lines.push(Line::from(vec![
            Span::styled("code: ", Style::new().bold()),
            Span::styled(code.code.clone(), Style::new().fg(ACCENT).bold()),
        ]));
        if code.is_admin_bootstrap() {
            lines.push(Line::from("(this code grants admin)".yellow()));
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
        items.push(ListItem::new(Line::from(
            "(no controllers connected)".dim(),
        )));
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
        .block(Block::bordered().title(Span::styled("connected", Style::new().fg(ACCENT).bold())))
        .highlight_style(Style::new().fg(ACCENT).bold().reversed())
        .highlight_symbol("> ");
    frame.render_stateful_widget(list, area, &mut list_state);
}

/// reuses the existing music now-playing/queue state rather than a
/// second queue representation - see phase-4 plan doc.
fn draw_queue_glance(frame: &mut Frame, area: Rect, app: &App) {
    let m = &app.state.ephemeral.music;

    // track count lives in the block title ("queue (N)") instead of a
    // separate header line inside the panel - frees up a full row for
    // more big-text queue entries, and there's no need to say the word
    // "queue" twice (the panel border already says it).
    let has_previews = !m.pending_previews.is_empty();
    let real_count = m.queue.len().saturating_sub(1);
    let title = if m.queue.len() > 1 || has_previews {
        if has_previews {
            format!(
                "queue ({real_count}, {} resolving\u{2026})",
                m.pending_previews.len()
            )
        } else {
            format!("queue ({real_count})")
        }
    } else {
        "queue".to_string()
    };
    let outer = Block::bordered().title(Span::styled(title, Style::new().fg(ACCENT).bold()));
    let inner = outer.inner(area);
    frame.render_widget(outer, area);

    let current = m.current.and_then(|i| m.queue.get(i));

    // "now playing" title + artist each get a dynamically-sized,
    // centered big-text line (same shrink-to-fit approach as the pin)
    // instead of plain text - falls back to normal bold/dim text when
    // even the smallest big-text size can't fit (long titles/artist
    // names will often land here - that's fine, still an upgrade for
    // the ones short enough to benefit). album stays regular text
    // (centered too), no need for it to compete for the same space.
    //
    // available height of 4 (not 2): `PIN_SIZE_CANDIDATES`' only
    // remaining entry (`HalfHeight`) needs 4 terminal rows per glyph -
    // `Octant` (2 rows) used to cover the 2-row budget this used to
    // pass, but was removed (see that array's doc comment - garbled on
    // consoles without unicode 16.0 glyph support), so passing 2 here
    // silently produced `None` (plain text) for EVERY now-playing
    // title/artist, not just long ones - a real regression found via a
    // "why did big text disappear entirely" report.
    let title_layout = current.and_then(|e| fit_text_layout(e.title(), inner.width, 4));
    let title_rows = title_layout.as_ref().map(|l| l.rows).unwrap_or(1);
    let artist_layout = current
        .and_then(|e| e.artist())
        .and_then(|a| fit_text_layout(a, inner.width, 4));
    let artist_rows = match (&artist_layout, current.and_then(|e| e.artist())) {
        (Some(l), _) => l.rows,
        (None, Some(_)) => 1,
        (None, None) => 0,
    };
    let album_rows = if current.and_then(|e| e.album()).is_some() {
        1
    } else {
        0
    };
    let progress_rows = if app
        .state
        .ephemeral
        .player_pairing
        .download_progress
        .is_some()
    {
        2
    } else {
        0
    };
    let show_queue = m.queue.len() > 1 || has_previews;
    let [now_playing_area, sep_area, rest] = Layout::vertical([
        Length(title_rows + artist_rows + album_rows + progress_rows),
        Length(if show_queue { 1 } else { 0 }),
        Min(0),
    ])
    .areas(inner);

    match current {
        Some(entry) => {
            let kind_glyph = match entry.kind() {
                crate::ratcore::app::MediaKind::Video => "[video] ",
                crate::ratcore::app::MediaKind::Audio => "",
            };
            let [title_area, artist_area, album_area, progress_area] = Layout::vertical([
                Length(title_rows),
                Length(artist_rows),
                Length(album_rows),
                Length(progress_rows),
            ])
            .areas(now_playing_area);
            match title_layout {
                Some(layout) => {
                    let big = BigText::builder()
                        .pixel_size(layout.pixel_size)
                        .style(Style::new().fg(ACCENT).bold())
                        .alignment(Alignment::Center)
                        .lines(vec![Line::from(format!("{kind_glyph}{}", entry.title()))])
                        .build();
                    frame.render_widget(big, title_area);
                }
                None => {
                    frame.render_widget(
                        Paragraph::new(Line::from(vec![
                            Span::styled("now playing: ", Style::new().bold()),
                            Span::raw(format!("{kind_glyph}{}", entry.title())),
                        ]))
                        .alignment(Alignment::Center),
                        title_area,
                    );
                }
            }
            if let Some(artist) = entry.artist() {
                match &artist_layout {
                    Some(layout) => {
                        let big = BigText::builder()
                            .pixel_size(layout.pixel_size)
                            .style(Style::new().fg(ACCENT_SECONDARY))
                            .alignment(Alignment::Center)
                            .lines(vec![Line::from(artist.to_string())])
                            .build();
                        frame.render_widget(big, artist_area);
                    }
                    None => {
                        frame.render_widget(
                            Paragraph::new(Line::from(artist.to_string()).fg(ACCENT_SECONDARY))
                                .alignment(Alignment::Center),
                            artist_area,
                        );
                    }
                }
            }
            if let Some(album) = entry.album() {
                frame.render_widget(
                    Paragraph::new(Line::from(album.to_string()).fg(ACCENT_SECONDARY).dim())
                        .alignment(Alignment::Center),
                    album_area,
                );
            }
            if let Some(progress) = &app.state.ephemeral.player_pairing.download_progress {
                frame.render_widget(
                    Paragraph::new(download_progress_line(progress)),
                    progress_area,
                );
            }
        }
        None => {
            frame.render_widget(Paragraph::new("(nothing playing)".dim()), now_playing_area);
        }
    }

    if show_queue {
        frame.render_widget(
            Paragraph::new(Line::from("\u{2500}".repeat(sep_area.width as usize)).dim()),
            sep_area,
        );
    }

    if show_queue {
        let list_area = rest;

        // each upcoming entry (real or still-resolving) gets its own
        // big-text title line (same shrink-to-fit approach as the
        // now-playing title above) instead of one small plain-text
        // line each - the user wants the whole queue readable from
        // "couch distance", not just now-playing. artist/album are
        // dropped here (unlike the now-playing section's separate
        // line) - there's rarely room for a second big-text line per
        // row once several are visible; the title alone is enough to
        // identify each entry. rows that don't fit ANY big-text size
        // (long titles, or we've run out of vertical space) fall back
        // to a plain truncated line, same graceful-degradation
        // pattern `fit_text_layout` already has.
        //
        // pending previews (still being pulled/imported - see
        // `MusicState::pending_previews`'s doc comment) render AFTER
        // the real queue, dimmed with a "..." suffix, so a fresh push
        // is visible INSTANTLY instead of looking stalled/unresponsive
        // until each item's download+import finishes.
        let mut y = list_area.y;
        let mut remaining_height = list_area.height;
        let real_rows = m.queue.iter().enumerate().skip(1).map(|(i, entry)| {
            let marker = if Some(i) == m.current {
                "\u{25b6} "
            } else {
                ""
            };
            let kind_glyph = match entry.kind() {
                crate::ratcore::app::MediaKind::Video => "[video] ",
                crate::ratcore::app::MediaKind::Audio => "",
            };
            (format!("{marker}{kind_glyph}{}", entry.title()), false)
        });
        let preview_rows = m.pending_previews.iter().map(|item| {
            let kind_glyph = match item.kind {
                Some(crate::ratcore::app::MediaKind::Video) => "[video] ",
                _ => "",
            };
            let title = item.title.as_deref().unwrap_or("(untitled)");
            (
                format!("{kind_glyph}{title} \u{2026}"),
                true, // dim
            )
        });
        // a dim horizontal rule is drawn between rows (not before the
        // first one) so a dense queue doesn't visually run together.
        // entries that don't fit as big text are skipped entirely
        // (not shrunk to tiny plain text) - couch-distance readability
        // is the whole point of this glance, so a long queue simply
        // stops rendering once it runs out of room rather than
        // degrading; a too-long title alone is skipped in favor of
        // shorter ones still to come.
        let mut drew_row = false;
        for (text, dim) in real_rows.chain(preview_rows) {
            let sep_cost = u16::from(drew_row);
            if remaining_height <= sep_cost {
                break;
            }
            let avail_after_sep = remaining_height - sep_cost;
            let Some(layout) = fit_text_layout(&text, list_area.width, avail_after_sep.min(4))
            else {
                if avail_after_sep < 4 {
                    break;
                }
                continue;
            };
            if drew_row {
                let sep = "\u{2500}".repeat(list_area.width as usize);
                frame.render_widget(
                    Paragraph::new(Line::from(sep).dim()),
                    Rect::new(list_area.x, y, list_area.width, 1),
                );
                y += 1;
                remaining_height -= 1;
            }
            let row_h = layout.rows.min(remaining_height);
            let row_area = Rect::new(list_area.x, y, list_area.width, row_h);
            let style = if dim {
                Style::new().dim()
            } else {
                Style::new()
            };
            let big = BigText::builder()
                .pixel_size(layout.pixel_size)
                .style(style)
                .lines(vec![Line::from(text)])
                .build();
            frame.render_widget(big, row_area);
            y += row_h;
            remaining_height = remaining_height.saturating_sub(row_h);
            drew_row = true;
        }
    }
}

/// like `fit_pin_layout`, but for an arbitrary title string rather than
/// a fixed 6-digit pin - tries `TEXT_SIZE_CANDIDATES` in order, falling
/// back further whenever a wider size doesn't fit `avail_w`/`avail_h`.
/// long titles that don't fit even the narrowest candidate fall back to
/// `None` (plain text) - still an upgrade for the ones short enough to
/// benefit.
fn fit_text_layout(text: &str, avail_w: u16, avail_h: u16) -> Option<PinLayout> {
    let n = text.chars().count() as u16;
    if n == 0 {
        return None;
    }
    for &(pixel_size, cols, rows) in TEXT_SIZE_CANDIDATES {
        if rows > avail_h {
            continue;
        }
        if n * cols <= avail_w {
            return Some(PinLayout {
                pixel_size,
                text: text.to_string(),
                rows,
            });
        }
    }
    None
}

/// renders "downloading 2/5: <title> [####------] 43%" (or a
/// byte-count instead of a percent when the item's size isn't known
/// yet - e.g. a controller that didn't set `size_bytes` on the
/// `MediaRef`).
fn download_progress_line(
    progress: &crate::ratcore::app::PairingDownloadProgress,
) -> Line<'static> {
    let position = format!("{}/{}", progress.item_index + 1, progress.item_count);
    let title = progress
        .title
        .clone()
        .unwrap_or_else(|| "(untitled)".into());
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
    let autostart_label = if app.state.ephemeral.player_pairing.autostart_enabled {
        "enabled"
    } else {
        "disabled"
    };
    let image_mode_label = match app.state.ephemeral.player_pairing.image_mode {
        crate::ratcore::app::ImageMode::Terminal => "terminal (unicode)",
        crate::ratcore::app::ImageMode::Framebuffer => "framebuffer (mpv, raster)",
    };
    let control_socket_label = if app.state.ephemeral.player_pairing.control_socket_enabled {
        "enabled"
    } else {
        "disabled"
    };
    let transcode_video_label = if app.state.ephemeral.player_pairing.transcode_video_enabled {
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
        format!("qr/art display: {image_mode_label}   (i: toggle)"),
        format!("unix control socket: {control_socket_label}   (u: toggle, next launch)"),
        format!("transcode video renditions: {transcode_video_label}   (t: toggle)"),
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
    let list = List::new(list_items).block(Block::bordered().title(Span::styled(
        "player settings",
        Style::new().fg(ACCENT).bold(),
    )));
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
    let popup_h = (area.height.saturating_sub(4)).clamp(3, 12);
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
