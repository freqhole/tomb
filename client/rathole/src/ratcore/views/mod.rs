//! view tree. m0 ships one view: the admin command palette.

pub mod admin;
pub mod action_menu;
pub mod command_form;
pub mod peer_input;

use ratatui::{
    layout::{Constraint::*, Layout},
    style::Stylize,
    text::{Line, Span},
    widgets::Paragraph,
    Frame,
};

use crate::ratcore::app::{App, Focus};

pub fn draw(frame: &mut Frame, app: &mut App) {
    let [header, body, footer] =
        Layout::vertical([Length(1), Min(0), Length(1)]).areas(frame.area());

    frame.render_widget(
        Paragraph::new(header_line(app)).bold().on_dark_gray(),
        header,
    );
    frame.render_widget(Paragraph::new(footer_hints(app)).dim(), footer);

    admin::palette::draw(frame, body, app);

    if app.state.ephemeral.focus == Focus::PeerInput {
        peer_input::draw(frame, app);
    }

    if app.state.ephemeral.focus == Focus::ResultActionMenu {
        action_menu::draw(frame, app);
    }
}

fn header_line(app: &App) -> Line<'static> {
    let mut spans: Vec<Span<'static>> = vec![Span::raw("rathole — admin")];

    if let Some(peer) = &app.state.ephemeral.connected_peer {
        spans.push(Span::raw("   peer: "));
        spans.push(Span::raw(short_id(peer)));
    } else {
        spans.push(Span::raw("   peer: "));
        spans.push(Span::raw("(none)"));
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

fn footer_hints(app: &App) -> &'static str {
    match app.state.ephemeral.focus {
        Focus::AdminPalette => {
            "↑/↓ j/k: move   enter: dispatch/form   tab: focus output   p: peer   q: quit"
        }
        Focus::PeerInput => "type/paste node id   enter: connect   esc: cancel",
        Focus::CommandForm => "←/→: cycle option   enter: next/submit   esc: cancel",
        Focus::ResultPanel => "↑/↓: scroll/row   a/enter: actions   tab/esc: back",
        Focus::ResultActionMenu => "↑/↓: pick   enter: open form   esc: cancel",
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
