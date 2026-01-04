//! Metadata handling for MusicBrainz operations
//!
//! This module contains functions for previewing and applying metadata changes,
//! direct MusicBrainz operations, and guided song update workflows.

use legacylib::{
    config::AppConfig,
    database::DatabaseConnection,
    music::repository::MusicRepository,
    musicbrainz::{MusicBrainzClient, MusicBrainzMatch, MusicBrainzService},
};

use std::io::{self, Write};
use std::sync::Arc;
use uuid::Uuid;

use crate::music::musicbrainz::utils::{get_musicbrainz_config, print_song_metadata};

/// Handle preview metadata command - show what changes would be made
pub async fn handle_preview_metadata(
    song_id: String,
    recording_id: String,
    config: &AppConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    let musicbrainz_config = get_musicbrainz_config(config)?;
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = DatabaseConnection::new(pool);
    let repository = Arc::new(MusicRepository::new(db.pool().clone()));
    let service = MusicBrainzService::new(musicbrainz_config, repository.clone())?;

    // Get the song
    let song_uuid = song_id.parse::<Uuid>()?;
    let song = repository.get_song(song_uuid).await?;

    println!("📄 current song metadata:");
    print_song_metadata(&song);
    println!();

    // Search for the song to get matches
    let matches = service.search_for_song(&song).await?;
    let mb_match = matches
        .into_iter()
        .find(|m| m.recording.id.to_string() == recording_id)
        .ok_or("recording not found in search results")?;

    // Preview changes
    let preview = service
        .preview_metadata_changes(&song_id, &mb_match)
        .await?;

    println!("📝 proposed metadata changes:");
    for change in &preview.changes {
        println!("  {}: ", change.field);
        println!("    current: {:?}", change.old_value);
        println!("    new: {}", change.new_value);
        println!("    confidence: {:.1}%", change.confidence * 100.0);
    }

    if !preview.cover_art_options.is_empty() {
        println!();
        println!("🖼️  cover art options:");
        for (i, cover_art) in preview.cover_art_options.iter().enumerate() {
            println!(
                "  {}. {} ({})",
                i + 1,
                cover_art.image_url,
                if cover_art.front { "front" } else { "other" }
            );
        }
    }

    Ok(())
}

/// Handle apply metadata command - apply changes to a song
pub async fn handle_apply_metadata(
    song_id: String,
    recording_id: String,
    force: bool,
    config: &AppConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    let musicbrainz_config = get_musicbrainz_config(config)?;
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = DatabaseConnection::new(pool);
    let repository = Arc::new(MusicRepository::new(db.pool().clone()));
    let service = MusicBrainzService::new(musicbrainz_config, repository.clone())?;

    // Get the song
    let song_uuid = song_id.parse::<Uuid>()?;
    let song = repository.get_song(song_uuid).await?;

    println!("📄 current song metadata:");
    print_song_metadata(&song);
    println!();

    // Search for the song to get matches
    let matches = service.search_for_song(&song).await?;
    let mb_match = matches
        .into_iter()
        .find(|m| m.recording.id.to_string() == recording_id)
        .ok_or("recording not found in search results")?;

    // Preview changes
    let preview = service
        .preview_metadata_changes(&song_id, &mb_match)
        .await?;

    if preview.changes.is_empty() {
        println!("✓ no metadata changes needed");
        return Ok(());
    }

    println!("📝 proposed metadata changes:");
    for change in &preview.changes {
        println!("  {}: ", change.field);
        println!("    current: {:?}", change.old_value);
        println!("    new: {}", change.new_value);
        println!("    confidence: {:.1}%", change.confidence * 100.0);
    }

    let should_apply = if force {
        true
    } else {
        print!("❓ apply these changes? (y/n): ");
        io::stdout().flush()?;
        let mut input = String::new();
        io::stdin().read_line(&mut input)?;
        matches!(input.trim().to_lowercase().as_str(), "y" | "yes")
    };

    if should_apply {
        service.apply_metadata(&song_id, &preview.changes).await?;
        println!("✅ metadata updated successfully");
    } else {
        println!("⏭️  changes cancelled");
    }

    Ok(())
}

