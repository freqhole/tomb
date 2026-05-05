//! view tree. m0 ships one view: the admin command palette.

pub mod admin;

use ratatui::{
    layout::{Constraint::*, Layout},
    style::Stylize,
    widgets::Paragraph,
    Frame,
};

use crate::app::App;

pub fn draw(frame: &mut Frame, app: &mut App) {
    let [header, body, footer] =
        Layout::vertical([Length(1), Min(0), Length(1)]).areas(frame.area());

    frame.render_widget(
        Paragraph::new("rathole — admin").bold().on_dark_gray(),
        header,
    );
    frame.render_widget(
        Paragraph::new(footer_hints()).dim(),
        footer,
    );

    admin::palette::draw(frame, body, app);
}

fn footer_hints() -> &'static str {
    "↑/↓ or j/k: move   enter: dispatch (no args)   q / ctrl-c: quit"
}
