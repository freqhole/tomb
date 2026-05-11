//! theaudiodb album-detail job processor (phase 13)
//!
//! one job per album. resolution order:
//!   1. if `mbid` (release-group) provided — `album-mb.php?i={mbid}`
//!   2. else text search via `searchalbum.php?s={artist}&a={album}` (first
//!      result wins)
//!   3. then artist via `artist-mb.php?i={artist_mbid}` if available;
//!      otherwise skip artist enrichment (audiodb has no artist text-search
//!      endpoint we expose right now)
//!
//! results are persisted into `albums.metadata.audiodb.*` via
//! `albums_repo::merge_album_metadata`. errors do NOT flip
//! `mb_lookup_status` — audiodb enrichment is a sideshow. on api failure
//! we still write `AudioDbMetadata { error, fetched_at }` so the ui can
//! surface it.

use crate::config;
use crate::database;
use crate::jobs::models::{Job, JobError};
use crate::music::audiodb::models::{AudioDbAlbum, AudioDbArtist};
use crate::music::audiodb::AudioDbClient;
use crate::music::entities::albums as albums_repo;
use crate::music::entities::albums::metadata::{
    self, AudioDbAlbumSnapshot, AudioDbArtistSnapshot, AudioDbMetadata,
};
use serde_json::Value;
use tracing::{info, warn};

use super::models::{AudioDbAlbumDetailParams, AudioDbAlbumDetailResult};

pub async fn process_audiodb_album_detail_job(job: &Job) -> Result<Option<Value>, JobError> {
    let params: AudioDbAlbumDetailParams =
        serde_json::from_str(&job.parameters).map_err(|e| JobError::ProcessingFailed {
            reason: format!("invalid parameters: {}", e),
        })?;

    let album_id = params.album_id.clone();
    info!(
        "audiodb album-detail starting for album {} mbid={:?} artist_mbid={:?}",
        album_id, params.mbid, params.artist_mbid
    );

    let pool = database::connect()
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("db connect: {}", e),
        })?;

    let row = sqlx::query!(
        r#"SELECT title as "title!", deleted_at FROM albumz WHERE id = ?"#,
        album_id
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| JobError::ProcessingFailed {
        reason: format!("read album: {}", e),
    })?;

    let title = match row {
        Some(r) if r.deleted_at.is_none() => r.title,
        _ => {
            return Err(JobError::ProcessingFailed {
                reason: format!("album {} not found or deleted", album_id),
            });
        }
    };

    let artist_name: Option<String> = sqlx::query_scalar!(
        r#"SELECT art.name FROM artist_albumz aa
           JOIN artistz art ON art.id = aa.artist_id
           WHERE aa.album_id = ?
           LIMIT 1"#,
        album_id
    )
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();

    let cfg = config::get_config();
    let client = match AudioDbClient::new(cfg.audiodb.clone()) {
        Ok(c) => c,
        Err(e) => {
            return Err(JobError::ProcessingFailed {
                reason: format!("audiodb client unavailable: {}", e),
            });
        }
    };

    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let mut snapshot = AudioDbMetadata {
        fetched_at: Some(now),
        ..Default::default()
    };

    // step 1: album lookup — prefer mbid, fall back to text search, then
    // to artist-discography fuzzy match (covers self-titled / quirky punct).
    let mut matched_by = String::from("none");
    // a non-mbid fallback may return the audiodb artist record as a side
    // effect (from search.php). reuse it for step 2 to avoid an extra hit.
    let mut artist_hint_from_search: Option<AudioDbArtist> = None;
    let album_opt: Option<AudioDbAlbum> = if let Some(mbid) = params.mbid.as_deref() {
        let resp = client.album_by_mbid(mbid).await;
        if resp.success {
            if resp.data.as_ref().and_then(|o| o.as_ref()).is_some() {
                matched_by = format!("mbid:{}", mbid);
                resp.data.flatten()
            } else if let Some(artist) = artist_name.as_deref() {
                warn!(
                    "audiodb mbid={} returned no album; falling back to text + discography",
                    mbid
                );
                let r = album_via_text_or_discography(&client, artist, &title).await;
                if let Some(by) = r.matched_by {
                    matched_by = by;
                }
                if let Some(e) = r.error {
                    record_error(&mut snapshot, &e);
                }
                artist_hint_from_search = r.artist;
                r.album
            } else {
                None
            }
        } else {
            warn!("audiodb album_by_mbid failed: {}", resp.message);
            snapshot.error = Some(format!("album_by_mbid: {}", resp.message));
            None
        }
    } else if let Some(artist) = artist_name.as_deref() {
        let r = album_via_text_or_discography(&client, artist, &title).await;
        if let Some(by) = r.matched_by {
            matched_by = by;
        }
        if let Some(e) = r.error {
            record_error(&mut snapshot, &e);
        }
        artist_hint_from_search = r.artist;
        r.album
    } else {
        info!(
            "audiodb: no mbid and no primary artist for album {}; skipping album lookup",
            album_id
        );
        None
    };

    let album_fetched = album_opt.is_some();
    if let Some(a) = album_opt.as_ref() {
        snapshot.album = Some(map_album(a.clone()));
    }

    // step 2: artist lookup. preference order:
    //   1. provided artist_mbid param
    //   2. mbid carried in the album result
    //   3. artist hint already collected during the album fallback
    //      (saves a round-trip — `search.php` already returned the record)
    //   4. nothing — skip artist enrichment
    let artist_mbid_for_lookup: Option<String> = params.artist_mbid.clone().or_else(|| {
        album_opt
            .as_ref()
            .and_then(|a| a.musicbrainz_artist_id.clone())
    });
    let artist_fetched = if let Some(amid) = artist_mbid_for_lookup.as_deref() {
        let resp = client.artist_by_mbid(amid).await;
        if resp.success {
            if let Some(Some(a)) = resp.data.map(Some) {
                if let Some(actual) = a {
                    snapshot.artist = Some(map_artist(actual));
                    true
                } else {
                    false
                }
            } else {
                false
            }
        } else {
            warn!("audiodb artist_by_mbid failed: {}", resp.message);
            record_error(&mut snapshot, &format!("artist_by_mbid: {}", resp.message));
            false
        }
    } else if let Some(hint) = artist_hint_from_search {
        snapshot.artist = Some(map_artist(hint));
        true
    } else {
        info!(
            "audiodb: no artist mbid for album {}; skipping artist lookup",
            album_id
        );
        false
    };

    // persist snapshot (always — even on miss/error, so the ui can surface it)
    let patch = metadata::patch_audiodb(&snapshot);
    let merge_resp = albums_repo::merge_album_metadata(&album_id, &patch).await;
    if !merge_resp.success {
        return Err(JobError::ProcessingFailed {
            reason: format!("metadata merge failed: {}", merge_resp.message),
        });
    }

    info!(
        "audiodb album-detail complete for {}: album={} artist={} matched_by={}",
        album_id, album_fetched, artist_fetched, matched_by
    );

    let result = AudioDbAlbumDetailResult {
        album_id: album_id.clone(),
        album_fetched,
        artist_fetched,
        matched_by,
    };

    Ok(Some(serde_json::to_value(result).map_err(|e| {
        JobError::ProcessingFailed {
            reason: format!("serialize result: {}", e),
        }
    })?))
}

