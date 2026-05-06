//! pop-up overlay listing per-row actions for the focused row
//! in the result panel.

use ratatui::{
    layout::{Alignment, Rect},
    style::Style,
    text::{Line, Span},
    widgets::{Block, Clear, Paragraph, Wrap},
    Frame,
};

use crate::ratcore::app::App;
use crate::ratcore::theme::ACCENT;

pub fn draw(frame: &mut Frame, app: &App) {
    let Some(menu) = app.state.ephemeral.action_menu.as_ref() else {
        return;
    };

    // center a small modal in the screen.
    let area = centered(50, 70, frame.area());
    frame.render_widget(Clear, area);

    let title = format!("actions for {}", menu.source_command);
    let mut lines: Vec<Line<'static>> = Vec::with_capacity(menu.options.len() + 2);
    lines.push(Line::from(Span::styled(
        "pick an action then enter — esc to dismiss".to_string(),
        Style::new().dim(),
    )));
    lines.push(Line::from(""));
    for (i, opt) in menu.options.iter().enumerate() {
        let marker = if i == menu.selected { "> " } else { "  " };
        let style = if i == menu.selected {
            Style::new().fg(ACCENT).bold()
        } else {
            Style::new()
        };
        lines.push(Line::from(vec![
            Span::styled(marker, Style::new().fg(ACCENT).bold()),
            Span::styled(opt.label.clone(), style),
            Span::raw("   "),
            Span::styled(format!("({})", opt.target_command), Style::new().dim()),
        ]));
    }

    frame.render_widget(
        Paragraph::new(lines)
            .alignment(Alignment::Left)
            .block(Block::bordered().title(Span::styled(
                title,
                Style::new().fg(ACCENT).bold(),
            )))
            .wrap(Wrap { trim: false }),
        area,
    );
}

fn centered(pct_w: u16, pct_h: u16, area: Rect) -> Rect {
    let w = area.width.saturating_mul(pct_w) / 100;
    let h = area.height.saturating_mul(pct_h) / 100;
    let x = area.x + (area.width.saturating_sub(w)) / 2;
    let y = area.y + (area.height.saturating_sub(h)) / 2;
    Rect {
        x,
        y,
        width: w,
        height: h,
    }
}
