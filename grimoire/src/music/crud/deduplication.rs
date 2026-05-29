//! deduplication helpers for case-insensitive matching
//! provides utilities to prevent duplicate artists, albums, and genres

use unicode_normalization::char::is_combining_mark;

/// check if character is a unicode format character
/// includes directional marks (LTR/RTL), zero-width spaces, joiners, etc
fn is_format_char(c: &char) -> bool {
    matches!(
        *c,
        '\u{200B}' // zero-width space
        | '\u{200C}' // zero-width non-joiner
        | '\u{200D}' // zero-width joiner
        | '\u{200E}' // left-to-right mark
        | '\u{200F}' // right-to-left mark
        | '\u{2028}' // line separator
        | '\u{2029}' // paragraph separator
        | '\u{202A}' // left-to-right embedding
        | '\u{202B}' // right-to-left embedding
        | '\u{202C}' // pop directional formatting
        | '\u{202D}' // left-to-right override
        | '\u{202E}' // right-to-left override
        | '\u{2060}' // word joiner
        | '\u{2061}' // function application
        | '\u{2062}' // invisible times
        | '\u{2063}' // invisible separator
        | '\u{2064}' // invisible plus
        | '\u{206A}' // inhibit symmetric swapping
        | '\u{206B}' // activate symmetric swapping
        | '\u{206C}' // inhibit arabic form shaping
        | '\u{206D}' // activate arabic form shaping
        | '\u{206E}' // national digit shapes
        | '\u{206F}' // nominal digit shapes
        | '\u{FEFF}' // zero-width no-break space (BOM)
    )
}

/// normalize a name for case-insensitive matching
/// trims whitespace, converts to lowercase, collapses multiple spaces,
/// and removes unicode combining characters, format marks, and control characters
pub fn normalize_name(input: &str) -> String {
    // first, strip invisible unicode characters (combining marks, directional marks, etc)
    let cleaned: String = input
        .chars()
        .filter(|c| {
            !is_combining_mark(*c) // combining diacritics
                && !c.is_control() // control characters
                && !is_format_char(c) // format characters (directional marks, zero-width, etc)
        })
        .collect();

    // then normalize whitespace and case
    cleaned
        .trim()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// normalize artist name with music-specific rules
pub fn normalize_artist_name(input: &str) -> String {
    let normalized = normalize_name(input);

    // TODO: add music-specific normalization rules
    // - Handle "The Beatles" vs "Beatles, The"
    // - Handle feat./featuring variations
    // - Handle punctuation differences ("Guns N' Roses" vs "Guns N Roses")

    normalized
}

/// normalize album title with music-specific rules
pub fn normalize_album_title(input: &str) -> String {
    let normalized = normalize_name(input);

    // TODO: add album-specific normalization rules
    // - Handle "Greatest Hits" variations
    // - Handle edition markers "(Deluxe)", "[Remastered]"
    // - Handle year suffixes

    normalized
}

/// check if two artist names should be considered the same
pub fn artists_match(name1: &str, name2: &str) -> bool {
    normalize_artist_name(name1) == normalize_artist_name(name2)
}

/// check if two album titles should be considered the same
pub fn albums_match(title1: &str, title2: &str) -> bool {
    normalize_album_title(title1) == normalize_album_title(title2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_name() {
        assert_eq!(normalize_name("  The Beatles  "), "the beatles");
        assert_eq!(normalize_name("Guns N'   Roses"), "guns n' roses");
        assert_eq!(normalize_name("RADIOHEAD"), "radiohead");
        assert_eq!(normalize_name(""), "");
        // test unicode combining characters
        assert_eq!(normalize_name("Co͟c͟k͟s͟"), "cocks");
        // test directional marks (LEFT-TO-RIGHT MARK U+200E)
        assert_eq!(normalize_name("Scorn \u{200E}"), "scorn");
        assert_eq!(normalize_name("Scorn"), "scorn");
        // both should match after normalization
        assert_eq!(normalize_name("Scorn \u{200E}"), normalize_name("Scorn"));
    }

    #[test]
    fn test_artists_match() {
        assert!(artists_match("The Beatles", "the beatles"));
        assert!(artists_match("RADIOHEAD", "Radiohead"));
        assert!(artists_match("  Pink Floyd  ", "Pink Floyd"));
        assert!(!artists_match("The Beatles", "Beatles"));
    }

    #[test]
    fn test_albums_match() {
        assert!(albums_match("OK Computer", "ok computer"));
        assert!(albums_match("Abbey Road", "ABBEY ROAD"));
        assert!(!albums_match("Abbey Road", "Sgt. Pepper"));
    }
}
