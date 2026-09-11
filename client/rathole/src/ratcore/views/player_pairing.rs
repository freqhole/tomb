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
    layout::{Constraint::*, Layout, Rect},
    style::{Style, Stylize},
    text::{Line, Span},
    widgets::{Block, List, ListItem, ListState, Paragraph, Wrap},
    Frame,
};

use crate::ratcore::app::{App, PairingViewMode, SessionMode};
use crate::ratcore::theme::ACCENT;

pub fn draw(frame: &mut Frame, area: Rect, app: &mut App) {
    match app.state.ephemeral.player_pairing.mode {
        PairingViewMode::Overview => draw_overview(frame, area, app),
        PairingViewMode::Settings => draw_settings(frame, area, app),
    }
}

fn draw_overview(frame: &mut Frame, area: Rect, app: &mut App) {
    let snapshot = app.pairing.as_ref().map(|p| p.snapshot());
    let [left, right] = Layout::horizontal([Percentage(55), Percentage(45)]).areas(area);

    let mut lines: Vec<Line> = Vec::new();
    match &snapshot {
        None => {
            lines.push(Line::from("pairing endpoint not started yet.".dim()));
        }
        Some(snap) => match &snap.node_id {
            None => lines.push(Line::from("starting endpoint\u{2026}".dim())),
            Some(_) => {
                if let Some(qr) = &app.state.ephemeral.player_pairing.qr_text {
                    for l in qr.lines() {
                        lines.push(Line::from(l.to_string()));
                    }
                } else {
                    lines.push(Line::from("(qr rendering unavailable)".dim()));
                }
            }
        },
    }
    lines.push(Line::from(""));
    if let Some(session) = snapshot.as_ref().and_then(|s| s.session.as_ref()) {
        lines.push(Line::from(vec![
            Span::styled("pin: ", Style::new().bold()),
            Span::styled(session.pin.clone(), Style::new().fg(ACCENT).bold()),
        ]));
        let mode_label = match session.mode {
            SessionMode::Everyone => "everyone (no pin needed)",
            SessionMode::Selected => "selected peers only",
        };
        lines.push(Line::from(format!("mode: {mode_label}")));
        if session.admin_grant_pending {
            lines.push(Line::from("(next redemption grants admin)".yellow()));
        }
    }
    if let Some(err) = &app.state.ephemeral.player_pairing.last_error {
        lines.push(Line::from(""));
        lines.push(Line::from(vec![Span::styled(
            format!("error: {err}"),
            Style::new().red(),
        )]));
    }
    let left_block = Paragraph::new(lines)
        .block(
            Block::bordered()
                .title(Span::styled("pair a device", Style::new().fg(ACCENT).bold())),
        )
        .wrap(Wrap { trim: false });
    frame.render_widget(left_block, left);

    let [connected_area, queue_area] =
        Layout::vertical([Percentage(50), Percentage(50)]).areas(right);
    draw_connected(frame, connected_area, app, snapshot.as_ref());
    draw_queue_glance(frame, queue_area, app);
}

fn draw_connected(
    frame: &mut Frame,
    area: Rect,
    app: &App,
    snapshot: Option<&crate::ratcore::app::PairingSnapshot>,
) {
    let v = &app.state.ephemeral.player_pairing;
    let connected = snapshot.map(|s| s.connected.as_slice()).unwrap_or(&[]);
    let items: Vec<ListItem> = if connected.is_empty() {
        vec![ListItem::new(Line::from("(no controllers connected)".dim()))]
    } else {
        connected
            .iter()
            .map(|c| {
                let label = format!("{}  ({})", c.display_name, short_id(&c.node_id));
                if v.pending_remove_confirm.as_deref() == Some(c.node_id.as_str()) {
                    ListItem::new(Line::from(vec![Span::styled(
                        format!("{label} \u{2014} remove? y/n"),
                        Style::new().yellow(),
                    )]))
                } else {
                    ListItem::new(Line::from(label))
                }
            })
            .collect()
    };
    let mut list_state = ListState::default();
    if !connected.is_empty() {
        list_state.select(Some(v.connected_cursor.min(connected.len() - 1)));
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
        Some(song) => {
            lines.push(Line::from(vec![
                Span::styled("now playing: ", Style::new().bold()),
                Span::raw(song.title.clone()),
            ]));
            if let Some(artist) = &song.artist {
                lines.push(Line::from(artist.clone()).dim());
            }
        }
        None => lines.push(Line::from("(nothing playing)".dim())),
    }
    if m.queue.len() > 1 {
        lines.push(Line::from(""));
        lines.push(Line::from(format!("queue ({} tracks):", m.queue.len())).bold());
        for (i, song) in m.queue.iter().enumerate().take(6) {
            let marker = if Some(i) == m.current { "\u{25b6} " } else { "  " };
            lines.push(Line::from(format!("{marker}{}", song.title)));
        }
    }
    let block = Paragraph::new(lines)
        .block(Block::bordered().title(Span::styled("queue", Style::new().fg(ACCENT).bold())))
        .wrap(Wrap { trim: false });
    frame.render_widget(block, area);
}

fn draw_settings(frame: &mut Frame, area: Rect, app: &mut App) {
    let snapshot = app.pairing.as_ref().map(|p| p.snapshot());
    let session = snapshot.as_ref().and_then(|s| s.session.as_ref());

    let mode_label = match session.map(|s| s.mode) {
        Some(SessionMode::Everyone) => "everyone",
        Some(SessionMode::Selected) | None => "selected peers only",
    };

    let devices = &app.state.ephemeral.music.output_devices;
    let items = [
        format!("session mode: {mode_label}   (e: toggle)"),
        "regenerate admin pairing code   (a)".to_string(),
        "regenerate session pin          (r)".to_string(),
        format!(
            "audio output device: {} known (picker not built yet)",
            devices.len()
        ),
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
    frame.render_widget(list, area);
}

fn short_id(s: &str) -> String {
    if s.len() <= 16 {
        s.to_string()
    } else {
        format!("{}\u{2026}{}", &s[..8], &s[s.len() - 6..])
    }
}
