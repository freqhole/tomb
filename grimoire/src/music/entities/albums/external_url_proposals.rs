//! external-url proposals (phase 11.x).
//!
//! mines already-stored enrichment snapshots for external links and
//! offers them up for ingestion into `entity_urlz`. one entry point per
//! album request — resolves the album's primary artist via
//! `album_songz JOIN artist_songz LIMIT 1` so a single review pass can
//! offer URLs for both the album AND its artist in one shot.
//!
//! sources currently mined:
//! - album: `metadata.musicbrainz.urls` (every relation_type)
//!          `metadata.lastfm.album.url`
//! - artist: `metadata.musicbrainz.urls` (every relation_type — the
//!           rich set: bandcamp, allmusic, songkick, streaming, etc.)
//!           `metadata.lastfm.artist.url`
//!           `metadata.audiodb.artist.{website, facebook, twitter}`
//!
//! the propose half is read-only against `entity_urlz` (used to filter
//! out URLs we already have on file, case-insensitive). the apply half
//! is a single batched INSERT — accepted proposals just become rows.
//! we do NOT soft-delete or otherwise track rejected proposals: the
//! source snapshots are the durable record, so re-runs offer them
//! again until accepted.

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

use crate::database;
use crate::error::ErrorDetail;
use crate::music::entities::albums::metadata as album_metadata;
use crate::music::entities::artists::ArtistMetadata;
use crate::response::GrimoireResponse;
use tracing::info;

/// one external-url proposal the user can opt-in to ingest.
///
/// `entity_type` is `"album"` or `"artist"` (the only two we surface
/// here; songs/playlists aren't part of the enrichment flow).
/// `source` is a freeform tag (`"musicbrainz" | "lastfm" | "audiodb"`)
/// for ui badges; not persisted into `entity_urlz`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct ExternalUrlProposal {
    pub entity_type: String,
    pub entity_id: String,
    /// the relation kind (e.g. `"bandcamp"`, `"discogs"`, `"website"`,
    /// `"facebook"`, `"twitter"`, `"lastfm"`). stored into the `name`
    /// column of `entity_urlz` on accept.
    pub name: String,
    pub url: String,
    pub source: String,
}

/// request body for `propose_external_urls`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct ProposeExternalUrlsRequest {
    pub album_id: String,
}

/// response wrapper — includes the resolved `artist_id` so callers
/// can attribute the artist-side proposals without a second lookup.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct ProposeExternalUrlsResponse {
    pub album_id: String,
    /// resolved primary artist for the album (none if the album has no
    /// linked songs/artists yet — proposals will only contain album rows).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist_id: Option<String>,
    pub proposals: Vec<ExternalUrlProposal>,
}

/// one row to insert. mirrors `ExternalUrlProposal` but drops the
/// `source` field (it's a ui hint, not persisted).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct AcceptedExternalUrl {
    pub entity_type: String,
    pub entity_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub url: String,
}

/// request body for `apply_external_urls`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct ApplyExternalUrlsRequest {
    #[serde(default)]
    pub accept: Vec<AcceptedExternalUrl>,
}

/// summary returned by `apply_external_urls`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct ApplyExternalUrlsResult {
    pub inserted: u64,
    pub skipped: u64,
}

