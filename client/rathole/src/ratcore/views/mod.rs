//! view tree. m0 ships one view: the admin command palette.

pub mod action_menu;
pub mod admin;
pub mod command_form;
pub mod flyout;
pub mod landing;
pub mod music;
pub mod peer_input;
pub mod player_row;
pub mod remote_list;
pub mod repl;

use ratatui::{
    layout::{Alignment, Constraint::*, Layout},
    style::{Color, Style, Stylize},
    text::{Line, Span},
    widgets::{Block, Clear, Paragraph},
    Frame,
};

use crate::ratcore::app::{App, Focus};
use crate::ratcore::theme::ACCENT;

pub fn draw(frame: &mut Frame, app: &mut App) {
    let player_h = player_row::height(app);
    let [header, body, player, repl_area, footer] =
        Layout::vertical([Length(1), Min(0), Length(player_h), Length(1), Length(1)])
            .areas(frame.area());

    frame.render_widget(Paragraph::new(footer_hints(app)).dim(), footer);

    // header is split into a left-aligned info segment and a small
    // right-aligned indicator slot for the knock-request bell.
    let knock_text = knock_indicator_text(app);
    let knock_w = knock_text
        .as_ref()
        .map(|s| s.chars().count() as u16 + 1)
        .unwrap_or(0);
    let [header_left, header_right] = Layout::horizontal([Min(0), Length(knock_w)]).areas(header);
    frame.render_widget(
        Paragraph::new(header_line(app)).style(Style::new().bg(ACCENT).fg(Color::White)),
        header_left,
    );
    if let Some(text) = knock_text {
        frame.render_widget(
            Paragraph::new(Line::from(vec![
                Span::raw(" "),
                Span::styled(text, Style::new().bg(Color::Yellow).fg(Color::Black).bold()),
            ]))
            .alignment(Alignment::Right)
            .style(Style::new().bg(ACCENT).fg(Color::White)),
            header_right,
        );
    } else {
        frame.render_widget(
            Paragraph::new("").style(Style::new().bg(ACCENT)),
            header_right,
        );
    }

    // body view: when the repl is focused (ctrl-k overlay) or the
    // player row is focused (ctrl-p), keep the previously-active
    // view rendered behind it instead of forcing the admin palette.
    // that way overlay-style focuses just steal input without
    // yanking the user out of music/landing/etc.
    let body_focus = if app.state.ephemeral.focus == Focus::Repl {
        app.state
            .ephemeral
            .repl
            .return_focus
            .unwrap_or(Focus::AdminPalette)
    } else if app.state.ephemeral.focus == Focus::PlayerRow {
        app.state
            .ephemeral
            .player_row_return_focus
            .unwrap_or(Focus::AdminPalette)
    } else {
        app.state.ephemeral.focus
    };
    match body_focus {
        Focus::Landing => landing::draw(frame, body, app),
        Focus::MusicView => music::draw(frame, body, app),
        _ => admin::palette::draw(frame, body, app),
    }

    if player_h > 0 {
        player_row::draw(frame, player, app);
    }

    repl::draw(frame, repl_area, app);

    // slash-completion flyout sits above the repl row when matches
    // narrow. drawn after the repl so it overlays cleanly.
    flyout::draw(frame, repl_area, app);

    if app.state.ephemeral.focus == Focus::PeerInput {
        peer_input::draw(frame, app);
    }

    if app.state.ephemeral.focus == Focus::RemoteList {
        remote_list::draw(frame, app);
    }

    if app.state.ephemeral.focus == Focus::ResultActionMenu {
        action_menu::draw(frame, app);
    }

    if app.state.ephemeral.pending_quit {
        draw_quit_confirm(frame);
    }
}

