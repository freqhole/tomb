//! Type definitions for batch processing operations

use grimoire::music::Song;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// metadata enrichment suggestion for a song
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataEnrichment {
    pub song_id: uuid::Uuid,
    pub current_metadata: SongMetadataSummary,
    pub musicbrainz_match: MusicBrainzMatchSummary,
    pub proposed_changes: HashMap<String, String>,
    pub confidence_score: f32,
    pub review_needed: bool,
    pub album_context: Option<AlbumContext>,
}

/// simplified song metadata for comparison
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SongMetadataSummary {
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    pub year: Option<i32>,
    pub genre: Option<String>,
}

/// simplified musicbrainz match summary
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MusicBrainzMatchSummary {
    pub recording_id: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub track_number: Option<i32>,
    pub year: Option<i32>,
    pub confidence_score: f32,
}

/// context about the album this song belongs to
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlbumContext {
    pub likely_album: String,
    pub likely_artist: String,
    pub total_tracks_found: usize,
    pub track_sequence_confidence: f32,
}

/// group of songs that belong to the same album
#[derive(Debug, Clone)]
pub struct AlbumGroup {
    pub artist: String,
    pub album: String,
    pub songs: Vec<Song>,
}

/// analysis of album completeness vs musicbrainz release
#[derive(Debug, Clone)]
pub struct AlbumCompletenessReport {
    pub total_mb_tracks: usize,
    pub matched_tracks: usize,
    pub completion_percentage: f32,
    pub confidence_boost: f32,
}

/// result of processing an album group
#[derive(Debug, Clone)]
pub struct AlbumProcessingResult {
    pub processed_count: usize,
    pub scanned_count: usize,
    pub updated_count: usize,
    pub skipped_count: usize,
}

impl From<&Song> for SongMetadataSummary {
    fn from(song: &Song) -> Self {
        Self {
            title: song.title.clone(),
            artist: song.artist.clone(),
            album: song.album.clone(),
            album_artist: song.album_artist.clone(),
            track_number: song.track_number,
            disc_number: song.disc_number,
            year: song.year,
            genre: song.genre.clone(),
        }
    }
}
