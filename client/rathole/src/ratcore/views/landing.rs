//! landing screen — default startup view. shows the "rathole"
//! block banner plus an ascii rendering of the magenta
//! quadrilateral from `assets/freqhole.svg`. the slash repl is
//! always visible at the bottom; users hit ctrl-k to type
//! `/commands`, `/music`, `/remote`, etc.

use ratatui::{
    layout::{Constraint::*, Layout, Rect},
    style::{Style, Stylize},
    text::{Line, Span},
    widgets::Paragraph,
    Frame,
};

use crate::ratcore::{app::App, theme::ACCENT};

pub fn draw(frame: &mut Frame, area: Rect, _app: &App) {
    if area.height == 0 || area.width == 0 {
        return;
    }
    // layout (top -> bottom):
    //   1 line padding (matches the top bar's gap to the banner)
    //   banner ("rathole" block letters)
    //   1 line gap
    //   triangle (sized to fill remaining vertical space)
    //   1 line gap
    //   hint
    //   leftover space at the bottom
    let banner_lines = banner_text();
    let banner_h = banner_lines.len() as u16;
    let pad_top = 1u16;
    // available rows for the triangle = total - pad_top - banner -
    // gap - gap - hint - hint_pad. clamp at 0 if the terminal is
    // tiny.
    let avail_for_tri = area
        .height
        .saturating_sub(pad_top + banner_h + 1 + 1 + 1 + 1);
    // triangle is twice as wide as it is tall (half-block cells).
    let max_tri_w = area.width.min(60);
    let tri_w = max_tri_w.min(avail_for_tri.saturating_mul(2));
    let tri = render_triangle(tri_w as usize);
    let tri_h = tri.len() as u16;

    let total = pad_top + banner_h + 1 + tri_h + 1 + 1 + 1;
    let pad_bot = area.height.saturating_sub(total);
    let [_, banner_a, _, tri_a, _, hint_a, _, _] = Layout::vertical([
        Length(pad_top),
        Length(banner_h),
        Length(1),
        Length(tri_h),
        Length(1),
        Length(1),
        Length(1),
        Length(pad_bot),
    ])
    .areas(area);

    let banner_para = Paragraph::new(
        banner_lines
            .into_iter()
            .map(|l| Line::from(Span::styled(l, Style::new().fg(ACCENT).bold())))
            .collect::<Vec<_>>(),
    )
    .alignment(ratatui::layout::Alignment::Center);
    frame.render_widget(banner_para, banner_a);

    let tri_para = Paragraph::new(
        tri.into_iter()
            .map(|l| Line::from(Span::styled(l, Style::new().fg(ACCENT))))
            .collect::<Vec<_>>(),
    )
    .alignment(ratatui::layout::Alignment::Center);
    frame.render_widget(tri_para, tri_a);

    let hint = Line::from(vec![
        Span::raw("type ").dim(),
        Span::styled("/help", Style::new().fg(ACCENT).bold()),
        Span::raw(" for help  \u{00b7}  ").dim(),
        Span::styled("/", Style::new().fg(ACCENT).bold()),
        Span::raw(" for slash commandz ").dim(),
    ]);
    frame.render_widget(
        Paragraph::new(hint).alignment(ratatui::layout::Alignment::Center),
        hint_a,
    );
}

/// 7-row block-letter banner spelling "rathole".
fn banner_text() -> Vec<String> {
    block_word("rathole")
}

fn block_word(word: &str) -> Vec<String> {
    let mut rows = vec![String::new(); 7];
    for (i, ch) in word.chars().enumerate() {
        if i > 0 {
            for r in &mut rows {
                r.push(' ');
            }
        }
        let glyph = block_letter(ch);
        for (r, line) in glyph.iter().enumerate() {
            rows[r].push_str(line);
        }
    }
    rows
}

