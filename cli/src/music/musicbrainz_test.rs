//! musicbrainz test utilities for direct metadata updates
//!
//! provides utility functions for testing musicbrainz integration
//! without requiring search matches first

use legacylib::{
    config::AppConfig,
    database::DatabaseConnection,
    music::{repository::MusicRepository, Song},
    musicbrainz::{
        MetadataChange, MusicBrainzClient, MusicBrainzConfig, MusicBrainzMatch, MusicBrainzService,
        Recording, Release,
    },
};
use std::sync::Arc;
use uuid::Uuid;

/// test helper to directly apply musicbrainz metadata to a song
pub async fn test_apply_metadata_direct(
    config: &AppConfig,
    song_id: &str,
    recording_id: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let musicbrainz_config = config.musicbrainz.clone();
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = DatabaseConnection::new(pool);
    let repository = Arc::new(MusicRepository::new(db.pool().clone()));
    let service = MusicBrainzService::new(musicbrainz_config.clone(), repository.clone())?;
    let client = MusicBrainzClient::new(musicbrainz_config)?;

    // get the song from database
    let song_uuid = song_id.parse::<Uuid>()?;
    let song = repository.get_song(song_uuid).await?;

    println!("current song metadata:");
    print_song_metadata(&song);
    println!();

    // fetch recording data from musicbrainz
    println!("fetching recording {} from musicbrainz...", recording_id);
    let recording = client.get_recording(recording_id).await?;

    println!(
        "found recording: {} by {}",
        recording.title,
        recording
            .primary_artist_name()
            .unwrap_or("unknown".to_string())
    );

    // create a mock match for preview
    let mb_match = MusicBrainzMatch::new(recording, None);

    // preview changes
    let preview = service.preview_metadata_changes(song_id, &mb_match).await?;

    if preview.changes.is_empty() {
        println!("no metadata changes needed");
        return Ok(());
    }

    println!("\nproposed metadata changes:");
    for change in &preview.changes {
        println!("  {}: ", change.field);
        println!("    current: {:?}", change.old_value);
        println!("    new: {}", change.new_value);
        println!("    confidence: {:.1}%", change.confidence);
    }

    if !preview.cover_art_options.is_empty() {
        println!("\ncover art options:");
        for (i, cover_art) in preview.cover_art_options.iter().enumerate() {
            println!(
                "  {}. {} ({})",
                i + 1,
                cover_art.image_url,
                if cover_art.front { "front" } else { "other" }
            );
        }
    }

    // apply changes
    println!("\napplying metadata changes...");
    service.apply_metadata(song_id, &preview.changes).await?;

    // show updated song
    let updated_song = repository.get_song(song_uuid).await?;
    println!("\nupdated song metadata:");
    print_song_metadata(&updated_song);

    println!("✓ metadata updated successfully");

    Ok(())
}

/// test helper to find and display musicbrainz matches for a song
pub async fn test_find_matches(
    config: &AppConfig,
    song_id: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let musicbrainz_config = config.musicbrainz.clone();
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = DatabaseConnection::new(pool);
    let repository = Arc::new(MusicRepository::new(db.pool().clone()));
    let service = MusicBrainzService::new(musicbrainz_config, repository.clone())?;

    // get the song from database
    let song_uuid = song_id.parse::<Uuid>()?;
    let song = repository.get_song(song_uuid).await?;

    println!("searching musicbrainz for song:");
    print_song_metadata(&song);
    println!();

    // search for matches
    let matches = service.search_for_song(&song).await?;

    if matches.is_empty() {
        println!("no matches found");
        return Ok(());
    }

    println!("found {} matches:", matches.len());
    for (i, mb_match) in matches.iter().take(10).enumerate() {
        println!(
            "\n{}. {} - {} (confidence: {:.1}%)",
            i + 1,
            mb_match
                .recording
                .primary_artist_name()
                .unwrap_or("unknown".to_string()),
            mb_match.recording.title,
            mb_match.confidence_score
        );
        println!("   id: {}", mb_match.recording.id);
        if !mb_match.match_reasons.is_empty() {
            println!("   reasons: {}", mb_match.match_reasons.join(", "));
        }
        if let Some(length) = mb_match.recording.length {
            println!(
                "   duration: {}:{:02}",
                length / 60000,
                (length / 1000) % 60
            );
        }
        if let Some(ref releases) = mb_match.recording.releases {
            if let Some(release) = releases.first() {
                println!("   album: {}", release.title);
            }
        }
    }

    Ok(())
}

/// test helper to check cover art for a release
pub async fn test_cover_art(
    config: &AppConfig,
    release_id: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let musicbrainz_config = config.musicbrainz.clone();
    let client = MusicBrainzClient::new(musicbrainz_config)?;

    println!("fetching cover art for release: {}", release_id);

    match client.get_cover_art(release_id).await {
        Ok(cover_art) => {
            if cover_art.is_empty() {
                println!("no cover art found");
            } else {
                println!("found {} cover art images:", cover_art.len());
                for (i, art) in cover_art.iter().enumerate() {
                    println!("  {}. {}", i + 1, art.image_url);
                    println!("     thumbnail: {}", art.thumbnail_url);
                    println!("     types: {:?}", art.types);
                    println!("     front: {}, approved: {}", art.front, art.approved);
                }
            }
        }
        Err(e) => {
            println!("error fetching cover art: {}", e);
        }
    }

    Ok(())
}

/// test comprehensive musicbrainz workflow
pub async fn test_full_workflow(
    config: &AppConfig,
    song_id: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("=== musicbrainz comprehensive test ===");

    // step 1: find matches
    println!("\nstep 1: finding musicbrainz matches...");
    test_find_matches(config, song_id).await?;

    println!("\n" + "=".repeat(50));
    println!("to apply metadata, use one of the recording ids above:");
    println!(
        "./target/debug/cli music musicbrainz-test apply-direct {} <recording-id>",
        song_id
    );

    Ok(())
}

fn print_song_metadata(song: &Song) {
    println!("  id: {}", song.id);
    println!("  title: {}", song.title);
    if let Some(ref artist) = song.artist {
        println!("  artist: {}", artist);
    }
    if let Some(ref album) = song.album {
        println!("  album: {}", album);
    }
    if let Some(ref album_artist) = song.album_artist {
        println!("  album_artist: {}", album_artist);
    }
    if let Some(track_number) = song.track_number {
        println!("  track_number: {}", track_number);
    }
    if let Some(year) = song.year {
        println!("  year: {}", year);
    }
    if let Some(ref genre) = song.genre {
        println!("  genre: {}", genre);
    }
    if let Some(duration) = song.formatted_duration() {
        println!("  duration: {}", duration);
    }

    // show musicbrainz metadata if present
    if let Some(mb_metadata) = song.metadata.get("musicbrainz") {
        println!(
            "  musicbrainz_data: {}",
            serde_json::to_string_pretty(mb_metadata).unwrap_or_default()
        );
    }
}
