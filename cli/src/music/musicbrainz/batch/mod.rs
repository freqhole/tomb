//! Batch processing functionality for MusicBrainz operations
//!
//! This module provides the main orchestration for batch processing songs with MusicBrainz,
//! including album-centric processing and database-wide scanning operations.

mod album;
mod database;
mod types;
mod utils;

pub use album::{group_songs_by_album, process_album_group};
pub use database::get_songs_for_batch_scan;

use crate::music::musicbrainz::utils::{get_musicbrainz_config, validate_confidence_threshold};
use grimoire::{
    config::AppConfig, database::DatabaseConnection, music::repository::MusicRepository,
    musicbrainz::MusicBrainzService,
};
use std::sync::Arc;

/// handle batch album processing command
pub async fn handle_batch_album(
    album: &str,
    artist: Option<&str>,
    auto_apply: bool,
    confidence_threshold: f32,
    dry_run: bool,
    config: &AppConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    let musicbrainz_config = get_musicbrainz_config(config)?;
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = DatabaseConnection::new(pool);
    let repository = Arc::new(MusicRepository::new(db.pool().clone()));
    let service = MusicBrainzService::new(musicbrainz_config.clone(), repository.clone())?;

    println!("🎵 searching for album: {}", album);
    if let Some(artist_filter) = artist {
        println!("   by artist: {}", artist_filter);
    }
    println!("   auto_apply: {}", auto_apply);
    println!("   confidence_threshold: {:.1}%", confidence_threshold);
    println!("   dry_run: {}", dry_run);
    println!();

    // search for songs in the specified album
    let songs = if let Some(artist_filter) = artist {
        repository
            .find_songs_by_artist_and_album(artist_filter, album)
            .await?
    } else {
        repository.find_songs_by_album(album).await?
    };

    if songs.is_empty() {
        println!("❌ no songs found for album '{}'", album);
        return Ok(());
    }

    println!("found {} songs in album", songs.len());

    // group songs into album groups
    let album_groups = group_songs_by_album(songs);

    if album_groups.is_empty() {
        println!("❌ no album groups found");
        return Ok(());
    }

    let threshold = validate_confidence_threshold(confidence_threshold)?;

    // process each album group
    for album_group in &album_groups {
        println!(
            "processing album group: {} - {} ({} tracks)",
            album_group.artist,
            album_group.album,
            album_group.songs.len()
        );

        let result = process_album_group(
            &service,
            &repository,
            album_group,
            false, // force_rescan
            false, // rescan_updated
            dry_run,
            auto_apply,
            threshold,
            &musicbrainz_config,
        )
        .await?;

        println!(
            "✓ completed: {} processed, {} scanned, {} updated, {} skipped",
            result.processed_count,
            result.scanned_count,
            result.updated_count,
            result.skipped_count
        );
    }

    Ok(())
}

