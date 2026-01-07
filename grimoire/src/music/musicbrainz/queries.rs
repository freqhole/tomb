//! MusicBrainz query builders
//!
//! Provides query builders for constructing MusicBrainz API search queries
//! with proper encoding and validation.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Query builder for recording searches
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RecordingSearchQuery {
    /// Artist name
    pub artist: Option<String>,

    /// Recording title
    pub title: Option<String>,

    /// Release title
    pub release: Option<String>,

    /// Track duration in milliseconds
    pub duration: Option<u32>,

    /// Maximum results to return
    pub limit: Option<u32>,

    /// Offset for pagination
    pub offset: Option<u32>,

    /// Additional query parameters
    pub extra_params: HashMap<String, String>,
}

/// Query builder for release searches
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ReleaseSearchQuery {
    /// Artist name
    pub artist: Option<String>,

    /// Release title
    pub release: Option<String>,

    /// Release date (YYYY, YYYY-MM, or YYYY-MM-DD)
    pub date: Option<String>,

    /// Country code
    pub country: Option<String>,

    /// Release status (official, promotion, bootleg, etc.)
    pub status: Option<String>,

    /// Number of tracks
    pub tracks: Option<u32>,

    /// Maximum results to return
    pub limit: Option<u32>,

    /// Offset for pagination
    pub offset: Option<u32>,

    /// Additional query parameters
    pub extra_params: HashMap<String, String>,
}

/// Query builder for release group searches
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ReleaseGroupSearchQuery {
    /// Artist name
    pub artist: Option<String>,

    /// Release group title
    pub releasegroup: Option<String>,

    /// Primary type (album, single, ep, etc.)
    pub type_: Option<String>,

    /// First release date
    pub firstreleasedate: Option<String>,

    /// Maximum results to return
    pub limit: Option<u32>,

    /// Offset for pagination
    pub offset: Option<u32>,

    /// Additional query parameters
    pub extra_params: HashMap<String, String>,
}

impl RecordingSearchQuery {
    /// Create new recording search query
    pub fn new() -> Self {
        Self::default()
    }

    /// Set artist name
    pub fn artist<S: Into<String>>(mut self, artist: S) -> Self {
        self.artist = Some(artist.into());
        self
    }

    /// Set recording title
    pub fn title<S: Into<String>>(mut self, title: S) -> Self {
        self.title = Some(title.into());
        self
    }

    /// Set release title
    pub fn release<S: Into<String>>(mut self, release: S) -> Self {
        self.release = Some(release.into());
        self
    }

    /// Set duration in milliseconds
    pub fn duration(mut self, duration: u32) -> Self {
        self.duration = Some(duration);
        self
    }

    /// Set duration with tolerance range
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

    /// Set result limit
    pub fn limit(mut self, limit: u32) -> Self {
        self.limit = Some(limit);
        self
    }

    /// Set result offset
    pub fn offset(mut self, offset: u32) -> Self {
        self.offset = Some(offset);
        self
    }

    /// Add custom parameter
    pub fn param<K: Into<String>, V: Into<String>>(mut self, key: K, value: V) -> Self {
        self.extra_params.insert(key.into(), value.into());
        self
    }

    /// Build query string for MusicBrainz API
    pub fn to_query_string(&self) -> String {
        let mut query_parts = Vec::new();

        // Build Lucene-style query
        let mut lucene_query = Vec::new();

        if let Some(ref artist) = self.artist {
            let clean_artist = clean_search_text(artist);
            lucene_query.push(format!("artist:\"{}\"", escape_lucene_query(&clean_artist)));
        }

        if let Some(ref title) = self.title {
            let clean_title = clean_search_text(title);
            lucene_query.push(format!(
                "recording:\"{}\"",
                escape_lucene_query(&clean_title)
            ));
        }

        if let Some(ref release) = self.release {
            let clean_release = clean_search_text(release);
            lucene_query.push(format!(
                "release:\"{}\"",
                escape_lucene_query(&clean_release)
            ));
        }

        if let Some(duration) = self.duration {
            // Single duration value (exact match)
            lucene_query.push(format!("dur:{}", duration / 1000)); // convert ms to seconds
        }

        // Check for duration range from extra params (takes precedence over single duration)
        if let Some(dur_range) = self.extra_params.get("dur_range") {
            // Remove single duration if range is specified
            lucene_query.retain(|q| !q.starts_with("dur:"));
            lucene_query.push(format!("dur:{}", dur_range));
        }

        if !lucene_query.is_empty() {
            query_parts.push(("query".to_string(), lucene_query.join(" AND ")));
        }

        // Add pagination parameters
        if let Some(limit) = self.limit {
            query_parts.push(("limit".to_string(), limit.to_string()));
        }

        if let Some(offset) = self.offset {
            query_parts.push(("offset".to_string(), offset.to_string()));
        }

        // Add format parameter
        query_parts.push(("fmt".to_string(), "json".to_string()));

        // Add extra parameters (skip dur_range as we already processed it)
        for (key, value) in &self.extra_params {
            if key != "dur_range" {
                query_parts.push((key.clone(), value.clone()));
            }
        }

        // Encode query string
        query_parts
            .iter()
            .map(|(k, v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v)))
            .collect::<Vec<_>>()
            .join("&")
    }
}