/// Handle test direct command - test MusicBrainz functionality with direct API calls
pub async fn handle_test_direct(
    song_id: String,
    config: &AppConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    let musicbrainz_config = get_musicbrainz_config(config)?;
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = DatabaseConnection::new(pool);
    let repository = Arc::new(MusicRepository::new(db.pool().clone()));
    let service = MusicBrainzService::new(musicbrainz_config.clone(), repository.clone())?;
    let client = MusicBrainzClient::new(musicbrainz_config)?;

    // Get the song from database
    let song_uuid = song_id.parse::<Uuid>()?;
    let song = repository.get_song(song_uuid).await?;

    println!("🧪 testing direct MusicBrainz functionality");
    println!("📄 current song metadata:");
    print_song_metadata(&song);
    println!();

    // Test search functionality
    println!("🔍 searching MusicBrainz for matches...");
    let matches = service.search_for_song(&song).await?;

    if matches.is_empty() {
        println!("❌ no matches found");
        return Ok(());
    }

    println!("✓ found {} matches:", matches.len());
    for (i, m) in matches.iter().take(3).enumerate() {
        println!(
            "  {}. {} - {} (confidence: {:.1}%)",
            i + 1,
            m.recording.primary_artist_name().unwrap_or_default(),
            m.recording.title,
            m.confidence_score * 100.0
        );
    }
    println!();

    // Test direct API call
    println!("🌐 testing direct API call...");
    let best_match = &matches[0];
    let recording = client
        .get_recording(&best_match.recording.id.to_string())
        .await?;

    println!("✓ fetched recording details:");
    println!("  id: {}", recording.id);
    println!("  title: {}", recording.title);
    if let Some(artist) = recording.primary_artist_name() {
        println!("  artist: {}", artist);
    }
    if let Some(length) = recording.length {
        println!("  duration: {}ms", length);
    }

    Ok(())
}

/// Handle apply direct command - directly apply metadata from MusicBrainz recording
pub async fn handle_apply_direct(
    song_id: String,
    recording_id: String,
    config: &AppConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    let musicbrainz_config = get_musicbrainz_config(config)?;
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = DatabaseConnection::new(pool);
    let repository = Arc::new(MusicRepository::new(db.pool().clone()));
    let service = MusicBrainzService::new(musicbrainz_config.clone(), repository.clone())?;
    let client = MusicBrainzClient::new(musicbrainz_config)?;

    // Get the song from database
    let song_uuid = song_id.parse::<Uuid>()?;
    let song = repository.get_song(song_uuid).await?;

    println!("📄 current song metadata:");
    print_song_metadata(&song);
    println!();

    // Fetch recording data from MusicBrainz
    println!("🌐 fetching recording {} from MusicBrainz...", recording_id);
    let recording = client.get_recording(&recording_id).await?;

    println!(
        "✓ found recording: {} by {}",
        recording.title,
        recording
            .primary_artist_name()
            .unwrap_or("unknown".to_string())
    );

    // Create a match for preview
    let mb_match = MusicBrainzMatch::new(recording, None);

    // Preview changes
    let preview = service
        .preview_metadata_changes(&song_id, &mb_match)
        .await?;

    if preview.changes.is_empty() {
        println!("✓ no metadata changes needed");
        return Ok(());
    }

    println!("📝 proposed metadata changes:");
    for change in &preview.changes {
        println!("  {}: ", change.field);
        println!("    current: {:?}", change.old_value);
        println!("    new: {}", change.new_value);
        println!("    confidence: {:.1}%", change.confidence * 100.0);
    }

    if !preview.cover_art_options.is_empty() {
        println!();
        println!("🖼️  cover art options:");
        for (i, cover_art) in preview.cover_art_options.iter().enumerate() {
            println!(
                "  {}. {} ({})",
                i + 1,
                cover_art.image_url,
                if cover_art.front { "front" } else { "other" }
            );
        }
    }

    // Apply changes
    service.apply_metadata(&song_id, &preview.changes).await?;
    println!("✅ metadata applied successfully");

    Ok(())
}