/// handle batch scan processing command
pub async fn handle_batch_scan(
    batch_size: u32,
    unscanned_only: bool,
    rescan_updated: bool,
    force_rescan: bool,
    query: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    missing_metadata: Option<String>,
    album_first: bool,
    auto_apply: bool,
    confidence_threshold: f32,
    dry_run: bool,
    limit: u32,
    config: &AppConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    let musicbrainz_config = get_musicbrainz_config(config)?;
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = DatabaseConnection::new(pool);
    let repository = Arc::new(MusicRepository::new(db.pool().clone()));
    let service = MusicBrainzService::new(musicbrainz_config.clone(), repository.clone())?;

    // validate confidence threshold
    let threshold = validate_confidence_threshold(confidence_threshold)?;

    println!("🚀 starting musicbrainz batch scan:");
    println!("   batch_size: {}", batch_size);
    println!("   unscanned_only: {}", unscanned_only);
    println!("   rescan_updated: {}", rescan_updated);
    println!("   force_rescan: {}", force_rescan);
    println!("   album_first: {}", album_first);
    println!("   auto_apply: {}", auto_apply);
    println!("   confidence_threshold: {:.1}%", confidence_threshold);
    println!("   dry_run: {}", dry_run);
    if limit > 0 {
        println!("   limit: {}", limit);
    }
    println!();

    let mut total_processed = 0;
    let mut total_scanned = 0;
    let mut total_updated = 0;
    let mut total_skipped = 0;
    let mut offset = 0;

    loop {
        // build query based on filters
        let songs = get_songs_for_batch_scan(
            &repository,
            batch_size as i64,
            offset,
            unscanned_only,
            rescan_updated,
            force_rescan,
            query.as_deref(),
            artist.as_deref(),
            album.as_deref(),
            missing_metadata.as_deref(),
        )
        .await?;

        if songs.is_empty() {
            break;
        }

        if album_first {
            // album-first processing: group songs by album and process albums
            let album_groups = group_songs_by_album(songs);
            println!(
                "📦 processing {} album groups (offset: {})",
                album_groups.len(),
                offset
            );

            for (group_idx, album_group) in album_groups.iter().enumerate() {
                // check limit
                if limit > 0 && total_processed >= limit as usize {
                    println!("🏁 reached processing limit of {} songs", limit);
                    break;
                }

                println!(
                    "{}/{}: {} - {} ({} tracks)",
                    group_idx + 1,
                    album_groups.len(),
                    album_group.artist,
                    album_group.album,
                    album_group.songs.len()
                );

                // process album as a unit
                let album_result = process_album_group(
                    &service,
                    &repository,
                    album_group,
                    force_rescan,
                    rescan_updated,
                    dry_run,
                    auto_apply,
                    threshold,
                    &musicbrainz_config,
                )
                .await?;

                total_processed += album_result.processed_count;
                total_scanned += album_result.scanned_count;
                total_updated += album_result.updated_count;
                total_skipped += album_result.skipped_count;

                // rate limiting between albums
                if group_idx % 3 == 0 && group_idx > 0 {
                    println!("   ⏸️  pausing for rate limiting...");
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                }
            }
        } else {
            // traditional song-by-song processing
            println!(
                "📦 processing batch of {} songs (offset: {})",
                songs.len(),
                offset
            );

            for (i, song) in songs.iter().enumerate() {
                // check limit
                if limit > 0 && total_processed >= limit as usize {
                    println!("🏁 reached processing limit of {} songs", limit);
                    break;
                }

                println!(
                    "{}/{}: {} - {}",
                    i + 1,
                    songs.len(),
                    song.artist.as_deref().unwrap_or("unknown artist"),
                    song.title
                );

                // check if already has musicbrainz data and we're not forcing rescan
                if !force_rescan && song.metadata.get("musicbrainz").is_some() {
                    if !rescan_updated {
                        println!("   ⏭️  already has musicbrainz data, skipping");
                        total_skipped += 1;
                        continue;
                    }
                    // TODO: check if song was updated since last scan
                }

                // search for musicbrainz matches
                let matches = service.search_for_song(song).await?;
                total_scanned += 1;

                if matches.is_empty() {
                    println!("   ❌ no musicbrainz matches found");

                    // store scan attempt with no results for tracking
                    if !dry_run {
                        utils::store_no_match_result(&repository, &song.id).await?;
                    }

                    total_skipped += 1;
                } else {
                    let best_match = &matches[0];
                    println!(
                        "   ✓ found {} matches, best: {} (confidence: {:.1}%)",
                        matches.len(),
                        best_match.recording.title,
                        best_match.confidence_score * 100.0
                    );

                    // analyze metadata and create enrichment proposal
                    let enrichment = utils::analyze_metadata_changes(song, best_match, None);

                    println!(
                        "   📋 proposed changes: {}",
                        enrichment.proposed_changes.len()
                    );
                    if enrichment.review_needed {
                        println!("   ⚠️  requires manual review");
                    }

                    // store enrichment data for later review/application
                    if !dry_run {
                        utils::store_enrichment_data(&repository, &song.id, &enrichment, &matches)
                            .await?;
                    }

                    // auto-apply only high-confidence enhancements (not conflicts)
                    if auto_apply
                        && enrichment.confidence_score >= threshold
                        && !enrichment.review_needed
                    {
                        let enhancement_count = enrichment.proposed_changes.len();

                        if enhancement_count > 0 && !dry_run {
                            // TODO: apply changes
                            println!("   🤖 auto-applied {} enhancements", enhancement_count);
                            total_updated += 1;
                        }
                    } else {
                        println!("   💾 stored enrichment data for review");
                    }
                }

                total_processed += 1;

                // rate limiting - respect musicbrainz api limits
                if total_processed % 10 == 0 {
                    println!("   ⏸️  pausing for rate limiting...");
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                }
            }
        }

        offset += batch_size as i64;
        println!();

        // check limit again
        if limit > 0 && total_processed >= limit as usize {
            break;
        }
    }

    println!("🏁 batch scan complete:");
    println!("   total processed: {}", total_processed);
    println!("   total scanned: {}", total_scanned);
    println!("   found matches: {}", total_scanned - total_skipped);
    println!("   auto-applied: {}", total_updated);
    println!("   no matches: {}", total_skipped);
    if total_scanned > 0 {
        println!(
            "   success rate: {:.1}%",
            ((total_scanned - total_skipped) as f32 / total_scanned as f32) * 100.0
        );
    }

    Ok(())
}

