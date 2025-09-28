//! MusicBrainz search functionality
//!
//! This module contains functions for searching MusicBrainz API directly
//! and searching for songs in the local database to match with MusicBrainz.

use grimoire::{
    config::AppConfig,
    database::DatabaseConnection,
    music::repository::MusicRepository,
    musicbrainz::{
        MusicBrainzClient, MusicBrainzService, RecordingSearchQuery, ReleaseSearchQuery,
    },
};
use std::sync::Arc;
use uuid::Uuid;

use crate::music::musicbrainz::utils::{get_musicbrainz_config, print_song_metadata};

/// Handle direct song search on MusicBrainz API
pub async fn handle_search_song(
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<u32>,
    limit: u32,
    config: &AppConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    let musicbrainz_config = get_musicbrainz_config(config)?;
    let client = MusicBrainzClient::new(musicbrainz_config)?;

    // Check that at least one search criterion is provided
    if title.is_none() && artist.is_none() && album.is_none() && duration.is_none() {
        return Err(
            "at least one search criterion (title, artist, album, or duration) must be provided"
                .into(),
        );
    }

    let mut query = RecordingSearchQuery::new().limit(limit);

    if let Some(ref title) = title {
        query = query.title(title);
    }

    if let Some(ref artist) = artist {
        query = query.artist(artist);
    }

    if let Some(ref album) = album {
        query = query.release(album);
    }

    if let Some(duration_secs) = duration {
        query = query.duration(duration_secs * 1000); // convert to milliseconds
    }

    print!("🔍 searching musicbrainz for:");
    if let Some(ref title) = title {
        print!(" title: \"{}\"", title);
    }
    if let Some(ref artist) = artist {
        print!(" artist: \"{}\"", artist);
    }
    if let Some(ref album) = album {
        print!(" album: \"{}\"", album);
    }
    if let Some(duration_secs) = duration {
        print!(" duration: {}s", duration_secs);
    }
    println!();

    let results = client.search_recordings(&query).await?;

    if results.results.is_empty() {
        println!("❌ no results found");
        return Ok(());
    }

    println!("✓ found {} results:\n", results.results.len());

    for (i, recording) in results.results.iter().enumerate() {
        println!("{}. {} ({})", i + 1, recording.title, recording.id);

        if let Some(artist_name) = recording.primary_artist_name() {
            println!("   artist: {}", artist_name);
        }

        if let Some(length) = recording.length {
            println!(
                "   duration: {}:{:02}",
                length / 60000,
                (length / 1000) % 60
            );
        }

        if let Some(ref releases) = recording.releases {
            if let Some(release) = releases.first() {
                println!("   album: {}", release.title);
                if let Some(ref date) = release.date {
                    println!("   year: {}", date);
                }
            }
        }

        if let Some(score) = recording.score {
            println!("   relevance: {}%", score);
        }

        println!();
    }

    Ok(())
}

/// Handle direct album/release search on MusicBrainz API
pub async fn handle_search_album(
    artist: Option<String>,
    album: Option<String>,
    date: Option<String>,
    country: Option<String>,
    limit: u32,
    config: &AppConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    let musicbrainz_config = get_musicbrainz_config(config)?;
    let client = MusicBrainzClient::new(musicbrainz_config)?;

    // Check that at least one search criterion is provided
    if artist.is_none() && album.is_none() && date.is_none() && country.is_none() {
        return Err(
            "at least one search criterion (artist, album, date, or country) must be provided"
                .into(),
        );
    }

    let mut query = ReleaseSearchQuery::new().limit(limit);

    if let Some(ref artist) = artist {
        query = query.artist(artist);
    }

    if let Some(ref album) = album {
        query = query.release(album);
    }

    if let Some(ref date) = date {
        query = query.date(date);
    }

    if let Some(ref country) = country {
        query = query.country(country);
    }

    print!("🔍 searching musicbrainz albums for:");
    if let Some(ref artist) = artist {
        print!(" artist: \"{}\"", artist);
    }
    if let Some(ref album) = album {
        print!(" album: \"{}\"", album);
    }
    if let Some(ref date) = date {
        print!(" date: \"{}\"", date);
    }
    if let Some(ref country) = country {
        print!(" country: \"{}\"", country);
    }
    println!();

    let results = client.search_releases(&query).await?;

    if results.results.is_empty() {
        println!("❌ no results found");
        return Ok(());
    }

    println!("✓ found {} results:\n", results.results.len());

    for (i, release) in results.results.iter().enumerate() {
        println!("{}. {} ({})", i + 1, release.title, release.id);

        if let Some(ref artist_credit) = release.artist_credit {
            if let Some(artist) = artist_credit.first() {
                println!("   artist: {}", artist.name);
            }
        }

        if let Some(ref date) = release.date {
            println!("   date: {}", date);
        }

        if let Some(ref country) = release.country {
            println!("   country: {}", country);
        }

        if let Some(ref status) = release.status {
            println!("   status: {}", status);
        }

        if let Some(score) = release.score {
            println!("   relevance: {}%", score);
        }

        println!();
    }

    Ok(())
}