/// surface external URLs for an album (and its primary artist) from
/// already-stored metadata snapshots. read-only — no external http calls.
pub async fn propose_external_urls(
    req: ProposeExternalUrlsRequest,
) -> GrimoireResponse<ProposeExternalUrlsResponse> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let album_id = req.album_id.trim().to_string();
    if album_id.is_empty() {
        return GrimoireResponse::failure(
            "bad request",
            vec![ErrorDetail::new(
                "bad_request",
                "bad request",
                "album_id is required",
            )],
        );
    }

    // load album metadata snapshot
    let album_meta_raw = match sqlx::query_scalar!(
        r#"SELECT metadata FROM albumz WHERE id = ? AND deleted_at IS NULL"#,
        album_id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(Some(raw)) => raw,
        Ok(None) => {
            return GrimoireResponse::failure(
                "album not found",
                vec![ErrorDetail::new(
                    "not_found",
                    "not found",
                    "album not found",
                )],
            )
        }
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to load album metadata",
                vec![ErrorDetail::from(e)],
            )
        }
    };
    let album_meta = album_metadata::parse(album_meta_raw.as_deref()).unwrap_or_default();

    // resolve primary artist id (may be none if the album has no linked
    // songs yet — uncommon in practice but cheap to handle).
    let artist_id: Option<String> = match sqlx::query_scalar!(
        r#"SELECT artist_songz.artist_id as "artist_id!"
           FROM album_songz
           JOIN artist_songz ON artist_songz.song_id = album_songz.song_id
           WHERE album_songz.album_id = ?
           LIMIT 1"#,
        album_id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(opt) => opt,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to resolve artist for album",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // load artist metadata snapshot if we have an artist
    let artist_meta = if let Some(aid) = artist_id.as_deref() {
        match sqlx::query_scalar!(
            r#"SELECT metadata FROM artistz WHERE id = ? AND deleted_at IS NULL"#,
            aid
        )
        .fetch_optional(&pool)
        .await
        {
            Ok(Some(raw)) => Some(ArtistMetadata::parse(raw.as_deref())),
            Ok(None) => None,
            Err(e) => {
                return GrimoireResponse::failure(
                    "failed to load artist metadata",
                    vec![ErrorDetail::from(e)],
                )
            }
        }
    } else {
        None
    };

    // diagnostics: log what's actually present in the snapshots so we
    // can tell whether missing url proposals are an upstream
    // (enrichment never ran / never persisted) vs downstream
    // (proposal pipeline filtered them) issue.
    let album_mb_url_count = album_meta
        .musicbrainz
        .as_ref()
        .map(|mb| mb.urls.len())
        .unwrap_or(0);
    let artist_mb_url_count = artist_meta
        .as_ref()
        .and_then(|m| m.musicbrainz.as_ref())
        .map(|mb| mb.urls.len())
        .unwrap_or(0);
    let artist_mb_artist_id = artist_meta
        .as_ref()
        .and_then(|m| m.musicbrainz.as_ref())
        .and_then(|mb| mb.artist_id.as_deref())
        .unwrap_or("(none)");
    let artist_mb_error = artist_meta
        .as_ref()
        .and_then(|m| m.musicbrainz.as_ref())
        .and_then(|mb| mb.error.as_deref());
    info!(
        "propose_external_urls album={} artist={:?}: snapshot album.mb.urls={} artist.mb.urls={} artist.mb.artist_id={} artist.mb.error={:?}",
        album_id, artist_id, album_mb_url_count, artist_mb_url_count, artist_mb_artist_id, artist_mb_error
    );

    // collect existing entity_urlz rows for both entities so we can filter
    // out URLs already on file (case-insensitive on url). keyed by
    // (entity_type, url_lower) so an album-side url doesn't block the
    // artist-side proposal of the same href and vice-versa.
    let mut existing_urls: std::collections::HashSet<(String, String)> =
        std::collections::HashSet::new();
    {
        let rows: Vec<String> = match sqlx::query_scalar!(
            r#"SELECT CAST(lower(url) AS TEXT) as "url!: String" FROM entity_urlz
               WHERE entity_type = 'album' AND entity_id = ?"#,
            album_id
        )
        .fetch_all(&pool)
        .await
        {
            Ok(r) => r,
            Err(e) => {
                return GrimoireResponse::failure(
                    "failed to read existing album urls",
                    vec![ErrorDetail::from(e)],
                )
            }
        };
        for u in rows {
            existing_urls.insert(("album".to_string(), u));
        }
    }
    if let Some(aid) = artist_id.as_deref() {
        let rows: Vec<String> = match sqlx::query_scalar!(
            r#"SELECT CAST(lower(url) AS TEXT) as "url!: String" FROM entity_urlz
               WHERE entity_type = 'artist' AND entity_id = ?"#,
            aid
        )
        .fetch_all(&pool)
        .await
        {
            Ok(r) => r,
            Err(e) => {
                return GrimoireResponse::failure(
                    "failed to read existing artist urls",
                    vec![ErrorDetail::from(e)],
                )
            }
        };
        for u in rows {
            existing_urls.insert(("artist".to_string(), u));
        }
    }

    let mut proposals: Vec<ExternalUrlProposal> = Vec::new();
    // dedupe within this proposal pass too — the same MB url often
    // appears on both release + release-group, etc.
    let mut seen: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();
    let push = |proposals: &mut Vec<ExternalUrlProposal>,
                seen: &mut std::collections::HashSet<(String, String)>,
                entity_type: &str,
                entity_id: &str,
                _name_hint: &str,
                url: &str,
                source: &str| {
        // proper url parsing: rejects junk like `https://`, `https://1`,
        // bare numerics, hosts without a tld, etc. (audiodb in
        // particular returns these). also derives a clean domain label
        // (e.g. `apple.com`, `bandcamp.com`) for use as the link name —
        // we no longer rely on mb relation_type strings or hardcoded
        // "website"/"facebook" labels.
        let Some((normalized, label)) = crate::music::crud::parse_external_url(url) else {
            return;
        };
        let url_lower = normalized.to_lowercase();
        if existing_urls.contains(&(entity_type.to_string(), url_lower.clone())) {
            return;
        }
        let key = (entity_type.to_string(), url_lower.clone());
        if !seen.insert(key) {
            return;
        }
        proposals.push(ExternalUrlProposal {
            entity_type: entity_type.to_string(),
            entity_id: entity_id.to_string(),
            name: label,
            url: normalized,
            source: source.to_string(),
        });
    };

    // album: musicbrainz url-rels
    if let Some(mb) = album_meta.musicbrainz.as_ref() {
        for u in &mb.urls {
            push(
                &mut proposals,
                &mut seen,
                "album",
                &album_id,
                &u.relation_type,
                &u.url,
                "musicbrainz",
            );
        }
    }
    // album: last.fm page url
    if let Some(lf) = album_meta.lastfm.as_ref() {
        if let Some(album) = lf.album.as_ref() {
            if let Some(url) = album.url.as_deref() {
                push(
                    &mut proposals,
                    &mut seen,
                    "album",
                    &album_id,
                    "last.fm",
                    url,
                    "lastfm",
                );
            }
        }
    }

    // artist sources (only if we resolved one)
    if let (Some(aid), Some(meta)) = (artist_id.as_deref(), artist_meta.as_ref()) {
        // musicbrainz artist url-rels (the richest source: bandcamp,
        // allmusic, songkick, streaming services, discogs, wikidata,
        // etc.). populated by the mb album-detail job step 5d.
        if let Some(mb) = meta.musicbrainz.as_ref() {
            for u in &mb.urls {
                push(
                    &mut proposals,
                    &mut seen,
                    "artist",
                    aid,
                    &u.relation_type,
                    &u.url,
                    "musicbrainz",
                );
            }
        }
        // last.fm artist page
        if let Some(lf) = meta.lastfm.as_ref() {
            if let Some(artist) = lf.artist.as_ref() {
                if let Some(url) = artist.url.as_deref() {
                    push(
                        &mut proposals,
                        &mut seen,
                        "artist",
                        aid,
                        "last.fm",
                        url,
                        "lastfm",
                    );
                }
            }
        }
        // audiodb artist links
        if let Some(ad) = meta.audiodb.as_ref() {
            if let Some(artist) = ad.artist.as_ref() {
                if let Some(url) = artist.website.as_deref() {
                    push(
                        &mut proposals,
                        &mut seen,
                        "artist",
                        aid,
                        "website",
                        url,
                        "audiodb",
                    );
                }
                if let Some(url) = artist.facebook.as_deref() {
                    push(
                        &mut proposals,
                        &mut seen,
                        "artist",
                        aid,
                        "facebook",
                        url,
                        "audiodb",
                    );
                }
                if let Some(url) = artist.twitter.as_deref() {
                    push(
                        &mut proposals,
                        &mut seen,
                        "artist",
                        aid,
                        "twitter",
                        url,
                        "audiodb",
                    );
                }
            }
        }
    }

    let album_proposed = proposals
        .iter()
        .filter(|p| p.entity_type == "album")
        .count();
    let artist_proposed = proposals
        .iter()
        .filter(|p| p.entity_type == "artist")
        .count();
    info!(
        "propose_external_urls album={} -> {} proposals (album={} artist={}) existing_filtered={}",
        album_id,
        proposals.len(),
        album_proposed,
        artist_proposed,
        existing_urls.len(),
    );

    GrimoireResponse::success(
        "external-url proposals",
        ProposeExternalUrlsResponse {
            album_id,
            artist_id,
            proposals,
        },
    )
}

