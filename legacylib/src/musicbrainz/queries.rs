//! musicbrainz query builders
//!
//! provides query builders for constructing musicbrainz api search queries
//! with proper encoding and validation.

use crate::music::Song;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use url::form_urlencoded;

/// query builder for recording searches
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RecordingSearchQuery {
    /// artist name
    pub artist: Option<String>,

    /// recording title
    pub title: Option<String>,

    /// release title
    pub release: Option<String>,

    /// track duration in milliseconds
    pub duration: Option<u32>,

    /// maximum results to return
    pub limit: Option<u32>,

    /// offset for pagination
    pub offset: Option<u32>,

    /// additional query parameters
    pub extra_params: HashMap<String, String>,
}

/// query builder for release searches
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ReleaseSearchQuery {
    /// artist name
    pub artist: Option<String>,

    /// release title
    pub release: Option<String>,

    /// release date (YYYY, YYYY-MM, or YYYY-MM-DD)
    pub date: Option<String>,

    /// country code
    pub country: Option<String>,

    /// release status (official, promotion, bootleg, etc.)
    pub status: Option<String>,

    /// number of tracks
    pub tracks: Option<u32>,

    /// maximum results to return
    pub limit: Option<u32>,

    /// offset for pagination
    pub offset: Option<u32>,

    /// additional query parameters
    pub extra_params: HashMap<String, String>,
}

/// query builder for release group searches
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ReleaseGroupSearchQuery {
    /// artist name
    pub artist: Option<String>,

    /// release group title
    pub releasegroup: Option<String>,

    /// primary type (album, single, ep, etc.)
    pub type_: Option<String>,

    /// first release date
    pub firstreleasedate: Option<String>,

    /// maximum results to return
    pub limit: Option<u32>,

    /// offset for pagination
    pub offset: Option<u32>,

    /// additional query parameters
    pub extra_params: HashMap<String, String>,
}

impl RecordingSearchQuery {
    /// create new recording search query
    pub fn new() -> Self {
        Self::default()
    }

    /// set artist name
    pub fn artist<S: Into<String>>(mut self, artist: S) -> Self {
        self.artist = Some(artist.into());
        self
    }

    /// set recording title
    pub fn title<S: Into<String>>(mut self, title: S) -> Self {
        self.title = Some(title.into());
        self
    }

    /// set release title
    pub fn release<S: Into<String>>(mut self, release: S) -> Self {
        self.release = Some(release.into());
        self
    }

    /// set duration in milliseconds
    pub fn duration(mut self, duration: u32) -> Self {
        self.duration = Some(duration);
        self
    }

    /// set duration with tolerance range
    pub fn duration_with_tolerance(mut self, duration_ms: u32, tolerance_seconds: u32) -> Self {
        let duration_sec = duration_ms / 1000;
        let min_duration = duration_sec.saturating_sub(tolerance_seconds);
        let max_duration = duration_sec + tolerance_seconds;
        // Store as formatted range string and clear any existing duration
        self.duration = None; // clear single duration to avoid conflicts
        self.extra_params.insert(
            "dur_range".to_string(),
            format!("[{} TO {}]", min_duration, max_duration),
        );
        self
    }

    /// set result limit
    pub fn limit(mut self, limit: u32) -> Self {
        self.limit = Some(limit);
        self
    }

    /// set result offset
    pub fn offset(mut self, offset: u32) -> Self {
        self.offset = Some(offset);
        self
    }

    /// add custom parameter
    pub fn param<K: Into<String>, V: Into<String>>(mut self, key: K, value: V) -> Self {
        self.extra_params.insert(key.into(), value.into());
        self
    }

