//! last.fm api response models.
//!
//! last.fm's json wrapper is famously chatty — every list field can be
//! either an object or an array depending on item count, attributes get
//! prefixed with `@attr`, and many numeric fields arrive as strings. these
//! models stay close to what we actually want to consume; expand as needed.
//!
//! known quirks handled here:
//!   - `tags` and `wiki` arrive as `""` (empty string!) when absent, not
//!     `null` and not omitted. `Option<...>` alone can't deserialize an
//!     empty string into the struct shape, so we use `empty_string_as_none`
//!     to coerce that case to `None` before serde tries the struct shape.

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

// ---------------------------------------------------------------------------
// album.getInfo
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastFmAlbumInfoResponse {
    pub album: Option<LastFmAlbumInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastFmAlbumInfo {
    pub name: String,
    pub artist: String,
    /// musicbrainz release-group mbid (last.fm sometimes carries this!)
    pub mbid: Option<String>,
    pub url: Option<String>,
    /// stringified numbers per last.fm convention
    pub listeners: Option<String>,
    pub playcount: Option<String>,
    #[serde(default, deserialize_with = "empty_string_as_none")]
    pub tags: Option<LastFmTagWrapper>,
    #[serde(default, deserialize_with = "empty_string_as_none")]
    pub wiki: Option<LastFmWiki>,
}

// ---------------------------------------------------------------------------
// artist.getInfo
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastFmArtistInfoResponse {
    pub artist: Option<LastFmArtistInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastFmArtistInfo {
    pub name: String,
    pub mbid: Option<String>,
    pub url: Option<String>,
    #[serde(default, deserialize_with = "empty_string_as_none")]
    pub stats: Option<LastFmArtistStats>,
    #[serde(default, deserialize_with = "empty_string_as_none")]
    pub tags: Option<LastFmTagWrapper>,
    #[serde(default, deserialize_with = "empty_string_as_none")]
    pub similar: Option<LastFmSimilarWrapper>,
    #[serde(default, deserialize_with = "empty_string_as_none")]
    pub bio: Option<LastFmWiki>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastFmArtistStats {
    pub listeners: Option<String>,
    pub playcount: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastFmSimilarWrapper {
    #[serde(default)]
    pub artist: Vec<LastFmSimilarArtist>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastFmSimilarArtist {
    pub name: String,
    pub url: Option<String>,
}

// ---------------------------------------------------------------------------
// shared
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastFmTagWrapper {
    #[serde(default)]
    pub tag: Vec<LastFmTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastFmTag {
    pub name: String,
    pub url: Option<String>,
    /// `tag.getTopTags` returns a `count`; on `album.getInfo` only `name+url`.
    pub count: Option<u32>,
}

/// last.fm's "wiki" block — used for both album wiki summaries and artist bios.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastFmWiki {
    pub published: Option<String>,
    pub summary: Option<String>,
    pub content: Option<String>,
}

// ---------------------------------------------------------------------------
// generic envelope for last.fm errors
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastFmErrorEnvelope {
    pub error: i32,
    pub message: String,
}

/// last.fm sometimes returns `""` (empty string) where a struct or null
/// would be expected (e.g. an album with no tags has `"tags": ""`). this
/// deserializer accepts that quirk: empty string -> None, anything else
/// is parsed as the inner type.
fn empty_string_as_none<'de, D, T>(de: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: serde::de::DeserializeOwned,
{
    let v = Value::deserialize(de)?;
    match v {
        Value::Null => Ok(None),
        Value::String(s) if s.is_empty() => Ok(None),
        other => serde_json::from_value(other)
            .map(Some)
            .map_err(serde::de::Error::custom),
    }
}
