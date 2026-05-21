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
//
// note: zod codegen for this enum is hand-rolled below (see
// `impl ZodSchema for MbLookupStatus`) because `zod_gen_derive` does not
// honor `#[serde(rename_all = ...)]` on enum variants. follow the same
// pattern as `BlobType` for any future renamed enums.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
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
    /// auto-confirm queued/running an `AutoApplyAlbumEnrichment` job
    /// that fans out the wizard's full apply chain (taxons, urls,
    /// images, bio, related artists) automatically once the upstream
    /// mb/lastfm/audiodb detail jobs finish. row stays in this state
    /// while the auto-apply job is pending or running so the library
    /// table can render a spinner. flips back to `Enriched` once the
    /// apply work completes.
    AutoApplying,
    /// user explicitly skipped this album in the bulk-review wizard.
    /// distinct from `Rejected` (which means the candidates list was
    /// rejected) and from `NoMatch` (which means search returned
    /// nothing). carved out so the library filter chip can show the
    /// pile of "i looked at this and chose not to deal with it"
    /// albums separately from the "machine couldn't find anything"
    /// pile.
    Skipped,
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
            Self::AutoApplying => "auto_applying",
            Self::Skipped => "skipped",
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
            "auto_applying" => Self::AutoApplying,
            "skipped" => Self::Skipped,
            "error" => Self::Error,
            _ => return None,
        })
    }
}

impl zod_gen::ZodSchema for MbLookupStatus {
    fn zod_schema() -> String {
        // keep in sync with `MbLookupStatus::as_str` (snake_case wire form).
        // hand-rolled because `zod_gen_derive` does not honor `serde(rename_all)`.
        r#"z.union([z.literal("not_attempted"), z.literal("queued"), z.literal("searching"), z.literal("candidates"), z.literal("confirmed"), z.literal("rejected"), z.literal("no_match"), z.literal("needs_review"), z.literal("fetching_detail"), z.literal("enriched"), z.literal("auto_applying"), z.literal("skipped"), z.literal("error")])"#.to_string()
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lastfm: Option<LastFmMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audiodb: Option<AudioDbMetadata>,
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
    /// release ids whose tag/genre payloads contributed to the current
    /// folksonomy snapshot. populated by the walk-and-union path in
    /// `mb_detail_processor` when the winner alone has sparse tags;
    /// surfaces in the review modal so the user can audit which
    /// siblings were folded into the result.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tag_source_release_ids: Vec<String>,
    /// external url relations harvested via `inc=url-rels` from the
    /// release and release-group endpoints. unioned + deduped by url.
    /// surfaces in the review modal as toggle-to-ingest into entity_urlz.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub urls: Vec<MbUrl>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema, PartialEq)]
#[serde(default)]
pub struct MbUrl {
    /// musicbrainz relation type (e.g. "bandcamp", "discogs", "wikidata",
    /// "free streaming", "streaming", "last.fm", "allmusic").
    pub relation_type: String,
    /// the resource url itself.
    pub url: String,
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
    /// first medium's format (e.g. "CD", "Digital Media", "12\" Vinyl").
    /// used both by the local confidence ladder and by the review ui.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media: Option<String>,
    /// musicbrainz' own lucene score (0..100)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mb_score: Option<i32>,
    /// our locally computed confidence (0.0..1.0)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_confidence: Option<f64>,
    /// number of cover-art images on the release (per MB cover art archive).
    /// surfaced in the review ui so users can see why a release was ranked.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art_count: Option<u32>,
    /// whether the release has a "front" cover image. front art is the
    /// strongest visual tiebreaker, so surface it explicitly.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_front_cover: Option<bool>,
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
// last.fm enrichment blob (phase 13)
// =============================================================================

/// snapshot of last.fm data captured by the lastfm-detail job. raw enough to
/// dump in a debug modal; consumers (mood unifier, similar-artist viz) can
/// read structured fields off this without re-fetching.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema, PartialEq)]
#[serde(default)]
pub struct LastFmMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<LastFmAlbumSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist: Option<LastFmArtistSnapshot>,
    /// unix timestamp when this data was fetched
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fetched_at: Option<i64>,
    /// last.fm api error envelope, when the call failed
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema, PartialEq)]
#[serde(default)]
pub struct LastFmAlbumSnapshot {
    pub name: String,
    pub artist: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mbid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub listeners: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playcount: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<LastFmTagRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wiki_summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wiki_published: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema, PartialEq)]
