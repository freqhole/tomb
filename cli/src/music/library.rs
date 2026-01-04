//! Music library operations and management

use legacylib::music::{MusicRepository, MusicService, SongQuery};
use sqlx::Row;
use std::io::{self, Write};
use uuid::Uuid;

/// Handle test command - show database record counts
pub async fn handle_test(service: &MusicService<'_>) -> Result<(), Box<dyn std::error::Error>> {
    println!("🧪 Testing database connectivity and showing record counts...");

    // Use MusicRepository for database stats
    let repository = MusicRepository::new(service.db().pool().clone());

    // Get comprehensive database stats
    let stats = repository.get_database_stats().await?;

    println!("📊 Database Record Counts:");
    println!("   🎵 Songs: {}", stats.song_count);
    println!("   📁 Media Blobs (music-cli): {}", stats.media_blob_count);
    println!("   🖼️  Thumbnail Blobs: {}", stats.thumbnail_blob_count);
    println!("   📋 Scan Sessions: {}", stats.scan_session_count);

    // Show recent songs with thumbnail status
    let recent_songs = repository.get_recent_songs_with_thumbnails(5).await?;

    if !recent_songs.is_empty() {
        println!("\n🎼 Recent Songs:");
        for song in recent_songs {
            let thumbnail_status = if song.thumbnail_blob_id.is_some() {
                " 🖼️"
            } else {
                ""
            };
            println!(
                "   • {} by {} (Album: {}{})",
                song.title,
                song.artist.unwrap_or("Unknown Artist".to_string()),
                song.album.unwrap_or("Unknown Album".to_string()),
                thumbnail_status
            );
        }
    }

    Ok(())
}

/// Handle listing songs command
pub async fn handle_songs(
    service: &MusicService<'_>,
    favorites: bool,
    artist: Option<String>,
    album: Option<String>,
    limit: i64,
    offset: Option<i64>,
    user_id: Option<String>,
) -> Result<(), Box<dyn std::error::Error>> {
    // parse user id if provided
    let parsed_user_id = if let Some(user_id_str) = user_id {
        match Uuid::parse_str(&user_id_str) {
            Ok(id) => {
                println!("🎵 Songs (for user: {}):", user_id_str);
                Some(id)
            }
            Err(_) => {
                eprintln!("❌ Invalid user ID format: {}", user_id_str);
                return Err("Invalid user ID".into());
            }
        }
    } else {
        println!("🎵 Songs (global view):");
        None
    };
    println!("=========");

    let repository = MusicRepository::new(service.db().pool().clone());

    let query = SongQuery {
        favorites_only: if favorites { Some(true) } else { None },
        artist: artist.map(|a| format!("%{}%", a)), // Add wildcards for ILIKE
        album: album.map(|a| format!("%{}%", a)),   // Add wildcards for ILIKE
        limit: Some(limit),
        offset,
        ..Default::default()
    };

    // use search_songs method which supports user context
    let songs = repository.search_songs(parsed_user_id, query).await?;

    if songs.is_empty() {
        println!("No songs found.");
        return Ok(());
    }

    for song in songs {
        let favorite_indicator = if song.is_favorite { " ⭐" } else { "" };
        let artist_info = song.artist.as_deref().unwrap_or("Unknown Artist");
        let album_info = song.album.as_deref().unwrap_or("Unknown Album");

        println!(
            "  {} | {} - {} (Album: {}){}",
            song.id, song.title, artist_info, album_info, favorite_indicator
        );
    }

    Ok(())
}

/// Handle albums command
pub async fn handle_albums(
    service: &MusicService<'_>,
    limit: i64,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("💿 Albums:");
    println!("==========");

    let repository = MusicRepository::new(service.db().pool().clone());
    let albums = repository.get_album_summaries(Some(limit)).await?;

    if albums.is_empty() {
        println!("No albums found.");
        return Ok(());
    }

    for album in albums {
        let year_info = album.year.map(|y| format!(" ({})", y)).unwrap_or_default();
        println!(
            "  {} - {} ({} tracks){}",
            album.artist.unwrap_or("Unknown Artist".to_string()),
            album.album.unwrap_or("Unknown Album".to_string()),
            album.track_count,
            year_info
        );
    }

    Ok(())
}