/// centered confirm overlay for the global `q` quit shortcut. y/enter
/// quits, n/esc cancels (handled in the shell key dispatcher).
fn draw_quit_confirm(frame: &mut Frame) {
    let area = frame.area();
    let w = 44u16.min(area.width);
    let h = 5u16.min(area.height);
    let x = area.x + (area.width.saturating_sub(w)) / 2;
    let y = area.y + (area.height.saturating_sub(h)) / 2;
    let rect = ratatui::layout::Rect {
        x,
        y,
        width: w,
        height: h,
    };
    frame.render_widget(Clear, rect);
    let lines = vec![
        Line::from(""),
        Line::from(Span::styled(
            "are you sure you want to quit?",
            Style::new().fg(Color::White).bold(),
        )),
        Line::from(Span::styled(
            "y/enter: quit    n/esc: cancel",
            Style::new().dim(),
        )),
    ];
    frame.render_widget(
        Paragraph::new(lines)
            .alignment(Alignment::Center)
            .block(Block::bordered().style(Style::new().fg(ACCENT))),
        rect,
    );
}

fn header_line(app: &App) -> Line<'static> {
    let mut spans: Vec<Span<'static>> = vec![
        Span::styled("rathole", Style::new().fg(Color::Black).bold()),
        Span::raw("   "),
    ];

    // remote name (or `local`) in brackets — replaces the previous
    // [home]/[admin] focus label.
    let remote_label = if app.state.ephemeral.connected_peer.is_some() {
        if let Some(name) = app
            .state
            .ephemeral
            .remote_name
            .as_deref()
            .filter(|s| !s.is_empty())
        {
            format!("[{name}]")
        } else if let Some(peer) = &app.state.ephemeral.connected_peer {
            format!("[{}]", short_id(peer))
        } else {
            "[local]".to_string()
        }
    } else if app.state.ephemeral.local_node_id.is_some() {
        "[local p2p]".to_string()
    } else {
        "[local]".to_string()
    };
    spans.push(Span::styled(
        remote_label,
        Style::new().fg(Color::White).bold(),
    ));

    if let Some(local) = &app.state.ephemeral.local_node_id {
        spans.push(Span::raw("   me: "));
        spans.push(Span::raw(short_id(local)));
    }

    if let Some(kid) = &app.state.ephemeral.last_knock_id {
        spans.push(Span::raw("   knock: "));
        spans.push(Span::raw(kid.clone()));
    }

    // serve subprocess badges. when in `auto` mode + running we
    // emit both `http` and `p2p` (the subprocess runs both
    // internally); otherwise we emit a single badge for whichever
    // mode is selected.
    push_serve_badges(&mut spans, &app.state.ephemeral.serve);

    // jobs progress badge (scan / fetch / etc.) — only renders
    // when a session is in flight.
    push_jobs_badge(&mut spans, app.state.ephemeral.jobs_status.as_ref());

    Line::from(spans)
}

fn push_serve_badges(spans: &mut Vec<Span<'static>>, badge: &crate::ratcore::app::ServeBadge) {
    use crate::ratcore::app::ServeMode;
    if matches!(badge.mode, ServeMode::None) && badge.last_message.is_none() {
        return;
    }
    let style_running = Style::new().bg(Color::Green).fg(Color::Black).bold();
    let style_stopped = Style::new().bg(Color::Red).fg(Color::White).dim();
    let style = if badge.running {
        style_running
    } else {
        style_stopped
    };
    let labels: &[&str] = match badge.mode {
        // auto runs both http + p2p in the same subprocess, so we
        // surface both badges.
        ServeMode::Auto => &["http", "p2p"],
        ServeMode::Http => &["http"],
        ServeMode::P2p => &["p2p"],
        ServeMode::None => &["serve"],
    };
    for label in labels {
        spans.push(Span::raw("   "));
        spans.push(Span::styled(format!(" {label} "), style));
    }
}

fn push_jobs_badge(spans: &mut Vec<Span<'static>>, jobs: Option<&crate::ratcore::app::JobsStatus>) {
    let Some(j) = jobs else { return };
    if j.kind.is_empty() {
        return;
    }
    let spinner = spinner_glyph();
    let label = if j.percent > 0 {
        format!(" {spinner} {} {}% ", j.kind, j.percent)
    } else if j.jobs_total > 0 {
        let done = j.jobs_total.saturating_sub(j.jobs_pending);
        format!(" {spinner} {} {}/{} ", j.kind, done, j.jobs_total)
    } else {
        format!(" {spinner} {} ", j.kind)
    };
    spans.push(Span::raw("   "));
    spans.push(Span::styled(
        label,
        Style::new().bg(Color::Cyan).fg(Color::Black).bold(),
    ));
}

