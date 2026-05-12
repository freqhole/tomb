//! taxon proposal synthesis (phase 14.2).
//!
//! reads an album's `metadata` blob (mb folksonomy + lastfm + audiodb
//! snapshots) and projects each enrichment payload onto the taxonomy
//! kinds defined in migration 040. the output is a deduplicated list of
//! `TaxonProposal`s ready for review in the bulk step-through ui.
//!
//! this module is **read-only** — it never writes to `album_taxonz`.
//! the user accepts/edits proposals in the modal and a separate route
//! (`apply_taxon_proposals`, phase 14.3) commits the chosen subset.
//!
//! mapping rules (per the phase-14 design doc):
//! - mb release_genres + release_group_genres → `genre`
//! - mb release_tags + release_group_tags → `mood` (when in mood
//!   vocabulary) or `genre` (otherwise) — same heuristic the mb detail
//!   processor already uses for mood detection.
//! - mb candidate `country` (when 2-letter / "XW") → `country`.
//! - mb confirmed release `first_release_date` → `decade`.
//! - lastfm tags → if case-insensitive slug matches an existing `genre`
//!   taxon, route to `genre`; else route to `lastfm_tag`.
//! - audiodb `strGenre` → `genre`, `strSubGenre` → `subgenre`,
//!   `strStyle` → `style`, `strMood` → `mood`, `strTheme` → `theme`,
//!   `strSpeed` → `speed`, `strLabel` → `label`. comma/slash separators
//!   inside a single field are split into multiple proposals.
//!
//! dedup: proposals are keyed by `(kind_slug, slugified_label)`. when
//! the same logical taxon comes from multiple sources, the
//! `sources` vec accumulates (e.g. `["mb", "lastfm"]`).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use zod_gen_derive::ZodSchema;

use crate::error::ErrorDetail;
use crate::music::entities::taxonomy::{
    self, AddAlbumTaxonRequest, KIND_COUNTRY, KIND_DECADE, KIND_GENRE, KIND_LABEL, KIND_LASTFM_TAG,
    KIND_MOOD, KIND_SPEED, KIND_STYLE, KIND_SUBGENRE, KIND_THEME, SEEDED_KIND_SLUGS,
};
use crate::response::GrimoireResponse;

use super::metadata::{
    AlbumMetadata, AudioDbAlbumSnapshot, FolksonomyTag, LastFmAlbumSnapshot, MbCandidate,
    MbFolksonomy,
};
use super::repository::read_album_metadata;

/// where a single proposal originated. one proposal can be backed by
/// multiple sources when the same `(kind, label)` shows up across enrichment
/// payloads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, ZodSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProposalSource {
    Mb,
    Lastfm,
    Audiodb,
    Allmusic,
}

impl ProposalSource {
    /// the value persisted to `album_taxonz.origin` when the proposal is
    /// accepted. matches existing values written by other code paths.
    pub fn as_origin(&self) -> &'static str {
        match self {
            Self::Mb => "musicbrainz",
            Self::Lastfm => "lastfm",
            Self::Audiodb => "audiodb",
            Self::Allmusic => "allmusic",
        }
    }
}

/// a single proposed `(kind, label)` link the user can accept, edit, or drop.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct TaxonProposal {
    pub kind_slug: String,
    pub label: String,
    pub sources: Vec<ProposalSource>,
    /// human-readable per-source detail surfaced in the review ui (e.g.
    /// `"mb release+rg, count 5"` or `"audiodb strGenre"`). optional;
    /// proposals without provenance breadcrumbs simply omit this.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_detail: Option<String>,
    /// true if this `(kind, label)` is already linked to the album. the ui
    /// uses this to dim the chip and skip it on bulk-accept.
    pub already_linked: bool,
}

/// request body for `propose_taxons` (phase 14.2). returns
/// `Vec<TaxonProposal>` keyed by `(kind_slug, slugified_label)`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct ProposeTaxonsRequest {
    pub album_id: String,
}

/// request body for `apply_taxon_proposals` (phase 14.3). the client
/// passes back the subset of `propose_taxons` results the user accepted
/// (after their edits — labels and kinds may have been tweaked).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct ApplyTaxonProposalsRequest {
    pub album_id: String,
    pub accepted: Vec<AcceptedProposal>,
}

