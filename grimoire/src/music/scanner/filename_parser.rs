//! filename parsing for music files
//!
//! extracts artist, album, and track information from filenames using common patterns:
//! - space-wrapped hyphens (` - `) separate artist, album, and track
//! - single hyphens (`-`) can also separate parts
//! - double hyphens (`--`) separate parts
//! - underscores can be used instead of spaces
//! - numbers in filename are extracted as track numbers
//! - leading/trailing commas are trimmed after number removal
//! - parentheses content (featuring, remix info) is preserved in track title
//! - youtube video IDs are removed (in square brackets or at end)
//! - unicode combining characters are stripped
//! - various hyphen types (en dash, em dash) are normalized
//! - "full album" detection uses album name for both album and track
//! - folder name used as album fallback when no album found
//!
//! examples:
//! - `Artist - Track.mp3` -> artist: "Artist", track: "Track"
//! - `Artist - Album - Track.mp3` -> artist: "Artist", album: "Album", track: "Track"
//! - `Zeigenbock_Kopf_-_04_-_Moves_Wicked.mp3` -> artist: "Zeigenbock Kopf", track: "Moves Wicked", track_number: 4
//! - `01 - Song Name.mp3` -> track: "Song Name", track_number: 1
//! - `01-Daft Punk-One More Time.mp3` -> artist: "Daft Punk", track: "One More Time", track_number: 1
//! - `01-Deftones--Hexagram.mp3` -> artist: "Deftones", track: "Hexagram", track_number: 1
//! - `01, Know you now.mp3` -> track: "Know you now", track_number: 1
//! - `Moonlight - San Salvador [Qt4YceNHIZU].mp3` -> artist: "Moonlight", track: "San Salvador"
//! - `Nine Inch Nails - Fixed (1992) full EP-lDY94PTe-BE.mp3` -> artist: "Nine Inch Nails", album: "Fixed (1992) full EP", track: "Fixed (1992) full EP"

use std::path::Path;
use unicode_normalization::char::is_combining_mark;

/// parsed metadata from a filename
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedFilename {
    /// artist name extracted from filename
    pub artist: Option<String>,
    /// album name extracted from filename
    pub album: Option<String>,
    /// track name extracted from filename
    pub track: Option<String>,
    /// track number extracted from filename
    pub track_number: Option<i64>,
}

impl ParsedFilename {
    /// create empty parsed filename
    pub fn empty() -> Self {
        Self {
            artist: None,
            album: None,
            track: None,
            track_number: None,
        }
    }

    /// check if any metadata was parsed
    pub fn has_data(&self) -> bool {
        self.artist.is_some()
            || self.album.is_some()
            || self.track.is_some()
            || self.track_number.is_some()
    }
}

