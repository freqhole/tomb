//! musicbrainz service layer
//!
//! provides high-level musicbrainz operations including search, metadata matching,
//! and metadata application with confidence scoring.

use crate::music::{repository::MusicRepository, BulkSongUpdates, BulkUpdateSongsRequest, Song};
use crate::musicbrainz::{
    client::MusicBrainzClient,
    config::MusicBrainzConfig,
    models::{CoverArt, MetadataChange, MetadataPreview, MusicBrainzMatch, Recording, Release},
    queries::{RecordingSearchQuery, ReleaseSearchQuery},
    MusicBrainzError, Result,
};

use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;
use time::OffsetDateTime;
use tracing::{debug, info, warn};

/// musicbrainz service for high-level operations
#[derive(Clone)]
pub struct MusicBrainzService {
    /// musicbrainz api client
    client: MusicBrainzClient,

    /// music repository for database operations
    repository: Arc<MusicRepository>,

    /// musicbrainz configuration
    config: MusicBrainzConfig,
}

impl MusicBrainzService {
    /// create new musicbrainz service
    pub fn new(config: MusicBrainzConfig, repository: Arc<MusicRepository>) -> Result<Self> {
        let client = MusicBrainzClient::new(config.clone())?;

        Ok(Self {
            client,
            repository,
            config,
        })
    }

    /// search for musicbrainz matches for a single song
    pub async fn search_for_song(&self, song: &Song) -> Result<Vec<MusicBrainzMatch>> {
        // first try with album included
        let query = RecordingSearchQuery::from_song(
            song,
            true,
            self.config.duration_tolerance_seconds,
            self.config.enable_duration_matching,
        );
        let search_result = self.client.search_recordings(&query).await?;

        debug!(
            "found {} recordings for song '{}' (with album)",
            search_result.results.len(),
            song.title
        );

        // if no results and we have an album, try without album (bootleg compatibility)
        let search_result = if search_result.results.is_empty() && song.album.is_some() {
            debug!(
                "retrying search without album for song '{}' (bootleg compatibility)",
                song.title
            );
            let fallback_query = RecordingSearchQuery::from_song_no_album(
                song,
                self.config.duration_tolerance_seconds,
                self.config.enable_duration_matching,
            );
            self.client.search_recordings(&fallback_query).await?
        } else {
            search_result
        };

        debug!(
            "found {} recordings for song '{}'",
            search_result.results.len(),
            song.title
        );

        let mut matches = Vec::new();

        for recording in search_result.results {
            let mut mb_match = MusicBrainzMatch::new(recording.clone(), None);

            // calculate confidence score
            self.calculate_confidence_score(&mut mb_match, song);

            // try to get release information for the best matches
            if mb_match.confidence_score > 60.0 {
                if let Some(releases) = &recording.releases {
                    if let Some(release) = releases.first() {
                        if let Ok(full_release) =
                            self.client.get_release(&release.id.to_string()).await
                        {
                            mb_match.release = Some(full_release);
                        }
                    }
                }
            }

            matches.push(mb_match);
        }

        // sort by confidence score
        matches.sort_by(|a, b| b.confidence_score.partial_cmp(&a.confidence_score).unwrap());

        Ok(matches)
    }

    /// search for musicbrainz matches for multiple songs
    pub async fn search_for_songs(
        &self,
        songs: &[Song],
    ) -> Result<HashMap<String, Vec<MusicBrainzMatch>>> {
        let mut results = HashMap::new();

        for song in songs {
            match self.search_for_song(song).await {
                Ok(matches) => {
                    results.insert(song.id.to_string(), matches);
                }
                Err(e) => {
                    warn!("failed to search for song '{}': {}", song.title, e);
                    results.insert(song.id.to_string(), Vec::new());
                }
            }

            // small delay between batch requests
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }

        Ok(results)
    }

    /// search for album/release matches
    pub async fn search_for_album(&self, artist: &str, album: &str) -> Result<Vec<Release>> {
        let query = ReleaseSearchQuery::new()
            .artist(artist)
            .release(album)
            .limit(25);

        let search_result = self.client.search_releases(&query).await?;

        debug!(
            "found {} releases for album '{}' by '{}'",
            search_result.results.len(),
            album,
            artist
        );

        Ok(search_result.results)
    }