impl ReleaseSearchQuery {
    /// Create new release search query
    pub fn new() -> Self {
        Self::default()
    }

    /// Set artist name
    pub fn artist<S: Into<String>>(mut self, artist: S) -> Self {
        self.artist = Some(artist.into());
        self
    }

    /// Set release title
    pub fn release<S: Into<String>>(mut self, release: S) -> Self {
        self.release = Some(release.into());
        self
    }

    /// Set release date
    pub fn date<S: Into<String>>(mut self, date: S) -> Self {
        self.date = Some(date.into());
        self
    }

    /// Set country
    pub fn country<S: Into<String>>(mut self, country: S) -> Self {
        self.country = Some(country.into());
        self
    }

    /// Set status
    pub fn status<S: Into<String>>(mut self, status: S) -> Self {
        self.status = Some(status.into());
        self
    }

    /// Set track count
    pub fn tracks(mut self, tracks: u32) -> Self {
        self.tracks = Some(tracks);
        self
    }

    /// Set result limit
    pub fn limit(mut self, limit: u32) -> Self {
        self.limit = Some(limit);
        self
    }

    /// Set result offset
    pub fn offset(mut self, offset: u32) -> Self {
        self.offset = Some(offset);
        self
    }

    /// Add custom parameter
    pub fn param<K: Into<String>, V: Into<String>>(mut self, key: K, value: V) -> Self {
        self.extra_params.insert(key.into(), value.into());
        self
    }

    /// Build query string for MusicBrainz API
    pub fn to_query_string(&self) -> String {
        let mut query_parts = Vec::new();
        let mut lucene_query = Vec::new();

        if let Some(ref artist) = self.artist {
            let clean_artist = clean_search_text(artist);
            lucene_query.push(format!("artist:\"{}\"", escape_lucene_query(&clean_artist)));
        }

        if let Some(ref release) = self.release {
            let clean_release = clean_search_text(release);
            lucene_query.push(format!(
                "release:\"{}\"",
                escape_lucene_query(&clean_release)
            ));
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
            query_parts.push(("query".to_string(), lucene_query.join(" AND ")));
        }

        if let Some(limit) = self.limit {
            query_parts.push(("limit".to_string(), limit.to_string()));
        }

        if let Some(offset) = self.offset {
            query_parts.push(("offset".to_string(), offset.to_string()));
        }

        query_parts.push(("fmt".to_string(), "json".to_string()));

        for (key, value) in &self.extra_params {
            query_parts.push((key.clone(), value.clone()));
        }

        query_parts
            .iter()
            .map(|(k, v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v)))
            .collect::<Vec<_>>()
            .join("&")
    }
}

impl ReleaseGroupSearchQuery {
    /// Create new release group search query
    pub fn new() -> Self {
        Self::default()
    }

    /// Set artist name
    pub fn artist<S: Into<String>>(mut self, artist: S) -> Self {
        self.artist = Some(artist.into());
        self
    }

    /// Set release group title
    pub fn releasegroup<S: Into<String>>(mut self, releasegroup: S) -> Self {
        self.releasegroup = Some(releasegroup.into());
        self
    }

    /// Set primary type
    pub fn type_<S: Into<String>>(mut self, type_: S) -> Self {
        self.type_ = Some(type_.into());
        self
    }

    /// Set first release date
    pub fn firstreleasedate<S: Into<String>>(mut self, date: S) -> Self {
        self.firstreleasedate = Some(date.into());
        self
    }

    /// Set result limit
    pub fn limit(mut self, limit: u32) -> Self {
        self.limit = Some(limit);
        self
    }

    /// Set result offset
    pub fn offset(mut self, offset: u32) -> Self {
        self.offset = Some(offset);
        self
    }

    /// Add custom parameter
    pub fn param<K: Into<String>, V: Into<String>>(mut self, key: K, value: V) -> Self {
        self.extra_params.insert(key.into(), value.into());
        self
    }