    /// build query string for musicbrainz api
    pub fn to_query_string(&self) -> String {
        let mut query_parts = Vec::new();

        // build lucene-style query
        let mut lucene_query = Vec::new();

        if let Some(ref artist) = self.artist {
            lucene_query.push(format!("artist:\"{}\"", escape_lucene_query(artist)));
        }

        if let Some(ref title) = self.title {
            lucene_query.push(format!("recording:\"{}\"", escape_lucene_query(title)));
        }

        if let Some(ref release) = self.release {
            lucene_query.push(format!("release:\"{}\"", escape_lucene_query(release)));
        }

        if let Some(duration) = self.duration {
            // single duration value (exact match)
            lucene_query.push(format!("dur:{}", duration / 1000)); // convert ms to seconds
        }

        // check for duration range from extra params (takes precedence over single duration)
        if let Some(dur_range) = self.extra_params.get("dur_range") {
            // remove single duration if range is specified
            lucene_query.retain(|q| !q.starts_with("dur:"));
            lucene_query.push(format!("dur:{}", dur_range));
        }

        if !lucene_query.is_empty() {
            query_parts.push(("query", lucene_query.join(" AND ")));
        }

        // add pagination parameters
        if let Some(limit) = self.limit {
            query_parts.push(("limit", limit.to_string()));
        }

        if let Some(offset) = self.offset {
            query_parts.push(("offset", offset.to_string()));
        }

        // add format parameter
        query_parts.push(("fmt", "json".to_string()));

        // add extra parameters
        for (key, value) in &self.extra_params {
            query_parts.push((key, value.clone()));
        }

        // encode query string
        form_urlencoded::Serializer::new(String::new())
            .extend_pairs(query_parts)
            .finish()
    }

    /// create query from song metadata with full configuration
    pub fn from_song(
        song: &Song,
        include_album: bool,
        duration_tolerance_seconds: u32,
        enable_duration_matching: bool,
    ) -> Self {
        // clean up title for better matching - remove artist names if present
        let clean_title = clean_title_with_artist_context(&song.title, song.artist.as_deref());
        let mut query = Self::new().title(&clean_title).limit(25); // reasonable default for song searches

        if let Some(ref artist) = song.artist {
            let clean_artist = clean_search_text(artist);
            query = query.artist(&clean_artist);
        }

        // only include album if requested - helps with bootleg albums
        if include_album {
            if let Some(ref album) = song.album {
                let clean_album = clean_search_text(album);
                query = query.release(&clean_album);
            }
        }

        // include duration for better matching (with configurable tolerance)
        if enable_duration_matching {
            if let Some(duration_interval) = song.duration {
                let duration_ms = (duration_interval.microseconds / 1000) as u32;
                query = query.duration_with_tolerance(duration_ms, duration_tolerance_seconds);
            }
        }

        query
    }

    /// convenience method: create query without album (for bootleg compatibility)
    pub fn from_song_no_album(
        song: &Song,
        duration_tolerance_seconds: u32,
        enable_duration_matching: bool,
    ) -> Self {
        Self::from_song(
            song,
            false,
            duration_tolerance_seconds,
            enable_duration_matching,
        )
    }
}

impl ReleaseSearchQuery {
    /// create new release search query
    pub fn new() -> Self {
        Self::default()
    }

    /// set artist name
    pub fn artist<S: Into<String>>(mut self, artist: S) -> Self {
        self.artist = Some(artist.into());
        self
    }

    /// set release title
    pub fn release<S: Into<String>>(mut self, release: S) -> Self {
        self.release = Some(release.into());
        self
    }

    /// set release date
    pub fn date<S: Into<String>>(mut self, date: S) -> Self {
        self.date = Some(date.into());
        self
    }

    /// set country
    pub fn country<S: Into<String>>(mut self, country: S) -> Self {
        self.country = Some(country.into());
        self
    }

    /// set status
    pub fn status<S: Into<String>>(mut self, status: S) -> Self {
        self.status = Some(status.into());
        self
    }

    /// set track count
    pub fn tracks(mut self, tracks: u32) -> Self {
        self.tracks = Some(tracks);
        self
    }

    /// set result limit
    pub fn limit(mut self, limit: u32) -> Self {
        self.limit = Some(limit);
        self
    }

    /// set result offset
    pub fn offset(mut self, offset: u32) -> Self {
        self.offset = Some(offset);
        self
    }

    /// add custom parameter
    pub fn param<K: Into<String>, V: Into<String>>(mut self, key: K, value: V) -> Self {
        self.extra_params.insert(key.into(), value.into());
        self
    }

