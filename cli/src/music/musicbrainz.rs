//! musicbrainz cli commands
//!
//! provides command line interface for testing musicbrainz integration
//! including song search, metadata preview, and bulk operations.

use clap::{Args, Subcommand};
use grimoire::{
    config::AppConfig,
    database::DatabaseConnection,
    music::repository::MusicRepository,
    musicbrainz::{
        MusicBrainzClient, MusicBrainzConfig, MusicBrainzMatch, MusicBrainzService,
        RecordingSearchQuery, ReleaseSearchQuery,
    },
};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Clone, Args)]
pub struct MusicBrainzArgs {
    #[command(subcommand)]
    pub command: MusicBrainzCommands,
}

#[derive(Debug, Clone, Subcommand)]
pub enum MusicBrainzCommands {
    /// search for a song on musicbrainz
    SearchSong {
        /// song title (optional)
        #[arg(short, long)]
        title: Option<String>,
        /// artist name (optional)
        #[arg(short, long)]
        artist: Option<String>,
        /// album name (optional)
        #[arg(short = 'l', long)]
        album: Option<String>,
        /// duration in seconds (optional)
        #[arg(short, long)]
        duration: Option<u32>,
        /// maximum results to return
        #[arg(long, default_value = "10")]
        limit: u32,
    },
    /// search for albums/releases on musicbrainz
    SearchAlbum {
        /// artist name (optional)
        #[arg(short, long)]
        artist: Option<String>,
        /// album/release title (optional)
        #[arg(short = 'l', long)]
        album: Option<String>,
        /// release date (optional, format: YYYY or YYYY-MM or YYYY-MM-DD)
        #[arg(short, long)]
        date: Option<String>,
        /// country code (optional)
        #[arg(short, long)]
        country: Option<String>,
        /// maximum results to return
        #[arg(long, default_value = "10")]
        limit: u32,
    },
    /// search musicbrainz for songs in database
    SearchDatabase {
        /// song id to search for
        #[arg(short, long)]
        song_id: Option<String>,
        /// limit number of songs to process
        #[arg(short, long, default_value = "10")]
        limit: i64,
        /// show detailed results
        #[arg(short, long)]
        verbose: bool,
    },
    /// preview metadata changes for a song
    PreviewMetadata {
        /// song id
        song_id: String,
        /// musicbrainz recording id
        recording_id: String,
    },
    /// apply metadata changes to a song
    ApplyMetadata {
        /// song id
        song_id: String,
        /// musicbrainz recording id
        recording_id: String,
        /// apply changes without confirmation
        #[arg(short, long)]
        force: bool,
    },
    /// test musicbrainz configuration
    TestConfig,
    /// test musicbrainz functionality with direct api calls
    TestDirect {
        /// song id to test with
        song_id: String,
    },
    /// directly apply metadata from musicbrainz recording
    ApplyDirect {
        /// song id to update
        song_id: String,
        /// musicbrainz recording id
        recording_id: String,
    },
    /// batch process songs from an album with guided workflow
    BatchAlbum {
        /// album name to search for in database
        album: String,
        /// artist name to filter by (optional)
        #[arg(short, long)]
        artist: Option<String>,
        /// auto-apply high confidence matches without confirmation
        #[arg(long)]
        auto_apply: bool,
        /// minimum confidence threshold for auto-apply (0-100)
        #[arg(long, default_value = "85")]
        confidence_threshold: f32,
        /// dry run mode - show changes without applying
        #[arg(long)]
        dry_run: bool,
    },
    /// guided workflow for single song metadata update
    UpdateSong {
        /// song id or search term
        song: String,
        /// skip confirmation prompts
        #[arg(short, long)]
        force: bool,
    },
}

