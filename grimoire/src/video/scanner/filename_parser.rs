//! filename parsing for video files
//!
//! extracts season/episode/title information from video filenames using an
//! ordered list of hardcoded regex patterns (first match wins) - mirrors
//! `crate::music::scanner::filename_parser`'s "hardcoded, tested rust, not
//! config-driven" precedent (see docs/video-domain-plan.md item 28 for the
//! full design rationale). this is deliberately NOT exposed as a tunable
//! config option.
//!
//! supported season/episode conventions, tried in this order:
//! - `S01E10` / `s1e2` (standard)
//! - `1x05` (season x episode)
//! - `sn1ep2` / `s01ep02` (looser "sn"/"ep" spellings)
//! - `Season 1 Episode 2` (spelled out)
//!
//! series-title resolution is NOT done here - filename regex alone can't
//! determine which series a file belongs to (only season/episode
//! numbers). [`parse_directory_context`] provides the parent-directory
//! series-title fallback (mirroring music's "folder name used as album
//! fallback" precedent) plus a `Season N`-named directory cross-check/
//! override for the season number - both intended to be resolved against
//! existing `video_seriez` rows by the importer, not blindly used to
//! create a new series per video.
//!
//! examples:
//! - `Show Name S01E05.mkv` -> title: "Show Name", season: 1, episode: 5
//! - `show.name.s1e2.mp4` -> title: "show name", season: 1, episode: 2
//! - `Show Name 1x05.mkv` -> title: "Show Name", season: 1, episode: 5
//! - `Show_Name_SN1EP2.mkv` -> title: "Show Name", season: 1, episode: 2
//! - `Show Name - Season 1 Episode 2.mkv` -> title: "Show Name", season: 1, episode: 2
//! - `Some Movie (2020).mkv` -> title: "Some Movie (2020)", season: None, episode: None

use once_cell::sync::Lazy;
use regex::Regex;
use std::path::Path;

/// parsed season/episode/title metadata from a video filename
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ParsedVideoFilename {
    pub season: Option<i64>,
    pub episode: Option<i64>,
    pub title: Option<String>,
}

impl ParsedVideoFilename {
    /// create empty parsed filename
    pub fn empty() -> Self {
        Self::default()
    }

    /// check if any metadata was parsed
    pub fn has_data(&self) -> bool {
        self.season.is_some() || self.episode.is_some() || self.title.is_some()
    }
}

/// series-title candidate + season override derived from a video file's
/// directory structure (handles both `Series/episode.mkv` and
/// `Series/Season N/episode.mkv` layouts).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct DirectoryContext {
    /// candidate series title from the nearest non-season-numbered
    /// ancestor directory. the importer should resolve this against an
    /// existing `video_seriez` row by title before creating a new one.
    pub series_title: Option<String>,
    /// season number parsed from a `Season N`-named directory, if present
    /// - a stronger signal than a filename-parsed season number when the
    /// two disagree, since directory structure is deliberate organization
    /// rather than an inconsistent release-naming convention.
    pub season_override: Option<i64>,
}

/// ordered season/episode regexes - first match wins. compiled once.
static SEASON_EPISODE_PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        // S01E10, s1e2
        Regex::new(r"(?i)s(?P<season>\d{1,2})e(?P<episode>\d{1,3})").unwrap(),
        // 1x05
        Regex::new(r"(?i)(?P<season>\d{1,2})x(?P<episode>\d{1,3})").unwrap(),
        // sn1ep2, s01ep02 (looser "sn"/"ep" spellings)
        Regex::new(r"(?i)s(?:n)?\W*(?P<season>\d{1,2})\W*ep?\W*(?P<episode>\d{1,3})").unwrap(),
        // spelled-out "Season 1 Episode 2"
        Regex::new(r"(?i)season\W*(?P<season>\d{1,2}).{0,10}?episode\W*(?P<episode>\d{1,3})")
            .unwrap(),
    ]
});