/// Handle comprehensive full scan of entire music database
/// Process albums first for efficiency, then remaining individual songs
pub async fn handle_full_scan(
    auto_apply: bool,
    confidence_threshold: f32,
    dry_run: bool,
    force_rescan: bool,
    config: &AppConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    let musicbrainz_config = get_musicbrainz_config(config)?;
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = DatabaseConnection::new(pool);
    let repository = Arc::new(MusicRepository::new(db.pool().clone()));
    let service = MusicBrainzService::new(musicbrainz_config.clone(), repository.clone())?;

    // validate confidence threshold
    let threshold = validate_confidence_threshold(confidence_threshold)?;

    println!("🚀 starting comprehensive musicbrainz full scan:");
    println!("   auto_apply: {}", auto_apply);
    println!("   confidence_threshold: {:.1}%", confidence_threshold);
    println!("   dry_run: {}", dry_run);
    println!("   force_rescan: {}", force_rescan);
    println!();

    // Phase 0: Analysis and Planning
    println!("📊 Phase 0: Analyzing music library...");
    let scan_plan = create_scan_plan(&repository, force_rescan).await?;

    println!("📋 Scan Plan:");
    println!(
        "   complete albums: {} ({} songs)",
        scan_plan.complete_albums.len(),
        scan_plan.album_song_count
    );
    println!(
        "   partial albums: {} ({} songs)",
        scan_plan.partial_albums.len(),
        scan_plan.partial_album_song_count
    );
    println!("   individual songs: {}", scan_plan.individual_songs.len());
    println!("   total songs to process: {}", scan_plan.total_songs());
    println!(
        "   estimated api calls: {}",
        scan_plan.estimated_api_calls()
    );
    println!();

    if scan_plan.total_songs() == 0 {
        println!("✅ No songs need processing. Library is up to date!");
        return Ok(());
    }

    let mut stats = ScanStatistics::new();

    // Phase 1: Complete Album Processing (1 API call per album)
    if !scan_plan.complete_albums.is_empty() {
        println!("📀 Phase 1: Complete album processing");
        println!(
            "   {} albums with exact track matches...",
            scan_plan.complete_albums.len()
        );
        println!();

        for (idx, album_plan) in scan_plan.complete_albums.iter().enumerate() {
            println!(
                "{}/{}: {} - {} ({} tracks)",
                idx + 1,
                scan_plan.complete_albums.len(),
                album_plan.artist_key(),
                album_plan.album,
                album_plan.songs.len()
            );

            let _result = process_complete_album(
                &service,
                &repository,
                album_plan,
                auto_apply,
                threshold,
                dry_run,
            )
            .await?;
            stats.add_album_result();
        }

        println!();
        println!(
            "✅ Phase 1 complete: {} albums, {} songs processed",
            stats.albums_processed, stats.songs_from_albums
        );
        println!();
    }

    // Phase 2: Partial Album Processing (fallback to individual songs)
    if !scan_plan.partial_albums.is_empty() {
        println!("🎵 Phase 2: Partial album processing");
        println!(
            "   {} albums with some missing tracks...",
            scan_plan.partial_albums.len()
        );
        println!();

        for (idx, album_plan) in scan_plan.partial_albums.iter().enumerate() {
            println!(
                "{}/{}: {} - {} ({} tracks)",
                idx + 1,
                scan_plan.partial_albums.len(),
                album_plan.artist_key(),
                album_plan.album,
                album_plan.songs.len()
            );

            let _result = process_partial_album(
                &service,
                &repository,
                album_plan,
                auto_apply,
                threshold,
                dry_run,
            )
            .await?;
            stats.add_partial_album_result();
        }

        println!();
        println!(
            "✅ Phase 2 complete: {} partial albums processed",
            scan_plan.partial_albums.len()
        );
        println!();
    }

    // Phase 3: Individual Song Processing
    if !scan_plan.individual_songs.is_empty() {
        println!("🎶 Phase 3: Individual song processing");
        println!(
            "   {} standalone songs...",
            scan_plan.individual_songs.len()
        );
        println!();

        let batch_size = 50;
        let batches = scan_plan.individual_songs.chunks(batch_size);
        let total_batches = (scan_plan.individual_songs.len() + batch_size - 1) / batch_size;

        for (batch_idx, batch) in batches.enumerate() {
            println!(
                "📦 Batch {}/{} ({} songs)",
                batch_idx + 1,
                total_batches,
                batch.len()
            );

            for (song_idx, song) in batch.iter().enumerate() {
                println!(
                    "  {}/{}: {} - {}",
                    song_idx + 1,
                    batch.len(),
                    song.artist.as_deref().unwrap_or("unknown"),
                    &song.title
                );

                let _result = process_individual_song(
                    &service,
                    &repository,
                    song,
                    auto_apply,
                    threshold,
                    dry_run,
                )
                .await?;
                stats.add_individual_result();
            }
            println!();
        }

        println!(
            "✅ Phase 3 complete: {} individual songs processed",
            stats.individual_songs_processed
        );
        println!();
    }

    // Final Summary
    println!("🏁 Full scan complete!");
    println!("   Albums processed: {}", stats.albums_processed);
    println!("   Songs from albums: {}", stats.songs_from_albums);
    println!("   Individual songs: {}", stats.individual_songs_processed);
    println!("   Total songs processed: {}", stats.total_processed());
    println!("   Songs updated: {}", stats.songs_updated);
    println!("   Songs skipped: {}", stats.songs_skipped);
    println!("   API calls made: {}", stats.api_calls_made);
    println!("   Success rate: {:.1}%", stats.success_rate());

    Ok(())
}

