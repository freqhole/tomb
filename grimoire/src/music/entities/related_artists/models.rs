//! related-artists models — see [super] for context.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// where a related-artist relation came from. one of the typed
/// enrichment sources.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ZodSchema)]
#[serde(rename_all = "snake_case")]
pub enum RelatedArtistSource {
    Lastfm,
    Audiodb,
    Mb,
}

impl RelatedArtistSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Lastfm => "lastfm",
            Self::Audiodb => "audiodb",
            Self::Mb => "mb",
        }
    }
}

/// a small {name, url} pair persisted in the `external_urlz` json
/// blob alongside each related-artist row. used for spotify, discogs,
/// the source's own artist page, etc — anything that isn't bandcamp
/// (which has its own dedicated columns because we lean into it).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ExternalUrl {
    pub name: String,
    pub url: String,
}

/// a related artist's bandcamp album. persisted as a json array on
/// the `bandcamp_album_urlz` column (capped at ~25 in repo writes).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct BandcampAlbumLink {
    pub title: String,
    pub url: String,
}

/// row read from the `related_artistz` table. external_urlz +
/// bandcamp_album_urlz are deserialized lazily on read so consumers
/// that only need the row metadata don't pay for json parse.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow, ZodSchema)]
pub struct RelatedArtist {
    pub id: String,
    pub source_artist_id: String,
    pub related_artist_id: Option<String>,
    pub related_name: String,
    pub related_name_key: String,
    pub related_mbid: Option<String>,
    /// stored as the source enum's `as_str()` value.
    pub source: String,
    pub match_score: Option<f64>,
    pub bandcamp_url: Option<String>,
    /// raw json string; deserialize via [RelatedArtist::bandcamp_albums].
    pub bandcamp_album_urlz: Option<String>,
    pub image_url: Option<String>,
    /// raw json string; deserialize via [RelatedArtist::external_urls].
    pub external_urlz: Option<String>,
    pub fetched_at: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

impl RelatedArtist {
    /// best-effort parse of `bandcamp_album_urlz`. returns empty vec
    /// on null / parse failure (we never want a bad row to break
    /// reads).
    pub fn bandcamp_albums(&self) -> Vec<BandcampAlbumLink> {
        self.bandcamp_album_urlz
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default()
    }

    /// best-effort parse of `external_urlz`. same null-tolerance as
    /// [Self::bandcamp_albums].
    pub fn external_urls(&self) -> Vec<ExternalUrl> {
        self.external_urlz
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default()
    }

    /// derived: is this related artist already in the local library?
    pub fn in_library(&self) -> bool {
        self.related_artist_id.is_some()
    }
}

/// upsert payload from a processor. the repo computes `name_key`,
/// resolves `related_artist_id` via mbid/name_key cross-ref, and
/// stamps `fetched_at` from the caller (so a single processor batch
/// shares a timestamp).
#[derive(Debug, Clone)]
pub struct UpsertRelatedArtist {
    pub source_artist_id: String,
    pub related_name: String,
    pub related_mbid: Option<String>,
    pub source: RelatedArtistSource,
    pub match_score: Option<f64>,
    pub bandcamp_url: Option<String>,
    pub bandcamp_albums: Vec<BandcampAlbumLink>,
    pub image_url: Option<String>,
    pub external_urls: Vec<ExternalUrl>,
    pub fetched_at: i64,
}
