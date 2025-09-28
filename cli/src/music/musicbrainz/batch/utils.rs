//! Utility functions for batch processing operations

use super::types::{
    AlbumContext, MetadataEnrichment, MusicBrainzMatchSummary, SongMetadataSummary,
};
use grimoire::music::{repository::MusicRepository, Song};
use grimoire::musicbrainz::MusicBrainzMatch;
use std::collections::HashMap;
use std::sync::Arc;

/// analyze metadata changes and create enrichment proposal
pub fn analyze_metadata_changes(
    song: &Song,
    mb_match: &MusicBrainzMatch,
    _album_context: Option<&AlbumContext>,
) -> MetadataEnrichment {
    let current_metadata = SongMetadataSummary::from(song);
    let mut proposed_changes = HashMap::new();
    let mut review_needed = false;

    // check title
    if song.title != mb_match.recording.title {
        proposed_changes.insert("title".to_string(), mb_match.recording.title.clone());
    }

    // check artist
    if let Some(mb_artist) = mb_match.recording.primary_artist_name() {
        if let Some(current_artist) = &song.artist {
            if current_artist != &mb_artist {
                proposed_changes.insert("artist".to_string(), mb_artist.clone());
                // major changes need review
                if calculate_string_similarity(current_artist, &mb_artist) < 0.8 {
                    review_needed = true;
                }
            }
        } else {
            proposed_changes.insert("artist".to_string(), mb_artist);
        }
    }

    // check album from release
    if let Some(release) = &mb_match.release {
        if let Some(current_album) = &song.album {
            if current_album != &release.title {
                proposed_changes.insert("album".to_string(), release.title.clone());
            }
        } else {
            proposed_changes.insert("album".to_string(), release.title.clone());
        }
    }

    // create summary of musicbrainz match
    let mb_summary = MusicBrainzMatchSummary {
        recording_id: mb_match.recording.id.to_string(),
        title: mb_match.recording.title.clone(),
        artist: mb_match.recording.primary_artist_name().unwrap_or_default(),
        album: mb_match.release.as_ref().map(|r| r.title.clone()),
        track_number: get_track_number_from_match(mb_match),
        year: get_year_from_match(mb_match),
        confidence_score: mb_match.confidence_score,
    };

    MetadataEnrichment {
        song_id: song.id,
        current_metadata,
        musicbrainz_match: mb_summary,
        proposed_changes,
        confidence_score: mb_match.confidence_score,
        review_needed,
        album_context: _album_context.cloned(),
    }
}

/// calculate string similarity using levenshtein distance
pub fn calculate_string_similarity(a: &str, b: &str) -> f32 {
    let a_chars: Vec<char> = a.to_lowercase().chars().collect();
    let b_chars: Vec<char> = b.to_lowercase().chars().collect();

    let distance = levenshtein_distance(&a_chars, &b_chars);
    let max_len = a_chars.len().max(b_chars.len());

    if max_len == 0 {
        1.0
    } else {
        1.0 - (distance as f32 / max_len as f32)
    }
}

/// calculate levenshtein distance between two character arrays
fn levenshtein_distance(a: &[char], b: &[char]) -> usize {
    let mut matrix = vec![vec![0; b.len() + 1]; a.len() + 1];

    for i in 0..=a.len() {
        matrix[i][0] = i;
    }
    for j in 0..=b.len() {
        matrix[0][j] = j;
    }

    for i in 1..=a.len() {
        for j in 1..=b.len() {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            matrix[i][j] = (matrix[i - 1][j] + 1)
                .min(matrix[i][j - 1] + 1)
                .min(matrix[i - 1][j - 1] + cost);
        }
    }

    matrix[a.len()][b.len()]
}

/// extract track number from musicbrainz match
fn get_track_number_from_match(_mb_match: &MusicBrainzMatch) -> Option<i32> {
    // TODO: implement track number extraction from release data
    None
}

/// extract year from musicbrainz match
fn get_year_from_match(_mb_match: &MusicBrainzMatch) -> Option<i32> {
    // TODO: implement year extraction from release date
    None
}

/// store result when no musicbrainz matches are found
pub async fn store_no_match_result(
    repository: &Arc<MusicRepository>,
    song_id: &uuid::Uuid,
) -> Result<(), Box<dyn std::error::Error>> {
    let scan_data = serde_json::json!({
        "scanned_at": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
        "status": "no_matches_found",
        "matches_found": 0,
        "next_scan_strategy": "try_broader_search",
        "version": "1.0"
    });

    // store scan result in song.metadata["musicbrainz"] field
    repository
        .update_song_musicbrainz_metadata(*song_id, &scan_data)
        .await?;

    Ok(())
}

/// store enrichment data with proposed changes for later review
pub async fn store_enrichment_data(
    repository: &Arc<MusicRepository>,
    song_id: &uuid::Uuid,
    enrichment: &MetadataEnrichment,
    matches: &[MusicBrainzMatch],
) -> Result<(), Box<dyn std::error::Error>> {
    let enrichment_data = serde_json::json!({
        "scanned_at": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
        "status": "enrichment_ready",
        "confidence_score": enrichment.confidence_score,
        "review_needed": enrichment.review_needed,
        "enrichment": enrichment,
        "all_matches": matches.iter().map(|m| serde_json::json!({
            "recording_id": m.recording.id,
            "title": m.recording.title,
            "artist": m.recording.primary_artist_name().unwrap_or_default(),
            "confidence_score": m.confidence_score,
            "match_reasons": m.match_reasons,
            "release": m.release.as_ref().map(|r| serde_json::json!({
                "id": r.id,
                "title": r.title,
                "date": r.date,
                "country": r.country,
                "status": r.status
            }))
        })).collect::<Vec<_>>(),
        "version": "1.0"
    });

    // store in song.metadata["musicbrainz"] field, preserving other metadata
    repository
        .update_song_musicbrainz_metadata(*song_id, &enrichment_data)
        .await?;

    Ok(())
}

