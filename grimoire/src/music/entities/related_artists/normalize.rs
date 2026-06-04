//! name normalization for soft cross-ref joins.
//!
//! produces a key that collapses common surface-form differences
//! ("Sigur Rós" / "sigur ros" / "SIGUR ROS!") into the same string.
//! good enough for an opportunistic match — never used as the only
//! key when an mbid is available on either side.

use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

/// canonical key for soft-matching artist names across sources.
/// algorithm: lowercase -> nfkd decompose -> drop combining marks ->
/// keep alphanumerics only -> collapse to single string.
///
/// returns the empty string for inputs that contain no alphanumeric
/// characters; callers should treat that as "no key" and skip the
/// soft-match path.
pub fn name_key(raw: &str) -> String {
    raw.nfkd()
        .filter(|c| !is_combining_mark(*c))
        .flat_map(|c| c.to_lowercase())
        .filter(|c| c.is_alphanumeric())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::name_key;

    #[test]
    fn handles_diacritics() {
        assert_eq!(name_key("Sigur Rós"), name_key("sigur ros"));
        assert_eq!(name_key("Beyoncé"), "beyonce");
    }

    #[test]
    fn strips_punctuation_and_whitespace() {
        assert_eq!(name_key("!!! (chk chk chk)"), "chkchkchk");
        assert_eq!(name_key("the the"), "thethe");
    }

    #[test]
    fn empty_for_punct_only() {
        assert_eq!(name_key("---"), "");
        assert_eq!(name_key(""), "");
    }
}