#[serde(default)]
pub struct LastFmArtistSnapshot {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mbid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub listeners: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playcount: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<LastFmTagRef>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub similar: Vec<LastFmSimilarArtistRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bio_summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bio_published: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema, PartialEq)]
#[serde(default)]
pub struct LastFmTagRef {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema, PartialEq)]
#[serde(default)]
pub struct LastFmSimilarArtistRef {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// snapshot of theaudiodb data captured by the audiodb-detail job. raw
/// enough to dump in a debug modal; consumers (mood unifier, asset puller)
/// can read structured fields off this without re-fetching.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema, PartialEq)]
#[serde(default)]
pub struct AudioDbMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<AudioDbAlbumSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist: Option<AudioDbArtistSnapshot>,
    /// unix timestamp when this data was fetched
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fetched_at: Option<i64>,
    /// last error message when the call failed (no envelope; audiodb
    /// just returns `{album:null}` on miss, so this is parse/transport).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema, PartialEq)]
#[serde(default)]
pub struct AudioDbAlbumSnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id_album: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id_artist: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year_released: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subgenre: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mood: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score_votes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description_en: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album_thumb: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album_thumb_hq: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album_thumb_back: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album_cdart: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album_spine: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album_3d_case: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub musicbrainz_release_group_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub musicbrainz_artist_id: Option<String>,
    // ---- additional fields surfaced by the api-sample audit ----
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discogs_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub itunes_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amazon_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allmusic_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wikipedia_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wikidata_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album_back: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album_3d_face: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album_3d_flat: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album_3d_thumb: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema, PartialEq)]
#[serde(default)]
pub struct AudioDbArtistSnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id_artist: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mood: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub biography_en: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formed_year: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist_thumb: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist_fanart: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub musicbrainz_artist_id: Option<String>,
    // ---- additional fields surfaced by the api-sample audit ----
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub website: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub facebook: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub twitter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub born_year: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub died_year: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disbanded: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub members: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gender: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist_logo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist_cutout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist_clearart: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist_wide_thumb: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist_fanart_2: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist_fanart_3: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist_fanart_4: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist_banner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub charted: Option<String>,
}

// =============================================================================
// review-flow request/response types (phase 7)
// =============================================================================

/// confirm a specific musicbrainz candidate as the canonical match for an
/// album. updates `mb_lookup_status` to `Confirmed`, writes the chosen
/// release / release-group ids into `metadata.musicbrainz`, and stamps the
/// confirming user. (the follow-up detail-fetch job is wired in phase 8.)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct ConfirmMbMatchRequest {
    pub album_id: String,
    pub release_group_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_id: Option<String>,
}

/// reject all candidates for an album. sets `mb_lookup_status` to
/// `Rejected` and clears stored candidates so the next lookup starts fresh.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct RejectMbMatchRequest {
    pub album_id: String,
}

/// uniform shape for both confirm and reject responses.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct MbMatchActionResponse {
    pub album_id: String,
    pub status: MbLookupStatus,
}

/// bulk auto-confirm: confirm the top candidate per album where it clears
/// both a confidence floor and a gap-to-#2 floor.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct AutoConfirmMbMatchesRequest {
    pub album_ids: Vec<String>,
    /// minimum `local_confidence` for the top candidate (e.g. 0.9).
    pub min_confidence: f64,
    /// minimum gap between top and #2 candidates (e.g. 0.15). use 0 to
    /// disable the gap check.
    pub min_gap: f64,
}

/// per-album skip/error reason returned from auto-confirm so the ui can
/// explain inline why a row didn't get auto-confirmed.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct AutoConfirmSkip {
    pub album_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct AutoConfirmMbMatchesResult {
    pub confirmed: Vec<String>,
    pub skipped: Vec<AutoConfirmSkip>,
    pub errors: Vec<AutoConfirmSkip>,
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

/// convenience: build a json patch that records external url relations
/// harvested from MB `inc=url-rels`. completely replaces the urls list.
pub fn patch_mb_urls(urls: &[MbUrl]) -> JsonValue {
    json!({
        "musicbrainz": {
            "urls": urls,
        }
    })
}

/// convenience: build a json patch that records which release_ids
/// contributed to the current folksonomy snapshot. used by the
/// walk-and-union path in `mb_detail_processor` when the auto-confirmed
/// winner has sparse tags and we fall back to detail-fetching siblings.
pub fn patch_mb_tag_sources(release_ids: &[String]) -> JsonValue {
    json!({
        "musicbrainz": {
            "tag_source_release_ids": release_ids,
        }
    })
}

/// convenience: build a json patch that records last.fm enrichment data.
/// passes the whole `LastFmMetadata` so callers can include album-only,
/// artist-only, or both. completely replaces the `lastfm` sub-tree (it's
/// always written together as a snapshot from one job run).
pub fn patch_lastfm(lastfm: &LastFmMetadata) -> JsonValue {
    json!({ "lastfm": lastfm })
}

/// convenience: build a json patch that records theaudiodb enrichment
/// data. completely replaces the `audiodb` sub-tree (always written
/// together as a snapshot from one job run).
pub fn patch_audiodb(audiodb: &AudioDbMetadata) -> JsonValue {
    json!({ "audiodb": audiodb })
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