/// a proposal the user accepted. matches `TaxonProposal` minus the
/// `already_linked` flag (callers should pre-filter those out), and
/// trimmed of provenance noise that's only useful in the review ui.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct AcceptedProposal {
    pub kind_slug: String,
    pub label: String,
    /// origin to stamp into `album_taxonz.origin`. typically the first
    /// entry from `TaxonProposal.sources`; the client may override
    /// when multiple sources agreed.
    pub source: ProposalSource,
    /// optional confidence stamp (0..1). usually omitted; the review
    /// ui doesn't currently expose confidence editing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
}

/// summary returned by `apply_taxon_proposals`. counts per outcome so the
/// review ui can show a quick "added 5, skipped 2" toast.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct ApplyTaxonProposalsResult {
    pub album_id: String,
    pub linked: u32,
    pub skipped_existing: u32,
    pub skipped_invalid: u32,
}

/// build the full proposal list for an album. reads the album's metadata
/// blob and the existing `album_taxonz` rows, runs every mapping rule, and
/// returns the deduplicated result sorted by `(kind, label)`.
pub async fn propose_taxons_for_album(album_id: &str) -> GrimoireResponse<Vec<TaxonProposal>> {
    let meta_resp = read_album_metadata(album_id).await;
    if !meta_resp.success {
        return GrimoireResponse::failure(
            "failed to read album metadata",
            meta_resp.errors,
        );
    }
    let meta = meta_resp.data.unwrap_or_default();

    // existing links so we can flag `already_linked`.
    let existing_resp = taxonomy::get_album_taxon_links(album_id).await;
    if !existing_resp.success {
        return GrimoireResponse::failure(
            "failed to read existing album taxon links",
            existing_resp.errors,
        );
    }
    let existing = existing_resp.data.unwrap_or_default();

    // for the lastfm-tag → genre promotion check, fetch all known `genre`
    // taxons up front. case-insensitive slug match.
    let known_genre_resp = taxonomy::list_taxons_by_kind(KIND_GENRE).await;
    let known_genre_slugs: std::collections::HashSet<String> = known_genre_resp
        .data
        .unwrap_or_default()
        .into_iter()
        .map(|t| taxonomy::slugify_taxon_label(&t.label))
        .collect();

    let existing_keys: std::collections::HashSet<(String, String)> = existing
        .iter()
        .map(|l| (l.kind_slug.clone(), taxonomy::slugify_taxon_label(&l.label)))
        .collect();

    let mut bag = ProposalBag::new();
    propose_from_mb(&meta, &mut bag);
    propose_from_lastfm(&meta, &known_genre_slugs, &mut bag);
    propose_from_audiodb(&meta, &mut bag);

    let mut proposals = bag.finish();
    for p in proposals.iter_mut() {
        let key = (
            p.kind_slug.clone(),
            taxonomy::slugify_taxon_label(&p.label),
        );
        p.already_linked = existing_keys.contains(&key);
    }
    proposals.sort_by(|a, b| {
        a.kind_slug
            .cmp(&b.kind_slug)
            .then_with(|| a.label.to_lowercase().cmp(&b.label.to_lowercase()))
    });

    GrimoireResponse::success("taxon proposals computed", proposals)
}