/// 7-row x 5-col block letters. only includes the letters used in
/// "freqhole" + "rathole" (f r e q h o l a t). uses full-block
/// glyphs (\u2588) on a space background so the banner reads as
/// a single chunky line of text.
fn block_letter(ch: char) -> [&'static str; 7] {
    // shorthands: B = full block, _ = space.
    const B: char = '\u{2588}';
    // declared inline below for clarity; each glyph is a 5-wide
    // 7-tall sprite.
    match ch {
        'f' => [
            "\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}",
            "\u{2588}    ",
            "\u{2588}    ",
            "\u{2588}\u{2588}\u{2588}\u{2588} ",
            "\u{2588}    ",
            "\u{2588}    ",
            "\u{2588}    ",
        ],
        'r' => [
            "\u{2588}\u{2588}\u{2588}\u{2588} ",
            "\u{2588}   \u{2588}",
            "\u{2588}   \u{2588}",
            "\u{2588}\u{2588}\u{2588}\u{2588} ",
            "\u{2588} \u{2588}  ",
            "\u{2588}  \u{2588} ",
            "\u{2588}   \u{2588}",
        ],
        'e' => [
            "\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}",
            "\u{2588}    ",
            "\u{2588}    ",
            "\u{2588}\u{2588}\u{2588}\u{2588} ",
            "\u{2588}    ",
            "\u{2588}    ",
            "\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}",
        ],
        'q' => [
            " \u{2588}\u{2588}\u{2588} ",
            "\u{2588}   \u{2588}",
            "\u{2588}   \u{2588}",
            "\u{2588}   \u{2588}",
            "\u{2588} \u{2588} \u{2588}",
            "\u{2588}  \u{2588} ",
            " \u{2588}\u{2588} \u{2588}",
        ],
        'h' => [
            "\u{2588}   \u{2588}",
            "\u{2588}   \u{2588}",
            "\u{2588}   \u{2588}",
            "\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}",
            "\u{2588}   \u{2588}",
            "\u{2588}   \u{2588}",
            "\u{2588}   \u{2588}",
        ],
        'o' => [
            " \u{2588}\u{2588}\u{2588} ",
            "\u{2588}   \u{2588}",
            "\u{2588}   \u{2588}",
            "\u{2588}   \u{2588}",
            "\u{2588}   \u{2588}",
            "\u{2588}   \u{2588}",
            " \u{2588}\u{2588}\u{2588} ",
        ],
        'l' => [
            "\u{2588}    ",
            "\u{2588}    ",
            "\u{2588}    ",
            "\u{2588}    ",
            "\u{2588}    ",
            "\u{2588}    ",
            "\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}",
        ],
        'a' => [
            " \u{2588}\u{2588}\u{2588} ",
            "\u{2588}   \u{2588}",
            "\u{2588}   \u{2588}",
            "\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}",
            "\u{2588}   \u{2588}",
            "\u{2588}   \u{2588}",
            "\u{2588}   \u{2588}",
        ],
        't' => [
            "\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}",
            "  \u{2588}  ",
            "  \u{2588}  ",
            "  \u{2588}  ",
            "  \u{2588}  ",
            "  \u{2588}  ",
            "  \u{2588}  ",
        ],
        _ => {
            let _ = B;
            [
                "     ", "     ", "     ", "     ", "     ", "     ", "     ",
            ]
        }
    }
}

/// scan-line polygon-fill the four-vertex magenta quad from
/// `assets/freqhole.svg` into ascii using upper/lower half blocks.
/// `width_cells` is the requested horizontal cell count; the height
/// is half that (since each cell is 2 pixels tall).
fn render_triangle(width_cells: usize) -> Vec<String> {
    let w = width_cells.max(8);
    let h_cells = (w / 2).max(4);
    let pixel_w = w as f64;
    let pixel_h = (h_cells * 2) as f64;
    let scale_x = pixel_w / 500.0;
    let scale_y = pixel_h / 500.0;
    let pts: [(f64, f64); 4] = [
        (125.0 * scale_x, 155.0 * scale_y),
        (375.0 * scale_x, 155.0 * scale_y),
        (303.611 * scale_x, 340.714 * scale_y),
        (250.0 * scale_x, 405.0 * scale_y),
    ];
    let inside = |x: f64, y: f64| -> bool {
        let n = pts.len();
        let mut c = false;
        let mut j = n - 1;
        for i in 0..n {
            let (xi, yi) = pts[i];
            let (xj, yj) = pts[j];
            if ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
                c = !c;
            }
            j = i;
        }
        c
    };
    let mut lines = Vec::with_capacity(h_cells);
    for cy in 0..h_cells {
        let mut s = String::with_capacity(w);
        for cx in 0..w {
            let top = inside(cx as f64 + 0.5, (cy * 2) as f64 + 0.5);
            let bot = inside(cx as f64 + 0.5, (cy * 2 + 1) as f64 + 0.5);
            s.push(match (top, bot) {
                (true, true) => '\u{2588}',
                (true, false) => '\u{2580}',
                (false, true) => '\u{2584}',
                (false, false) => ' ',
            });
        }
        lines.push(s);
    }
    lines
}
