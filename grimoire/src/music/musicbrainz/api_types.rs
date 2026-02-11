//! api request and response types for musicbrainz endpoints

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

use super::models::{
    ArtistCredit, CoverArt, CoverArtThumbnails, Medium, Release, SearchResult, Track,
};

// -- request types --

/// request to search releases (albums)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SearchReleasesRequest {
    /// artist name filter
    pub artist: Option<String>,
    /// release title filter
    pub release: Option<String>,
    /// limit results
    pub limit: Option<u32>,
    /// offset for pagination
    pub offset: Option<u32>,
}

/// request to get a specific release by mbid
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetReleaseRequest {
    /// musicbrainz id
    pub mbid: String,
}

/// request to search recordings (songs/tracks)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SearchRecordingsRequest {
    /// search query string
    pub query: String,
    /// artist name filter
    pub artist: Option<String>,
    /// recording title filter
    pub recording: Option<String>,
    /// limit results
    pub limit: Option<u32>,
    /// offset for pagination
    pub offset: Option<u32>,
}

/// request to get a specific recording by mbid
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetRecordingRequest {
    /// musicbrainz id
    pub mbid: String,
}

/// request to get cover art for a release
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetCoverArtRequest {
    /// musicbrainz release id
    pub mbid: String,
}

// -- response types --
// these are our API contract - clean flat types separate from raw MB models

/// response for search releases endpoint
#[derive(Debug, Clone, Serialize, ZodSchema)]
pub struct MbSearchReleasesResponse {
    /// list of matching releases
    pub results: Vec<MbReleaseListItem>,
    /// total number of results available on musicbrainz
    pub count: u32,
    /// current offset into results
    pub offset: u32,
}

/// a release in the search results list
#[derive(Debug, Clone, Serialize, ZodSchema)]
pub struct MbReleaseListItem {
    /// musicbrainz release id
    pub id: String,
    /// release title
    pub title: String,
    /// release date (partial, e.g. "2024" or "2024-03-15")
    pub date: Option<String>,
    /// country code
    pub country: Option<String>,
    /// release status (official, promotion, bootleg, etc.)
    pub status: Option<String>,
    /// search relevance score (0-100)
    pub score: Option<u32>,
    /// artist credits
    pub artist_credit: Vec<MbArtistCreditEntry>,
    /// total number of tracks across all media
    pub track_count: u32,
    /// whether cover art is available on the cover art archive
    pub has_cover_art: bool,
    /// cover art thumbnail URL (250px, from coverartarchive.org)
    pub cover_art_url: Option<String>,
    /// release group primary type (album, single, ep, etc.)
    pub primary_type: Option<String>,
    /// release group secondary types (compilation, live, remix, etc.)
    pub secondary_types: Vec<String>,
    /// label name(s) joined with " / " when multiple
    pub label: Option<String>,
    /// media format(s) e.g. "CD", "Vinyl", "Cassette", "Digital Media"
    pub format: Option<String>,
    /// packaging type e.g. "Jewel Case", "Digipak"
    pub packaging: Option<String>,
}

/// artist credit entry (name + optional join phrase like " feat. ")
#[derive(Debug, Clone, Serialize, ZodSchema)]
pub struct MbArtistCreditEntry {
    /// credited name
    pub name: String,
    /// join phrase between this and next artist (e.g. " & ", " feat. ")
    pub joinphrase: Option<String>,
}

/// full release detail response (includes tracks)
#[derive(Debug, Clone, Serialize, ZodSchema)]
pub struct MbReleaseDetail {
    /// musicbrainz release id
    pub id: String,
    /// release title
    pub title: String,
    /// release date
    pub date: Option<String>,
    /// country code
    pub country: Option<String>,
    /// release status
    pub status: Option<String>,
    /// artist credits
    pub artist_credit: Vec<MbArtistCreditEntry>,
    /// media (discs) with track listings
    pub media: Vec<MbMediumDetail>,
    /// release group primary type
    pub primary_type: Option<String>,
    /// release group secondary types
    pub secondary_types: Vec<String>,
    /// whether cover art is available
    pub has_cover_art: bool,
    /// cover art thumbnail URL (250px, from coverartarchive.org)
    pub cover_art_url: Option<String>,
    /// cover art images fetched from cover art archive (populated on detail endpoint)
    pub cover_art_images: Vec<MbCoverArtImage>,
    /// genres from musicbrainz (combined: release-group genres sorted by vote count)
    pub genres: Vec<String>,
    /// label name (first label from label-info, if available)
    pub label: Option<String>,
}