pub async fn handle_musicbrainz_command(
    args: MusicBrainzArgs,
    config: &AppConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    match args.command {
        MusicBrainzCommands::SearchSong {
            title,
            artist,
            album,
            duration,
            limit,
        } => handle_search_song(title, artist, album, duration, limit, config).await,
        MusicBrainzCommands::SearchAlbum {
            artist,
            album,
            date,
            country,
            limit,
        } => handle_search_album(artist, album, date, country, limit, config).await,
        MusicBrainzCommands::SearchDatabase {
            song_id,
            limit,
            verbose,
        } => handle_search_database(song_id, limit, verbose, config).await,
        MusicBrainzCommands::PreviewMetadata {
            song_id,
            recording_id,
        } => handle_preview_metadata(song_id, recording_id, config).await,
        MusicBrainzCommands::ApplyMetadata {
            song_id,
            recording_id,
            force,
        } => handle_apply_metadata(song_id, recording_id, force, config).await,
        MusicBrainzCommands::TestConfig => handle_test_config(config).await,
        MusicBrainzCommands::TestDirect { song_id } => handle_test_direct(song_id, config).await,
        MusicBrainzCommands::ApplyDirect {
            song_id,
            recording_id,
        } => handle_apply_direct(song_id, recording_id, config).await,
        MusicBrainzCommands::BatchAlbum {
            album,
            artist,
            auto_apply,
            confidence_threshold,
            dry_run,
        } => {
            handle_batch_album(
                &album,
                artist.as_deref(),
                auto_apply,
                confidence_threshold,
                dry_run,
                config,
            )
            .await
        }
        MusicBrainzCommands::UpdateSong { song, force } => {
            handle_update_song(&song, force, config).await
        }
    }
}

async fn handle_search_song(
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

    print!("searching musicbrainz for:");
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
        println!("no results found");
        return Ok(());
    }

    println!("found {} results:\n", results.results.len());

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

async fn handle_search_album(
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

    print!("searching musicbrainz albums for:");
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
        println!("no results found");
        return Ok(());
    }

    println!("found {} results:\n", results.results.len());

    for (i, release) in results.results.iter().enumerate() {
        println!("{}. {} ({})", i + 1, release.title, release.id);

        if let Some(artist_name) = release.primary_artist_name() {
            println!("   artist: {}", artist_name);
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

        let track_count = release.total_track_count();
        if track_count > 0 {
            println!("   tracks: {}", track_count);
        }

        if release.has_cover_art() {
            println!("   cover art: available");
        }

        println!();
    }

    Ok(())
}

async fn handle_search_database(
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

    let songs = if let Some(song_id) = song_id {
        let uuid = song_id.parse::<Uuid>()?;
        vec![repository.get_song(uuid).await?]
    } else {
        repository.get_songs_paginated(limit, 0).await?
    };

    println!(
        "searching musicbrainz for {} songs from database\n",
        songs.len()
    );

    for song in songs {
        println!("processing: \"{}\"", song.display_title());

        match service.search_for_song(&song).await {
            Ok(matches) => {
                if matches.is_empty() {
                    println!("  no matches found");
                } else {
                    println!("  found {} matches:", matches.len());

                    for (i, mb_match) in matches.iter().take(3).enumerate() {
                        println!(
                            "    {}. {} - {} (confidence: {:.1}%)",
                            i + 1,
                            mb_match
                                .recording
                                .primary_artist_name()
                                .unwrap_or("unknown".to_string()),
                            mb_match.recording.title,
                            mb_match.confidence_score
                        );

                        if verbose {
                            println!("       id: {}", mb_match.recording.id);
                            if !mb_match.match_reasons.is_empty() {
                                println!("       reasons: {}", mb_match.match_reasons.join(", "));
                            }
                        }
                    }

                    if matches.len() > 3 {
                        println!("    ... and {} more", matches.len() - 3);
                    }
                }
            }
            Err(e) => {
                println!("  error: {}", e);
            }
        }

        println!();
    }

    Ok(())
}

async fn handle_preview_metadata(
    song_id: String,
    recording_id: String,
    config: &AppConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    let musicbrainz_config = get_musicbrainz_config(config)?;
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = DatabaseConnection::new(pool);
    let repository = Arc::new(MusicRepository::new(db.pool().clone()));
    let service = MusicBrainzService::new(musicbrainz_config, repository.clone())?;

    // get the song
    let song_uuid = song_id.parse::<Uuid>()?;
    let song = repository.get_song(song_uuid).await?;

    println!("current song metadata:");
    print_song_metadata(&song);
    println!();

    // search for the song to get matches
    let matches = service.search_for_song(&song).await?;
    let mb_match = matches
        .into_iter()
        .find(|m| m.recording.id.to_string() == recording_id)
        .ok_or("recording not found in search results")?;

    // preview changes
    let preview = service
        .preview_metadata_changes(&song_id, &mb_match)
        .await?;

    println!("proposed metadata changes:");
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

    Ok(())
}