/// commit a subset of proposals to `album_taxonz`. for each accepted
/// proposal:
/// 1. validate `kind_slug` against the seeded taxonomy.
/// 2. `find_or_create_taxon(kind_slug, label)` (case-insensitive
///    dedup is handled inside that helper).
/// 3. `add_album_taxon` with `origin=source.as_origin()`. duplicate
///    `(album, taxon, origin)` rows are upserted, not errored.
///
/// idempotent: re-running with the same accepted set is a no-op past the
/// first call (each link upserts with the same confidence).
pub async fn apply_taxon_proposals(
    req: ApplyTaxonProposalsRequest,
) -> GrimoireResponse<ApplyTaxonProposalsResult> {
    let mut result = ApplyTaxonProposalsResult {
        album_id: req.album_id.clone(),
        ..Default::default()
    };

    // pre-compute current links so we can count `skipped_existing` cleanly.
    let existing_resp = taxonomy::get_album_taxon_links(&req.album_id).await;
    if !existing_resp.success {
        return GrimoireResponse::failure(
            "failed to read existing album taxon links",
            existing_resp.errors,
        );
    }
    let existing_keys: std::collections::HashSet<(String, String)> = existing_resp
        .data
        .unwrap_or_default()
        .into_iter()
        .map(|l| (l.kind_slug, taxonomy::slugify_taxon_label(&l.label)))
        .collect();

    let mut errors: Vec<ErrorDetail> = Vec::new();
    for proposal in req.accepted {
        if !SEEDED_KIND_SLUGS.contains(&proposal.kind_slug.as_str()) {
            result.skipped_invalid += 1;
            errors.push(ErrorDetail::new(
                "invalid_kind",
                "invalid taxon kind",
                &format!("unknown kind_slug `{}`", proposal.kind_slug),
            ));
            continue;
        }
        let trimmed = proposal.label.trim();
        if trimmed.is_empty() {
            result.skipped_invalid += 1;
            continue;
        }

        let key = (
            proposal.kind_slug.clone(),
            taxonomy::slugify_taxon_label(trimmed),
        );
        if existing_keys.contains(&key) {
            result.skipped_existing += 1;
            continue;
        }

        let taxon_resp = taxonomy::find_or_create_taxon(&proposal.kind_slug, trimmed).await;
        if !taxon_resp.success {
            result.skipped_invalid += 1;
            errors.extend(taxon_resp.errors);
            continue;
        }
        let taxon = match taxon_resp.data {
            Some(t) => t,
            None => {
                result.skipped_invalid += 1;
                continue;
            }
        };

        let add_resp = taxonomy::add_album_taxon(AddAlbumTaxonRequest {
            album_id: req.album_id.clone(),
            taxon_id: taxon.id,
            origin: proposal.source.as_origin().to_string(),
            confidence: proposal.confidence,
        })
        .await;
        if !add_resp.success {
            result.skipped_invalid += 1;
            errors.extend(add_resp.errors);
            continue;
        }
        result.linked += 1;
    }

    if errors.is_empty() {
        GrimoireResponse::success("taxon proposals applied", result)
    } else {
        // partial success: data is still useful for the toast.
        GrimoireResponse {
            success: true,
            message: "taxon proposals partially applied".to_string(),
            data: Some(result),
            errors,
        }
    }
}

// ---------------------------------------------------------------------------
// dedup bag
// ---------------------------------------------------------------------------

struct ProposalBag {
    inner: BTreeMap<(String, String), TaxonProposal>,
}

impl ProposalBag {
    fn new() -> Self {
        Self {
            inner: BTreeMap::new(),
        }
    }

    /// add a (kind, label, source, detail) tuple. on duplicate key,
    /// merges sources + appends detail.
    fn add(&mut self, kind: &str, label: &str, source: ProposalSource, detail: Option<String>) {
        let label = label.trim();
        if label.is_empty() {
            return;
        }
        let key = (kind.to_string(), taxonomy::slugify_taxon_label(label));
        match self.inner.get_mut(&key) {
            Some(existing) => {
                if !existing.sources.contains(&source) {
                    existing.sources.push(source);
                }
                if let Some(d) = detail {
                    existing.source_detail = Some(match existing.source_detail.take() {
                        Some(prev) => format!("{prev}; {d}"),
                        None => d,
                    });
                }
            }
            None => {
                self.inner.insert(
                    key,
                    TaxonProposal {
                        kind_slug: kind.to_string(),
                        label: label.to_string(),
                        sources: vec![source],
                        source_detail: detail,
                        already_linked: false,
                    },
                );
            }
        }
    }

    fn finish(self) -> Vec<TaxonProposal> {
        self.inner.into_values().collect()
    }
}

// ---------------------------------------------------------------------------
// per-source mapping rules
// ---------------------------------------------------------------------------