/// a cover art image from the cover art archive
#[derive(Debug, Clone, Serialize, ZodSchema)]
pub struct MbCoverArtImage {
    /// unique image id
    pub id: String,
    /// full-size image url
    pub image_url: String,
    /// thumbnail urls at various sizes
    pub thumbnails: Option<MbCoverArtThumbnails>,
    /// image types (front, back, booklet, etc.)
    pub types: Vec<String>,
    /// whether this is the front cover
    pub front: bool,
    /// whether this is the back cover
    pub back: bool,
    /// comment about this image
    pub comment: Option<String>,
}

/// thumbnail urls for a cover art image
#[derive(Debug, Clone, Serialize, ZodSchema)]
pub struct MbCoverArtThumbnails {
    /// small thumbnail (~250px)
    pub small: Option<String>,
    /// large thumbnail (~500px)
    pub large: Option<String>,
    /// 250px thumbnail
    pub thumb_250: Option<String>,
    /// 500px thumbnail
    pub thumb_500: Option<String>,
    /// 1200px thumbnail
    pub thumb_1200: Option<String>,
}

#[derive(Debug, Clone, Serialize, ZodSchema)]
pub struct MbMediumDetail {
    /// disc position (1, 2, etc.)
    pub position: Option<u32>,
    /// medium title (for multi-disc releases with named discs)
    pub title: Option<String>,
    /// format (cd, vinyl, digital media, etc.)
    pub format: Option<String>,
    /// individual tracks on this medium
    pub tracks: Vec<MbTrackDetail>,
    /// number of tracks
    pub track_count: u32,
}

/// a track in a medium
#[derive(Debug, Clone, Serialize, ZodSchema)]
pub struct MbTrackDetail {
    /// track position on the medium
    pub position: Option<u32>,
    /// track title
    pub title: String,
    /// track length in milliseconds
    pub length_ms: Option<u32>,
    /// per-track artist credit (different from release artist on compilations)
    pub artist_credit: Vec<MbArtistCreditEntry>,
}

// -- conversions from internal MB models to API response types --

impl From<SearchResult<Release>> for MbSearchReleasesResponse {
    fn from(sr: SearchResult<Release>) -> Self {
        Self {
            results: sr
                .results
                .into_iter()
                .map(MbReleaseListItem::from)
                .collect(),
            count: sr.count,
            offset: sr.offset,
        }
    }
}

