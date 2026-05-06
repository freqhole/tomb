//! view tree. m0 ships one view: the admin command palette.

pub mod action_menu;
pub mod admin;
pub mod command_form;
pub mod landing;
pub mod music;
pub mod peer_input;
pub mod player_row;
pub mod remote_list;
pub mod repl;

use ratatui::{
    layout::{Constraint::*, Layout, Alignment},
    style::{Color, Style, Stylize},
    text::{Line, Span},
    widgets::{Block, Clear, Paragraph},
    Frame,
};

use crate::ratcore::app::{App, Focus};
use crate::ratcore::theme::ACCENT;

pub fn draw(frame: &mut Frame, app: &mut App) {
    let player_h = player_row::height(app);
    let [header, body, player, repl_area, footer] = Layout::vertical([
        Length(1),
        Min(0),
        Length(player_h),
        Length(1),
        Length(1),
    ])
    .areas(frame.area());

    frame.render_widget(
        Paragraph::new(header_line(app)).style(Style::new().bg(ACCENT).fg(Color::White)),
        header,
    );
    frame.render_widget(Paragraph::new(footer_hints(app)).dim(), footer);

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
    let rect = ratatui::layout::Rect { x, y, width: w, height: h };
    frame.render_widget(Clear, rect);
    let lines = vec![
        Line::from(""),
        Line::from(Span::styled(
            "are you sure you want to quit?",
            Style::new().fg(Color::White).bold(),
        )),
        Line::from(Span::styled("y/enter: quit    n/esc: cancel", Style::new().dim())),
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
        view_label(app),
        Span::raw("  \u{00b7}  "),
    ];

    if let Some(peer) = &app.state.ephemeral.connected_peer {
        spans.push(Span::raw("remote: "));
        if let Some(name) = app
            .state
            .ephemeral
            .remote_name
            .as_deref()
            .filter(|s| !s.is_empty())
        {
            spans.push(Span::raw(name.to_string()));
        } else {
            spans.push(Span::raw(short_id(peer)));
        }
    } else if app.state.ephemeral.local_node_id.is_some() {
        spans.push(Span::raw("local p2p"));
    } else {
        spans.push(Span::raw("local"));
    }

    if let Some(local) = &app.state.ephemeral.local_node_id {
        spans.push(Span::raw("   me: "));
        spans.push(Span::raw(short_id(local)));
    }

    if let Some(kid) = &app.state.ephemeral.last_knock_id {
        spans.push(Span::raw("   knock: "));
        spans.push(Span::raw(kid.clone()));
    }

    Line::from(spans)
}

/// short tag identifying which top-level view is active. shows up
/// near the start of the header so it's always obvious where you are.
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
            "c commands   m music   r remote   p player   ctrl-k repl   q quit"
        }
        Focus::AdminPalette => {
            "↑/↓ j/k: move   enter: dispatch/form   tab: focus resultz   ctrl-m: music   ctrl-r: remote   ctrl-p: player   ctrl-k: repl   q: quit"
        }
        Focus::PeerInput => "type/paste node id   enter: connect   esc: cancel",
        Focus::RemoteList => "↑/↓: select   enter: connect   a: add   d: delete   esc: back",
        Focus::CommandForm => "←/→: cycle option   tab/enter: next   esc: cancel",
        Focus::ResultPanel => "↑/↓ j/k: move row   pgup/pgdn: page   a/enter: actions   tab/esc: back",
        Focus::ResultActionMenu => "↑/↓: pick   enter: open form   esc: cancel",
        Focus::MusicView => {
            "j/k: move   enter: play   space: pause   n/p: skip   ←/→: seek   -/=: vol   f: favorite   /local /search   esc: home"
        }
        Focus::Repl => {
            "type /command   tab: complete   ↑/↓: history   enter: run   esc: cancel"
        }
        Focus::PlayerRow => {
            "←/→ h/l: pick control   enter/space: activate   tab: next/exit   esc/q/ctrl-p: leave"
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