async fn handle_apply_metadata(
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

    // get the song
    let song_uuid = song_id.parse::<Uuid>()?;
    let song = repository.get_song(song_uuid).await?;

    // search for the song to get matches
    let matches = service.search_for_song(&song).await?;
    let mb_match = matches
        .into_iter()
        .find(|m| m.recording.id.to_string() == recording_id)
        .ok_or("recording not found in search results")?;

    // preview changes
    let preview = service
        .preview_metadata_changes(&song_id, &mb_match)
        .await?;

    if preview.changes.is_empty() {
        println!("no metadata changes needed");
        return Ok(());
    }

    println!("applying {} metadata changes:", preview.changes.len());
    for change in &preview.changes {
        println!(
            "  {}: {} -> {}",
            change.field,
            change
                .old_value
                .as_ref()
                .map(|v| v.to_string())
                .unwrap_or("none".to_string()),
            change.new_value
        );
    }

    if !force {
        print!("continue? (y/n): ");
        use std::io::{self, Write};
        io::stdout().flush()?;

        let mut input = String::new();
        io::stdin().read_line(&mut input)?;

        if !input.trim().to_lowercase().starts_with('y') {
            println!("cancelled");
            return Ok(());
        }
    }

    // apply changes
    service.apply_metadata(&song_id, &preview.changes).await?;

    println!("metadata updated successfully");

    // show updated song
    let updated_song = repository.get_song(song_uuid).await?;
    println!("\nupdated song metadata:");
    print_song_metadata(&updated_song);

    Ok(())
}

async fn handle_test_config(config: &AppConfig) -> Result<(), Box<dyn std::error::Error>> {
    println!("testing musicbrainz configuration...");

    let musicbrainz_config = get_musicbrainz_config(config)?;

    println!("configuration:");
    println!("  enabled: {}", musicbrainz_config.enabled);
    println!("  user_agent: {}", musicbrainz_config.user_agent);
    println!("  base_url: {}", musicbrainz_config.base_url);
    println!("  rate_limit: {}ms", musicbrainz_config.rate_limit_ms);
    println!();

    if !musicbrainz_config.enabled {
        println!("musicbrainz integration is disabled");
        return Ok(());
    }

    // test basic connectivity
    let client = MusicBrainzClient::new(musicbrainz_config)?;

    println!("testing api connectivity...");
    let query = RecordingSearchQuery::new()
        .title("test")
        .artist("the beatles")
        .limit(1);

    match client.search_recordings(&query).await {
        Ok(results) => {
            println!("✓ api connection successful");
            println!("  test search returned {} results", results.results.len());
        }
        Err(e) => {
            println!("✗ api connection failed: {}", e);
        }
    }

    Ok(())
}

fn get_musicbrainz_config(
    config: &AppConfig,
) -> Result<MusicBrainzConfig, Box<dyn std::error::Error>> {
    // use musicbrainz config from app config
    let mb_config = config.musicbrainz.clone();

    // validate config
    mb_config
        .validate()
        .map_err(|e| format!("musicbrainz config error: {}", e))?;

    Ok(mb_config)
}

async fn handle_test_direct(
    song_id: String,
    config: &AppConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    let musicbrainz_config = config.musicbrainz.clone();
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = DatabaseConnection::new(pool);
    let repository = Arc::new(MusicRepository::new(db.pool().clone()));
    let service = MusicBrainzService::new(musicbrainz_config, repository.clone())?;

    // get the song from database
    let song_uuid = song_id.parse::<uuid::Uuid>()?;
    let song = repository.get_song(song_uuid).await?;

    println!("searching musicbrainz for song:");
    print_song_metadata(&song);
    println!();

    // search for matches using the service
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

    if !matches.is_empty() {
        println!("\nto apply metadata, use:");
        println!(
            "./target/debug/cli music musicbrainz apply-direct {} <recording-id>",
            song_id
        );
    }

    Ok(())
}