/// Handle album tracks command
pub async fn handle_album_tracks(
    service: &MusicService<'_>,
    album: String,
    artist: Option<String>,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("🎵 Album Tracks: {}", album);
    if let Some(ref artist_name) = artist {
        println!("🎤 Artist: {}", artist_name);
    }
    println!("===================");

    let repository = MusicRepository::new(service.db().pool().clone());
    let tracks = repository
        .get_album_tracks(&album, artist.as_deref())
        .await?;

    if tracks.is_empty() {
        println!("No tracks found for this album.");
        return Ok(());
    }

    for track in tracks {
        let track_num = track
            .track_number
            .map(|n| format!("{}. ", n))
            .unwrap_or_default();

        let duration = if let Some(dur) = track.duration {
            let total_seconds = dur.microseconds / 1_000_000;
            let minutes = total_seconds / 60;
            let seconds = total_seconds % 60;
            format!(" ({}:{:02})", minutes, seconds)
        } else {
            String::new()
        };

        println!(
            "  {}{} - {}{}",
            track_num,
            track.title,
            track.artist.unwrap_or("Unknown Artist".to_string()),
            duration
        );
    }

    Ok(())
}

/// Handle artist albums command
pub async fn handle_artist_albums(
    service: &MusicService<'_>,
    artist: String,
    limit: i32,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("🎤 Artist Albums: {}", artist);
    println!("===================");

    let repository = MusicRepository::new(service.db().pool().clone());
    let albums = repository.get_artist_albums(&artist, Some(limit)).await?;

    if albums.is_empty() {
        println!("No albums found for this artist.");
        return Ok(());
    }

    for album in albums {
        let year_info = album.year.map(|y| format!(" ({})", y)).unwrap_or_default();
        println!(
            "  {} ({} tracks){}",
            album.album.unwrap_or("Unknown Album".to_string()),
            album.track_count,
            year_info
        );
    }

    Ok(())
}

/// Handle play song command
pub async fn handle_play_song(
    service: &MusicService<'_>,
    song_id: String,
    visualize: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("🎵 Playing song: {}", song_id);

    // Parse song ID
    let parsed_id = match Uuid::parse_str(&song_id) {
        Ok(id) => id,
        Err(_) => {
            println!("❌ Invalid song ID format");
            return Ok(());
        }
    };

    let repository = MusicRepository::new(service.db().pool().clone());

    // Get song details
    let song = match repository.get_song(parsed_id).await {
        Ok(song) => song,
        Err(_) => {
            println!("❌ Song not found");
            return Ok(());
        }
    };

    println!(
        "🎶 Now playing: {} - {}",
        song.title,
        song.artist.as_deref().unwrap_or("Unknown Artist")
    );

    // Get song with media info for file path
    match repository.get_song_with_media(parsed_id).await {
        Ok(song_with_media) => {
            if let Some(file_path) = &song_with_media.local_path {
                println!("🎵 File: {}", file_path);

                // Get audio playback config
                let config = service.config();
                let playback_config = &config.media.playback;

                // Build command
                let player_cmd = if let Some(path) = &playback_config.player_path {
                    path.clone()
                } else {
                    playback_config.player_command.clone()
                };

                if visualize {
                    println!("🎨 Visualizer mode enabled");
                    // Play with visualizer (requires cava)
                    let cmd = format!(
                        "{} {} '{}' & cava",
                        player_cmd,
                        playback_config.player_args.join(" "),
                        file_path
                    );
                    std::process::Command::new("sh")
                        .arg("-c")
                        .arg(&cmd)
                        .spawn()?;
                } else {
                    // Execute player directly to hand over terminal control
                    let status = std::process::Command::new(&player_cmd)
                        .args(&playback_config.player_args)
                        .arg(file_path)
                        .status()?;

                    if !status.success() {
                        println!("⚠️  Playback failed");
                    }
                }
            } else {
                println!("❌ Song file path not available");
            }
        }
        Err(e) => {
            println!("❌ Failed to get song media info: {}", e);
        }
    }

    Ok(())
}