    /// perform custom search with raw query
    pub async fn custom_search(
        &self,
        query_type: &str,
        query_string: &str,
    ) -> Result<serde_json::Value> {
        match query_type {
            "recording" => {
                let mut query = RecordingSearchQuery::new();
                query
                    .extra_params
                    .insert("query".to_string(), query_string.to_string());
                let result = self.client.search_recordings(&query).await?;
                Ok(serde_json::to_value(result)?)
            }
            "release" => {
                let mut query = ReleaseSearchQuery::new();
                query
                    .extra_params
                    .insert("query".to_string(), query_string.to_string());
                let result = self.client.search_releases(&query).await?;
                Ok(serde_json::to_value(result)?)
            }
            _ => Err(MusicBrainzError::InvalidQuery(format!(
                "unsupported query type: {}",
                query_type
            ))),
        }
    }

    /// preview metadata changes for a song
    pub async fn preview_metadata_changes(
        &self,
        song_id: &str,
        mb_match: &MusicBrainzMatch,
    ) -> Result<MetadataPreview> {
        let song_uuid = song_id
            .parse::<uuid::Uuid>()
            .map_err(|e| MusicBrainzError::ConfigError(format!("invalid song id: {}", e)))?;

        let song = self
            .repository
            .get_song(song_uuid)
            .await
            .map_err(|e| MusicBrainzError::ConfigError(format!("failed to get song: {}", e)))?;

        let current_metadata = self.song_to_metadata_map(&song);
        let proposed_metadata =
            self.recording_to_metadata_map(&mb_match.recording, mb_match.release.as_ref());

        // Use consolidated conservative enrichment logic
        let changes = self.analyze_metadata_changes_conservative(&song, mb_match);

        // get cover art options if available
        let cover_art_options = if let Some(ref release) = mb_match.release {
            if release.has_cover_art() {
                match self.client.get_cover_art(&release.id.to_string()).await {
                    Ok(cover_art) => cover_art,
                    Err(_) => Vec::new(),
                }
            } else {
                Vec::new()
            }
        } else {
            Vec::new()
        };

        Ok(MetadataPreview {
            song_id: song_id.to_string(),
            current_metadata,
            proposed_metadata,
            changes,
            cover_art_options,
        })
    }

    /// apply metadata changes to a song
    pub async fn apply_metadata(
        &self,
        song_id: &str,
        metadata_changes: &[MetadataChange],
    ) -> Result<()> {
        let song_uuid = song_id
            .parse::<uuid::Uuid>()
            .map_err(|e| MusicBrainzError::ConfigError(format!("invalid song id: {}", e)))?;

        let mut song = self
            .repository
            .get_song(song_uuid)
            .await
            .map_err(|e| MusicBrainzError::ConfigError(format!("failed to get song: {}", e)))?;

        // apply changes
        for change in metadata_changes {
            match change.field.as_str() {
                "title" => {
                    if let Some(new_value) = change.new_value.as_str() {
                        song.title = new_value.to_string();
                    }
                }
                "artist" => {
                    if let Some(new_value) = change.new_value.as_str() {
                        song.artist = Some(new_value.to_string());
                    }
                }
                "album" => {
                    if let Some(new_value) = change.new_value.as_str() {
                        song.album = Some(new_value.to_string());
                    }
                }
                "album_artist" => {
                    if let Some(new_value) = change.new_value.as_str() {
                        song.album_artist = Some(new_value.to_string());
                    }
                }
                "track_number" => {
                    if let Some(new_value) = change.new_value.as_u64() {
                        song.track_number = Some(new_value as i32);
                    }
                }
                "disc_number" => {
                    if let Some(new_value) = change.new_value.as_u64() {
                        song.disc_number = Some(new_value as i32);
                    }
                }
                "year" => {
                    if let Some(new_value) = change.new_value.as_u64() {
                        song.year = Some(new_value as i32);
                    }
                }
                "genre" => {
                    if let Some(new_value) = change.new_value.as_str() {
                        song.genre = Some(new_value.to_string());
                    }
                }
                "musicbrainz_id" => {
                    // musicbrainz_id will be stored in metadata json field
                    // handled separately below
                }
                _ => {
                    warn!("unknown metadata field: {}", change.field);
                }
            }
        }

        // create musicbrainz metadata tracking
        let mut musicbrainz_metadata = serde_json::json!({
            "updated_at": OffsetDateTime::now_utc().to_string(),
            "confidence_scores": metadata_changes.iter()
                .map(|c| (c.field.clone(), c.confidence))
                .collect::<std::collections::HashMap<_, _>>(),
            "fields_updated": metadata_changes.iter()
                .map(|c| c.field.clone())
                .collect::<Vec<_>>(),
            "source": "musicbrainz_integration_v1"
        });

        // add recording and release ids if available
        if let Some(mb_recording_id) = metadata_changes
            .iter()
            .find(|c| c.field == "musicbrainz_id")
            .and_then(|c| c.new_value.as_str())
        {
            musicbrainz_metadata["recording_id"] =
                serde_json::Value::String(mb_recording_id.to_string());
        }

        // merge with existing metadata
        let mut updated_metadata = song.metadata.clone();
        if let Some(obj) = updated_metadata.as_object_mut() {
            obj.insert("musicbrainz".to_string(), musicbrainz_metadata);
        } else {
            updated_metadata = serde_json::json!({
                "musicbrainz": musicbrainz_metadata
            });
        }

        // update song in repository using bulk update
        let updates = BulkSongUpdates {
            tags: None, // don't modify tags
            title: Some(song.title.clone()),
            artist: song.artist.clone(),
            album: song.album.clone(),
            album_artist: song.album_artist.clone(),
            track_number: song.track_number,
            disc_number: song.disc_number,
            genre: song.genre.clone(),
            sub_genres: song.sub_genres.clone(),
            year: song.year,
            bpm: song.bpm,
            key_signature: song.key_signature.clone(),
            thumbnail_blob_id: song.thumbnail_blob_id.clone(),
            metadata: Some(updated_metadata),
        };

        let update_request = BulkUpdateSongsRequest {
            song_ids: vec![song.id],
            updates,
        };

        self.repository
            .bulk_update_songs(update_request)
            .await
            .map_err(|e| MusicBrainzError::ConfigError(format!("failed to update song: {}", e)))?;

        info!(
            "applied {} metadata changes to song '{}'",
            metadata_changes.len(),
            song.title
        );

        Ok(())
    }