    /// Build query string for MusicBrainz API
    pub fn to_query_string(&self) -> String {
        let mut query_parts = Vec::new();
        let mut lucene_query = Vec::new();

        if let Some(ref artist) = self.artist {
            let clean_artist = clean_search_text(artist);
            lucene_query.push(format!("artist:\"{}\"", escape_lucene_query(&clean_artist)));
        }

        if let Some(ref releasegroup) = self.releasegroup {
            let clean_rg = clean_search_text(releasegroup);
            lucene_query.push(format!(
                "releasegroup:\"{}\"",
                escape_lucene_query(&clean_rg)
            ));
        }

        if let Some(ref type_) = self.type_ {
            lucene_query.push(format!("type:{}", type_));
        }

        if let Some(ref date) = self.firstreleasedate {
            lucene_query.push(format!("firstreleasedate:{}", date));
        }

        if !lucene_query.is_empty() {
            query_parts.push(("query".to_string(), lucene_query.join(" AND ")));
        }

        if let Some(limit) = self.limit {
            query_parts.push(("limit".to_string(), limit.to_string()));
        }

        if let Some(offset) = self.offset {
            query_parts.push(("offset".to_string(), offset.to_string()));
        }

        query_parts.push(("fmt".to_string(), "json".to_string()));

        for (key, value) in &self.extra_params {
            query_parts.push((key.clone(), value.clone()));
        }

        query_parts
            .iter()
            .map(|(k, v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v)))
            .collect::<Vec<_>>()
            .join("&")
    }
}

/// Clean text for better MusicBrainz searching
fn clean_search_text(input: &str) -> String {
    input
        .replace(" - ", " ") // remove " - " separators common in song titles
        .replace('-', " ") // replace other hyphens with spaces
        .replace("  ", " ") // collapse multiple spaces
        .trim()
        .to_string()
}

/// Escape special characters in Lucene queries
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
            .artist("Radiohead")
            .title("Pyramid Song")
            .limit(25);

        let query_string = query.to_query_string();
        assert!(query_string.contains("artist"));
        assert!(query_string.contains("Radiohead"));
        assert!(query_string.contains("recording"));
        assert!(query_string.contains("Pyramid+Song"));
        assert!(query_string.contains("limit=25"));
    }

    #[test]
    fn test_recording_query_with_duration() {
        let query = RecordingSearchQuery::new()
            .title("Test Song")
            .duration_with_tolerance(240000, 5); // 240 seconds ± 5

        let query_string = query.to_query_string();
        assert!(query_string.contains("dur"));
        assert!(query_string.contains("235"));
        assert!(query_string.contains("245"));
    }

    #[test]
    fn test_release_query_basic() {
        let query = ReleaseSearchQuery::new()
            .artist("Radiohead")
            .release("Kid A")
            .limit(10);

        let query_string = query.to_query_string();
        assert!(query_string.contains("artist"));
        assert!(query_string.contains("release"));
        assert!(query_string.contains("limit=10"));
    }

    #[test]
    fn test_release_group_query() {
        let query = ReleaseGroupSearchQuery::new()
            .artist("Radiohead")
            .releasegroup("OK Computer")
            .type_("album");

        let query_string = query.to_query_string();
        assert!(query_string.contains("artist"));
        assert!(query_string.contains("releasegroup"));
        assert!(query_string.contains("type"));
    }

    #[test]
    fn test_lucene_escaping() {
        let escaped = escape_lucene_query("test+query-with:special*chars");
        assert!(escaped.contains("\\+"));
        assert!(escaped.contains("\\-"));
        assert!(escaped.contains("\\:"));
        assert!(escaped.contains("\\*"));
    }

    #[test]
    fn test_empty_query() {
        let query = RecordingSearchQuery::new();
        let query_string = query.to_query_string();
        // Should at least have format parameter
        assert!(query_string.contains("fmt=json"));
    }

    #[test]
    fn test_custom_parameters() {
        let query = RecordingSearchQuery::new()
            .param("inc", "artist-credits")
            .param("type", "album");

        let query_string = query.to_query_string();
        assert!(query_string.contains("inc="));
        assert!(query_string.contains("type="));
    }

    #[test]
    fn test_clean_search_text() {
        assert_eq!(clean_search_text("Test - Song"), "Test  Song");
        assert_eq!(clean_search_text("Multi  Space"), "Multi Space");
        assert_eq!(clean_search_text("  trimmed  "), "trimmed");
    }
}