/// Handle interactive play command (simplified version)
pub async fn handle_interactive_play(
    service: &MusicService<'_>,
    shuffle: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("🎵 Interactive Music Player");
    println!("===========================");

    let repository = MusicRepository::new(service.db().pool().clone());

    // Get all playlists
    let playlists = repository.get_playlist_summaries(Some(50)).await?;

    if playlists.is_empty() {
        println!("❌ No playlists found. Create a playlist first with:");
        println!("   cli music create-playlist \"My Playlist\"");
        return Ok(());
    }

    println!("Available playlists:");
    for (i, playlist) in playlists.iter().enumerate() {
        println!(
            "  {}. {} ({} songs)",
            i + 1,
            playlist.title,
            playlist.song_count
        );
    }

    print!("Select playlist (1-{}): ", playlists.len());
    io::stdout().flush()?;

    let mut input = String::new();
    io::stdin().read_line(&mut input)?;

    if let Ok(selection) = input.trim().parse::<usize>() {
        if selection > 0 && selection <= playlists.len() {
            let selected_playlist = &playlists[selection - 1];
            println!("🎵 Selected: {}", selected_playlist.title);

            if shuffle {
                println!("🔀 Shuffle mode enabled");
            }

            // Get playlist songs
            let songs = repository
                .get_playlist_songs_with_media(selected_playlist.id)
                .await?;

            if songs.is_empty() {
                println!("❌ Playlist is empty");
                return Ok(());
            }

            // Get audio playback config
            let config = service.config();
            let playback_config = &config.media.playback;

            let player_cmd = if let Some(path) = &playback_config.player_path {
                path.clone()
            } else {
                playback_config.player_command.clone()
            };

            // Play songs
            for (index, song) in songs.iter().enumerate() {
                if let Some(file_path) = &song.local_path {
                    println!(
                        "▶️  [{}/{}] {} - {}",
                        index + 1,
                        songs.len(),
                        song.title,
                        song.artist.as_deref().unwrap_or("Unknown Artist")
                    );

                    let status = std::process::Command::new(&player_cmd)
                        .args(&playback_config.player_args)
                        .arg(file_path)
                        .status();

                    match status {
                        Ok(exit_status) => {
                            if !exit_status.success() {
                                println!("⚠️  Playback failed, skipping to next song...");
                                continue;
                            }
                        }
                        Err(e) => {
                            println!("⚠️  Error starting player: {}, skipping...", e);
                            continue;
                        }
                    }
                } else {
                    println!("⚠️  No file path available for song, skipping...");
                    continue;
                }
            }

            println!("✅ Playlist finished");
        } else {
            println!("❌ Invalid selection");
        }
    } else {
        println!("❌ Invalid input");
    }

    Ok(())
}

/// Handle genres command - list all distinct song genres in alphabetical order
pub async fn handle_genres(service: &MusicService<'_>) -> Result<(), Box<dyn std::error::Error>> {
    println!("🎵 Listing all distinct song genres in alphabetical order...");

    // Query to get distinct genres ordered alphabetically
    let query = "SELECT DISTINCT genre FROM songs WHERE genre IS NOT NULL AND genre != '' ORDER BY genre ASC";
    let rows = sqlx::query(query).fetch_all(service.db().pool()).await?;

    if rows.is_empty() {
        println!("No genres found.");
        return Ok(());
    }

    println!("📋 Found {} distinct genres:", rows.len());
    for row in rows {
        let genre: String = row.get("genre");
        println!("  • {}", genre);
    }

    Ok(())
}

/// Handle subgenres command - list all distinct song sub-genres from array columns
pub async fn handle_subgenres(
    service: &MusicService<'_>,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("🎼 Listing all distinct song sub-genres in alphabetical order...");

    // Query to get all sub_genres arrays, unnest them, and get distinct values
    let query = "
        SELECT DISTINCT unnest(sub_genres) as subgenre
        FROM songs
        WHERE sub_genres IS NOT NULL
        AND array_length(sub_genres, 1) > 0
        ORDER BY subgenre ASC
    ";
    let rows = sqlx::query(query).fetch_all(service.db().pool()).await?;

    if rows.is_empty() {
        println!("No sub-genres found.");
        return Ok(());
    }

    println!("📋 Found {} distinct sub-genres:", rows.len());
    for row in rows {
        let subgenre: String = row.get("subgenre");
        println!("  • {}", subgenre);
    }

    Ok(())
}
