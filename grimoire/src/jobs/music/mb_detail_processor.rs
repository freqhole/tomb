//! musicbrainz album-detail job processor (phase 8)
//!
//! one job per confirmed album. flow:
//! 1. mark `mb_lookup_status = FetchingDetail`.
//! 2. fetch release-group with `+genres+tags+artist-credits`.
//! 3. if a release_id is present, also fetch the release with
//!    `+genres+tags+...`.
//! 4. map MB `Tag`/`Genre` rows -> `FolksonomyTag` and stuff them into a
//!    single `MbFolksonomy` blob (release_genres / release_tags /
//!    release_group_genres / release_group_tags + fetched_at).
//! 5. merge via `patch_mb_folksonomy` so writes stay centralized.
//! 6. flip status to `Enriched` (or `Error` on failure).
//!
//! heuristics like top-K folksonomy summaries are computed at read time
//! by callers; this processor just persists the raw lists.

use crate::config;
use crate::jobs::models::{Job, JobError};
use crate::music::entities::albums as albums_repo;
use crate::music::entities::albums::metadata::{self, FolksonomyTag, MbFolksonomy, MbLookupStatus};
use crate::music::musicbrainz::models::{Genre, Tag};
use crate::music::musicbrainz::MusicBrainzClient;
use serde_json::Value;
use tracing::info;

use super::models::{MbAlbumDetailParams, MbAlbumDetailResult};