/// store enrichment data with album context for comprehensive analysis
pub async fn store_enrichment_data_with_album_context(
    repository: &Arc<MusicRepository>,
    song_id: &uuid::Uuid,
    enrichment: &MetadataEnrichment,
    matches: &[MusicBrainzMatch],
    album_analysis: &super::types::AlbumCompletenessReport,
) -> Result<(), Box<dyn std::error::Error>> {
    let enrichment_data = serde_json::json!({
        "scanned_at": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
        "status": "enrichment_ready",
        "confidence_score": enrichment.confidence_score,
        "review_needed": enrichment.review_needed,
        "enrichment": enrichment,
        "album_analysis": {
            "completion_percentage": album_analysis.completion_percentage,
            "matched_tracks": album_analysis.matched_tracks,
            "total_mb_tracks": album_analysis.total_mb_tracks,
            "confidence_boost": album_analysis.confidence_boost,
            "eligible_for_bulk_update": album_analysis.completion_percentage >= 90.0
        },
        "all_matches": matches.iter().map(|m| serde_json::json!({
            "recording_id": m.recording.id,
            "title": m.recording.title,
            "artist": m.recording.primary_artist_name().unwrap_or_default(),
            "confidence_score": m.confidence_score,
            "match_reasons": m.match_reasons,
            "release": m.release.as_ref().map(|r| serde_json::json!({
                "id": r.id,
                "title": r.title,
                "date": r.date,
                "country": r.country,
                "status": r.status
            }))
        })).collect::<Vec<_>>(),
        "version": "1.0"
    });

    // store comprehensive data for web UI decision making
    repository
        .update_song_musicbrainz_metadata(*song_id, &enrichment_data)
        .await?;

    Ok(())
}

/// analyze album completeness from song matches
pub fn analyze_album_completeness_from_songs(
    song_matches: &[(
        &grimoire::music::Song,
        Vec<grimoire::musicbrainz::MusicBrainzMatch>,
    )],
    config: &grimoire::musicbrainz::MusicBrainzConfig,
) -> super::types::AlbumCompletenessReport {
    let total_our_tracks = song_matches.len();
    let matched_tracks = song_matches
        .iter()
        .filter(|(_, matches)| !matches.is_empty())
        .count();

    // estimate musicbrainz track count from release data
    let estimated_mb_tracks = song_matches
        .iter()
        .filter_map(|(_, matches)| matches.first())
        .filter_map(|m| m.release.as_ref())
        .filter_map(|r| r.media.as_ref())
        .flat_map(|media| media.iter())
        .filter_map(|medium| medium.track_count)
        .max()
        .unwrap_or(total_our_tracks as u32) as usize;

    let completion_percentage = if estimated_mb_tracks > 0 {
        (matched_tracks as f32 / estimated_mb_tracks as f32 * 100.0).min(100.0)
    } else {
        0.0
    };

    // calculate confidence boost based on completion
    let confidence_boost = match completion_percentage {
        p if p >= config.album_completion_threshold => 1.2, // 20% boost for complete albums
        p if p >= 70.0 => 1.1,                              // 10% boost for mostly complete
        p if p >= 50.0 => 1.0,                              // no change for partial albums
        _ => 0.9,                                           // slight penalty for few tracks
    };

    super::types::AlbumCompletenessReport {
        total_mb_tracks: estimated_mb_tracks,
        matched_tracks,
        completion_percentage,
        confidence_boost,
    }
}

/// select best release from musicbrainz results based on config preferences
pub fn select_best_release<'a>(
    releases: &'a [grimoire::musicbrainz::Release],
    config: &grimoire::musicbrainz::MusicBrainzConfig,
) -> Option<&'a grimoire::musicbrainz::Release> {
    if releases.is_empty() {
        return None;
    }

    // score each release based on preferences
    let mut scored_releases: Vec<(f32, &grimoire::musicbrainz::Release)> = releases
        .iter()
        .map(|release| {
            let mut score = 0.0;

            // base score from musicbrainz relevance
            if let Some(mb_score) = release.score {
                score += mb_score as f32 / 100.0 * 50.0; // max 50 points from mb score
            }

            // prefer matching country (20 points)
            if let Some(ref country) = release.country {
                if country == &config.preferred_country {
                    score += 20.0;
                }
            }

            // prefer matching status (15 points)
            if let Some(ref status) = release.status {
                if status == &config.preferred_status {
                    score += 15.0;
                }
            }

            // prefer releases with dates (5 points)
            if release.date.is_some() {
                score += 5.0;
            }

            // prefer more recent dates within same year (up to 5 points)
            if let Some(ref date) = release.date {
                if date.len() >= 10 {
                    // full date YYYY-MM-DD, give slight bonus for more specific dates
                    score += 3.0;
                } else if date.len() >= 7 {
                    // month precision YYYY-MM
                    score += 2.0;
                } else if date.len() >= 4 {
                    // year precision YYYY
                    score += 1.0;
                }
            }

            // penalty for bootlegs unless specifically preferred
            if let Some(ref status) = release.status {
                if status == "Bootleg" && config.preferred_status != "Bootleg" {
                    score -= 10.0;
                }
            }

            (score, release)
        })
        .collect();

    // sort by score (highest first)
    scored_releases.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    // return the highest scoring release
    scored_releases.first().map(|(_, release)| *release)
}