/// parse metadata from a music filename
///
/// extracts artist, album, track, and track number using common patterns:
/// 1. removes youtube video IDs
/// 2. removes unicode combining characters
/// 3. normalizes various hyphen types to standard hyphen
/// 4. replaces underscores with spaces
/// 5. normalizes separators (` - `, `-`, `--`)
/// 6. splits on normalized separator
/// 7. extracts numbers as track numbers and removes them from parts
/// 8. trims leading/trailing commas and hyphens from parts
/// 9. detects "full album" and uses album name for both album and track
/// 10. interprets parts based on count:
///    - 1 part: track only (or album+track if "full album")
///    - 2 parts: artist, track
///    - 3+ parts: artist, album, track (remaining parts joined)
pub fn parse_filename(file_path: &Path) -> ParsedFilename {
    // get filename without extension
    let filename = match file_path.file_stem().and_then(|s| s.to_str()) {
        Some(name) => name,
        None => return ParsedFilename::empty(),
    };

    // clean filename: remove youtube IDs, combining chars, normalize hyphens
    let cleaned = clean_filename(filename);

    // normalize the filename: underscores to spaces
    let mut normalized = cleaned.replace('_', " ");

    // detect and normalize different separator patterns
    // priority: ` - ` (space-wrapped), `--` (double hyphen), `-` (single hyphen)
    // note: commas are NOT separators, they're common in song titles
    let separator = if normalized.contains(" - ") {
        " - "
    } else if normalized.contains("--") {
        // normalize double hyphen to single separator
        normalized = normalized.replace("--", " - ");
        " - "
    } else if normalized.contains('-') {
        // single hyphen without spaces - normalize to space-wrapped
        normalized = normalize_single_hyphens(&normalized);
        " - "
    } else {
        // no clear separator, will parse as single part
        " - "
    };

    // split on separator
    let parts: Vec<&str> = normalized.split(separator).map(|s| s.trim()).collect();

    // extract track number from all parts (look for standalone numbers or leading numbers)
    let track_number = extract_track_number(&parts);

    // remove track numbers from parts and clean them up
    // also trim any leading/trailing commas and hyphens that might be left over
    let cleaned_parts: Vec<String> = parts
        .iter()
        .map(|part| remove_leading_numbers(part))
        .map(|part| {
            part.trim_matches(|c| c == ',' || c == '-')
                .trim()
                .to_string()
        })
        .filter(|part| !part.is_empty())
        .collect();

    // check if "full album" was in the original filename (case insensitive)
    // note: the [Full Album] tag itself has been stripped during cleaning
    let is_full_album = filename.to_lowercase().contains("full album");

    match cleaned_parts.len() {
        0 => ParsedFilename {
            artist: None,
            album: None,
            track: None,
            track_number,
        },
        1 => {
            let track_title = cleaned_parts[0].clone();
            if is_full_album {
                // if "full album", use same for album and track
                ParsedFilename {
                    artist: None,
                    album: Some(track_title.clone()),
                    track: Some(track_title),
                    track_number,
                }
            } else {
                ParsedFilename {
                    artist: None,
                    album: None,
                    track: Some(track_title),
                    track_number,
                }
            }
        }
        2 => {
            let artist = Some(cleaned_parts[0].clone());
            let track_or_album = cleaned_parts[1].clone();
            if is_full_album {
                // if "full album", second part is both album and track
                ParsedFilename {
                    artist,
                    album: Some(track_or_album.clone()),
                    track: Some(track_or_album),
                    track_number,
                }
            } else {
                ParsedFilename {
                    artist,
                    album: None,
                    track: Some(track_or_album),
                    track_number,
                }
            }
        }
        _ => {
            // 3 or more parts: artist - album - track (+ any remaining parts joined to track)
            let artist = Some(cleaned_parts[0].clone());
            let album_or_track = cleaned_parts[1].clone();
            let remaining = cleaned_parts[2..].join(" - ");

            if is_full_album {
                // if "full album", second part is album title
                ParsedFilename {
                    artist,
                    album: Some(album_or_track.clone()),
                    track: Some(album_or_track),
                    track_number,
                }
            } else {
                ParsedFilename {
                    artist,
                    album: Some(album_or_track),
                    track: Some(remaining),
                    track_number,
                }
            }
        }
    }
}

/// clean filename: remove youtube IDs, unicode combining chars, normalize hyphens
fn clean_filename(filename: &str) -> String {
    let mut cleaned = filename.to_string();

    // remove youtube video IDs (usually in square brackets or at end)
    cleaned = remove_youtube_ids(&cleaned);

    // remove [Full Album] or [full album] text
    cleaned = remove_full_album_tags(&cleaned);

    // remove unicode combining characters (like in "Co͟c͟k͟s͟")
    cleaned = remove_combining_chars(&cleaned);

    // normalize various hyphen types to standard hyphen
    cleaned = normalize_hyphens(&cleaned);

    cleaned
}