/// a `Season N` directory name (used both to detect season directories
/// during directory-context parsing and to cross-check a filename-parsed
/// season number).
static SEASON_DIR_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^season\s*0*(\d{1,2})$").unwrap());

/// parse season/episode/title from a filename string directly (same as
/// [`parse_video_filename`] but takes a string instead of a path - useful
/// when the original filename is available but stored separately from the
/// file path, e.g. uploaded files stored with a blob id as filename).
pub fn parse_video_filename_str(filename: &str) -> ParsedVideoFilename {
    let stem = filename
        .rsplit_once('.')
        .map(|(name, _ext)| name)
        .unwrap_or(filename);
    parse_video_filename_inner(stem)
}

/// parse season/episode/title from a video file path's filename.
pub fn parse_video_filename(file_path: &Path) -> ParsedVideoFilename {
    let stem = match file_path.file_stem().and_then(|s| s.to_str()) {
        Some(name) => name,
        None => return ParsedVideoFilename::empty(),
    };
    parse_video_filename_inner(stem)
}

fn parse_video_filename_inner(stem: &str) -> ParsedVideoFilename {
    for pattern in SEASON_EPISODE_PATTERNS.iter() {
        if let Some(caps) = pattern.captures(stem) {
            let season = caps
                .name("season")
                .and_then(|m| m.as_str().parse::<i64>().ok());
            let episode = caps
                .name("episode")
                .and_then(|m| m.as_str().parse::<i64>().ok());

            // whole regex match (not just the named groups) is removed from
            // the title candidate - it may include separators/labels (e.g.
            // "Season "/"Episode ") that aren't part of the title.
            let whole_match = caps.get(0).expect("regex always has a full match");
            let mut title_source = String::with_capacity(stem.len());
            title_source.push_str(&stem[..whole_match.start()]);
            title_source.push(' ');
            title_source.push_str(&stem[whole_match.end()..]);

            let title = clean_title(&title_source);
            return ParsedVideoFilename {
                season,
                episode,
                title: if title.is_empty() { None } else { Some(title) },
            };
        }
    }

    // no season/episode pattern matched at all - the whole (cleaned)
    // filename is the best title candidate (e.g. a standalone movie).
    let title = clean_title(stem);
    ParsedVideoFilename {
        season: None,
        episode: None,
        title: if title.is_empty() { None } else { Some(title) },
    }
}