/// Handle update song command - guided workflow for single song metadata update
pub async fn handle_update_song(
    song_input: &str,
    force: bool,
    config: &AppConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    let musicbrainz_config = get_musicbrainz_config(config)?;
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = DatabaseConnection::new(pool);
    let repository = Arc::new(MusicRepository::new(db.pool().clone()));
    let service = MusicBrainzService::new(musicbrainz_config, repository.clone())?;

    // Try to parse as UUID first
    let song = if let Ok(song_uuid) = Uuid::parse_str(song_input) {
        repository.get_song(song_uuid).await?
    } else {
        // For now, just return an error if not a valid UUID
        // TODO: Implement song search by title once repository API is clarified
        return Err(format!(
            "please provide a valid song UUID. Search by title not yet implemented: {}",
            song_input
        )
        .into());
    };

    println!("🎵 selected song:");
    print_song_metadata(&song);
    println!();

    // Search for MusicBrainz matches
    println!("🔍 searching MusicBrainz for matches...");
    let matches = service.search_for_song(&song).await?;

    if matches.is_empty() {
        println!("❌ no MusicBrainz matches found");
        return Ok(());
    }

    println!("✓ found {} matches:", matches.len());
    for (i, m) in matches.iter().take(5).enumerate() {
        println!(
            "  {}. {} - {} (confidence: {:.1}%)",
            i + 1,
            m.recording.primary_artist_name().unwrap_or_default(),
            m.recording.title,
            m.confidence_score * 100.0
        );
    }

    let selected_match = if force && !matches.is_empty() {
        &matches[0] // Auto-select best match
    } else {
        print!("❓ select match (1-{}, 0 to skip): ", matches.len());
        io::stdout().flush()?;
        let mut input = String::new();
        io::stdin().read_line(&mut input)?;
        let selection: usize = input.trim().parse()?;

        if selection == 0 {
            println!("⏭️  skipped");
            return Ok(());
        }

        if selection > matches.len() {
            return Err("invalid selection".into());
        }

        &matches[selection - 1]
    };

    // Preview and apply changes
    let preview = service
        .preview_metadata_changes(&song.id.to_string(), selected_match)
        .await?;

    if preview.changes.is_empty() {
        println!("✓ no metadata changes needed");
        return Ok(());
    }

    println!("📝 proposed changes:");
    for change in &preview.changes {
        println!(
            "  {}: {} -> {}",
            change.field,
            change
                .old_value
                .as_ref()
                .and_then(|v| v.as_str())
                .unwrap_or("none"),
            change.new_value.as_str().unwrap_or("invalid")
        );
    }

    let should_apply = if force {
        true
    } else {
        print!("❓ apply changes? (y/n): ");
        io::stdout().flush()?;
        let mut input = String::new();
        io::stdin().read_line(&mut input)?;
        matches!(input.trim().to_lowercase().as_str(), "y" | "yes")
    };

    if should_apply {
        service
            .apply_metadata(&song.id.to_string(), &preview.changes)
            .await?;
        println!("✅ metadata updated successfully");
    } else {
        println!("⏭️  changes cancelled");
    }

    Ok(())
}

/// Handle mark reviewed command - mark songs as user-reviewed to prevent re-scanning
pub async fn handle_mark_reviewed(
    song_id: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    all: bool,
    config: &AppConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = DatabaseConnection::new(pool);
    let repository = Arc::new(MusicRepository::new(db.pool().clone()));

    let song_uuid = song_id.as_ref().map(|id| Uuid::parse_str(id)).transpose()?;

    if all {
        println!("🏷️  marking all songs with musicbrainz data as user-reviewed...");
    } else if let Some(id) = &song_id {
        println!("🏷️  marking song {} as user-reviewed...", id);
    } else if artist.is_some() || album.is_some() {
        println!("🏷️  marking songs as user-reviewed with filters...");
        if let Some(artist_filter) = &artist {
            println!("   artist contains: {}", artist_filter);
        }
        if let Some(album_filter) = &album {
            println!("   album contains: {}", album_filter);
        }
    } else {
        return Err("must specify --song-id, --artist, --album, or --all".into());
    }

    let rows_affected = legacylib::musicbrainz::batch::mark_songs_as_reviewed(
        &repository,
        song_uuid,
        artist.as_deref(),
        album.as_deref(),
        all,
    )
    .await?;

    if song_id.is_some() && rows_affected == 0 {
        println!("❌ song not found or has no musicbrainz data");
    } else {
        println!("✅ marked {} songs as user-reviewed", rows_affected);
    }

    Ok(())
}

/// Handle clear data command - remove MusicBrainz metadata from songs
pub async fn handle_clear_data(
    song_id: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    all: bool,
    force: bool,
    config: &AppConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = DatabaseConnection::new(pool);
    let repository = Arc::new(MusicRepository::new(db.pool().clone()));

    // Confirmation prompt unless --force
    if !force {
        print!("⚠️  this will permanently remove musicbrainz metadata. continue? (y/N): ");
        io::stdout().flush()?;

        let mut input = String::new();
        io::stdin().read_line(&mut input)?;

        if !input.trim().to_lowercase().starts_with('y') {
            println!("❌ operation cancelled");
            return Ok(());
        }
    }

    let song_uuid = song_id.as_ref().map(|id| Uuid::parse_str(id)).transpose()?;

    if all {
        println!("🗑️  clearing all musicbrainz data...");
    } else if let Some(id) = &song_id {
        println!("🗑️  clearing musicbrainz data from song {}...", id);
    } else if artist.is_some() || album.is_some() {
        println!("🗑️  clearing musicbrainz data with filters...");
        if let Some(artist_filter) = &artist {
            println!("   artist contains: {}", artist_filter);
        }
        if let Some(album_filter) = &album {
            println!("   album contains: {}", album_filter);
        }
    } else {
        return Err("must specify --song-id, --artist, --album, or --all".into());
    }

    let rows_affected = legacylib::musicbrainz::batch::clear_musicbrainz_data(
        &repository,
        song_uuid,
        artist.as_deref(),
        album.as_deref(),
        all,
    )
    .await?;

    if song_id.is_some() && rows_affected == 0 {
        println!("❌ song not found or has no musicbrainz data");
    } else {
        println!("✅ cleared musicbrainz data from {} songs", rows_affected);
    }

    Ok(())
}