/// remove youtube video IDs from filename
/// pattern: [-_a-zA-Z0-9]{11} (youtube IDs are 11 chars)
fn remove_youtube_ids(s: &str) -> String {
    let mut result = s.to_string();

    // remove square bracket patterns: [VideoID]
    if let Ok(bracket_pattern) = regex::Regex::new(r"\[[-_a-zA-Z0-9]{11}\]") {
        result = bracket_pattern.replace_all(&result, "").to_string();
    }

    // remove trailing -VideoID or .VideoID patterns
    if let Ok(trailing_pattern) = regex::Regex::new(r"[-.]([a-zA-Z0-9_-]{11})$") {
        result = trailing_pattern.replace_all(&result, "").to_string();
    }

    result.trim().to_string()
}

/// remove [Full Album] or [full album] tags from filename
fn remove_full_album_tags(s: &str) -> String {
    let mut result = s.to_string();

    // remove [Full Album] case insensitive
    if let Ok(pattern) = regex::Regex::new(r"(?i)\[full album\]") {
        result = pattern.replace_all(&result, "").to_string();
    }

    result.trim().to_string()
}

/// remove unicode combining characters, format marks, and control characters
/// strips invisible characters like combining marks, directional marks (LTR/RTL),
/// zero-width spaces, and other formatting/control characters
fn remove_combining_chars(s: &str) -> String {
    s.chars()
        .filter(|c| {
            // keep the character if it's NOT any of these:
            !is_combining_mark(*c) // combining diacritics
                && !c.is_control() // control characters
                && !is_format_char(c) // format characters (directional marks, zero-width, etc)
        })
        .collect()
}

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

/// normalize various hyphen types to standard ASCII hyphen
fn normalize_hyphens(s: &str) -> String {
    s.replace('–', "-") // en dash
        .replace('—', "-") // em dash
        .replace('‐', "-") // hyphen
        .replace('‑', "-") // non-breaking hyphen
        .replace('‒', "-") // figure dash
        .replace('―', "-") // horizontal bar
}

/// normalize single hyphens to separators where appropriate
///
/// converts patterns like "01-Artist-Track" to "01 - Artist - Track"
fn normalize_single_hyphens(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let len = chars.len();

    if len == 0 {
        return String::new();
    }

    let mut result = String::new();
    let mut i = 0;

    while i < len {
        if chars[i] == '-' {
            // add spaces around hyphen to normalize it
            if !result.ends_with(' ') {
                result.push(' ');
            }
            result.push('-');
            result.push(' ');
            // skip any immediately following spaces
            while i + 1 < len && chars[i + 1] == ' ' {
                i += 1;
            }
        } else {
            result.push(chars[i]);
        }
        i += 1;
    }

    result
}

/// extract track number from filename parts
///
/// looks for:
/// 1. standalone numbers (e.g., "04")
/// 2. leading numbers in any part (e.g., "04 Song Name" or "Track 05")
fn extract_track_number(parts: &[&str]) -> Option<i64> {
    for part in parts {
        let trimmed = part.trim();

        // try to parse as pure number first
        if let Ok(num) = trimmed.parse::<i64>() {
            if num > 0 && num < 1000 {
                return Some(num);
            }
        }

        // look for numbers anywhere in the part
        let words: Vec<&str> = trimmed.split_whitespace().collect();
        for word in &words {
            // try to parse the whole word as a number
            if let Ok(num) = word.parse::<i64>() {
                if num > 0 && num < 1000 {
                    return Some(num);
                }
            }

            // try to extract leading digits from word
            let num_str: String = word.chars().take_while(|c| c.is_numeric()).collect();
            if !num_str.is_empty() {
                if let Ok(num) = num_str.parse::<i64>() {
                    if num > 0 && num < 1000 {
                        return Some(num);
                    }
                }
            }
        }
    }

    None
}

