//! auto-apply enrichment processor.
//!
//! scheduled by `albums::repository::auto_confirm_mb_matches`. one job
//! per auto-confirmed album. waits for the upstream mb/lastfm/audiodb
//! detail jobs to write their snapshots, then auto-accepts every
//! available proposal (taxons, entity urls, artist bio, related
//! artists) and ingests every album + artist remote image candidate
//! that the wizard would surface. final step flips the album from
//! `auto_applying` to `enriched`.
//!
//! reschedule policy: when the snapshots aren't ready yet (e.g.
//! lastfm/audiodb is rate-limited or the chain hasn't run yet), the
//! processor returns `Ok` with a follow-up job scheduled `RETRY_DELAY_SECS`
//! in the future. capped at `MAX_ATTEMPTS` so a stuck chain doesn't
//! produce an infinite reschedule loop.

use serde_json::{json, Value};
use tracing::{info, warn};

use crate::config;
use crate::database;
use crate::jobs::models::{Job, JobError};
use crate::jobs::{create_job, CreateJobRequest, JobType};
use crate::music::entities::albums::{
    self as albums_repo,
    external_url_proposals::{
        apply_external_urls, propose_external_urls, AcceptedExternalUrl, ApplyExternalUrlsRequest,
        ProposeExternalUrlsRequest,
    },
    metadata::MbLookupStatus,
    taxon_proposals::{
        apply_taxon_proposals, propose_taxons_for_album, AcceptedProposal,
        ApplyTaxonProposalsRequest,
    },
};
use crate::music::entities::artists::{
    bio_proposals::{
        apply_artist_bio, propose_artist_bios, ApplyArtistBioRequest, BioSource,
        ProposeArtistBiosRequest,
    },
    related_proposals::{
        apply_related_artists, propose_related_artists, ApplyRelatedArtistsRequest,
        ProposeRelatedArtistsRequest,
    },
};
use crate::offal::music::albums::{
    ingest_remote_image_inner, ImageIngestTarget, IngestRemoteImageRequest,
};

use super::models::{AutoApplyAlbumEnrichmentParams, AutoApplyAlbumEnrichmentResult};

/// how long to wait before retrying when upstream snapshots aren't
/// ready yet. picked to match the pipeline's typical chain latency
/// (mb-detail ~ a few s, lastfm/audiodb each rate-limited 1qps).
const RETRY_DELAY_SECS: i64 = 30;

/// cap retries so a permanently-stuck chain (api outage, missing
/// credentials surfaced after enable was flipped on) doesn't reschedule
/// forever. 20 * 30s = 10min.
const MAX_ATTEMPTS: u32 = 20;

/// snapshot is "fresh enough" if it was written within the last
/// 24h. (the user just clicked auto-confirm, so anything older
/// indicates the chain didn't run for that source — it's not coming.)
const FRESHNESS_WINDOW_SECS: i64 = 24 * 60 * 60;