    /// fetch cover art for a release
    pub async fn fetch_cover_art(&self, release_mbid: &str) -> Result<Vec<CoverArt>> {
        self.client.get_cover_art(release_mbid).await
    }

    /// get specific release by musicbrainz id
    pub async fn get_release(&self, mbid: &str) -> Result<Release> {
        self.client.get_release(mbid).await
    }

    /// calculate confidence score for a musicbrainz match
    fn calculate_confidence_score(&self, mb_match: &mut MusicBrainzMatch, song: &Song) {
        // clone data we need to avoid borrowing issues
        let recording_title = mb_match.recording.title.clone();
        let recording_artist = mb_match.recording.primary_artist_name();
        let recording_length = mb_match.recording.length;
        let recording_releases = mb_match.recording.releases.clone();
        let recording_score = mb_match.recording.score;

        // title matching (most important)
        if let Some(score) = self.calculate_string_similarity(&song.title, &recording_title) {
            if score > 0.8 {
                mb_match.add_reason("exact title match".to_string(), 40.0);
            } else if score > 0.6 {
                mb_match.add_reason("similar title".to_string(), 25.0);
            } else if score > 0.4 {
                mb_match.add_reason("partial title match".to_string(), 10.0);
            }
        }

        // artist matching
        if let Some(ref song_artist) = song.artist {
            if let Some(recording_artist) = recording_artist {
                if let Some(score) =
                    self.calculate_string_similarity(song_artist, &recording_artist)
                {
                    if score > 0.8 {
                        mb_match.add_reason("exact artist match".to_string(), 30.0);
                    } else if score > 0.6 {
                        mb_match.add_reason("similar artist".to_string(), 20.0);
                    } else if score > 0.4 {
                        mb_match.add_reason("partial artist match".to_string(), 10.0);
                    }
                }
            }
        }

        // duration matching
        if let Some(song_duration_interval) = song.duration {
            let song_duration_ms = (song_duration_interval.microseconds / 1000) as u32;
            if let Some(recording_duration) = recording_length {
                let diff = (song_duration_ms as i64 - recording_duration as i64).abs();
                if diff < 2000 {
                    // within 2 seconds
                    mb_match.add_reason("exact duration match".to_string(), 20.0);
                } else if diff < 5000 {
                    // within 5 seconds
                    mb_match.add_reason("similar duration".to_string(), 10.0);
                } else if diff < 10000 {
                    // within 10 seconds
                    mb_match.add_reason("approximate duration".to_string(), 5.0);
                }
            }
        }

        // album matching (if available)
        if let Some(ref song_album) = song.album {
            if let Some(ref releases) = recording_releases {
                for release in releases {
                    if let Some(score) =
                        self.calculate_string_similarity(song_album, &release.title)
                    {
                        if score > 0.8 {
                            mb_match.add_reason("exact album match".to_string(), 15.0);
                            break;
                        } else if score > 0.6 {
                            mb_match.add_reason("similar album".to_string(), 8.0);
                            break;
                        }
                    }
                }
            }
        }

        // musicbrainz score boost
        if let Some(mb_score) = recording_score {
            let boost = (mb_score as f32 / 100.0) * 5.0; // max 5 point boost
            mb_match.add_reason(format!("musicbrainz relevance: {}", mb_score), boost);
        }
    }