    /// build query string for musicbrainz api
    pub fn to_query_string(&self) -> String {
        let mut query_parts = Vec::new();
        let mut lucene_query = Vec::new();

        if let Some(ref artist) = self.artist {
            lucene_query.push(format!("artist:\"{}\"", escape_lucene_query(artist)));
        }

        if let Some(ref release) = self.release {
            lucene_query.push(format!("release:\"{}\"", escape_lucene_query(release)));
        }

        if let Some(ref date) = self.date {
            lucene_query.push(format!("date:{}", date));
        }

        if let Some(ref country) = self.country {
            lucene_query.push(format!("country:{}", country));
        }

        if let Some(ref status) = self.status {
            lucene_query.push(format!("status:{}", status));
        }

        if let Some(tracks) = self.tracks {
            lucene_query.push(format!("tracks:{}", tracks));
        }

        if !lucene_query.is_empty() {
            query_parts.push(("query", lucene_query.join(" AND ")));
        }

        if let Some(limit) = self.limit {
            query_parts.push(("limit", limit.to_string()));
        }

        if let Some(offset) = self.offset {
            query_parts.push(("offset", offset.to_string()));
        }

        query_parts.push(("fmt", "json".to_string()));

        for (key, value) in &self.extra_params {
            query_parts.push((key, value.clone()));
        }

        form_urlencoded::Serializer::new(String::new())
            .extend_pairs(query_parts)
            .finish()
    }
}

impl ReleaseGroupSearchQuery {
    /// create new release group search query
    pub fn new() -> Self {
        Self::default()
    }

    /// set artist name
    pub fn artist<S: Into<String>>(mut self, artist: S) -> Self {
        self.artist = Some(artist.into());
        self
    }

    /// set release group title
    pub fn releasegroup<S: Into<String>>(mut self, releasegroup: S) -> Self {
        self.releasegroup = Some(releasegroup.into());
        self
    }

    /// set primary type
    pub fn type_<S: Into<String>>(mut self, type_: S) -> Self {
        self.type_ = Some(type_.into());
        self
    }

    /// set first release date
    pub fn firstreleasedate<S: Into<String>>(mut self, date: S) -> Self {
        self.firstreleasedate = Some(date.into());
        self
    }

    /// set result limit
    pub fn limit(mut self, limit: u32) -> Self {
        self.limit = Some(limit);
        self
    }

    /// set result offset
    pub fn offset(mut self, offset: u32) -> Self {
        self.offset = Some(offset);
        self
    }

    /// add custom parameter
    pub fn param<K: Into<String>, V: Into<String>>(mut self, key: K, value: V) -> Self {
        self.extra_params.insert(key.into(), value.into());
        self
    }

    /// build query string for musicbrainz api
    pub fn to_query_string(&self) -> String {
        let mut query_parts = Vec::new();
        let mut lucene_query = Vec::new();

        if let Some(ref artist) = self.artist {
            lucene_query.push(format!("artist:\"{}\"", escape_lucene_query(artist)));
        }

        if let Some(ref releasegroup) = self.releasegroup {
            lucene_query.push(format!(
                "releasegroup:\"{}\"",
                escape_lucene_query(releasegroup)
            ));
        }

        if let Some(ref type_) = self.type_ {
            lucene_query.push(format!("type:{}", type_));
        }

        if let Some(ref date) = self.firstreleasedate {
            lucene_query.push(format!("firstreleasedate:{}", date));
        }

        if !lucene_query.is_empty() {
            query_parts.push(("query", lucene_query.join(" AND ")));
        }

        if let Some(limit) = self.limit {
            query_parts.push(("limit", limit.to_string()));
        }

        if let Some(offset) = self.offset {
            query_parts.push(("offset", offset.to_string()));
        }

        query_parts.push(("fmt", "json".to_string()));

        for (key, value) in &self.extra_params {
            query_parts.push((key, value.clone()));
        }

        form_urlencoded::Serializer::new(String::new())
            .extend_pairs(query_parts)
            .finish()
    }
}

/// clean text for better musicbrainz searching
fn clean_search_text(input: &str) -> String {
    input
        .to_lowercase()
        .replace(" - ", " ") // remove " - " separators common in song titles
        .replace("-", " ") // replace other hyphens with spaces
        .replace("  ", " ") // collapse multiple spaces
        .trim()
        .to_string()
}

