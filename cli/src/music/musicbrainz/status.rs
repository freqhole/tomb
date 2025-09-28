//! Status and progress reporting for MusicBrainz operations
//!
//! This module contains functions for displaying processing status,
//! progress tracking, and generating reports on MusicBrainz integration.

use grimoire::{
    config::AppConfig,
    database::DatabaseConnection,
    music::{get_albums_for_processing, get_processing_progress, ProcessingStatus},
};

use crate::music::musicbrainz::utils::get_musicbrainz_config;

/// Handle status command - show processing progress and statistics
pub async fn handle_status(
    detailed: bool,
    filter_status: Option<&str>,
    config: &AppConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = DatabaseConnection::new(pool);

    println!("🎵 musicbrainz processing status:");
    println!();

    // Get overall progress
    let progress = get_processing_progress(db.pool()).await?;

    println!("📊 overall progress:");
    println!("   total songs: {}", progress.total_songs.unwrap_or(0));
    println!("   processed: {}", progress.processed_songs.unwrap_or(0));
    println!("   skipped: {}", progress.skipped_songs.unwrap_or(0));
    println!(
        "   unprocessed: {}",
        progress.unprocessed_songs.unwrap_or(0)
    );
    println!(
        "   review needed: {}",
        progress.review_needed_songs.unwrap_or(0)
    );
    println!("   duplicates: {}", progress.duplicate_songs.unwrap_or(0));
    println!("   progress: {:.1}%", progress.songs_processed_percentage());
    println!();

    if detailed {
        // Parse filter status
        let status_filter = filter_status.and_then(|s| match s {
            "unprocessed" => Some(ProcessingStatus::Unprocessed),
            "processed" => Some(ProcessingStatus::Processed),
            "skip" => Some(ProcessingStatus::Skip),
            "review_needed" => Some(ProcessingStatus::ReviewNeeded),
            "duplicate" => Some(ProcessingStatus::Duplicate),
            _ => None,
        });

        println!("📁 albums:");
        let albums =
            get_albums_for_processing(db.pool(), status_filter, None, Some(20), Some(0)).await?;

        for album in albums {
            println!(
                "   {} - {}",
                album.artist_name.as_deref().unwrap_or("unknown"),
                album.album_name.as_deref().unwrap_or("unknown")
            );
            println!(
                "     songs: {} (processed: {})",
                album.song_count, album.processed_count
            );
            println!("     status: {}", album.status);
            if let Some(notes) = &album.notes {
                println!("     notes: {}", notes);
            }
            println!();
        }
    }

    // Show MusicBrainz configuration status
    match get_musicbrainz_config(config) {
        Ok(mb_config) => {
            println!("⚙️  musicbrainz configuration:");
            println!("   enabled: {}", mb_config.enabled);
            println!("   rate_limit_ms: {}", mb_config.rate_limit_ms);
            println!("   base_url: {}", mb_config.base_url);
        }
        Err(e) => {
            println!("⚠️  musicbrainz configuration error: {}", e);
        }
    }

    Ok(())
}