pub async fn process_mb_album_detail_job(job: &Job) -> Result<Option<Value>, JobError> {
    let params: MbAlbumDetailParams =
        serde_json::from_str(&job.parameters).map_err(|e| JobError::ProcessingFailed {
            reason: format!("invalid parameters: {}", e),
        })?;

    let album_id = params.album_id.clone();
    info!(
        "mb album-detail starting for album {} rg={} release={:?}",
        album_id, params.release_group_id, params.release_id
    );

    // step 1: mark fetching (best-effort)
    let _ = albums_repo::update_mb_lookup_status(
        &album_id,
        MbLookupStatus::FetchingDetail,
        job.created_by.as_deref(),
    )
    .await;

    // step 2: build client
    let cfg = config::get_config();
    let client = match MusicBrainzClient::new(cfg.musicbrainz.clone()) {
        Ok(c) => c,
        Err(e) => {
            let _ = albums_repo::update_mb_lookup_status(
                &album_id,
                MbLookupStatus::Error,
                job.created_by.as_deref(),
            )
            .await;
            return Err(JobError::ProcessingFailed {
                reason: format!("musicbrainz client unavailable: {}", e),
            });
        }
    };

    // step 3: fetch release-group
    let rg_resp = client.get_release_group(&params.release_group_id).await;
    if !rg_resp.success {
        let _ = albums_repo::update_mb_lookup_status(
            &album_id,
            MbLookupStatus::Error,
            job.created_by.as_deref(),
        )
        .await;
        return Err(JobError::ProcessingFailed {
            reason: format!("mb release-group fetch failed: {}", rg_resp.message),
        });
    }
    let rg = rg_resp.data.ok_or_else(|| JobError::ProcessingFailed {
        reason: "mb release-group response empty".to_string(),
    })?;

    let release_group_genres = map_genres(rg.genres.as_deref());
    let release_group_tags = map_tags(rg.tags.as_deref());

    // collect official MB genre names from the release-group up front so we
    // can use them later when auto-filling album columns.
    let mut mb_genre_names: Vec<String> = rg
        .genres
        .as_deref()
        .map(|g| g.iter().map(|x| x.name.clone()).collect())
        .unwrap_or_default();
    let rg_first_release_date = rg.first_release_date.clone();

    info!(
        "mb release-group {} title={:?} primary_type={:?} secondary_types={:?} first_release_date={:?} artist_credits={}",
        rg.id,
        rg.title,
        rg.primary_type,
        rg.secondary_types,
        rg.first_release_date,
        format_artist_credits(rg.artist_credit.as_deref()),
    );
    info!(
        "  rg genres ({}): {}",
        release_group_genres.len(),
        format_folksonomy_top(&release_group_genres, 10)
    );
    info!(
        "  rg tags ({}): {}",
        release_group_tags.len(),
        format_folksonomy_top(&release_group_tags, 10)
    );

    // step 4: optionally fetch release
    let mut release_date_for_apply: Option<String> = None;
    let mut release_label_for_apply: Option<String> = None;
    let (release_genres, release_tags) = if let Some(release_id) = params.release_id.as_deref() {
        let r_resp = client.get_release(release_id).await;
        if r_resp.success {
            let r = r_resp.data.unwrap();
            let r_genres = map_genres(r.genres.as_deref());
            let r_tags = map_tags(r.tags.as_deref());
            info!(
                "mb release {} title={:?} status={:?} packaging={:?} country={:?} date={:?} text_repr={:?}",
                r.id,
                r.title,
                r.status,
                r.packaging,
                r.country,
                r.date,
                r.text_representation,
            );
            info!(
                "  release labels: {}",
                format_label_info(r.label_info.as_deref())
            );
            info!("  release media: {}", format_media(r.media.as_deref()));
            info!("  release cover_art: {:?}", r.cover_art_archive);
            info!(
                "  release genres ({}): {}",
                r_genres.len(),
                format_folksonomy_top(&r_genres, 10)
            );
            info!(
                "  release tags ({}): {}",
                r_tags.len(),
                format_folksonomy_top(&r_tags, 10)
            );
            // capture for auto-apply: prefer release.date over rg.first_release_date
            release_date_for_apply = r.date.clone();
            release_label_for_apply = r
                .label_info
                .as_ref()
                .and_then(|li| li.first())
                .and_then(|li| li.label.as_ref())
                .map(|l| l.name.clone());
            // merge release-level genres into the names pool (deduped lowercase)
            if let Some(gs) = r.genres.as_deref() {
                for g in gs {
                    if !mb_genre_names
                        .iter()
                        .any(|n| n.eq_ignore_ascii_case(&g.name))
                    {
                        mb_genre_names.push(g.name.clone());
                    }
                }
            }
            (r_genres, r_tags)
        } else {
            // release fetch failure is non-fatal; we still have release-group
            // data. log and continue.
            info!(
                "mb release fetch failed for {} (continuing with rg-only): {}",
                release_id, r_resp.message
            );
            (Vec::new(), Vec::new())
        }
    } else {
        (Vec::new(), Vec::new())
    };

    let folksonomy = MbFolksonomy {
        release_genres,
        release_tags,
        release_group_genres,
        release_group_tags,
        fetched_at: Some(time::OffsetDateTime::now_utc().unix_timestamp()),
    };

    // mb has no dedicated "mood" field — moods live in the same folksonomy
    // tag pool as everything else. surface them so we can see what's
    // available before deciding whether to extract them into a first-class
    // dimension. matches against a (deliberately-loose) list of common mood
    // tags applied to releases on musicbrainz.
    let mood_hits = collect_mood_hits(&folksonomy);
    if !mood_hits.is_empty() {
        info!(
            "  mood-like tags ({}): {}",
            mood_hits.len(),
            format_folksonomy_top(&mood_hits, mood_hits.len())
        );
    } else {
        info!("  mood-like tags: (none detected)");
    }

    let result_summary = MbAlbumDetailResult {
        album_id: album_id.clone(),
        release_genre_count: folksonomy.release_genres.len() as u64,
        release_tag_count: folksonomy.release_tags.len() as u64,
        release_group_genre_count: folksonomy.release_group_genres.len() as u64,
        release_group_tag_count: folksonomy.release_group_tags.len() as u64,
        final_status: MbLookupStatus::Enriched.as_str().to_string(),
    };

    // step 5: merge folksonomy patch
    let patch = metadata::patch_mb_folksonomy(&folksonomy);
    let merge_resp = albums_repo::merge_album_metadata(&album_id, &patch).await;
    if !merge_resp.success {
        let _ = albums_repo::update_mb_lookup_status(
            &album_id,
            MbLookupStatus::Error,
            job.created_by.as_deref(),
        )
        .await;
        return Err(JobError::ProcessingFailed {
            reason: format!("metadata merge failed: {}", merge_resp.message),
        });
    }

    // step 5b: auto-apply year/label/genres to album columns where currently
    // empty. user-facing convention: never overwrite hand-edited values.
    // never touches title/artist/track-level fields (those need explicit
    // user opt-in via ui).
    let release_date_to_apply = release_date_for_apply.or(rg_first_release_date);
    let apply_summary = apply_mb_album_columns_if_empty(
        &album_id,
        release_date_to_apply.as_deref(),
        release_label_for_apply.as_deref(),
        &mb_genre_names,
    )
    .await;
    info!(
        "mb auto-apply for {}: year={} label={} genres_added={}",
        album_id, apply_summary.year_set, apply_summary.label_set, apply_summary.genres_added
    );

    // step 6: flip status to enriched
    let _ = albums_repo::update_mb_lookup_status(
        &album_id,
        MbLookupStatus::Enriched,
        job.created_by.as_deref(),
    )
    .await;

    info!(
        "mb album-detail complete for {}: rg_genres={} rg_tags={} r_genres={} r_tags={}",
        album_id,
        result_summary.release_group_genre_count,
        result_summary.release_group_tag_count,
        result_summary.release_genre_count,
        result_summary.release_tag_count,
    );

    Ok(Some(serde_json::to_value(result_summary).map_err(|e| {
        JobError::ProcessingFailed {
            reason: format!("serialize result: {}", e),
        }
    })?))
}