impl From<Release> for MbReleaseListItem {
    fn from(r: Release) -> Self {
        let track_count = r
            .media
            .as_ref()
            .map(|media| media.iter().map(|m| m.track_count.unwrap_or(0)).sum())
            .unwrap_or(0);
        let has_cover_art = r
            .cover_art_archive
            .as_ref()
            .map(|ca| ca.front || ca.artwork)
            .unwrap_or(false);
        let primary_type = r
            .release_group
            .as_ref()
            .and_then(|rg| rg.primary_type.clone());
        let secondary_types = r
            .release_group
            .as_ref()
            .and_then(|rg| rg.secondary_types.clone())
            .unwrap_or_default();
        let label = {
            let names: Vec<String> = r
                .label_info
                .as_ref()
                .map(|li| {
                    li.iter()
                        .filter_map(|entry| entry.label.as_ref().map(|l| l.name.clone()))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let mut seen = std::collections::HashSet::new();
            let unique: Vec<String> = names
                .into_iter()
                .filter(|n| seen.insert(n.clone()))
                .collect();
            if unique.is_empty() {
                None
            } else {
                Some(unique.join(" / "))
            }
        };

        Self {
            id: r.id.to_string(),
            title: r.title,
            date: r.date,
            country: r.country,
            status: r.status,
            score: r.score,
            artist_credit: r
                .artist_credit
                .unwrap_or_default()
                .into_iter()
                .map(MbArtistCreditEntry::from)
                .collect(),
            track_count,
            has_cover_art,
            // musicbrainz search doesn't return cover-art-archive info, but
            // the cover art archive URL is predictable from the release id.
            // the client shows a music icon fallback and hides the img on 404.
            cover_art_url: Some(format!(
                "https://coverartarchive.org/release/{}/front-250",
                r.id
            )),
            primary_type,
            secondary_types,
            label,
            format: {
                let formats: Vec<String> = r
                    .media
                    .as_ref()
                    .map(|media| {
                        media
                            .iter()
                            .filter_map(|m| m.format.clone())
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let mut seen = std::collections::HashSet::new();
                let unique: Vec<String> = formats
                    .into_iter()
                    .filter(|f| seen.insert(f.clone()))
                    .collect();
                if unique.is_empty() {
                    None
                } else {
                    Some(unique.join(" + "))
                }
            },
            packaging: r.packaging,
        }
    }
}

impl From<ArtistCredit> for MbArtistCreditEntry {
    fn from(ac: ArtistCredit) -> Self {
        Self {
            name: ac.name,
            joinphrase: ac.joinphrase,
        }
    }
}

impl From<Release> for MbReleaseDetail {
    fn from(r: Release) -> Self {
        let has_cover_art = r
            .cover_art_archive
            .as_ref()
            .map(|ca| ca.front || ca.artwork)
            .unwrap_or(false);
        let primary_type = r
            .release_group
            .as_ref()
            .and_then(|rg| rg.primary_type.clone());
        let secondary_types = r
            .release_group
            .as_ref()
            .and_then(|rg| rg.secondary_types.clone())
            .unwrap_or_default();

        Self {
            id: r.id.to_string(),
            title: r.title,
            date: r.date,
            country: r.country,
            status: r.status,
            artist_credit: r
                .artist_credit
                .unwrap_or_default()
                .into_iter()
                .map(MbArtistCreditEntry::from)
                .collect(),
            media: r
                .media
                .unwrap_or_default()
                .into_iter()
                .map(MbMediumDetail::from)
                .collect(),
            primary_type,
            secondary_types,
            has_cover_art,
            cover_art_url: Some(format!(
                "https://coverartarchive.org/release/{}/front-250",
                r.id
            )),
            // cover art images are populated separately by the server handler
            cover_art_images: vec![],
            // genres: prefer release-group genres (more commonly populated), fall back to release genres
            genres: {
                let rg_genres = r
                    .release_group
                    .as_ref()
                    .and_then(|rg| rg.genres.as_ref())
                    .cloned()
                    .unwrap_or_default();
                let release_genres = r.genres.unwrap_or_default();
                // use whichever has more entries, sorted by vote count descending
                let mut genres = if rg_genres.len() >= release_genres.len() {
                    rg_genres
                } else {
                    release_genres
                };
                genres.sort_by(|a, b| b.count.unwrap_or(0).cmp(&a.count.unwrap_or(0)));
                genres.into_iter().map(|g| g.name).collect()
            },
            // label: join all unique label names from label-info
            label: {
                let names: Vec<String> = r
                    .label_info
                    .as_ref()
                    .map(|li| {
                        li.iter()
                            .filter_map(|entry| entry.label.as_ref().map(|l| l.name.clone()))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                // deduplicate while preserving order
                let mut seen = std::collections::HashSet::new();
                let unique: Vec<String> = names
                    .into_iter()
                    .filter(|n| seen.insert(n.clone()))
                    .collect();
                if unique.is_empty() {
                    None
                } else {
                    Some(unique.join(" / "))
                }
            },
        }
    }
}

impl From<CoverArt> for MbCoverArtImage {
    fn from(ca: CoverArt) -> Self {
        Self {
            id: ca.id,
            image_url: ca.image_url,
            thumbnails: ca.thumbnails.map(MbCoverArtThumbnails::from),
            types: ca.types,
            front: ca.front,
            back: ca.back,
            comment: ca.comment,
        }
    }
}

impl From<CoverArtThumbnails> for MbCoverArtThumbnails {
    fn from(t: CoverArtThumbnails) -> Self {
        Self {
            small: t.small,
            large: t.large,
            thumb_250: t.thumb_250,
            thumb_500: t.thumb_500,
            thumb_1200: t.thumb_1200,
        }
    }
}

impl From<Medium> for MbMediumDetail {
    fn from(m: Medium) -> Self {
        let track_count = m
            .track_count
            .unwrap_or(m.tracks.as_ref().map(|t| t.len() as u32).unwrap_or(0));
        Self {
            position: m.position,
            title: m.title,
            format: m.format,
            tracks: m
                .tracks
                .unwrap_or_default()
                .into_iter()
                .map(MbTrackDetail::from)
                .collect(),
            track_count,
        }
    }
}

impl From<Track> for MbTrackDetail {
    fn from(t: Track) -> Self {
        let length_ms = t
            .length
            .or_else(|| t.recording.as_ref().and_then(|r| r.length));
        // prefer track-level artist credit, fall back to recording's artist credit
        let artist_credit = t
            .artist_credit
            .or_else(|| t.recording.as_ref().and_then(|r| r.artist_credit.clone()))
            .unwrap_or_default()
            .into_iter()
            .map(MbArtistCreditEntry::from)
            .collect();
        Self {
            position: t.position,
            title: t.title,
            length_ms,
            artist_credit,
        }
    }
}
