//! theaudiodb artist-detail job processor (phase 13h)
//!
//! one job per artist. resolution order:
//!   1. if `mbid` provided — `artist-mb.php?i={mbid}` direct lookup
//!   2. else `search.php?s={artist}` text fallback
//!
//! persists the result into `artistz.metadata.audiodb.*` via
//! `artists_repo::merge_artist_metadata`. audiodb does not currently
//! expose a related-artists endpoint we ingest here — see the lastfm
//! companion for the related-rows path.
//!
//! errors do NOT fail-loud: we still write a snapshot with `error` set
//! so the ui can surface what went wrong, and we return Ok with a
//! result envelope. only structural failures (db, parameter parse,
//! audiodb client init) bubble up as `JobError`.

use crate::config;
use crate::database;
use crate::jobs::models::{Job, JobError};
use crate::music::audiodb::models::AudioDbArtist;
use crate::music::audiodb::AudioDbClient;
use crate::music::entities::albums::metadata::AudioDbArtistSnapshot;
use crate::music::entities::artists as artists_repo;
use crate::music::entities::artists::ArtistAudioDbMetadata;
use serde_json::{json, Value};
use tracing::{info, warn};

use super::models::{AudioDbArtistDetailParams, AudioDbArtistDetailResult};

pub async fn process_audiodb_artist_detail_job(job: &Job) -> Result<Option<Value>, JobError> {
    let params: AudioDbArtistDetailParams =
        serde_json::from_str(&job.parameters).map_err(|e| JobError::ProcessingFailed {
            reason: format!("invalid parameters: {}", e),
        })?;

    let artist_id = params.artist_id.clone();
    info!(
        "audiodb artist-detail starting for artist {} mbid={:?}",
        artist_id, params.mbid
    );

    let pool = database::connect()
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("db connect: {}", e),
        })?;

    let row = sqlx::query!(
        r#"SELECT name as "name!", deleted_at FROM artistz WHERE id = ?"#,
        artist_id
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| JobError::ProcessingFailed {
        reason: format!("read artist: {}", e),
    })?;

    let name = match row {
        Some(r) if r.deleted_at.is_none() => r.name,
        _ => {
            return Err(JobError::ProcessingFailed {
                reason: format!("artist {} not found or deleted", artist_id),
            });
        }
    };
    let name = params.artist_override.clone().unwrap_or(name);

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
    let mut snapshot = ArtistAudioDbMetadata {
        fetched_at: Some(now),
        ..Default::default()
    };

    let mut matched_by = String::from("none");
    let artist_opt: Option<AudioDbArtist> = if let Some(mbid) = params.mbid.as_deref() {
        crate::jobs::rate_limit::acquire(crate::jobs::rate_limit::Source::Audiodb).await;
        let resp = client.artist_by_mbid(mbid).await;
        if resp.success {
            if let Some(Some(a)) = resp.data.map(Some) {
                if let Some(actual) = a {
                    matched_by = format!("mbid:{}", mbid);
                    Some(actual)
                } else {
                    // mbid lookup returned empty; fall through to text
                    fallback_text(&client, &name, &mut snapshot, &mut matched_by).await
                }
            } else {
                fallback_text(&client, &name, &mut snapshot, &mut matched_by).await
            }
        } else {
            warn!("audiodb artist_by_mbid failed: {}", resp.message);
            snapshot.error = Some(format!("artist_by_mbid: {}", resp.message));
            None
        }
    } else {
        fallback_text(&client, &name, &mut snapshot, &mut matched_by).await
    };

    let artist_fetched = artist_opt.is_some();
    if let Some(a) = artist_opt {
        snapshot.artist = Some(map_artist(a));
    }

    let patch = json!({ "audiodb": snapshot });
    let merge_resp = artists_repo::merge_artist_metadata(&artist_id, &patch).await;
    if !merge_resp.success {
        return Err(JobError::ProcessingFailed {
            reason: format!("artist metadata merge failed: {}", merge_resp.message),
        });
    }

    info!(
        "audiodb artist-detail complete for {}: fetched={} matched_by={}",
        artist_id, artist_fetched, matched_by
    );

    let result = AudioDbArtistDetailResult {
        artist_id,
        artist_fetched,
        matched_by,
    };

    Ok(Some(serde_json::to_value(result).map_err(|e| {
        JobError::ProcessingFailed {
            reason: format!("serialize result: {}", e),
        }
    })?))
}

async fn fallback_text(
    client: &AudioDbClient,
    name: &str,
    snapshot: &mut ArtistAudioDbMetadata,
    matched_by: &mut String,
) -> Option<AudioDbArtist> {
    if name.trim().is_empty() {
        return None;
    }
    crate::jobs::rate_limit::acquire(crate::jobs::rate_limit::Source::Audiodb).await;
    let resp = client.search_artist(name).await;
    if !resp.success {
        warn!("audiodb search_artist failed: {}", resp.message);
        let prev = snapshot.error.take().unwrap_or_default();
        let msg = if prev.is_empty() {
            format!("search_artist: {}", resp.message)
        } else {
            format!("{}; search_artist: {}", prev, resp.message)
        };
        snapshot.error = Some(msg);
        return None;
    }
    match resp.data.flatten() {
        Some(a) => {
            *matched_by = format!("search:{}", name);
            Some(a)
        }
        None => None,
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
        label: a.label,
        website: a.website,
        facebook: a.facebook,
        twitter: a.twitter,
        born_year: a.born_year,
        died_year: a.died_year,
        disbanded: a.disbanded,
        members: a.members,
        gender: a.gender,
        country_code: a.country_code,
        artist_logo: a.artist_logo,
        artist_cutout: a.artist_cutout,
        artist_clearart: a.artist_clearart,
        artist_wide_thumb: a.artist_wide_thumb,
        artist_fanart_2: a.artist_fanart_2,
        artist_fanart_3: a.artist_fanart_3,
        artist_fanart_4: a.artist_fanart_4,
        artist_banner: a.artist_banner,
        charted: a.charted,
    }
}