pub async fn process_auto_apply_album_enrichment_job(job: &Job) -> Result<Option<Value>, JobError> {
    let mut params: AutoApplyAlbumEnrichmentParams = serde_json::from_str(&job.parameters)
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("invalid parameters: {}", e),
        })?;

    let album_id = params.album_id.clone();
    let user_id = params.user_id.clone();
    let username = params.username.clone().unwrap_or_else(|| user_id.clone());
    info!(
        "auto-apply starting album={} attempt={}",
        album_id, params.attempts
    );

    // read album metadata once — reused for both the optional
    // auto-confirm step below and the snapshot freshness check.
    let meta = match albums_repo::read_album_metadata(&album_id).await.data {
        Some(m) => m,
        None => {
            return Err(JobError::ProcessingFailed {
                reason: format!("album {} metadata read failed", album_id),
            });
        }
    };

    // optional: auto-confirm the top mb candidate when the album is
    // still awaiting a decision and the caller requested it.
    if params.auto_confirm_top_match {
        let album_resp = albums_repo::get_album(&album_id).await;
        let status = album_resp
            .data
            .as_ref()
            .and_then(|a| MbLookupStatus::parse_opt(a.mb_lookup_status.as_deref()))
            .unwrap_or(MbLookupStatus::NotAttempted);

        match status {
            MbLookupStatus::Candidates | MbLookupStatus::NeedsReview => {
                let mut cands: Vec<_> = meta
                    .musicbrainz
                    .as_ref()
                    .map(|mb| mb.candidates.iter().collect::<Vec<_>>())
                    .unwrap_or_default();

                if cands.is_empty() {
                    return Ok(Some(json!({
                        "album_id": album_id,
                        "final_status": "skipped_no_candidates",
                    })));
                }

                cands.sort_by(|a, b| {
                    b.local_confidence
                        .unwrap_or(0.0)
                        .partial_cmp(&a.local_confidence.unwrap_or(0.0))
                        .unwrap_or(std::cmp::Ordering::Equal)
                });

                let mc = params.min_confidence.unwrap_or(0.85);
                let mg = params.min_gap.unwrap_or(0.10);
                let top = cands[0];
                let top_conf = top.local_confidence.unwrap_or(0.0);
                let second_conf = cands.get(1).and_then(|c| c.local_confidence).unwrap_or(0.0);

                if top_conf < mc || (top_conf - second_conf) < mg {
                    return Ok(Some(json!({
                        "album_id": album_id,
                        "final_status": "skipped_low_confidence",
                    })));
                }

                let confirm_resp = albums_repo::confirm_mb_match(
                    &album_id,
                    &top.release_group_id,
                    top.release_id.as_deref(),
                    &user_id,
                )
                .await;
                if confirm_resp.data.is_none() {
                    return Err(JobError::ProcessingFailed {
                        reason: format!(
                            "confirm_mb_match failed for {}: {}",
                            album_id, confirm_resp.message
                        ),
                    });
                }

                let _ = albums_repo::update_mb_lookup_status(
                    &album_id,
                    MbLookupStatus::AutoApplying,
                    Some(&user_id),
                )
                .await;

                // unset so rescheduled jobs don't re-run the confirm step.
                params.auto_confirm_top_match = false;
            }
            _ => {
                // status is already past candidates/needs_review;
                // skip the confirm step and fall through to the apply flow.
            }
        }
    }

    // step 1: are upstream snapshots ready?
    let cfg = config::get_config();
    let lastfm_enabled =
        cfg.lastfm.enabled && crate::music::lastfm::lastfm_is_configured(&cfg.lastfm);
    let audiodb_enabled = cfg.audiodb.enabled;

    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let mb_ready = meta
        .folksonomy
        .as_ref()
        .and_then(|f| f.musicbrainz.as_ref())
        .and_then(|mb| mb.fetched_at)
        .map(|t| now - t < FRESHNESS_WINDOW_SECS)
        .unwrap_or(false);
    let lastfm_ready = if lastfm_enabled {
        meta.lastfm
            .as_ref()
            .and_then(|lf| lf.fetched_at)
            .map(|t| now - t < FRESHNESS_WINDOW_SECS)
            .unwrap_or(false)
    } else {
        true
    };
    let audiodb_ready = if audiodb_enabled {
        meta.audiodb
            .as_ref()
            .and_then(|ad| ad.fetched_at)
            .map(|t| now - t < FRESHNESS_WINDOW_SECS)
            .unwrap_or(false)
    } else {
        true
    };

    if !(mb_ready && lastfm_ready && audiodb_ready) {
        if params.attempts + 1 >= MAX_ATTEMPTS {
            warn!(
                "auto-apply album={} bailing after {} attempts (mb_ready={} lastfm_ready={} audiodb_ready={})",
                album_id, params.attempts, mb_ready, lastfm_ready, audiodb_ready
            );
            // proceed anyway with whatever we have rather than leave the
            // row stuck in `auto_applying` forever.
        } else {
            params.attempts += 1;
            let parameters =
                serde_json::to_value(&params).map_err(|e| JobError::ProcessingFailed {
                    reason: format!("serialize reschedule params: {}", e),
                })?;
            let resp = create_job(CreateJobRequest {
                job_type: JobType::AutoApplyAlbumEnrichment,
                session_id: job.session_id.clone(),
                parameters,
                max_retries: Some(2),
                scheduled_at: Some(now + RETRY_DELAY_SECS),
                created_by: job.created_by.clone(),
                priority: None,
            })
            .await;
            if !resp.success {
                warn!(
                    "auto-apply reschedule create_job failed for {}: {}",
                    album_id, resp.message
                );
            }
            info!(
                "auto-apply album={} rescheduled (attempt {}, mb_ready={} lastfm_ready={} audiodb_ready={})",
                album_id, params.attempts, mb_ready, lastfm_ready, audiodb_ready
            );
            return Ok(Some(json!({
                "album_id": album_id,
                "rescheduled": true,
                "attempts": params.attempts,
            })));
        }
    }

    // step 2: apply every taxon proposal that isn't already linked.
    let mut taxons_applied: u32 = 0;
    let taxon_resp = propose_taxons_for_album(&album_id).await;
    if let Some(props) = taxon_resp.data {
        let accepted: Vec<AcceptedProposal> = props
            .into_iter()
            .filter(|p| !p.already_linked && !p.label.trim().is_empty())
            .map(|p| {
                let source = p.sources.first().copied().unwrap_or_else(|| {
                    // proposal must have at least one source by
                    // construction; fall back to mb arbitrarily.
                    crate::music::entities::albums::taxon_proposals::ProposalSource::Mb
                });
                AcceptedProposal {
                    kind_slug: p.kind_slug,
                    label: p.label,
                    source,
                    confidence: None,
                }
            })
            .collect();
        if !accepted.is_empty() {
            let req = ApplyTaxonProposalsRequest {
                album_id: album_id.clone(),
                accepted,
            };
            let apply = apply_taxon_proposals(req).await;
            if let Some(r) = apply.data {
                taxons_applied = r.linked;
            } else {
                warn!(
                    "auto-apply taxons failed for {}: {}",
                    album_id, apply.message
                );
            }
        }
    } else {
        warn!(
            "auto-apply propose_taxons failed for {}: {}",
            album_id, taxon_resp.message
        );
    }

    // step 3: apply every external-url proposal.
    let mut urls_applied: u32 = 0;
    let url_resp = propose_external_urls(ProposeExternalUrlsRequest {
        album_id: album_id.clone(),
    })
    .await;
    let resolved_artist_id = url_resp.data.as_ref().and_then(|r| r.artist_id.clone());
    if let Some(r) = url_resp.data {
        let accept: Vec<AcceptedExternalUrl> = r
            .proposals
            .into_iter()
            .map(|p| AcceptedExternalUrl {
                entity_type: p.entity_type,
                entity_id: p.entity_id,
                name: Some(p.name),
                url: p.url,
            })
            .collect();
        if !accept.is_empty() {
            let apply =
                apply_external_urls(ApplyExternalUrlsRequest { accept }, Some(&user_id)).await;
            if let Some(res) = apply.data {
                urls_applied = res.inserted as u32;
            } else {
                warn!("auto-apply urls failed for {}: {}", album_id, apply.message);
            }
        }
    } else {
        warn!(
            "auto-apply propose_urls failed for {}: {}",
            album_id, url_resp.message
        );
    }

    // step 4: artist bio. prefer user > lastfm > audiodb (matches the
    // wizard's default selection logic). only writes if a non-empty
    // proposal exists and it's not already current.
    let mut bio_applied = false;
    let bio_resp = propose_artist_bios(ProposeArtistBiosRequest {
        artist_id: None,
        album_id: Some(album_id.clone()),
    })
    .await;
    if let Some(r) = bio_resp.data {
        let pick = r
            .proposals
            .iter()
            .find(|p| matches!(p.source, BioSource::User) && !p.text.trim().is_empty())
            .or_else(|| {
                r.proposals
                    .iter()
                    .find(|p| matches!(p.source, BioSource::Lastfm) && !p.text.trim().is_empty())
            })
            .or_else(|| {
                r.proposals
                    .iter()
                    .find(|p| matches!(p.source, BioSource::Audiodb) && !p.text.trim().is_empty())
            })
            .cloned();
        if let Some(p) = pick {
            if !p.is_current {
                let apply = apply_artist_bio(ApplyArtistBioRequest {
                    artist_id: r.artist_id.clone(),
                    source: p.source,
                    text: p.text,
                })
                .await;
                if apply.success {
                    bio_applied = true;
                } else {
                    warn!(
                        "auto-apply bio failed for {}: {}",
                        r.artist_id, apply.message
                    );
                }
            }
        }
    } else {
        warn!(
            "auto-apply propose_bios failed for {}: {}",
            album_id, bio_resp.message
        );
    }

    // step 5: accept every pending related-artist row.
    let mut related_applied: u32 = 0;
    let related_resp = propose_related_artists(ProposeRelatedArtistsRequest {
        artist_id: None,
        album_id: Some(album_id.clone()),
    })
    .await;
    if let Some(r) = related_resp.data {
        let accept_ids: Vec<String> = r.proposals.into_iter().map(|p| p.id).collect();
        if !accept_ids.is_empty() {
            let apply = apply_related_artists(ApplyRelatedArtistsRequest {
                artist_id: r.artist_id.clone(),
                accept_ids,
                reject_ids: Vec::new(),
            })
            .await;
            if let Some(res) = apply.data {
                related_applied = res.accepted as u32;
            } else {
                warn!(
                    "auto-apply related failed for {}: {}",
                    r.artist_id, apply.message
                );
            }
        }
    } else {
        warn!(
            "auto-apply propose_related failed for {}: {}",
            album_id, related_resp.message
        );
    }

    // step 6: ingest every album image candidate.
    let mut album_images_ingested: u32 = 0;
    let album_imgs_existing = albums_repo::get_album_images(&album_id)
        .await
        .data
        .unwrap_or_default()
        .len() as u32;
    let album_candidates = collect_album_image_candidates(&meta);
    let mut album_link_count = album_imgs_existing;
    for url in album_candidates {
        let req = IngestRemoteImageRequest {
            remote_url: url.url,
            target: ImageIngestTarget::Album(album_id.clone()),
            is_primary: album_link_count == 0,
            source: Some(url.source),
        };
        let resp = ingest_remote_image_inner(req, &user_id, &username).await;
        if resp.success {
            album_images_ingested += 1;
            album_link_count += 1;
        } else {
            warn!(
                "auto-apply album image ingest failed for {}: {}",
                album_id, resp.message
            );
        }
    }

    // step 7: ingest every artist image candidate (for the album's
    // primary artist as resolved during the urls step; falls back to
    // an explicit lookup when the urls step couldn't resolve one).
    let mut artist_images_ingested: u32 = 0;
    let artist_id_for_images = match resolved_artist_id {
        Some(id) => Some(id),
        None => primary_artist_for_album(&album_id).await,
    };
    if let Some(artist_id) = artist_id_for_images.clone() {
        let artist_meta_raw =
            sqlx::query_scalar!("SELECT metadata FROM artistz WHERE id = ?", artist_id)
                .fetch_optional(&database::connect().await.map_err(|e| {
                    JobError::ProcessingFailed {
                        reason: format!("db connect: {}", e),
                    }
                })?)
                .await
                .ok()
                .flatten()
                .flatten();
        let artist_meta =
            crate::music::entities::artists::ArtistMetadata::parse(artist_meta_raw.as_deref());
        let artist_imgs_existing = crate::music::entities::artists::get_artist_images(&artist_id)
            .await
            .data
            .unwrap_or_default()
            .len() as u32;
        let mut artist_link_count = artist_imgs_existing;
        for url in collect_artist_image_candidates(&artist_meta) {
            let req = IngestRemoteImageRequest {
                remote_url: url.url,
                target: ImageIngestTarget::Artist(artist_id.clone()),
                is_primary: artist_link_count == 0,
                source: Some(url.source),
            };
            let resp = ingest_remote_image_inner(req, &user_id, &username).await;
            if resp.success {
                artist_images_ingested += 1;
                artist_link_count += 1;
            } else {
                warn!(
                    "auto-apply artist image ingest failed for {}: {}",
                    artist_id, resp.message
                );
            }
        }
    }

    // step 8: flip status to enriched.
    let final_status = MbLookupStatus::Enriched;
    let _ = albums_repo::update_mb_lookup_status(&album_id, final_status, Some(&user_id)).await;

    info!(
        "auto-apply album={} done: taxons={} urls={} bio={} related={} album_imgs={} artist_imgs={}",
        album_id,
        taxons_applied,
        urls_applied,
        bio_applied,
        related_applied,
        album_images_ingested,
        artist_images_ingested
    );

    let result = AutoApplyAlbumEnrichmentResult {
        album_id,
        taxons_applied,
        urls_applied,
        bio_applied,
        related_applied,
        album_images_ingested,
        artist_images_ingested,
        final_status: final_status.as_str().to_string(),
    };
    Ok(Some(serde_json::to_value(result).map_err(|e| {
        JobError::ProcessingFailed {
            reason: format!("serialize result: {}", e),
        }
    })?))
}