    /// calculate string similarity using jaro-winkler algorithm (simplified version)
    fn calculate_string_similarity(&self, s1: &str, s2: &str) -> Option<f32> {
        let s1_lower = s1.to_lowercase();
        let s2_lower = s2.to_lowercase();
        let s1 = s1_lower.trim();
        let s2 = s2_lower.trim();

        if s1 == s2 {
            return Some(1.0);
        }

        if s1.is_empty() || s2.is_empty() {
            return Some(0.0);
        }

        // simple similarity based on common characters and length
        let common_chars = s1.chars().filter(|c| s2.contains(*c)).count();
        let max_len = s1.len().max(s2.len());

        Some(common_chars as f32 / max_len as f32)
    }

    /// convert song to metadata map
    fn song_to_metadata_map(&self, song: &Song) -> HashMap<String, serde_json::Value> {
        let mut metadata = HashMap::new();

        metadata.insert("title".to_string(), json!(song.title));

        if let Some(ref artist) = song.artist {
            metadata.insert("artist".to_string(), json!(artist));
        }

        if let Some(ref album) = song.album {
            metadata.insert("album".to_string(), json!(album));
        }

        if let Some(ref album_artist) = song.album_artist {
            metadata.insert("album_artist".to_string(), json!(album_artist));
        }

        if let Some(track_number) = song.track_number {
            metadata.insert("track_number".to_string(), json!(track_number));
        }

        if let Some(disc_number) = song.disc_number {
            metadata.insert("disc_number".to_string(), json!(disc_number));
        }

        if let Some(year) = song.year {
            metadata.insert("year".to_string(), json!(year));
        }

        if let Some(ref genre) = song.genre {
            metadata.insert("genre".to_string(), json!(genre));
        }

        // Note: musicbrainz_id is not currently a field on Song model
        // This would need to be added to the database schema and model
        // For now, we'll skip this field
        /*
        if let Some(ref musicbrainz_id) = song.musicbrainz_id {
            metadata.insert("musicbrainz_id".to_string(), json!(musicbrainz_id));
        }
        */

        metadata
    }

    /// convert recording to metadata map
    fn recording_to_metadata_map(
        &self,
        recording: &Recording,
        release: Option<&Release>,
    ) -> HashMap<String, serde_json::Value> {
        let mut metadata = HashMap::new();

        metadata.insert("title".to_string(), json!(recording.title));
        metadata.insert("musicbrainz_id".to_string(), json!(recording.id));

        if let Some(artist_name) = recording.primary_artist_name() {
            metadata.insert("artist".to_string(), json!(artist_name));
        }

        if let Some(release) = release {
            metadata.insert("album".to_string(), json!(release.title));

            if let Some(artist_name) = release.primary_artist_name() {
                metadata.insert("album_artist".to_string(), json!(artist_name));
            }

            // extract year from release date
            if let Some(ref date) = release.date {
                if let Some(year_str) = date.split('-').next() {
                    if let Ok(year) = year_str.parse::<i32>() {
                        metadata.insert("year".to_string(), json!(year));
                    }
                }
            }
        }

        // extract genre from tags
        if let Some(ref tags) = recording.tags {
            if let Some(genre_tag) = tags.first() {
                metadata.insert("genre".to_string(), json!(genre_tag.name));
            }
        }

        metadata
    }