async fn handle_apply_direct(
    song_id: String,
    recording_id: String,
    config: &AppConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    let musicbrainz_config = config.musicbrainz.clone();
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = DatabaseConnection::new(pool);
    let repository = Arc::new(MusicRepository::new(db.pool().clone()));
    let service = MusicBrainzService::new(musicbrainz_config.clone(), repository.clone())?;
    let client = MusicBrainzClient::new(musicbrainz_config)?;

    // get the song from database
    let song_uuid = song_id.parse::<uuid::Uuid>()?;
    let song = repository.get_song(song_uuid).await?;

    println!("current song metadata:");
    print_song_metadata(&song);
    println!();

    // fetch recording data from musicbrainz
    println!("fetching recording {} from musicbrainz...", recording_id);
    let recording = client.get_recording(&recording_id).await?;

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
    let preview = service
        .preview_metadata_changes(&song_id, &mb_match)
        .await?;

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
    service.apply_metadata(&song_id, &preview.changes).await?;

    // show updated song
    let updated_song = repository.get_song(song_uuid).await?;
    println!("\nupdated song metadata:");
    print_song_metadata(&updated_song);

    println!("✓ metadata updated successfully");

    Ok(())
}

async fn handle_batch_album(
    album_name: &str,
    artist_filter: Option<&str>,
    auto_apply: bool,
    confidence_threshold: f32,
    dry_run: bool,
    config: &AppConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    use grimoire::database::DatabaseConnection;
    use grimoire::music::repository::MusicRepository;
    use std::io::{self, Write};
    use std::sync::Arc;

    let musicbrainz_config = get_musicbrainz_config(config)?;
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = DatabaseConnection::new(pool);
    let repository = Arc::new(MusicRepository::new(db.pool().clone()));
    let service =
        grimoire::musicbrainz::MusicBrainzService::new(musicbrainz_config, repository.clone())?;

    // search for songs in this album
    let mut query_builder = sqlx::QueryBuilder::new("SELECT * FROM songs WHERE album ILIKE ");
    query_builder.push_bind(format!("%{}%", album_name));

    if let Some(artist) = artist_filter {
        query_builder.push(" AND artist ILIKE ");
        query_builder.push_bind(format!("%{}%", artist));
    }

    query_builder.push(" ORDER BY track_number, title");

    let songs: Vec<grimoire::music::Song> =
        query_builder.build_query_as().fetch_all(db.pool()).await?;

    if songs.is_empty() {
        println!("no songs found for album: {}", album_name);
        return Ok(());
    }

    println!("found {} songs in album '{}'", songs.len(), album_name);
    if dry_run {
        println!("(dry run mode - no changes will be applied)");
    }
    println!();

    let mut total_processed = 0;
    let mut total_updated = 0;
    let mut total_skipped = 0;

    for (i, song) in songs.iter().enumerate() {
        println!(
            "{}. {} - {}",
            i + 1,
            song.artist.as_deref().unwrap_or("unknown artist"),
            song.title
        );

        // search for musicbrainz matches
        let matches = service.search_for_song(song).await?;

        if matches.is_empty() {
            println!("   no musicbrainz matches found");
            total_skipped += 1;
            println!();
            continue;
        }

        // find best match
        let best_match = &matches[0];
        println!(
            "   best match: {} - {} (confidence: {:.1}%)",
            best_match
                .recording
                .primary_artist_name()
                .unwrap_or_default(),
            best_match.recording.title,
            best_match.confidence_score
        );

        // preview changes
        let preview = service
            .preview_metadata_changes(&song.id.to_string(), best_match)
            .await?;

        if preview.changes.is_empty() {
            println!("   no changes needed");
            total_skipped += 1;
            println!();
            continue;
        }

        // show proposed changes
        println!("   proposed changes:");
        for change in &preview.changes {
            println!(
                "     {}: {} -> {} (confidence: {:.1}%)",
                change.field,
                change
                    .old_value
                    .as_ref()
                    .and_then(|v| v.as_str())
                    .unwrap_or("none"),
                change.new_value.as_str().unwrap_or("invalid"),
                change.confidence
            );
        }

        let should_apply = if auto_apply && best_match.confidence_score >= confidence_threshold {
            println!(
                "   auto-applying (confidence >= {:.1}%)",
                confidence_threshold
            );
            true
        } else if dry_run {
            false
        } else {
            print!("   apply changes? (y/n/a/q): ");
            io::stdout().flush()?;
            let mut input = String::new();
            io::stdin().read_line(&mut input)?;
            match input.trim().to_lowercase().as_str() {
                "y" | "yes" => true,
                "a" | "all" => {
                    println!("   applying remaining songs automatically...");
                    // set auto_apply for remaining songs
                    true
                }
                "q" | "quit" => {
                    println!("   stopping batch process");
                    break;
                }
                _ => false,
            }
        };

        if should_apply && !dry_run {
            service
                .apply_metadata(&song.id.to_string(), &preview.changes)
                .await?;
            println!("   ✓ metadata updated");
            total_updated += 1;
        } else {
            println!("   skipped");
            total_skipped += 1;
        }

        total_processed += 1;
        println!();
    }

    println!("batch processing complete:");
    println!("  processed: {}", total_processed);
    println!("  updated: {}", total_updated);
    println!("  skipped: {}", total_skipped);

    Ok(())
}