/// clean title text with artist context to remove artist names from contaminated titles
fn clean_title_with_artist_context(title: &str, artist: Option<&str>) -> String {
    let title_lower = title.to_lowercase();

    // if we have an artist, try to remove it from the title
    if let Some(artist) = artist {
        let artist_lower = artist.to_lowercase();

        // common patterns where artist appears in title:
        // "Song Name - Artist"
        // "Song Name - Artist Name"
        // "Artist - Song Name"
        // "Artist Name - Song Name"

        // try pattern: "title - artist" (most common)
        if let Some(dash_pos) = title_lower.find(" - ") {
            let before_dash = &title_lower[..dash_pos].trim();
            let after_dash = &title_lower[dash_pos + 3..].trim();

            // if after dash matches artist, use before dash as title
            if after_dash == &artist_lower {
                return clean_search_text(before_dash);
            }

            // if before dash matches artist, use after dash as title
            if before_dash == &artist_lower {
                return clean_search_text(after_dash);
            }
        }

        // try pattern: title contains artist at end
        if title_lower.ends_with(&artist_lower) {
            let title_without_artist = &title_lower[..title_lower.len() - artist_lower.len()];
            if title_without_artist.ends_with(" - ") || title_without_artist.ends_with(" ") {
                let cleaned = title_without_artist
                    .trim_end_matches(" - ")
                    .trim_end_matches(" ");
                if !cleaned.is_empty() {
                    return clean_search_text(cleaned);
                }
            }
        }
    }

    // fallback to normal cleaning if no artist context or no patterns matched
    clean_search_text(title)
}

/// escape special characters in lucene queries
fn escape_lucene_query(input: &str) -> String {
    input
        .chars()
        .map(|c| match c {
            '+' | '-' | '&' | '|' | '!' | '(' | ')' | '{' | '}' | '[' | ']' | '^' | '"' | '~'
            | '*' | '?' | ':' | '\\' => format!("\\{}", c),
            _ => c.to_string(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_recording_query_basic() {
        let query = RecordingSearchQuery::new()
            .artist("the beatles")
            .title("hey jude")
            .limit(10);

        let query_string = query.to_query_string();
        assert!(query_string.contains("artist%3A%22the+beatles%22"));
        assert!(query_string.contains("recording%3A%22hey+jude%22"));
        assert!(query_string.contains("limit=10"));
        assert!(query_string.contains("fmt=json"));
    }

    #[test]
    fn test_recording_query_with_duration() {
        let query = RecordingSearchQuery::new()
            .title("test song")
            .duration(180000); // 3 minutes

        let query_string = query.to_query_string();
        assert!(query_string.contains("dur%3A%5B178+TO+182%5D")); // 178-182 seconds
    }

    #[test]
    fn test_release_query_basic() {
        let query = ReleaseSearchQuery::new()
            .artist("pink floyd")
            .release("dark side of the moon")
            .date("1973");

        let query_string = query.to_query_string();
        assert!(query_string.contains("artist%3A%22pink+floyd%22"));
        assert!(query_string.contains("release%3A%22dark+side+of+the+moon%22"));
        assert!(query_string.contains("date%3A1973"));
    }

    #[test]
    fn test_release_group_query() {
        let query = ReleaseGroupSearchQuery::new()
            .artist("radiohead")
            .releasegroup("ok computer")
            .type_("album");

        let query_string = query.to_query_string();
        assert!(query_string.contains("artist%3A%22radiohead%22"));
        assert!(query_string.contains("releasegroup%3A%22ok+computer%22"));
        assert!(query_string.contains("type%3Aalbum"));
    }

    #[test]
    fn test_lucene_escaping() {
        let escaped = escape_lucene_query("artist: (test) + more");
        assert_eq!(escaped, "artist\\: \\(test\\) \\+ more");
    }

    #[test]
    fn test_empty_query() {
        let query = RecordingSearchQuery::new();
        let query_string = query.to_query_string();
        assert!(query_string.contains("fmt=json"));
        // should not contain query parameter when no search terms
        assert!(!query_string.contains("query="));
    }

    #[test]
    fn test_custom_parameters() {
        let query = RecordingSearchQuery::new()
            .param("inc", "artist-credits")
            .param("dismax", "true");

        let query_string = query.to_query_string();
        assert!(query_string.contains("inc=artist-credits"));
        assert!(query_string.contains("dismax=true"));
    }
}