    /// Consolidated metadata enrichment logic - conservative approach
    pub fn analyze_metadata_changes_conservative(
        &self,
        song: &crate::music::Song,
        mb_match: &MusicBrainzMatch,
    ) -> Vec<MetadataChange> {
        let mut proposed_changes = Vec::new();

        // 1. Add missing artist
        if song.artist.is_none() {
            if let Some(mb_artist) = mb_match.recording.primary_artist_name() {
                if !mb_artist.is_empty() {
                    proposed_changes.push(MetadataChange {
                        field: "artist".to_string(),
                        old_value: None,
                        new_value: serde_json::Value::String(mb_artist),
                        confidence: mb_match.confidence_score,
                    });
                }
            }
        }

        // 2. Add missing genre from MusicBrainz tags (only if missing)
        if song.genre.is_none() {
            if let Some(ref tags) = mb_match.recording.tags {
                if let Some(first_tag) = tags.first() {
                    proposed_changes.push(MetadataChange {
                        field: "genre".to_string(),
                        old_value: None,
                        new_value: serde_json::Value::String(first_tag.name.clone()),
                        confidence: mb_match.confidence_score * 0.7,
                    });
                }
            }
        }

        // 3. Add missing year from release date (only if missing)
        if song.year.is_none() {
            if let Some(ref release) = mb_match.release {
                if let Some(ref date) = release.date {
                    // Extract year from date (YYYY-MM-DD format)
                    if let Some(year_str) = date.split('-').next() {
                        if let Ok(year) = year_str.parse::<i32>() {
                            proposed_changes.push(MetadataChange {
                                field: "year".to_string(),
                                old_value: None,
                                new_value: serde_json::Value::Number(serde_json::Number::from(
                                    year,
                                )),
                                confidence: mb_match.confidence_score * 0.9,
                            });
                        }
                    }
                }
            }
        }

        // 4. Clean contaminated titles (remove artist suffixes)
        let current_title = &song.title;
        if let Some(ref artist) = song.artist {
            let artist_lower = artist.to_lowercase();
            let title_lower = current_title.to_lowercase();

            // Check if title ends with " - {artist}" pattern
            let suffix = format!(" - {}", artist_lower);
            if title_lower.ends_with(&suffix) {
                let clean_title = current_title[..current_title.len() - suffix.len()].to_string();
                if !clean_title.is_empty() && clean_title != *current_title {
                    proposed_changes.push(MetadataChange {
                        field: "title".to_string(),
                        old_value: Some(serde_json::Value::String(current_title.clone())),
                        new_value: serde_json::Value::String(clean_title),
                        confidence: mb_match.confidence_score * 0.95,
                    });
                }
            }
        }

        // 5. Only suggest album changes for very specific cases (removed hardcoded string matching)
        // For now, skip album suggestions entirely to be conservative
        // TODO: Implement smarter album matching logic based on MusicBrainz release types

        proposed_changes
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_string_similarity() {
        let config = MusicBrainzConfig::default();
        let client = MusicBrainzClient::new(config).unwrap();

        // create a minimal service for testing string similarity
        let service_impl = MusicBrainzServiceImpl { client };

        assert_eq!(
            service_impl.calculate_string_similarity("bohemian rhapsody", "bohemian rhapsody"),
            Some(1.0)
        );

        assert!(
            service_impl
                .calculate_string_similarity("bohemian rhapsody", "bohemian")
                .unwrap()
                > 0.5
        );

        assert_eq!(
            service_impl.calculate_string_similarity("", "test"),
            Some(0.0)
        );
    }

    // helper struct for testing methods without database dependency
    struct MusicBrainzServiceImpl {
        client: MusicBrainzClient,
    }

    impl MusicBrainzServiceImpl {
        fn calculate_string_similarity(&self, s1: &str, s2: &str) -> Option<f32> {
            let s1 = s1.to_lowercase().trim();
            let s2 = s2.to_lowercase().trim();

            if s1 == s2 {
                return Some(1.0);
            }

            if s1.is_empty() || s2.is_empty() {
                return Some(0.0);
            }

            let common_chars = s1.chars().filter(|c| s2.contains(*c)).count();
            let max_len = s1.len().max(s2.len());

            Some(common_chars as f32 / max_len as f32)
        }
    }
}