async fn handle_update_song(
    song_input: &str,
    force: bool,
    config: &AppConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    use grimoire::database::DatabaseConnection;
    use grimoire::music::repository::MusicRepository;
    use std::io::{self, Write};
    use std::sync::Arc;
    use uuid::Uuid;

    let musicbrainz_config = get_musicbrainz_config(config)?;
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = DatabaseConnection::new(pool);
    let repository = Arc::new(MusicRepository::new(db.pool().clone()));
    let service = grimoire::musicbrainz::MusicBrainzService::new(
        musicbrainz_config.clone(),
        repository.clone(),
    )?;
    let _client = grimoire::musicbrainz::MusicBrainzClient::new(musicbrainz_config)?;

    // try to parse as UUID first, otherwise search
    let song = if let Ok(uuid) = Uuid::parse_str(song_input) {
        repository.get_song(uuid).await?
    } else {
        // search for song by title/artist
        let query = sqlx::query_as::<_, grimoire::music::Song>(
            "SELECT * FROM songs WHERE title ILIKE $1 OR artist ILIKE $1 LIMIT 1",
        )
        .bind(format!("%{}%", song_input));

        match query.fetch_optional(db.pool()).await? {
            Some(song) => song,
            None => {
                println!("song not found: {}", song_input);
                return Ok(());
            }
        }
    };

    println!(
        "song: {} - {}",
        song.artist.as_deref().unwrap_or("unknown artist"),
        song.title
    );
    print_song_metadata(&song);
    println!();

    // search for musicbrainz matches
    println!("searching musicbrainz...");
    let matches = service.search_for_song(&song).await?;

    if matches.is_empty() {
        println!("no musicbrainz matches found");
        return Ok(());
    }

    println!("found {} matches:", matches.len());
    for (i, mb_match) in matches.iter().take(5).enumerate() {
        println!(
            "  {}. {} - {} (confidence: {:.1}%)",
            i + 1,
            mb_match.recording.primary_artist_name().unwrap_or_default(),
            mb_match.recording.title,
            mb_match.confidence_score
        );
    }
    println!();

    let selected_match = if force && !matches.is_empty() {
        &matches[0]
    } else {
        print!("select match (1-{}, 0 to skip): ", matches.len().min(5));
        io::stdout().flush()?;
        let mut input = String::new();
        io::stdin().read_line(&mut input)?;

        match input.trim().parse::<usize>() {
            Ok(0) => {
                println!("skipped");
                return Ok(());
            }
            Ok(n) if n > 0 && n <= matches.len().min(5) => &matches[n - 1],
            _ => {
                println!("invalid selection");
                return Ok(());
            }
        }
    };

    // preview changes
    let preview = service
        .preview_metadata_changes(&song.id.to_string(), selected_match)
        .await?;

    if preview.changes.is_empty() {
        println!("no changes needed");
        return Ok(());
    }

    println!("proposed changes:");
    for change in &preview.changes {
        println!(
            "  {}: {} -> {} (confidence: {:.1}%)",
            change.field,
            change
                .old_value
                .as_ref()
                .and_then(|v| v.as_str())
                .unwrap_or("none"),
            change.new_value.as_str().unwrap_or("invalid"),
            change.confidence
        );
    }
    println!();

    if !force {
        print!("apply changes? (y/n): ");
        io::stdout().flush()?;
        let mut input = String::new();
        io::stdin().read_line(&mut input)?;
        if !matches!(input.trim().to_lowercase().as_str(), "y" | "yes") {
            println!("skipped");
            return Ok(());
        }
    }

    service
        .apply_metadata(&song.id.to_string(), &preview.changes)
        .await?;
    println!("✓ metadata updated successfully");

    Ok(())
}

fn print_song_metadata(song: &grimoire::music::Song) {
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