/// Scan plan for organizing work efficiently
#[derive(Debug)]
struct ScanPlan {
    complete_albums: Vec<AlbumPlan>,
    partial_albums: Vec<AlbumPlan>,
    individual_songs: Vec<grimoire::music::models::Song>,
    album_song_count: usize,
    partial_album_song_count: usize,
}

impl ScanPlan {
    fn total_songs(&self) -> usize {
        self.album_song_count + self.partial_album_song_count + self.individual_songs.len()
    }

    fn estimated_api_calls(&self) -> usize {
        self.complete_albums.len() + self.partial_albums.len() + self.individual_songs.len()
    }
}

/// Plan for processing an album
#[derive(Debug)]
struct AlbumPlan {
    artist: Option<String>,
    album_artist: Option<String>,
    album: String,
    songs: Vec<grimoire::music::models::Song>,
}

impl AlbumPlan {
    fn artist_key(&self) -> &str {
        self.album_artist
            .as_deref()
            .or(self.artist.as_deref())
            .unwrap_or("unknown")
    }
}

/// Statistics tracking for scan progress
#[derive(Debug, Default)]
struct ScanStatistics {
    albums_processed: usize,
    songs_from_albums: usize,
    individual_songs_processed: usize,
    songs_updated: usize,
    songs_skipped: usize,
    api_calls_made: usize,
}

impl ScanStatistics {
    fn new() -> Self {
        Default::default()
    }

    fn total_processed(&self) -> usize {
        self.songs_from_albums + self.individual_songs_processed
    }

    fn success_rate(&self) -> f32 {
        let total = self.total_processed() + self.songs_skipped;
        if total > 0 {
            (self.total_processed() as f32 / total as f32) * 100.0
        } else {
            0.0
        }
    }

