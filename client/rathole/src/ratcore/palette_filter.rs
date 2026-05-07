//! shared key handling for the admin palette filter input.
//!
//! both shells (web + tty) listen for printable chars / backspace
//! while focused on [`Focus::AdminPalette`] and route them through
//! these helpers so the filtering ux is identical across builds.
//!
//! the palette selection is stored in `palette_list` as an index
//! into the *filtered* visible list, so any change to the filter
//! resets the selection back to the top of the visible list.

use crate::ratcore::app::App;

/// append a printable char to the palette filter and reset the
/// list selection to the top of the (newly filtered) visible list.
pub fn push_char(app: &mut App, c: char) {
    app.state.ephemeral.palette_filter.push(c);
    reset_selection(app);
}

/// pop the trailing char (one unicode scalar) from the palette
/// filter. returns true if anything was removed (the caller might
/// want to fall through to a different binding when the filter was
/// already empty — e.g. esc-on-empty unwinds focus).
pub fn pop_char(app: &mut App) -> bool {
    if app.state.ephemeral.palette_filter.is_empty() {
        return false;
    }
    app.state.ephemeral.palette_filter.pop();
    reset_selection(app);
    true
}

/// drop the entire filter buffer.
pub fn clear(app: &mut App) -> bool {
    if app.state.ephemeral.palette_filter.is_empty() {
        return false;
    }
    app.state.ephemeral.palette_filter.clear();
    reset_selection(app);
    true
}

fn reset_selection(app: &mut App) {
    let visible = app.palette_visible_indices();
    if visible.is_empty() {
        app.state.ephemeral.palette_list.select(None);
    } else {
        app.state.ephemeral.palette_list.select(Some(0));
    }
}

/// classify a char that arrived in the palette focus. printable
/// chars (alphanumeric, `_`, `-`, `.`, ` `) feed the filter; the
/// rest fall through to whatever bindings the shell layered on.
///
/// using a deliberately narrow allow-list (instead of `is_ascii_graphic`)
/// keeps room open for future single-key bindings on punctuation
/// (`/`, `?`, `:`) without those chars getting eaten by the filter.
pub fn is_filter_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '-' | '.' | ' ')
}