fn map_tags(src: Option<&[Tag]>) -> Vec<FolksonomyTag> {
    src.map(|list| {
        list.iter()
            .map(|t| FolksonomyTag {
                name: t.name.clone(),
                count: t.count.unwrap_or(0) as i32,
            })
            .collect()
    })
    .unwrap_or_default()
}

fn map_genres(src: Option<&[Genre]>) -> Vec<FolksonomyTag> {
    src.map(|list| {
        list.iter()
            .map(|g| FolksonomyTag {
                name: g.name.clone(),
                count: g.count.unwrap_or(0) as i32,
            })
            .collect()
    })
    .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// log formatting helpers (info-level only, no debug! per ux directive)
// ---------------------------------------------------------------------------

fn format_folksonomy_top(tags: &[FolksonomyTag], n: usize) -> String {
    if tags.is_empty() {
        return "(none)".to_string();
    }
    let mut sorted: Vec<&FolksonomyTag> = tags.iter().collect();
    sorted.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));
    sorted
        .into_iter()
        .take(n)
        .map(|t| format!("{}({})", t.name, t.count))
        .collect::<Vec<_>>()
        .join(", ")
}

fn format_artist_credits(
    src: Option<&[crate::music::musicbrainz::models::ArtistCredit]>,
) -> String {
    match src {
        None => "(none)".to_string(),
        Some(list) => list
            .iter()
            .map(|c| {
                let join = c.joinphrase.clone().unwrap_or_default();
                format!("{}{}", c.name, join)
            })
            .collect::<String>(),
    }
}

fn format_label_info(src: Option<&[crate::music::musicbrainz::models::LabelInfo]>) -> String {
    match src {
        None => "(none)".to_string(),
        Some(list) if list.is_empty() => "(none)".to_string(),
        Some(list) => list
            .iter()
            .map(|li| {
                let label = li.label.as_ref().map(|l| l.name.as_str()).unwrap_or("?");
                let cat = li.catalog_number.as_deref().unwrap_or("-");
                format!("{} [{}]", label, cat)
            })
            .collect::<Vec<_>>()
            .join(", "),
    }
}

fn format_media(src: Option<&[crate::music::musicbrainz::models::Medium]>) -> String {
    match src {
        None => "(none)".to_string(),
        Some(list) if list.is_empty() => "(none)".to_string(),
        Some(list) => list
            .iter()
            .map(|m| {
                let format = m.format.as_deref().unwrap_or("?");
                let count = m
                    .track_count
                    .or_else(|| m.tracks.as_ref().map(|t| t.len() as u32))
                    .unwrap_or(0);
                format!("{}x{}", format, count)
            })
            .collect::<Vec<_>>()
            .join(", "),
    }
}

/// rough mood detector. mb's folksonomy is freeform so this is a best-effort
/// match against common mood vocabulary; misses are expected.
fn collect_mood_hits(folksonomy: &MbFolksonomy) -> Vec<FolksonomyTag> {
    const MOOD_TERMS: &[&str] = &[
        "angry",
        "atmospheric",
        "calm",
        "cathartic",
        "cheerful",
        "chill",
        "contemplative",
        "dark",
        "dreamy",
        "driving",
        "energetic",
        "epic",
        "ethereal",
        "euphoric",
        "feelgood",
        "happy",
        "haunting",
        "hopeful",
        "hypnotic",
        "introspective",
        "laid-back",
        "lonely",
        "longing",
        "melancholic",
        "melancholy",
        "mellow",
        "meditative",
        "moody",
        "nostalgic",
        "ominous",
        "peaceful",
        "playful",
        "reflective",
        "relaxing",
        "romantic",
        "sad",
        "sensual",
        "sentimental",
        "serene",
        "soothing",
        "spacey",
        "spiritual",
        "sweet",
        "tense",
        "trippy",
        "uplifting",
        "warm",
        "yearning",
    ];
    let mut hits: Vec<FolksonomyTag> = Vec::new();
    let mut seen: std::collections::HashMap<String, i32> = std::collections::HashMap::new();
    let pools = [
        &folksonomy.release_tags,
        &folksonomy.release_group_tags,
        &folksonomy.release_genres,
        &folksonomy.release_group_genres,
    ];
    for pool in pools {
        for tag in pool.iter() {
            let key = tag.name.to_lowercase();
            if MOOD_TERMS.contains(&key.as_str()) {
                let entry = seen.entry(key.clone()).or_insert(0);
                *entry += tag.count.max(1);
            }
        }
    }
    for (name, count) in seen {
        hits.push(FolksonomyTag { name, count });
    }
    hits.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));
    hits
}

