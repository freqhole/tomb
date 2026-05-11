//! album metadata: single source of truth.
//!
//! everything about the `albumz.metadata` json blob and the
//! `albumz.mb_lookup_status` enum lives in this module and nowhere else.
//!
//! callers MUST go through this module and MUST NOT:
//!   - hand-roll `json_extract('$.musicbrainz.…')` strings (use `paths::*`)
//!   - spell out a status string literal (use `MbLookupStatus::*` + `as_str`)
//!   - reach into the parsed blob with raw field paths from outside
//!
//! when the blob shape evolves, exactly one file changes here on the rust
//! side (and one generated module on the typescript side via codegen).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use zod_gen_derive::ZodSchema;

// =============================================================================
// status enum
// =============================================================================

/// musicbrainz lookup lifecycle for an album.
///
/// stored in `albumz.mb_lookup_status` as plain TEXT (no DB CHECK constraint).
/// values are also used as string literals on the wire and in filters.
///
/// add new variants here; never spell the strings inline elsewhere.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ZodSchema)]
#[serde(rename_all = "snake_case")]
pub enum MbLookupStatus {
    /// no attempt has been made (also represented by NULL in the db)
    NotAttempted,
    /// a search job has been enqueued but not yet picked up
    Queued,
    /// search call is currently in flight
    Searching,
    /// search returned candidates; awaiting decision
    Candidates,
    /// a candidate has been chosen (manual or auto)
    Confirmed,
    /// user explicitly rejected all candidates
    Rejected,
    /// search returned zero results
    NoMatch,
    /// borderline confidence; flagged for manual review
    NeedsReview,
    /// a detail-fetch job is in flight after confirmation
    FetchingDetail,
    /// detail fetched and folksonomy persisted
    Enriched,
    /// last attempt failed; retry-able
    Error,
}

impl MbLookupStatus {
    /// canonical string form, exactly as stored in the db / sent on the wire.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotAttempted => "not_attempted",
            Self::Queued => "queued",
            Self::Searching => "searching",
            Self::Candidates => "candidates",
            Self::Confirmed => "confirmed",
            Self::Rejected => "rejected",
            Self::NoMatch => "no_match",
            Self::NeedsReview => "needs_review",
            Self::FetchingDetail => "fetching_detail",
            Self::Enriched => "enriched",
            Self::Error => "error",
        }
    }

    /// parse from db text. NULL maps to `NotAttempted`. unknown values yield
    /// `None` (caller decides whether to treat as error or default).
    pub fn parse_opt(s: Option<&str>) -> Option<Self> {
        match s {
            None => Some(Self::NotAttempted),
            Some(s) => Self::parse(s),
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "not_attempted" => Self::NotAttempted,
            "queued" => Self::Queued,
            "searching" => Self::Searching,
            "candidates" => Self::Candidates,
            "confirmed" => Self::Confirmed,
            "rejected" => Self::Rejected,
            "no_match" => Self::NoMatch,
            "needs_review" => Self::NeedsReview,
            "fetching_detail" => Self::FetchingDetail,
            "enriched" => Self::Enriched,
            "error" => Self::Error,
            _ => return None,
        })
    }
}

// =============================================================================
// blob shape (versioned)
// =============================================================================

/// current schema version of `AlbumMetadata`. bump on shape change; readers
/// must accept older versions via `serde(default)` everywhere.
pub const CURRENT_VERSION: u32 = 1;

/// the parsed shape of `albumz.metadata`. all fields default; partial blobs
/// (including completely empty ones) deserialize cleanly.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema, PartialEq)]
#[serde(default)]
pub struct AlbumMetadata {
    pub version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub musicbrainz: Option<MbMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folksonomy: Option<FolksonomyMetadata>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub log: Vec<EnrichmentLogEntry>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema, PartialEq)]
#[serde(default)]
pub struct MbMetadata {
    /// confirmed release id, once a match is chosen
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_id: Option<String>,
    /// confirmed release-group id, once a match is chosen
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_group_id: Option<String>,
    /// unix timestamp when the match was confirmed
    #[serde(skip_serializing_if = "Option::is_none")]
    pub match_confirmed_at: Option<i64>,
    /// user id who confirmed the match (null = automated)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub match_confirmed_by: Option<String>,
    /// candidate matches from the most recent search
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub candidates: Vec<MbCandidate>,
    /// the query inputs used in the most recent search (for debugging)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_query: Option<MbLastQuery>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema, PartialEq)]
#[serde(default)]
pub struct MbCandidate {
    pub release_group_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_id: Option<String>,
    pub title: String,
    pub artist: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_release_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_type: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub secondary_types: Vec<String>,
    /// musicbrainz' own lucene score (0..100)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mb_score: Option<i32>,
    /// our locally computed confidence (0.0..1.0)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_confidence: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema, PartialEq)]
#[serde(default)]
pub struct MbLastQuery {
    pub artist: String,
    pub release: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracks: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema, PartialEq)]
#[serde(default)]
pub struct FolksonomyMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub musicbrainz: Option<MbFolksonomy>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema, PartialEq)]
#[serde(default)]
pub struct MbFolksonomy {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub release_genres: Vec<FolksonomyTag>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub release_tags: Vec<FolksonomyTag>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub release_group_genres: Vec<FolksonomyTag>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub release_group_tags: Vec<FolksonomyTag>,
    /// unix timestamp when this data was fetched
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fetched_at: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema, PartialEq)]
#[serde(default)]
pub struct FolksonomyTag {
    pub name: String,
    pub count: i32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema, PartialEq)]