fn map_album(a: AudioDbAlbum) -> AudioDbAlbumSnapshot {
    AudioDbAlbumSnapshot {
        id_album: a.id_album,
        id_artist: a.id_artist,
        title: a.title,
        artist: a.artist,
        year_released: a.year_released,
        genre: a.genre,
        subgenre: a.subgenre,
        style: a.style,
        mood: a.mood,
        theme: a.theme,
        speed: a.speed,
        label: a.label,
        score: a.score,
        score_votes: a.score_votes,
        description_en: a.description_en,
        album_thumb: a.album_thumb,
        album_thumb_hq: a.album_thumb_hq,
        album_thumb_back: a.album_thumb_back,
        album_cdart: a.album_cdart,
        album_spine: a.album_spine,
        album_3d_case: a.album_3d_case,
        musicbrainz_release_group_id: a.musicbrainz_release_group_id,
        musicbrainz_artist_id: a.musicbrainz_artist_id,
    }
}

fn map_artist(a: AudioDbArtist) -> AudioDbArtistSnapshot {
    AudioDbArtistSnapshot {
        id_artist: a.id_artist,
        name: a.name,
        genre: a.genre,
        style: a.style,
        mood: a.mood,
        biography_en: a.biography_en,
        country: a.country,
        formed_year: a.formed_year,
        artist_thumb: a.artist_thumb,
        artist_fanart: a.artist_fanart,
        musicbrainz_artist_id: a.musicbrainz_artist_id,
    }
}

/// outcome of the text+discography album fallback. carries an artist
/// record back to the caller when `search.php` resolved one — that lets
/// us skip a redundant `artist-mb.php` round-trip later.
struct AlbumFallback {
    album: Option<AudioDbAlbum>,
    artist: Option<AudioDbArtist>,
    matched_by: Option<String>,
    error: Option<String>,
}