fn propose_from_mb(meta: &AlbumMetadata, bag: &mut ProposalBag) {
    if let Some(folk) = meta
        .folksonomy
        .as_ref()
        .and_then(|f| f.musicbrainz.as_ref())
    {
        propose_from_mb_folksonomy(folk, bag);
    }
    if let Some(mb) = meta.musicbrainz.as_ref() {
        // pick the confirmed candidate (or the highest-confidence one) for
        // structural fields like country / decade.
        let confirmed_release_id = mb.release_id.as_deref();
        let candidate: Option<&MbCandidate> = if let Some(rid) = confirmed_release_id {
            mb.candidates
                .iter()
                .find(|c| c.release_id.as_deref() == Some(rid))
        } else {
            mb.candidates.iter().max_by(|a, b| {
                a.local_confidence
                    .unwrap_or(0.0)
                    .partial_cmp(&b.local_confidence.unwrap_or(0.0))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
        };
        if let Some(c) = candidate {
            if let Some(country) = c.country.as_deref() {
                let normalized = country.trim().to_ascii_uppercase();
                // skip nonsense; mb uses 2-letter iso + "XW" for worldwide.
                if normalized.len() == 2 || normalized == "XW" {
                    bag.add(
                        KIND_COUNTRY,
                        &normalized,
                        ProposalSource::Mb,
                        Some(format!("mb candidate country={}", normalized)),
                    );
                }
            }
            if let Some(date) = c.first_release_date.as_deref() {
                if let Some(decade) = year_to_decade(date) {
                    bag.add(
                        KIND_DECADE,
                        &decade,
                        ProposalSource::Mb,
                        Some(format!("mb first_release_date={}", date)),
                    );
                }
            }
        }
    }
}

fn propose_from_mb_folksonomy(folk: &MbFolksonomy, bag: &mut ProposalBag) {
    // genres are typed as "genre" by mb; always propose under `genre`.
    let genre_pools: [(&str, &[FolksonomyTag]); 2] = [
        ("release", &folk.release_genres),
        ("release-group", &folk.release_group_genres),
    ];
    for (label, pool) in genre_pools {
        for tag in pool {
            bag.add(
                KIND_GENRE,
                &tag.name,
                ProposalSource::Mb,
                Some(format!("mb {} genre, count={}", label, tag.count)),
            );
        }
    }
    // tags are folksonomy and untyped; route to `mood` if it matches the
    // mood vocabulary, otherwise to `genre` (mb users frequently apply
    // sub-genre style tags here).
    let tag_pools: [(&str, &[FolksonomyTag]); 2] = [
        ("release", &folk.release_tags),
        ("release-group", &folk.release_group_tags),
    ];
    for (label, pool) in tag_pools {
        for tag in pool {
            let kind = if is_mood_term(&tag.name) {
                KIND_MOOD
            } else {
                KIND_GENRE
            };
            bag.add(
                kind,
                &tag.name,
                ProposalSource::Mb,
                Some(format!("mb {} tag, count={}", label, tag.count)),
            );
        }
    }
}

fn propose_from_lastfm(
    meta: &AlbumMetadata,
    known_genre_slugs: &std::collections::HashSet<String>,
    bag: &mut ProposalBag,
) {
    let Some(lastfm) = meta.lastfm.as_ref() else {
        return;
    };
    let Some(album) = lastfm.album.as_ref() else {
        return;
    };
    propose_from_lastfm_album(album, known_genre_slugs, bag);
}

fn propose_from_lastfm_album(
    album: &LastFmAlbumSnapshot,
    known_genre_slugs: &std::collections::HashSet<String>,
    bag: &mut ProposalBag,
) {
    for tag in album.tags.iter() {
        let slug = taxonomy::slugify_taxon_label(&tag.name);
        if known_genre_slugs.contains(&slug) {
            bag.add(
                KIND_GENRE,
                &tag.name,
                ProposalSource::Lastfm,
                Some("lastfm tag (promoted to genre)".to_string()),
            );
        } else if is_mood_term(&tag.name) {
            bag.add(
                KIND_MOOD,
                &tag.name,
                ProposalSource::Lastfm,
                Some("lastfm tag (mood vocabulary)".to_string()),
            );
        } else {
            bag.add(
                KIND_LASTFM_TAG,
                &tag.name,
                ProposalSource::Lastfm,
                Some("lastfm tag".to_string()),
            );
        }
    }
}

fn propose_from_audiodb(meta: &AlbumMetadata, bag: &mut ProposalBag) {
    let Some(audiodb) = meta.audiodb.as_ref() else {
        return;
    };
    let Some(album) = audiodb.album.as_ref() else {
        return;
    };
    propose_from_audiodb_album(album, bag);
}

fn propose_from_audiodb_album(album: &AudioDbAlbumSnapshot, bag: &mut ProposalBag) {
    let single_value_fields: [(&str, Option<&str>, &str); 7] = [
        (KIND_GENRE, album.genre.as_deref(), "audiodb strGenre"),
        (
            KIND_SUBGENRE,
            album.subgenre.as_deref(),
            "audiodb strSubGenre",
        ),
        (KIND_STYLE, album.style.as_deref(), "audiodb strStyle"),
        (KIND_MOOD, album.mood.as_deref(), "audiodb strMood"),
        (KIND_THEME, album.theme.as_deref(), "audiodb strTheme"),
        (KIND_SPEED, album.speed.as_deref(), "audiodb strSpeed"),
        (KIND_LABEL, album.label.as_deref(), "audiodb strLabel"),
    ];
    for (kind, value, detail) in single_value_fields {
        if let Some(raw) = value {
            for label in split_compound(raw) {
                bag.add(
                    kind,
                    &label,
                    ProposalSource::Audiodb,
                    Some(detail.to_string()),
                );
            }
        }
    }
    if let Some(year) = album.year_released.as_deref() {
        if let Some(decade) = year_to_decade(year) {
            bag.add(
                KIND_DECADE,
                &decade,
                ProposalSource::Audiodb,
                Some(format!("audiodb intYearReleased={}", year)),
            );
        }
    }
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

/// derive a decade label like `"1990s"` from a year-prefixed date string
/// (`"1995"`, `"1995-04-01"`, ...). returns `None` for unparseable input.
fn year_to_decade(date_or_year: &str) -> Option<String> {
    let prefix: String = date_or_year.chars().take_while(|c| c.is_ascii_digit()).collect();
    if prefix.len() < 4 {
        return None;
    }
    let year: i32 = prefix[..4].parse().ok()?;
    if !(1000..=9999).contains(&year) {
        return None;
    }
    let decade = (year / 10) * 10;
    Some(format!("{}s", decade))
}

/// split an audiodb-style compound field (`"Rock / Pop"`, `"Jazz, Funk"`)
/// into individual labels. strips whitespace and skips empties.
fn split_compound(raw: &str) -> Vec<String> {
    raw.split(|c: char| c == ',' || c == '/' || c == ';' || c == '|')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// shared mood vocabulary. kept in lockstep with the list in
/// `mb_detail_processor::collect_mood_hits`. add new terms in both
/// places when the vocabulary grows.
fn is_mood_term(label: &str) -> bool {
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
    let key = label.trim().to_ascii_lowercase();
    MOOD_TERMS.contains(&key.as_str())
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::music::entities::albums::metadata::{
        AudioDbMetadata, FolksonomyMetadata, FolksonomyTag, LastFmMetadata, LastFmTagRef,
        MbFolksonomy, MbMetadata,
    };

    fn meta_with_mb_folksonomy() -> AlbumMetadata {
        AlbumMetadata {
            folksonomy: Some(FolksonomyMetadata {
                musicbrainz: Some(MbFolksonomy {
                    release_genres: vec![FolksonomyTag {
                        name: "Post-Rock".to_string(),
                        count: 5,
                    }],
                    release_tags: vec![
                        FolksonomyTag {
                            name: "melancholic".to_string(),
                            count: 3,
                        },
                        FolksonomyTag {
                            name: "instrumental".to_string(),
                            count: 4,
                        },
                    ],
                    ..Default::default()
                }),
            }),
            ..Default::default()
        }
    }

    #[test]
    fn year_to_decade_parses_iso_dates() {
        assert_eq!(year_to_decade("1995"), Some("1990s".to_string()));
        assert_eq!(year_to_decade("1995-04-01"), Some("1990s".to_string()));
        assert_eq!(year_to_decade("2003"), Some("2000s".to_string()));
        assert_eq!(year_to_decade("???"), None);
        assert_eq!(year_to_decade(""), None);
    }

    #[test]
    fn split_compound_handles_mixed_separators() {
        assert_eq!(
            split_compound("Rock / Pop, Jazz; Funk"),
            vec!["Rock", "Pop", "Jazz", "Funk"]
        );
        assert_eq!(split_compound(""), Vec::<String>::new());
        assert_eq!(split_compound("Trip Hop"), vec!["Trip Hop"]);
    }

    #[test]
    fn mb_folksonomy_routes_genres_and_moods() {
        let meta = meta_with_mb_folksonomy();
        let mut bag = ProposalBag::new();
        propose_from_mb(&meta, &mut bag);
        let proposals = bag.finish();
        let by_kind: std::collections::HashMap<&str, std::collections::HashSet<&str>> = proposals
            .iter()
            .map(|p| (p.kind_slug.as_str(), p.label.as_str()))
            .fold(
                std::collections::HashMap::new(),
                |mut acc, (k, l)| {
                    acc.entry(k).or_default().insert(l);
                    acc
                },
            );
        let genres = by_kind.get(KIND_GENRE).unwrap();
        assert!(genres.contains("Post-Rock"));
        assert!(genres.contains("instrumental"));
        let moods = by_kind.get(KIND_MOOD).unwrap();
        assert!(moods.contains("melancholic"));
    }

    #[test]
    fn lastfm_promotes_to_genre_when_known() {
        let meta = AlbumMetadata {
            lastfm: Some(LastFmMetadata {
                album: Some(LastFmAlbumSnapshot {
                    name: "x".into(),
                    artist: "y".into(),
                    tags: vec![
                        LastFmTagRef {
                            name: "post-rock".into(),
                            url: None,
                        },
                        LastFmTagRef {
                            name: "vibey".into(),
                            url: None,
                        },
                    ],
                    ..Default::default()
                }),
                ..Default::default()
            }),
            ..Default::default()
        };
        let mut known = std::collections::HashSet::new();
        known.insert("post-rock".to_string());
        let mut bag = ProposalBag::new();
        propose_from_lastfm(&meta, &known, &mut bag);
        let proposals = bag.finish();
        let pr = proposals
            .iter()
            .find(|p| p.label == "post-rock")
            .expect("post-rock proposal");
        assert_eq!(pr.kind_slug, KIND_GENRE);
        let pv = proposals
            .iter()
            .find(|p| p.label == "vibey")
            .expect("vibey proposal");
        assert_eq!(pv.kind_slug, KIND_LASTFM_TAG);
    }

    #[test]
    fn audiodb_splits_compound_fields_and_derives_decade() {
        let meta = AlbumMetadata {
            audiodb: Some(AudioDbMetadata {
                album: Some(AudioDbAlbumSnapshot {
                    genre: Some("Rock / Pop".into()),
                    mood: Some("Mellow".into()),
                    year_released: Some("1985".into()),
                    ..Default::default()
                }),
                ..Default::default()
            }),
            ..Default::default()
        };
        let mut bag = ProposalBag::new();
        propose_from_audiodb(&meta, &mut bag);
        let proposals = bag.finish();
        let labels: std::collections::HashSet<(String, String)> = proposals
            .iter()
            .map(|p| (p.kind_slug.clone(), p.label.clone()))
            .collect();
        assert!(labels.contains(&(KIND_GENRE.into(), "Rock".into())));
        assert!(labels.contains(&(KIND_GENRE.into(), "Pop".into())));
        assert!(labels.contains(&(KIND_MOOD.into(), "Mellow".into())));
        assert!(labels.contains(&(KIND_DECADE.into(), "1980s".into())));
    }

    #[test]
    fn dedup_merges_sources() {
        let mut bag = ProposalBag::new();
        bag.add(
            KIND_GENRE,
            "Rock",
            ProposalSource::Mb,
            Some("mb".into()),
        );
        bag.add(
            KIND_GENRE,
            "rock",
            ProposalSource::Audiodb,
            Some("audiodb".into()),
        );
        let out = bag.finish();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].sources.len(), 2);
        assert!(out[0].sources.contains(&ProposalSource::Mb));
        assert!(out[0].sources.contains(&ProposalSource::Audiodb));
    }
}