/// clean a title candidate: underscores/dots become spaces, leading/
/// trailing separator noise (`-`, `.`, whitespace) is trimmed, and
/// repeated whitespace is collapsed.
fn clean_title(s: &str) -> String {
    let normalized = s.replace(['_', '.'], " ");
    let trimmed = normalized.trim_matches(|c: char| c.is_whitespace() || c == '-');
    trimmed.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// derive series-title/season-override candidates from a video file's
/// directory structure. handles both `Series/episode.mkv` (parent is the
/// series folder) and `Series/Season N/episode.mkv` (parent is a season
/// folder, grandparent is the series folder) layouts.
pub fn parse_directory_context(file_path: &Path) -> DirectoryContext {
    let parent_name = dir_name(file_path.parent());

    if let Some(parent) = parent_name.as_deref() {
        if let Some(season_from_dir) = season_number_from_directory_name(parent) {
            let series_title = dir_name(file_path.parent().and_then(|p| p.parent()))
                .filter(|s| is_useful_folder_name(s));
            return DirectoryContext {
                series_title,
                season_override: Some(season_from_dir),
            };
        }
    }

    let series_title = parent_name.filter(|s| is_useful_folder_name(s));
    DirectoryContext {
        series_title,
        season_override: None,
    }
}

fn dir_name(path: Option<&Path>) -> Option<String> {
    let name = path?.file_name()?.to_str()?.trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

fn season_number_from_directory_name(name: &str) -> Option<i64> {
    SEASON_DIR_PATTERN
        .captures(name.trim())
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse::<i64>().ok())
}

/// whether a folder name looks like a useful series-title candidate
/// (skips date-like/upload-path components: pure numbers, "fetch"/"media",
/// hex-looking blob-id subfolders, and `Season N` folders themselves).
fn is_useful_folder_name(name: &str) -> bool {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    if trimmed.eq_ignore_ascii_case("fetch") || trimmed.eq_ignore_ascii_case("media") {
        return false;
    }
    if trimmed.len() >= 8 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        return false;
    }
    if season_number_from_directory_name(trimmed).is_some() {
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_standard_s01e10() {
        let parsed = parse_video_filename(&PathBuf::from("Show Name S01E10.mkv"));
        assert_eq!(parsed.season, Some(1));
        assert_eq!(parsed.episode, Some(10));
        assert_eq!(parsed.title, Some("Show Name".to_string()));
    }

    #[test]
    fn test_lowercase_s1e2() {
        let parsed = parse_video_filename(&PathBuf::from("show name s1e2.mp4"));
        assert_eq!(parsed.season, Some(1));
        assert_eq!(parsed.episode, Some(2));
        assert_eq!(parsed.title, Some("show name".to_string()));
    }

    #[test]
    fn test_underscores_and_dots() {
        let parsed = parse_video_filename(&PathBuf::from("Show.Name.S02E05.mkv"));
        assert_eq!(parsed.season, Some(2));
        assert_eq!(parsed.episode, Some(5));
        assert_eq!(parsed.title, Some("Show Name".to_string()));

        let parsed = parse_video_filename(&PathBuf::from("Show_Name_S02E05.mkv"));
        assert_eq!(parsed.season, Some(2));
        assert_eq!(parsed.episode, Some(5));
        assert_eq!(parsed.title, Some("Show Name".to_string()));
    }

    #[test]
    fn test_1x05_form() {
        let parsed = parse_video_filename(&PathBuf::from("Show Name 1x05.mkv"));
        assert_eq!(parsed.season, Some(1));
        assert_eq!(parsed.episode, Some(5));
        assert_eq!(parsed.title, Some("Show Name".to_string()));
    }

    #[test]
    fn test_1x05_uppercase_x() {
        let parsed = parse_video_filename(&PathBuf::from("Show Name 1X05.mkv"));
        assert_eq!(parsed.season, Some(1));
        assert_eq!(parsed.episode, Some(5));
    }

    #[test]
    fn test_loose_sn_ep_form() {
        let parsed = parse_video_filename(&PathBuf::from("Show Name SN1EP2.mkv"));
        assert_eq!(parsed.season, Some(1));
        assert_eq!(parsed.episode, Some(2));
        assert_eq!(parsed.title, Some("Show Name".to_string()));
    }

    #[test]
    fn test_loose_s_ep_form_with_separators() {
        let parsed = parse_video_filename(&PathBuf::from("Show Name S01 EP02.mkv"));
        assert_eq!(parsed.season, Some(1));
        assert_eq!(parsed.episode, Some(2));
    }

    #[test]
    fn test_spelled_out_season_episode() {
        let parsed = parse_video_filename(&PathBuf::from("Show Name - Season 1 Episode 2.mkv"));
        assert_eq!(parsed.season, Some(1));
        assert_eq!(parsed.episode, Some(2));
        assert_eq!(parsed.title, Some("Show Name".to_string()));
    }

    #[test]
    fn test_spelled_out_with_extra_title_after() {
        let parsed =
            parse_video_filename(&PathBuf::from("Show Name Season 01 Episode 02 - The One.mkv"));
        assert_eq!(parsed.season, Some(1));
        assert_eq!(parsed.episode, Some(2));
        // both the leading and trailing text are joined into the title
        // candidate - the importer prefers the parsed title over this only
        // when nothing better (e.g. tag metadata) is available.
        assert_eq!(parsed.title, Some("Show Name - The One".to_string()));
    }

    #[test]
    fn test_no_season_episode_standalone_movie() {
        let parsed = parse_video_filename(&PathBuf::from("Some Movie (2020).mkv"));
        assert_eq!(parsed.season, None);
        assert_eq!(parsed.episode, None);
        assert_eq!(parsed.title, Some("Some Movie (2020)".to_string()));
    }

    #[test]
    fn test_empty_filename() {
        let parsed = parse_video_filename_str("");
        assert_eq!(parsed, ParsedVideoFilename::empty());
    }

    #[test]
    fn test_double_digit_season_and_episode() {
        let parsed = parse_video_filename(&PathBuf::from("Show Name S12E123.mkv"));
        assert_eq!(parsed.season, Some(12));
        assert_eq!(parsed.episode, Some(123));
    }

    #[test]
    fn test_parse_filename_str_variant() {
        let parsed = parse_video_filename_str("Show Name S01E05.mkv");
        assert_eq!(parsed.season, Some(1));
        assert_eq!(parsed.episode, Some(5));
        assert_eq!(parsed.title, Some("Show Name".to_string()));
    }

    #[test]
    fn test_parse_filename_str_no_extension() {
        let parsed = parse_video_filename_str("Show Name S01E05");
        assert_eq!(parsed.season, Some(1));
        assert_eq!(parsed.episode, Some(5));
    }

    #[test]
    fn test_has_data() {
        assert!(!ParsedVideoFilename::empty().has_data());
        assert!(ParsedVideoFilename {
            season: Some(1),
            episode: None,
            title: None,
        }
        .has_data());
    }

    // -- directory context --

    #[test]
    fn test_directory_context_series_only() {
        let path = PathBuf::from("/media/videos/Show Name/Show Name S01E01.mkv");
        let ctx = parse_directory_context(&path);
        assert_eq!(ctx.series_title, Some("Show Name".to_string()));
        assert_eq!(ctx.season_override, None);
    }

    #[test]
    fn test_directory_context_series_and_season_dir() {
        let path = PathBuf::from("/media/videos/Show Name/Season 2/Show Name S02E01.mkv");
        let ctx = parse_directory_context(&path);
        assert_eq!(ctx.series_title, Some("Show Name".to_string()));
        assert_eq!(ctx.season_override, Some(2));
    }

    #[test]
    fn test_directory_context_zero_padded_season_dir() {
        let path = PathBuf::from("/media/videos/Show Name/Season 02/episode.mkv");
        let ctx = parse_directory_context(&path);
        assert_eq!(ctx.series_title, Some("Show Name".to_string()));
        assert_eq!(ctx.season_override, Some(2));
    }

    #[test]
    fn test_directory_context_skips_date_like_upload_folders() {
        let path = PathBuf::from("/data/fetch/2026/03/blobid.mkv");
        let ctx = parse_directory_context(&path);
        // parent "03" is purely numeric - not a useful series title
        assert_eq!(ctx.series_title, None);
        assert_eq!(ctx.season_override, None);
    }

    #[test]
    fn test_directory_context_skips_fetch_folder() {
        let path = PathBuf::from("/data/fetch/blobid.mkv");
        let ctx = parse_directory_context(&path);
        assert_eq!(ctx.series_title, None);
    }

    #[test]
    fn test_directory_context_skips_hex_blob_subfolder() {
        let path = PathBuf::from("/data/media/deadbeefcafebabe/blobid.mkv");
        let ctx = parse_directory_context(&path);
        assert_eq!(ctx.series_title, None);
    }

    #[test]
    fn test_directory_context_no_parent() {
        let path = PathBuf::from("episode.mkv");
        let ctx = parse_directory_context(&path);
        assert_eq!(ctx.series_title, None);
        assert_eq!(ctx.season_override, None);
    }
}