/// Handle searching for songs in the database and finding MusicBrainz matches
pub async fn handle_search_database(
    song_id: Option<String>,
    limit: i64,
    verbose: bool,
    config: &AppConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    let musicbrainz_config = get_musicbrainz_config(config)?;
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = DatabaseConnection::new(pool);
    let repository = Arc::new(MusicRepository::new(db.pool().clone()));
    let service = MusicBrainzService::new(musicbrainz_config, repository.clone())?;

    let songs = if let Some(id) = song_id {
        // Search for specific song by ID
        let song_uuid =
            Uuid::parse_str(&id).map_err(|_| format!("invalid song id format: {}", id))?;

        let song = repository.get_song(song_uuid).await?;
        vec![song]
    } else {
        // Get songs that need metadata
        println!(
            "🔍 searching for songs in database that could benefit from musicbrainz metadata..."
        );
        repository.get_songs_paginated(limit, 0).await?
    };

    if songs.is_empty() {
        println!("❌ no songs found");
        return Ok(());
    }

    println!("✓ found {} songs to search\n", songs.len());

    let mut total_processed = 0;
    let mut total_found = 0;
    let mut total_no_match = 0;

    for (i, song) in songs.iter().enumerate() {
        println!("{}. searching for: {}", i + 1, song.title);

        if verbose {
            print_song_metadata(song);
        }

        // Search for matches
        let matches = service.search_for_song(song).await?;

        if matches.is_empty() {
            println!("   ❌ no musicbrainz matches found");
            total_no_match += 1;
        } else {
            println!("   ✓ found {} matches", matches.len());
            total_found += 1;

            // Show best match
            let best_match = &matches[0];
            println!(
                "   best: {} - {} ({:.1}% confidence)",
                best_match
                    .recording
                    .primary_artist_name()
                    .unwrap_or("unknown".to_string()),
                best_match.recording.title,
                best_match.confidence_score * 100.0
            );

            if verbose && matches.len() > 1 {
                println!("   other matches:");
                for (j, m) in matches.iter().skip(1).take(3).enumerate() {
                    println!(
                        "     {}. {} - {} ({:.1}%)",
                        j + 2,
                        m.recording
                            .primary_artist_name()
                            .unwrap_or("unknown".to_string()),
                        m.recording.title,
                        m.confidence_score * 100.0
                    );
                }
                if matches.len() > 4 {
                    println!("     ... and {} more", matches.len() - 4);
                }
            }
        }

        total_processed += 1;
        println!();

        // Rate limiting - respect MusicBrainz API limits
        if total_processed % 10 == 0 {
            println!("⏸️  pausing for rate limiting...");
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        }
    }

    println!("🏁 database search complete:");
    println!("   processed: {}", total_processed);
    println!("   found matches: {}", total_found);
    println!("   no matches: {}", total_no_match);
    println!(
        "   success rate: {:.1}%",
        (total_found as f32 / total_processed as f32) * 100.0
    );

    Ok(())
}