#[serde(default)]
pub struct EnrichmentLogEntry {
    /// unix timestamp
    pub at: i64,
    /// short identifier for the step (e.g. "search", "fetch_detail")
    pub step: String,
    /// human-readable result summary
    pub result: String,
}

// =============================================================================
// json path constants — sole source of truth for `json_extract` callers
// =============================================================================

/// json paths into `albumz.metadata`. use these in any sql `json_extract`
/// expression instead of inlining path strings.
pub mod paths {
    /// `$.version`
    pub const VERSION: &str = "$.version";
    /// `$.musicbrainz`
    pub const MUSICBRAINZ: &str = "$.musicbrainz";
    /// `$.musicbrainz.release_id`
    pub const MB_RELEASE_ID: &str = "$.musicbrainz.release_id";
    /// `$.musicbrainz.release_group_id`
    pub const MB_RELEASE_GROUP_ID: &str = "$.musicbrainz.release_group_id";
    /// `$.musicbrainz.match_confirmed_at`
    pub const MB_MATCH_CONFIRMED_AT: &str = "$.musicbrainz.match_confirmed_at";
    /// `$.musicbrainz.candidates`
    pub const MB_CANDIDATES: &str = "$.musicbrainz.candidates";
    /// `$.folksonomy`
    pub const FOLKSONOMY: &str = "$.folksonomy";
    /// `$.folksonomy.musicbrainz.fetched_at`
    pub const FOLKSONOMY_MB_FETCHED_AT: &str = "$.folksonomy.musicbrainz.fetched_at";
}

// =============================================================================
// parse / serialize / merge helpers
// =============================================================================

/// parse the raw `albumz.metadata` text column. NULL or empty maps to a
/// default `AlbumMetadata`. malformed json returns an error so callers can
/// log and continue with a default if they choose.
pub fn parse(raw: Option<&str>) -> Result<AlbumMetadata, serde_json::Error> {
    match raw {
        None => Ok(AlbumMetadata::default()),
        Some(s) if s.trim().is_empty() => Ok(AlbumMetadata::default()),
        Some(s) => serde_json::from_str(s),
    }
}

/// parse, returning a default on any error. use this when callers can't
/// usefully react to a parse failure (e.g. the table view).
pub fn parse_lossy(raw: Option<&str>) -> AlbumMetadata {
    parse(raw).unwrap_or_default()
}

/// serialize to the canonical compact json form for storage.
pub fn to_string(meta: &AlbumMetadata) -> Result<String, serde_json::Error> {
    serde_json::to_string(meta)
}

/// deep-merge a json patch into a metadata blob. used by jobs that update one
/// sub-tree (e.g. just `musicbrainz.candidates`) without clobbering siblings
/// written by other steps. arrays in `patch` REPLACE arrays in `base` (we
/// don't try to merge arrays element-wise — that's almost never what you
/// want for our shape). objects merge recursively.
///
/// returns the new `AlbumMetadata`. always sets `version = CURRENT_VERSION`.
pub fn merge_patch(
    base: &AlbumMetadata,
    patch: &JsonValue,
) -> Result<AlbumMetadata, serde_json::Error> {
    let mut base_value = serde_json::to_value(base)?;
    deep_merge(&mut base_value, patch);
    let mut merged: AlbumMetadata = serde_json::from_value(base_value)?;
    merged.version = CURRENT_VERSION;
    Ok(merged)
}

/// convenience: build a json patch that updates the musicbrainz sub-tree's
/// candidates list and last_query.
pub fn patch_mb_search_result(candidates: &[MbCandidate], last_query: &MbLastQuery) -> JsonValue {
    json!({
        "musicbrainz": {
            "candidates": candidates,
            "last_query": last_query,
        }
    })
}