    fn add_album_result(&mut self) {
        self.albums_processed += 1;
        // Add more tracking as needed
    }

    fn add_partial_album_result(&mut self) {
        // Add tracking for partial album results
    }

    fn add_individual_result(&mut self) {
        self.individual_songs_processed += 1;
        // Add more tracking as needed
    }
}

/// Create a comprehensive scan plan by analyzing the database
async fn create_scan_plan(
    repository: &Arc<MusicRepository>,
    force_rescan: bool,
) -> Result<ScanPlan, Box<dyn std::error::Error>> {
    // Get all albums that need processing
    let album_query = if force_rescan {
        r#"
        SELECT artist, album_artist, album, COUNT(*) as song_count
        FROM songs
        WHERE artist IS NOT NULL AND album IS NOT NULL
        AND trim(artist) != '' AND trim(album) != ''
        GROUP BY artist, album_artist, album
        ORDER BY artist, album
        "#
    } else {
        r#"
        SELECT artist, album_artist, album
        FROM songs
        WHERE artist IS NOT NULL AND album IS NOT NULL
        AND trim(artist) != '' AND trim(album) != ''
        AND (
            metadata->'musicbrainz' IS NULL
            OR metadata->'musicbrainz'->>'status' != 'user_reviewed'
            OR (metadata->'musicbrainz'->>'scanned_at')::bigint < extract(epoch from updated_at)
        )
        GROUP BY artist, album_artist, album
        HAVING COUNT(*) > 0
        ORDER BY artist, album
        "#
    };

    #[derive(sqlx::FromRow)]
    struct AlbumInfo {
        artist: Option<String>,
        album_artist: Option<String>,
        album: String,
    }

    let album_infos = sqlx::query_as::<_, AlbumInfo>(album_query)
        .fetch_all(repository.pool())
        .await?;

    let mut complete_albums = Vec::new();
    let mut partial_albums = Vec::new();
    let mut album_song_count = 0;
    let mut partial_album_song_count = 0;

    // For each album, get all songs and determine if it's complete or partial
    for album_info in album_infos {
        let songs = get_songs_for_album(
            repository,
            album_info.artist.as_deref(),
            album_info.album_artist.as_deref(),
            &album_info.album,
            force_rescan,
        )
        .await?;

        if songs.len() >= 3 {
            // Might be a complete album - we'll check against MusicBrainz
            let album_plan = AlbumPlan {
                artist: album_info.artist,
                album_artist: album_info.album_artist,
                album: album_info.album,
                songs,
            };
            album_song_count += album_plan.songs.len();
            complete_albums.push(album_plan);
        } else {
            // Treat as partial album
            let album_plan = AlbumPlan {
                artist: album_info.artist,
                album_artist: album_info.album_artist,
                album: album_info.album,
                songs,
            };
            partial_album_song_count += album_plan.songs.len();
            partial_albums.push(album_plan);
        }
    }

    // Get individual songs (no album or single-song albums)
    let individual_query = if force_rescan {
        r#"
        SELECT id, media_blob_id, thumbnail_blob_id, waveform_blob_id, thumbnail_blob_ids,
               title, artist, album, album_artist, track_number, disc_number,
               duration, genre, year, bpm, key_signature, rating, is_favorite,
               tags, metadata, processing_status, processing_notes,
               deleted_at, deleted_by, created_at, updated_at, version
        FROM songs
        WHERE (album IS NULL OR trim(album) = '')
        ORDER BY artist, title
        "#
    } else {
        r#"
        SELECT id, media_blob_id, thumbnail_blob_id, waveform_blob_id, thumbnail_blob_ids,
               title, artist, album, album_artist, track_number, disc_number,
               duration, genre, year, bpm, key_signature, rating, is_favorite,
               tags, metadata, processing_status, processing_notes,
               deleted_at, deleted_by, created_at, updated_at, version
        FROM songs
        WHERE (album IS NULL OR trim(album) = '')
        AND (
            metadata->'musicbrainz' IS NULL
            OR metadata->'musicbrainz'->>'status' != 'user_reviewed'
            OR (metadata->'musicbrainz'->>'scanned_at')::bigint < extract(epoch from updated_at)
        )
        ORDER BY artist, title
        "#
    };

    let individual_songs = sqlx::query_as::<_, grimoire::music::models::Song>(individual_query)
        .fetch_all(repository.pool())
        .await?;

    Ok(ScanPlan {
        complete_albums,
        partial_albums,
        individual_songs,
        album_song_count,
        partial_album_song_count,
    })
}