/// shape of one image candidate (kind not needed by the auto-apply
/// path, only `url + source` for blob metadata + dedup attribution).
struct ImageCandidate {
    url: String,
    source: String,
}

/// mirror of `offal::music::albums::image_candidates_for_album` but
/// returning the trimmed set we actually need for ingest. read-only.
fn collect_album_image_candidates(
    meta: &crate::music::entities::albums::metadata::AlbumMetadata,
) -> Vec<ImageCandidate> {
    let mut out: Vec<ImageCandidate> = Vec::new();

    if let Some(ad) = meta.audiodb.as_ref() {
        if let Some(album) = ad.album.as_ref() {
            for url in [
                album.album_thumb_hq.as_ref(),
                album.album_thumb.as_ref(),
                album.album_thumb_back.as_ref(),
                album.album_cdart.as_ref(),
                album.album_spine.as_ref(),
                album.album_3d_case.as_ref(),
            ]
            .into_iter()
            .flatten()
            {
                push_http(&mut out, url, "audiodb");
            }
        }
    }

    if let Some(mb) = meta.musicbrainz.as_ref() {
        if let Some(rid) = mb.release_id.as_ref() {
            let r = rid.trim();
            if !r.is_empty() {
                out.push(ImageCandidate {
                    url: format!("https://coverartarchive.org/release/{}/front", r),
                    source: "musicbrainz".to_string(),
                });
                out.push(ImageCandidate {
                    url: format!("https://coverartarchive.org/release/{}/back", r),
                    source: "musicbrainz".to_string(),
                });
            }
        }
    }

    out
}