/// fallback chain for album lookup when no mbid match is available:
///   1. `searchalbum.php?s={artist}&a={album}` — strict text search
///   2. `search.php?s={artist}` → `album.php?i={idArtist}` — fuzzy match
///      the title locally against the artist's full discography
///
/// step 2 catches self-titled albums (where audiodb sometimes stores the
/// album as the artist name with edge whitespace), albums with quirky
/// punctuation, and the "(deluxe)" / "(remastered)" variants.
async fn album_via_text_or_discography(
    client: &crate::music::audiodb::AudioDbClient,
    artist: &str,
    title: &str,
) -> AlbumFallback {
    // step 1: strict text search
    let s = client.search_album(artist, title).await;
    if !s.success {
        return AlbumFallback {
            album: None,
            artist: None,
            matched_by: None,
            error: Some(format!("search_album: {}", s.message)),
        };
    }
    if let Some(first) = s.data.and_then(|v| v.into_iter().next()) {
        return AlbumFallback {
            album: Some(first),
            artist: None,
            matched_by: Some(format!("search:{}/{}", artist, title)),
            error: None,
        };
    }

    // step 2: search artist, then fuzzy-match in their discography
    let ar = client.search_artist(artist).await;
    if !ar.success {
        return AlbumFallback {
            album: None,
            artist: None,
            matched_by: None,
            error: Some(format!("search_artist: {}", ar.message)),
        };
    }
    let artist_record = match ar.data.flatten() {
        Some(a) => a,
        None => {
            info!(
                "audiodb fallback: no artist match for {:?} — giving up",
                artist
            );
            return AlbumFallback {
                album: None,
                artist: None,
                matched_by: None,
                error: None,
            };
        }
    };
    let artist_id = match artist_record.id_artist.clone() {
        Some(id) => id,
        None => {
            return AlbumFallback {
                album: None,
                artist: Some(artist_record),
                matched_by: None,
                error: None,
            };
        }
    };

    let disc = client.albums_by_artist_id(&artist_id).await;
    if !disc.success {
        return AlbumFallback {
            album: None,
            artist: Some(artist_record),
            matched_by: None,
            error: Some(format!("albums_by_artist_id: {}", disc.message)),
        };
    }
    let albums = disc.data.unwrap_or_default();
    if albums.is_empty() {
        info!(
            "audiodb fallback: artist {:?} has empty discography",
            artist
        );
        return AlbumFallback {
            album: None,
            artist: Some(artist_record),
            matched_by: None,
            error: None,
        };
    }

    let want = normalize_album_title(title);
    let mut best: Option<(AudioDbAlbum, &'static str)> = None;
    for a in albums.into_iter() {
        let cand = match a.title.as_deref() {
            Some(t) => normalize_album_title(t),
            None => continue,
        };
        if cand == want {
            best = Some((a, "exact"));
            break;
        }
        if best.is_none() && (cand.starts_with(&want) || want.starts_with(&cand)) {
            best = Some((a, "prefix"));
        }
    }

    match best {
        Some((album, how)) => {
            info!("audiodb fallback: discography match ({})", how);
            AlbumFallback {
                album: Some(album),
                artist: Some(artist_record),
                matched_by: Some(format!("discography:{}/{}", artist, title)),
                error: None,
            }
        }
        None => {
            info!(
                "audiodb fallback: no discography title match for {:?}",
                title
            );
            AlbumFallback {
                album: None,
                artist: Some(artist_record),
                matched_by: None,
                error: None,
            }
        }
    }
}

/// loose normalization for comparing album titles across sources: lowercase,
/// strip parenthesized suffixes ("(deluxe)", "(remastered 2020)"), drop
/// non-alphanumerics, collapse whitespace.
fn normalize_album_title(s: &str) -> String {
    let lower = s.to_lowercase();
    // strip a single trailing parenthesized chunk
    let trimmed = if let Some(idx) = lower.rfind(" (") {
        if lower.ends_with(')') {
            &lower[..idx]
        } else {
            &lower
        }
    } else {
        &lower
    };
    let mut out = String::with_capacity(trimmed.len());
    let mut last_space = false;
    for c in trimmed.chars() {
        if c.is_alphanumeric() {
            out.push(c);
            last_space = false;
        } else if c.is_whitespace() {
            if !last_space && !out.is_empty() {
                out.push(' ');
                last_space = true;
            }
        }
    }
    out.trim().to_string()
}

/// append `msg` to `snapshot.error`, separated by `; ` if there's already
/// an error recorded.
fn record_error(snapshot: &mut AudioDbMetadata, msg: &str) {
    let prev = snapshot.error.take().unwrap_or_default();
    snapshot.error = Some(if prev.is_empty() {
        msg.to_string()
    } else {
        format!("{}; {}", prev, msg)
    });
}