/// insert accepted external-url proposals into `entity_urlz`. silently
/// dedupes against existing rows (case-insensitive on url within the
/// same entity) so re-clicking apply doesn't produce duplicates.
pub async fn apply_external_urls(
    req: ApplyExternalUrlsRequest,
    created_by: Option<&str>,
) -> GrimoireResponse<ApplyExternalUrlsResult> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    if req.accept.is_empty() {
        return GrimoireResponse::success(
            "nothing to apply",
            ApplyExternalUrlsResult {
                inserted: 0,
                skipped: 0,
            },
        );
    }

    let mut inserted: u64 = 0;
    let mut skipped: u64 = 0;

    let mut tx = match pool.begin().await {
        Ok(t) => t,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to begin transaction",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    for row in &req.accept {
        let entity_type = row.entity_type.trim();
        let entity_id = row.entity_id.trim();
        let url = row.url.trim();
        if entity_type.is_empty() || entity_id.is_empty() || url.is_empty() {
            skipped += 1;
            continue;
        }
        if !matches!(entity_type, "artist" | "album" | "song" | "playlist") {
            skipped += 1;
            continue;
        }
        // dedupe against any existing same-url row for this entity
        // (case-insensitive). prevents a re-run from inserting twice.
        let url_lower = url.to_lowercase();
        let exists: Option<i64> = match sqlx::query_scalar!(
            r#"SELECT 1 as "x!: i64" FROM entity_urlz
               WHERE entity_type = ? AND entity_id = ? AND CAST(lower(url) AS TEXT) = ?
               LIMIT 1"#,
            entity_type,
            entity_id,
            url_lower,
        )
        .fetch_optional(&mut *tx)
        .await
        {
            Ok(o) => o,
            Err(e) => {
                let _ = tx.rollback().await;
                return GrimoireResponse::failure(
                    "failed to check for existing url",
                    vec![ErrorDetail::from(e)],
                );
            }
        };
        if exists.is_some() {
            skipped += 1;
            continue;
        }

        let name = row.name.as_deref();
        match sqlx::query!(
            r#"INSERT INTO entity_urlz (entity_type, entity_id, name, url, created_by)
               VALUES (?, ?, ?, ?, ?)"#,
            entity_type,
            entity_id,
            name,
            url,
            created_by,
        )
        .execute(&mut *tx)
        .await
        {
            Ok(_) => inserted += 1,
            Err(e) => {
                let _ = tx.rollback().await;
                return GrimoireResponse::failure(
                    "failed to insert external url",
                    vec![ErrorDetail::from(e)],
                );
            }
        }
    }

    if let Err(e) = tx.commit().await {
        return GrimoireResponse::failure(
            "failed to commit external-url inserts",
            vec![ErrorDetail::from(e)],
        );
    }

    GrimoireResponse::success(
        "external urls applied",
        ApplyExternalUrlsResult { inserted, skipped },
    )
}