/// rotating ascii spinner glyph driven by the system clock so we
/// don't need to thread a frame counter through render state. ~8Hz
/// — fast enough to feel "live", slow enough to read.
fn spinner_glyph() -> char {
    const FRAMES: &[char] = &['|', '/', '-', '\\'];
    // SystemTime is fine on tty; web shell never renders this badge
    // (no grimoire event subscription on wasm), so the wasm32 path
    // never reaches here even though SystemTime is unsupported there.
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    FRAMES[((ms / 250) as usize) % FRAMES.len()]
}

/// right-aligned bell-style indicator showing the count of pending
/// knock requests. returns `None` when there are no pending knocks
/// (the slot is left empty in that case).
fn knock_indicator_text(app: &App) -> Option<String> {
    let n = app.state.ephemeral.pending_knocks;
    if n == 0 {
        return None;
    }
    // ascii-only bell stand-in; lowercase prose, no emoji.
    Some(format!(" knock {n} "))
}

#[allow(dead_code)]
/// short tag identifying which top-level view is active. retained
/// for callers that still want a focus label; the top bar no longer
/// renders it.
fn view_label(app: &App) -> Span<'static> {
    // when in the repl, label the underlying view (so ctrl-k feels
    // like an overlay rather than navigation).
    let focus = if app.state.ephemeral.focus == Focus::Repl {
        app.state
            .ephemeral
            .repl
            .return_focus
            .unwrap_or(Focus::AdminPalette)
    } else {
        app.state.ephemeral.focus
    };
    let label = match focus {
        Focus::Landing => "[home]",
        Focus::MusicView => "[music]",
        Focus::PeerInput => "[remote]",
        Focus::RemoteList => "[remotes]",
        Focus::Repl => "[repl]",
        Focus::PlayerRow => "[player]",
        _ => "[admin]",
    };
    // header bg is magenta now — use white text so it stays legible.
    Span::styled(label, Style::new().fg(Color::White).bold())
}

fn footer_hints(app: &App) -> &'static str {
    match app.state.ephemeral.focus {
        Focus::Landing => {
            "/ slash repl"
        }
        Focus::AdminPalette => {
            "\u{2191}/\u{2193}: move   enter: dispatch/form   tab: focus resultz   /: repl"
        }
        Focus::PeerInput => "type/paste node id   enter: connect   esc: cancel",
        Focus::RemoteList => "\u{2191}/\u{2193}: select   enter: connect   a: add   d: delete   esc: back",
        Focus::CommandForm => "\u{2190}/\u{2192}: cycle option   tab/enter: next   esc: cancel",
        Focus::ResultPanel => "\u{2191}/\u{2193}: move row   pgup/pgdn: page   enter: actions   tab/esc: back",
        Focus::ResultActionMenu => "\u{2191}/\u{2193}: pick   enter: open form   esc: cancel",
        Focus::MusicView => {
            "\u{2191}/\u{2193}: move   enter: play   space: pause   n/p: skip   \u{2190}/\u{2192}: seek   -/=: vol   f: favorite   /: repl   esc: home"
        }
        Focus::Repl => {
            "type /command   tab: complete   \u{2191}/\u{2193}: history   enter: run   esc: cancel"
        }
        Focus::PlayerRow => {
            "\u{2190}/\u{2192} h/l: pick control   enter/space: activate   tab: next/exit   esc: leave"
        }
    }
}

/// shorten a long node id like `abc123…ef89` for header display.
fn short_id(s: &str) -> String {
    if s.len() <= 16 {
        s.to_string()
    } else {
        format!("{}…{}", &s[..8], &s[s.len() - 6..])
    }
}