/// remove leading numbers from a string part and clean up whitespace
///
/// removes standalone numbers and leading numbers, preserves numbers within words
fn remove_leading_numbers(part: &str) -> String {
    let trimmed = part.trim();

    // if entire part is just a number, return empty
    if trimmed.parse::<i64>().is_ok() {
        return String::new();
    }

    // split into words and process
    let words: Vec<&str> = trimmed.split_whitespace().collect();

    // skip leading pure number words
    let filtered_words: Vec<&str> = words
        .iter()
        .skip_while(|word| word.parse::<i64>().is_ok())
        .copied()
        .collect();

    // if we have words left, check if first word has leading digits
    if !filtered_words.is_empty() {
        let first = filtered_words[0];
        let without_leading: String = first.chars().skip_while(|c| c.is_numeric()).collect();

        if !without_leading.is_empty() && without_leading != first {
            // word had leading digits, build result with cleaned first word
            let mut result_words = vec![without_leading];
            result_words.extend(filtered_words[1..].iter().map(|s| s.to_string()));
            return result_words.join(" ");
        }
    }

    // if we skipped all words but original had words, try harder
    if filtered_words.is_empty() && !words.is_empty() {
        // check if any word has non-numeric content
        for word in &words {
            let without_nums: String = word.chars().filter(|c| !c.is_numeric()).collect();
            if !without_nums.is_empty() {
                return without_nums;
            }
        }
        return String::new();
    }

    filtered_words.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_parse_artist_track() {
        let path = PathBuf::from("Artist - Track.mp3");
        let parsed = parse_filename(&path);

        assert_eq!(parsed.artist, Some("Artist".to_string()));
        assert_eq!(parsed.album, None);
        assert_eq!(parsed.track, Some("Track".to_string()));
        assert_eq!(parsed.track_number, None);
    }

    #[test]
    fn test_parse_artist_album_track() {
        let path = PathBuf::from("The Beatles - Abbey Road - Come Together.mp3");
        let parsed = parse_filename(&path);

        assert_eq!(parsed.artist, Some("The Beatles".to_string()));
        assert_eq!(parsed.album, Some("Abbey Road".to_string()));
        assert_eq!(parsed.track, Some("Come Together".to_string()));
        assert_eq!(parsed.track_number, None);
    }

    #[test]
    fn test_parse_underscores() {
        let path = PathBuf::from("Zeigenbock_Kopf_-_04_-_Moves_Wicked.mp3");
        let parsed = parse_filename(&path);

        assert_eq!(parsed.artist, Some("Zeigenbock Kopf".to_string()));
        assert_eq!(parsed.album, None);
        assert_eq!(parsed.track, Some("Moves Wicked".to_string()));
        assert_eq!(parsed.track_number, Some(4));
    }

    #[test]
    fn test_parse_track_number_only() {
        let path = PathBuf::from("01 - Song Name.mp3");
        let parsed = parse_filename(&path);

        assert_eq!(parsed.artist, None);
        assert_eq!(parsed.album, None);
        assert_eq!(parsed.track, Some("Song Name".to_string()));
        assert_eq!(parsed.track_number, Some(1));
    }

    #[test]
    fn test_parse_single_hyphen_with_number() {
        let path = PathBuf::from("01-Daft Punk-One More Time.mp3");
        let parsed = parse_filename(&path);

        assert_eq!(parsed.artist, Some("Daft Punk".to_string()));
        assert_eq!(parsed.album, None);
        assert_eq!(parsed.track, Some("One More Time".to_string()));
        assert_eq!(parsed.track_number, Some(1));
    }

    #[test]
    fn test_parse_double_hyphen() {
        let path = PathBuf::from("01-Deftones--Hexagram.mp3");
        let parsed = parse_filename(&path);

        assert_eq!(parsed.artist, Some("Deftones".to_string()));
        assert_eq!(parsed.album, None);
        assert_eq!(parsed.track, Some("Hexagram".to_string()));
        assert_eq!(parsed.track_number, Some(1));
    }

    #[test]
    fn test_parse_comma_separator() {
        let path = PathBuf::from("01, Know you now.mp3");
        let parsed = parse_filename(&path);

        assert_eq!(parsed.artist, None);
        assert_eq!(parsed.album, None);
        assert_eq!(parsed.track, Some("Know you now".to_string()));
        assert_eq!(parsed.track_number, Some(1));
    }

    #[test]
    fn test_parse_track_number_leading() {
        let path = PathBuf::from("Artist - 03 Track Name.mp3");
        let parsed = parse_filename(&path);

        assert_eq!(parsed.artist, Some("Artist".to_string()));
        assert_eq!(parsed.album, None);
        assert_eq!(parsed.track, Some("Track Name".to_string()));
        assert_eq!(parsed.track_number, Some(3));
    }

    #[test]
    fn test_parse_complex_with_numbers() {
        let path = PathBuf::from("Nine Inch Nails - 05 - The Hand That Feeds.mp3");
        let parsed = parse_filename(&path);

        assert_eq!(parsed.artist, Some("Nine Inch Nails".to_string()));
        assert_eq!(parsed.album, None);
        assert_eq!(parsed.track, Some("The Hand That Feeds".to_string()));
        assert_eq!(parsed.track_number, Some(5));
    }

    #[test]
    fn test_parse_track_only() {
        let path = PathBuf::from("Just A Song.mp3");
        let parsed = parse_filename(&path);

        assert_eq!(parsed.artist, None);
        assert_eq!(parsed.album, None);
        assert_eq!(parsed.track, Some("Just A Song".to_string()));
        assert_eq!(parsed.track_number, None);
    }

    #[test]
    fn test_parse_multiple_track_parts() {
        let path = PathBuf::from("Artist - Album - Track Part 1 - Track Part 2.mp3");
        let parsed = parse_filename(&path);

        assert_eq!(parsed.artist, Some("Artist".to_string()));
        assert_eq!(parsed.album, Some("Album".to_string()));
        assert_eq!(
            parsed.track,
            Some("Track Part 1 - Track Part 2".to_string())
        );
        assert_eq!(parsed.track_number, Some(1));
    }

    #[test]
    fn test_parse_featuring_parentheses() {
        let path = PathBuf::from("01 - Dancingbox (Featuring TTC).mp3");
        let parsed = parse_filename(&path);

        assert_eq!(parsed.artist, None);
        assert_eq!(parsed.album, None);
        assert_eq!(parsed.track, Some("Dancingbox (Featuring TTC)".to_string()));
        assert_eq!(parsed.track_number, Some(1));
    }

    #[test]
    fn test_parse_parentheses_artist() {
        let path = PathBuf::from("(2_Pac)-California_Love.mp3");
        let parsed = parse_filename(&path);

        assert_eq!(parsed.artist, Some("(2 Pac)".to_string()));
        assert_eq!(parsed.album, None);
        assert_eq!(parsed.track, Some("California Love".to_string()));
        assert_eq!(parsed.track_number, None);
    }

    #[test]
    fn test_parse_empty_filename() {
        let path = PathBuf::from("");
        let parsed = parse_filename(&path);

        assert!(!parsed.has_data());
    }

    #[test]
    fn test_parse_with_extension_variations() {
        let paths = vec![
            "Artist - Track.mp3",
            "Artist - Track.flac",
            "Artist - Track.m4a",
            "Artist - Track.ogg",
        ];

        for path_str in paths {
            let path = PathBuf::from(path_str);
            let parsed = parse_filename(&path);

            assert_eq!(parsed.artist, Some("Artist".to_string()));
            assert_eq!(parsed.track, Some("Track".to_string()));
        }
    }

    #[test]
    fn test_parse_album_artist_track_format() {
        let path = PathBuf::from(
            "Water Liars - Cardinals At The Window - 72 Swannanoa (Demo Version).mp3",
        );
        let parsed = parse_filename(&path);

        assert_eq!(parsed.artist, Some("Water Liars".to_string()));
        assert_eq!(parsed.album, Some("Cardinals At The Window".to_string()));
        assert_eq!(parsed.track, Some("Swannanoa (Demo Version)".to_string()));
        assert_eq!(parsed.track_number, Some(72));
    }

    #[test]
    fn test_extract_track_number() {
        assert_eq!(extract_track_number(&["04"]), Some(4));
        assert_eq!(extract_track_number(&["Track 05"]), Some(5));
        assert_eq!(extract_track_number(&["Artist", "12", "Song"]), Some(12));
        assert_eq!(extract_track_number(&["Artist Name"]), None);
    }

    #[test]
    fn test_remove_leading_numbers() {
        assert_eq!(remove_leading_numbers("04"), "");
        assert_eq!(remove_leading_numbers("04 Song Name"), "Song Name");
        assert_eq!(
            remove_leading_numbers("Song 99 Problems"),
            "Song 99 Problems"
        );
        assert_eq!(remove_leading_numbers("  05  Track  "), "Track");
    }

    #[test]
    fn test_normalize_single_hyphens() {
        assert_eq!(
            normalize_single_hyphens("01-Artist-Track"),
            "01 - Artist - Track"
        );
    }

    #[test]
    fn test_has_data() {
        let empty = ParsedFilename::empty();
        assert!(!empty.has_data());

        let with_track = ParsedFilename {
            artist: None,
            album: None,
            track: Some("Track".to_string()),
            track_number: None,
        };
        assert!(with_track.has_data());

        let with_track_num = ParsedFilename {
            artist: None,
            album: None,
            track: None,
            track_number: Some(1),
        };
        assert!(with_track_num.has_data());
    }

    #[test]
    fn test_remove_youtube_ids() {
        assert_eq!(
            remove_youtube_ids("Moonlight - San Salvador [Qt4YceNHIZU]"),
            "Moonlight - San Salvador"
        );
        assert_eq!(
            remove_youtube_ids("Nine Inch Nails - Fixed-lDY94PTe-BE"),
            "Nine Inch Nails - Fixed"
        );
        assert_eq!(
            remove_youtube_ids("Song Name.mp3-GogKucCyMJ4"),
            "Song Name.mp3"
        );
    }

    #[test]
    fn test_remove_combining_chars() {
        assert_eq!(remove_combining_chars("Co͟c͟k͟s͟"), "Cocks");
        assert_eq!(remove_combining_chars("S͟t͟e͟e͟r͟s͟"), "Steers");
        assert_eq!(remove_combining_chars("normal text"), "normal text");
        // test removal of directional marks (LEFT-TO-RIGHT MARK U+200E)
        assert_eq!(remove_combining_chars("Scorn \u{200E}"), "Scorn ");
        // test removal of zero-width spaces
        assert_eq!(remove_combining_chars("test\u{200B}word"), "testword");
    }

    #[test]
    fn test_normalize_hyphens() {
        assert_eq!(
            normalize_hyphens("Bigod 20 – The Bog"),
            "Bigod 20 - The Bog"
        );
        assert_eq!(normalize_hyphens("Ministry ‎– N.W.O"), "Ministry ‎- N.W.O");
        assert_eq!(normalize_hyphens("Em—dash"), "Em-dash");
    }

    #[test]
    fn test_full_album_detection() {
        let path = PathBuf::from("Nine Inch Nails - Fixed (1992) [Full Album].mp3");
        let parsed = parse_filename(&path);

        assert_eq!(parsed.artist, Some("Nine Inch Nails".to_string()));
        assert_eq!(parsed.album, Some("Fixed (1992)".to_string()));
        assert_eq!(parsed.track, Some("Fixed (1992)".to_string()));
    }

    #[test]
    fn test_full_album_with_youtube_id() {
        let path =
            PathBuf::from("Napalm Death - Utopia Banished (1992) [Full Album] HQ-GwsfFTQcU2E.mp3");
        let parsed = parse_filename(&path);

        assert_eq!(parsed.artist, Some("Napalm Death".to_string()));
        // album title should have youtube ID and [Full Album] removed
        assert_eq!(parsed.album, Some("Utopia Banished (1992) HQ".to_string()));
        assert_eq!(parsed.track, Some("Utopia Banished (1992) HQ".to_string()));
    }
}