/// mirror of `offal::music::artists::image_candidates`. audiodb-only
/// today (mb has no per-artist images and lastfm's artist images are
/// long-since defunct).
fn collect_artist_image_candidates(
    meta: &crate::music::entities::artists::ArtistMetadata,
) -> Vec<ImageCandidate> {
    let mut out: Vec<ImageCandidate> = Vec::new();
    if let Some(ad) = meta.audiodb.as_ref() {
        if let Some(artist) = ad.artist.as_ref() {
            for url in [
                artist.artist_thumb.as_ref(),
                artist.artist_fanart.as_ref(),
                artist.artist_fanart_2.as_ref(),
                artist.artist_fanart_3.as_ref(),
                artist.artist_fanart_4.as_ref(),
            ]
            .into_iter()
            .flatten()
            {
                push_http(&mut out, url, "audiodb");
            }
        }
    }
    out
}

fn push_http(out: &mut Vec<ImageCandidate>, raw: &String, source: &str) {
    let trimmed = raw.trim();
    if !trimmed.is_empty() && (trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        out.push(ImageCandidate {
            url: trimmed.to_string(),
            source: source.to_string(),
        });
    }
}

async fn primary_artist_for_album(album_id: &str) -> Option<String> {
    let pool = database::connect().await.ok()?;
    sqlx::query_scalar!(
        r#"SELECT artist_songz.artist_id as "artist_id!"
           FROM album_songz
           JOIN artist_songz ON artist_songz.song_id = album_songz.song_id
           WHERE album_songz.album_id = ?
           LIMIT 1"#,
        album_id
    )
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten()
}
