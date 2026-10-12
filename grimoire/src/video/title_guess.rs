//! best-guess classification + artist extraction from a video's title
//! string (a yt-dlp download title or a raw filename stem).
//!
//! used by both import paths (`importer::import_video_file`) and exposed
//! through the `guess_video_title` route so the edit modal / review panel
//! can prefill an artist when the user flips a video to "music video" or
//! "karaoke". only the word "karaoke" auto-classifies a video - "Artist -
//! Song" alone is far too common a title shape (movie trailers, podcasts,
//! tutorials) to treat as music on its own, so for a plain title only the
//! artist/song split is offered as a suggestion.

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

use super::scanner::filename_parser::strip_youtube_video_id;

/// result of [`guess_video_title`]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ZodSchema)]
pub struct VideoTitleGuess {
    /// "karaoke" when the title contains the word "karaoke", otherwise
    /// `None` (the title alone is never enough to call something a
    /// "music_video").
    pub content_type: Option<String>,
    /// best-guess artist name, when the title splits as "artist - song".
    pub artist: Option<String>,
    /// the song-title half of that split.
    pub song_title: Option<String>,
}

static KARAOKE_WORD: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bkaraoke\b").unwrap());

/// bracketed groups that are pure decoration ("(Karaoke Version)",
/// "[Official Video]", "(Lyrics)", ...) rather than part of a real title.
static NOISE_GROUP: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)\s*[\(\[\u{3010}][^\)\]\u{3011}]*\b(?:karaoke|official|video|lyrics?|hd|4k|1080p|720p|audio|instrumental|sing[- ]?along|backing track|no vocals|mv|m/v|version)\b[^\)\]\u{3011}]*[\)\]\u{3011}]",
    )
    .unwrap()
});

/// a whole " - "-separated segment that is just decoration.
static NOISE_SEGMENT: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)^(?:karaoke(?:\s+version)?|instrumental(?:\s+karaoke)?|with lyrics|lyrics?|sing[- ]?along|official(?:\s+music)?\s+video|official\s+audio|hd|4k)$",
    )
    .unwrap()
});

/// a leading "karaoke" token glued onto the artist ("Karaoke Taylor Swift
/// - Love Story", "Karaoke: Taylor Swift - Love Story").
static LEADING_KARAOKE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^karaoke\s*[:\-\u{2013}\u{2014}|]?\s+").unwrap());

/// spaced dash separator between artist and song. a bare "-" inside a word
/// ("Merry-Go-Round") deliberately doesn't count.
static SEGMENT_SEPARATOR: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\s+[-\u{2013}\u{2014}]\s+").unwrap());

/// "feat."/"ft."/"featuring" credit trailing an artist name.
static FEATURING_TAIL: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\s+(?:feat\.?|ft\.?|featuring)\s+.*$").unwrap());

/// true when `title` contains the standalone word "karaoke".
pub fn is_karaoke_title(title: &str) -> bool {
    KARAOKE_WORD.is_match(title)
}

/// guess the content type and artist/song split of a video from its title.
pub fn guess_video_title(raw_title: &str) -> VideoTitleGuess {
    let title = strip_youtube_video_id(raw_title);
    let is_karaoke = is_karaoke_title(&title);

    let cleaned = NOISE_GROUP.replace_all(&title, "");
    let cleaned = cleaned.trim();
    let cleaned = LEADING_KARAOKE.replace(cleaned, "");

    let mut segments: Vec<&str> = SEGMENT_SEPARATOR
        .split(cleaned.trim())
        .map(str::trim)
        .filter(|s| !s.is_empty() && !NOISE_SEGMENT.is_match(s))
        .collect();

    // a channel/brand segment ("Sing King Karaoke - Artist - Song") only gets
    // dropped when something else still splits as artist + song afterwards.
    if segments.len() >= 3 && is_karaoke_title(segments[0]) {
        segments.remove(0);
    }

    let mut guess = VideoTitleGuess {
        content_type: is_karaoke.then(|| "karaoke".to_string()),
        ..Default::default()
    };

    if segments.len() >= 2 {
        let artist = FEATURING_TAIL
            .replace(segments[0], "")
            .trim()
            .trim_matches(|c| c == '"' || c == '\'' || c == '\u{201c}' || c == '\u{201d}')
            .trim()
            .to_string();
        let song = segments[1..].join(" - ");
        if !artist.is_empty() && !song.is_empty() && !is_karaoke_title(&artist) {
            guess.artist = Some(artist);
            guess.song_title = Some(song);
        }
    }

    guess
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn karaoke_keyword_classifies() {
        assert!(is_karaoke_title("Love Story (Karaoke Version)"));
        assert!(is_karaoke_title("KARAOKE - Hello"));
        assert!(is_karaoke_title("Hello-Karaoke-Version"));
        assert!(!is_karaoke_title("Karaokeville documentary"));
        assert!(!is_karaoke_title("Official Music Video"));
    }

    #[test]
    fn artist_and_song_split_with_noise_stripped() {
        let g = guess_video_title("Taylor Swift - Love Story (Karaoke Version)");
        assert_eq!(g.content_type.as_deref(), Some("karaoke"));
        assert_eq!(g.artist.as_deref(), Some("Taylor Swift"));
        assert_eq!(g.song_title.as_deref(), Some("Love Story"));
    }

    #[test]
    fn plain_music_video_title_is_not_auto_classified() {
        let g = guess_video_title("Queen - Bohemian Rhapsody (Official Video)");
        assert_eq!(g.content_type, None);
        assert_eq!(g.artist.as_deref(), Some("Queen"));
        assert_eq!(g.song_title.as_deref(), Some("Bohemian Rhapsody"));
    }

    #[test]
    fn leading_karaoke_and_channel_prefix() {
        let g = guess_video_title("Karaoke - Journey - Don't Stop Believin'");
        assert_eq!(g.artist.as_deref(), Some("Journey"));
        assert_eq!(g.song_title.as_deref(), Some("Don't Stop Believin'"));

        let g = guess_video_title("Sing King Karaoke - Adele - Hello");
        assert_eq!(g.content_type.as_deref(), Some("karaoke"));
        assert_eq!(g.artist.as_deref(), Some("Adele"));
        assert_eq!(g.song_title.as_deref(), Some("Hello"));

        let g = guess_video_title("Karaoke Adele - Hello");
        assert_eq!(g.artist.as_deref(), Some("Adele"));
    }

    #[test]
    fn trailing_karaoke_segment_and_featuring_credit() {
        let g = guess_video_title("Artist ft. Someone Else - Some Song - Karaoke Version");
        assert_eq!(g.content_type.as_deref(), Some("karaoke"));
        assert_eq!(g.artist.as_deref(), Some("Artist"));
        assert_eq!(g.song_title.as_deref(), Some("Some Song"));
    }

    #[test]
    fn no_separator_means_no_artist_guess() {
        let g = guess_video_title("Happy Birthday Karaoke");
        assert_eq!(g.content_type.as_deref(), Some("karaoke"));
        assert_eq!(g.artist, None);

        let g = guess_video_title("Merry-Go-Round");
        assert_eq!(g, VideoTitleGuess::default());
    }

    #[test]
    fn youtube_id_suffix_is_ignored() {
        let g = guess_video_title("Queen - Bohemian Rhapsody [dQw4w9WgXcQ]");
        assert_eq!(g.artist.as_deref(), Some("Queen"));
        assert_eq!(g.song_title.as_deref(), Some("Bohemian Rhapsody"));
    }
}
