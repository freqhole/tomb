//! view tree. m0 ships one view: the admin command palette.

pub mod action_menu;
pub mod admin;
pub mod command_form;
pub mod music;
pub mod peer_input;
pub mod player_row;
pub mod repl;

use ratatui::{
    layout::{Constraint::*, Layout},
    style::Stylize,
    text::{Line, Span},
    widgets::Paragraph,
    Frame,
};

use crate::ratcore::app::{App, Focus};

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
        Paragraph::new(header_line(app)).bold().on_dark_gray(),
        header,
    );
    frame.render_widget(Paragraph::new(footer_hints(app)).dim(), footer);

    if app.state.ephemeral.focus == Focus::MusicView {
        music::draw(frame, body, app);
    } else {
        admin::palette::draw(frame, body, app);
    }

    if player_h > 0 {
        player_row::draw(frame, player, app);
    }

    repl::draw(frame, repl_area, app);

    if app.state.ephemeral.focus == Focus::PeerInput {
        peer_input::draw(frame, app);
    }

    if app.state.ephemeral.focus == Focus::ResultActionMenu {
        action_menu::draw(frame, app);
    }
}

fn header_line(app: &App) -> Line<'static> {
    let mut spans: Vec<Span<'static>> = vec![
        Span::raw("rathole").bold(),
        Span::raw("   "),
        view_label(app),
        Span::raw("  ·  "),
    ];

    if let Some(peer) = &app.state.ephemeral.connected_peer {
        spans.push(Span::raw("peer: ").dim());
        spans.push(Span::raw(short_id(peer)));
    } else if app.state.ephemeral.local_node_id.is_some() {
        spans.push(Span::raw("local p2p").dim());
    } else {
        spans.push(Span::raw("local").dim());
    }

    if let Some(local) = &app.state.ephemeral.local_node_id {
        spans.push(Span::raw("   me: ").dim());
        spans.push(Span::raw(short_id(local)));
    }

    if let Some(kid) = &app.state.ephemeral.last_knock_id {
        spans.push(Span::raw("   knock: ").dim());
        spans.push(Span::raw(kid.clone()));
    }

    Line::from(spans)
}

/// short tag identifying which top-level view is active. shows up
/// near the start of the header so it's always obvious where you are.
fn view_label(app: &App) -> Span<'static> {
    let label = match app.state.ephemeral.focus {
        Focus::MusicView => "[music]",
        Focus::PeerInput => "[peer]",
        Focus::Repl => "[repl]",
        Focus::PlayerRow => "[player]",
        _ => "[admin]",
    };
    Span::styled(
        label,
        ratatui::style::Style::new().fg(crate::ratcore::theme::ACCENT),
    )
}

fn footer_hints(app: &App) -> &'static str {
    match app.state.ephemeral.focus {
        Focus::AdminPalette => {
            "↑/↓ j/k: move   enter: dispatch/form   tab: focus resultz   m: music   p: peer   ctrl-k: repl   q: quit"
        }
        Focus::PeerInput => "type/paste node id   enter: connect   esc: cancel",
        Focus::CommandForm => "←/→: cycle option   tab/enter: next   esc: cancel",
        Focus::ResultPanel => "↑/↓ j/k: move row   pgup/pgdn: page   a/enter: actions   tab/esc: back",
        Focus::ResultActionMenu => "↑/↓: pick   enter: open form   esc: cancel",
        Focus::MusicView => {
            "type to search   enter: search/play   space: pause   n/p: skip   ←/→: seek   -/=: vol   f: favorite   esc: back"
        }
        Focus::Repl => {
            "type /command   tab: complete   ↑/↓: history   enter: run   esc: cancel"
        }
        Focus::PlayerRow => {
            "←/→ h/l: pick control   enter/space: activate   tab: next   esc/q: leave"
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