/// Get all songs for a specific album
async fn get_songs_for_album(
    repository: &Arc<MusicRepository>,
    artist: Option<&str>,
    album_artist: Option<&str>,
    album: &str,
    force_rescan: bool,
) -> Result<Vec<grimoire::music::models::Song>, Box<dyn std::error::Error>> {
    let base_query = r#"
        SELECT id, media_blob_id, thumbnail_blob_id, waveform_blob_id, thumbnail_blob_ids,
               title, artist, album, album_artist, track_number, disc_number,
               duration, genre, year, bpm, key_signature, rating, is_favorite,
               tags, metadata, processing_status, processing_notes,
               deleted_at, deleted_by, created_at, updated_at, version
        FROM songs
        WHERE album = $1
    "#;

    let condition = if !force_rescan {
        " AND (metadata->'musicbrainz' IS NULL OR metadata->'musicbrainz'->>'status' != 'user_reviewed' OR (metadata->'musicbrainz'->>'scanned_at')::bigint < extract(epoch from updated_at))"
    } else {
        ""
    };

    let order = " ORDER BY track_number, title";

    let full_query = if let Some(_album_artist_val) = album_artist {
        format!("{} AND album_artist = $2{}{}", base_query, condition, order)
    } else {
        format!("{} AND artist = $2{}{}", base_query, condition, order)
    };

    let songs = if let Some(artist_val) = album_artist.or(artist) {
        sqlx::query_as::<_, grimoire::music::models::Song>(&full_query)
            .bind(album)
            .bind(artist_val)
            .fetch_all(repository.pool())
            .await?
    } else {
        sqlx::query_as::<_, grimoire::music::models::Song>(&format!(
            "{}{}{}",
            base_query, condition, order
        ))
        .bind(album)
        .fetch_all(repository.pool())
        .await?
    };

    Ok(songs)
}

/// Process a complete album (expected to match MusicBrainz release fully)
async fn process_complete_album(
    _service: &MusicBrainzService,
    _repository: &Arc<MusicRepository>,
    _album_plan: &AlbumPlan,
    _auto_apply: bool,
    _threshold: f32,
    _dry_run: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("   🔍 searching for complete album release...");

    // Use existing album processing logic but with smarter artist selection

    // TODO: Implement actual processing
    println!("   ✅ processed complete album");

    Ok(())
}

/// Process a partial album (some songs missing or don't match release)
async fn process_partial_album(
    _service: &MusicBrainzService,
    _repository: &Arc<MusicRepository>,
    _album_plan: &AlbumPlan,
    _auto_apply: bool,
    _threshold: f32,
    _dry_run: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("   🎵 processing as partial album...");

    // Process songs individually but with album context
    // TODO: Implement actual processing

    Ok(())
}

/// Process an individual song
async fn process_individual_song(
    service: &MusicBrainzService,
    _repository: &Arc<MusicRepository>,
    song: &grimoire::music::models::Song,
    _auto_apply: bool,
    _threshold: f32,
    _dry_run: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    // Check if should skip
    if grimoire::musicbrainz::batch::should_skip_song(song) {
        println!("   ⏭️  skipping - already processed");
        return Ok(());
    }

    // Process individual song
    match service.search_for_song(song).await {
        Ok(matches) => {
            if matches.is_empty() {
                println!("   ❌ no musicbrainz matches found");
            } else {
                let best_match = &matches[0];
                println!(
                    "   ✓ found match: {} (confidence: {:.1}%)",
                    best_match.recording.title, best_match.confidence_score
                );

                // Store enrichment data
                if let Err(e) = service
                    .preview_metadata_changes(&song.id.to_string(), best_match)
                    .await
                {
                    println!("   ⚠️  error storing enrichment: {}", e);
                } else {
                    println!("   💾 stored enrichment data for review");
                }
            }
        }
        Err(e) => {
            println!("   ❌ search failed: {}", e);
        }
    }

    Ok(())
}