// ---------------------------------------------------------------------------
// auto-apply mb-derived data to album columns (year/label/genres only)
// ---------------------------------------------------------------------------

#[derive(Debug, Default)]
struct ApplySummary {
    year_set: bool,
    label_set: bool,
    genres_added: usize,
}

/// fill `release_date` and `label` columns only when currently NULL/empty,
/// and link any new genres into `album_taxonz` (existing links untouched).
/// never updates title, album_type, artist, or song-level data.
async fn apply_mb_album_columns_if_empty(
    album_id: &str,
    release_date: Option<&str>,
    label: Option<&str>,
    genre_names: &[String],
) -> ApplySummary {
    use crate::database;
    let mut summary = ApplySummary::default();
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!("auto-apply: db connect failed: {}", e);
            return summary;
        }
    };

    // read current values from album_query_view (label and release_date
    // are now synthesized from `album_taxonz`).
    let current = match sqlx::query!(
        r#"SELECT
            v.album_release_date as "release_date?: String",
            v.album_label as "label?: String"
             FROM albumz a
             LEFT JOIN album_query_view v ON v.album_id = a.id
            WHERE a.id = ? AND a.deleted_at IS NULL"#,
        album_id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(Some(row)) => Some((row.release_date, row.label)),
        Ok(None) => None,
        Err(e) => {
            tracing::warn!("auto-apply: read album failed: {}", e);
            None
        }
    };

    let (cur_date, cur_label) = current.unwrap_or((None, None));

    // release_date: only fill when empty
    let new_date = release_date
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .filter(|_| {
            cur_date
                .as_deref()
                .map(|s| s.trim().is_empty())
                .unwrap_or(true)
        });

    // label: only fill when empty
    let new_label = label
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .filter(|_| {
            cur_label
                .as_deref()
                .map(|s| s.trim().is_empty())
                .unwrap_or(true)
        });

    // route the legacy `release_date` / `label` columns through the
    // taxonomy. add_album_taxon with origin='musicbrainz' so the link
    // can be distinguished from user-set values.
    if let Some(date) = new_date {
        let resp =
            crate::music::entities::taxonomy::find_or_create_taxon("release_date", date).await;
        if let Some(taxon) = resp.data {
            let _ = crate::music::entities::taxonomy::add_album_taxon(
                crate::music::entities::taxonomy::AddAlbumTaxonRequest {
                    album_id: album_id.to_string(),
                    taxon_id: taxon.id,
                    origin: "musicbrainz".to_string(),
                    confidence: None,
                },
            )
            .await;
            summary.year_set = true;
            // bump updated_at so cache invalidation triggers
            let _ = sqlx::query!(
                "UPDATE albumz SET updated_at = unixepoch() WHERE id = ?",
                album_id
            )
            .execute(&pool)
            .await;
        }
    }
    if let Some(label_val) = new_label {
        let resp = crate::music::entities::taxonomy::find_or_create_taxon("label", label_val).await;
        if let Some(taxon) = resp.data {
            let _ = crate::music::entities::taxonomy::add_album_taxon(
                crate::music::entities::taxonomy::AddAlbumTaxonRequest {
                    album_id: album_id.to_string(),
                    taxon_id: taxon.id,
                    origin: "musicbrainz".to_string(),
                    confidence: None,
                },
            )
            .await;
            summary.label_set = true;
            let _ = sqlx::query!(
                "UPDATE albumz SET updated_at = unixepoch() WHERE id = ?",
                album_id
            )
            .execute(&pool)
            .await;
        }
    }

    // genres: add any that aren't already linked. find_or_create_taxon handles
    // case-insensitive dedupe at the taxonomy table level.
    for raw_name in genre_names {
        let name = raw_name.trim();
        if name.is_empty() {
            continue;
        }
        let resp = crate::music::entities::taxonomy::find_or_create_taxon("genre", name).await;
        let taxon = match resp.data {
            Some(t) => t,
            None => continue,
        };
        match sqlx::query!(
            r#"INSERT OR IGNORE INTO album_taxonz (album_id, taxon_id, origin) VALUES (?, ?, 'musicbrainz')"#,
            album_id,
            taxon.id,
        )
        .execute(&pool)
        .await
        {
            Ok(res) if res.rows_affected() > 0 => summary.genres_added += 1,
            Ok(_) => {}
            Err(e) => {
                tracing::warn!("auto-apply: link genre {} failed: {}", taxon.id, e);
            }
        }
    }

    summary
}
