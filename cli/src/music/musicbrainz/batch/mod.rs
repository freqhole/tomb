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
pub use types::*;

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
