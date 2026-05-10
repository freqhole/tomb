//! tiny single-line text-edit primitive shared by tty + web shells.
//! tracks a buffer + caret position (in chars). all ops are saturating
//! and unicode-safe. no allocation beyond the buffer itself.
//!
//! we hand-roll instead of pulling `tui-input` because we only need
//! one field today; if more inputs land we should swap to it.

/// insert one char at the caret and advance the caret.
pub fn insert_char(buf: &mut String, cursor: &mut usize, c: char) {
    let byte_idx = char_to_byte(buf, *cursor);
    buf.insert(byte_idx, c);
    *cursor += 1;
}

/// insert a whole string at the caret, advancing the caret by its
/// char count. control chars are stripped.
pub fn insert_str(buf: &mut String, cursor: &mut usize, s: &str) {
    for c in s.chars().filter(|c| !c.is_control()) {
        insert_char(buf, cursor, c);
    }
}

/// delete the char before the caret (backspace).
pub fn backspace(buf: &mut String, cursor: &mut usize) {
    if *cursor == 0 {
        return;
    }
    let end_byte = char_to_byte(buf, *cursor);
    let start_byte = char_to_byte(buf, *cursor - 1);
    buf.replace_range(start_byte..end_byte, "");
    *cursor -= 1;
}

/// delete the char at the caret (delete-forward).
pub fn delete(buf: &mut String, cursor: &mut usize) {
    let total = buf.chars().count();
    if *cursor >= total {
        return;
    }
    let start_byte = char_to_byte(buf, *cursor);
    let end_byte = char_to_byte(buf, *cursor + 1);
    buf.replace_range(start_byte..end_byte, "");
}

pub fn move_left(cursor: &mut usize) {
    *cursor = cursor.saturating_sub(1);
}

pub fn move_right(buf: &str, cursor: &mut usize) {
    let total = buf.chars().count();
    if *cursor < total {
        *cursor += 1;
    }
}

pub fn move_home(cursor: &mut usize) {
    *cursor = 0;
}

pub fn move_end(buf: &str, cursor: &mut usize) {
    *cursor = buf.chars().count();
}

/// clamp caret to `0..=buf.chars().count()`.
pub fn clamp(buf: &str, cursor: &mut usize) {
    let max = buf.chars().count();
    if *cursor > max {
        *cursor = max;
    }
}

fn char_to_byte(s: &str, char_idx: usize) -> usize {
    s.char_indices()
        .nth(char_idx)
        .map(|(b, _)| b)
        .unwrap_or(s.len())
}