/// convenience: build a json patch that records a confirmed match.
pub fn patch_mb_confirmation(
    release_group_id: &str,
    release_id: Option<&str>,
    confirmed_at: i64,
    confirmed_by: Option<&str>,
) -> JsonValue {
    json!({
        "musicbrainz": {
            "release_group_id": release_group_id,
            "release_id": release_id,
            "match_confirmed_at": confirmed_at,
            "match_confirmed_by": confirmed_by,
        }
    })
}

/// convenience: build a json patch that records folksonomy data from MB.
pub fn patch_mb_folksonomy(folksonomy: &MbFolksonomy) -> JsonValue {
    json!({
        "folksonomy": {
            "musicbrainz": folksonomy,
        }
    })
}

/// convenience: append an entry to the `log` array. log is rebuilt server-side
/// via `merge_log_entry` (since arrays don't deep-merge).
pub fn append_log_entry(meta: &mut AlbumMetadata, entry: EnrichmentLogEntry) {
    meta.log.push(entry);
    // keep log bounded so blobs don't grow unbounded
    const MAX_LOG_ENTRIES: usize = 50;
    if meta.log.len() > MAX_LOG_ENTRIES {
        let excess = meta.log.len() - MAX_LOG_ENTRIES;
        meta.log.drain(0..excess);
    }
}

fn deep_merge(dst: &mut JsonValue, src: &JsonValue) {
    match (dst, src) {
        (JsonValue::Object(dst_map), JsonValue::Object(src_map)) => {
            for (k, v) in src_map {
                deep_merge(dst_map.entry(k.clone()).or_insert(JsonValue::Null), v);
            }
        }
        (dst, src) => {
            *dst = src.clone();
        }
    }
}

// =============================================================================
// tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_empty_yields_default() {
        assert_eq!(parse(None).unwrap(), AlbumMetadata::default());
        assert_eq!(parse(Some("")).unwrap(), AlbumMetadata::default());
        assert_eq!(parse(Some("   ")).unwrap(), AlbumMetadata::default());
    }

    #[test]
    fn parse_partial_blob() {
        let raw = r#"{"musicbrainz":{"release_id":"abc"}}"#;
        let meta = parse(Some(raw)).unwrap();
        assert_eq!(
            meta.musicbrainz.unwrap().release_id.unwrap(),
            "abc".to_string()
        );
    }

    #[test]
    fn merge_preserves_other_subtrees() {
        let base = AlbumMetadata {
            version: 1,
            musicbrainz: Some(MbMetadata {
                release_id: Some("orig".into()),
                ..Default::default()
            }),
            ..Default::default()
        };
        let patch = json!({"folksonomy":{"musicbrainz":{"fetched_at":42}}});
        let merged = merge_patch(&base, &patch).unwrap();
        assert_eq!(
            merged.musicbrainz.as_ref().unwrap().release_id.as_deref(),
            Some("orig")
        );
        assert_eq!(
            merged
                .folksonomy
                .as_ref()
                .unwrap()
                .musicbrainz
                .as_ref()
                .unwrap()
                .fetched_at,
            Some(42)
        );
    }

    #[test]
    fn merge_replaces_arrays_wholesale() {
        let base = AlbumMetadata {
            musicbrainz: Some(MbMetadata {
                candidates: vec![MbCandidate {
                    release_group_id: "old".into(),
                    title: "old".into(),
                    artist: "old".into(),
                    ..Default::default()
                }],
                ..Default::default()
            }),
            ..Default::default()
        };
        let patch = json!({"musicbrainz":{"candidates":[{"release_group_id":"new","title":"new","artist":"new"}]}});
        let merged = merge_patch(&base, &patch).unwrap();
        let candidates = &merged.musicbrainz.as_ref().unwrap().candidates;
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].release_group_id, "new");
    }

    #[test]
    fn status_round_trips() {
        for status in [
            MbLookupStatus::NotAttempted,
            MbLookupStatus::Candidates,
            MbLookupStatus::Confirmed,
            MbLookupStatus::Enriched,
            MbLookupStatus::NoMatch,
            MbLookupStatus::Error,
        ] {
            assert_eq!(MbLookupStatus::parse(status.as_str()), Some(status));
        }
    }

    #[test]
    fn status_null_is_not_attempted() {
        assert_eq!(
            MbLookupStatus::parse_opt(None),
            Some(MbLookupStatus::NotAttempted)
        );
    }

    #[test]
    fn status_unknown_is_none() {
        assert_eq!(MbLookupStatus::parse("future_value"), None);
    }

    #[test]
    fn log_is_bounded() {
        let mut meta = AlbumMetadata::default();
        for i in 0..100 {
            append_log_entry(
                &mut meta,
                EnrichmentLogEntry {
                    at: i,
                    step: "x".into(),
                    result: "y".into(),
                },
            );
        }
        assert_eq!(meta.log.len(), 50);
        // oldest entries dropped
        assert_eq!(meta.log[0].at, 50);
    }
}
