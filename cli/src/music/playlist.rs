//! Playlist management operations

use grimoire::music::{
    CreatePlaylist, MusicRepository, MusicService, PlaylistQuery, PlaylistService,
};
use std::io::{self, Write};
use uuid::Uuid;

/// Handle listing playlists command
pub async fn handle_playlists(
    service: &MusicService<'_>,
    public: bool,
    verbose: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("📋 Playlists:");
    println!("=============");

    let repository = MusicRepository::new(service.db().pool().clone());
    let playlist_service = PlaylistService::new(repository);

    let query = PlaylistQuery {
        public_only: if public { Some(true) } else { None },
        ..Default::default()
    };

    let playlists = playlist_service.query_playlists(query).await?;

    if playlists.is_empty() {
        println!("No playlists found.");
        return Ok(());
    }

    for playlist_with_count in playlists {
        let playlist = &playlist_with_count.playlist;
        let song_count = playlist_with_count.song_count;
        let visibility = if playlist.is_public {
            "Public"
        } else {
            "Private"
        };

        if verbose {
            println!(
                "  {} | {} ({} songs) [{}]",
                playlist.id, playlist.title, song_count, visibility
            );
            if let Some(ref desc) = playlist.description {
                println!("    Description: {}", desc);
            }
        } else {
            println!(
                "  {} | {} ({} songs)",
                playlist.id, playlist.title, song_count
            );
        }
    }

    Ok(())
}

/// Handle creating a new playlist
pub async fn handle_create_playlist(
    service: &MusicService<'_>,
    title: String,
    description: Option<String>,
    public: bool,
    songs: Option<String>,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("📝 Creating playlist: {}", title);

    let repository = MusicRepository::new(service.db().pool().clone());
    let playlist_service = PlaylistService::new(repository);

    let create_params = CreatePlaylist {
        title: title.clone(),
        description,
        client_id: Some("cli".to_string()),
        is_public: Some(public),
        is_collaborative: Some(false),
        metadata: None,
        media_blob_id: None,
        thumbnail_blob_id: None,
    };

    let song_ids = if let Some(song_ids_str) = songs {
        match parse_song_ids(&song_ids_str) {
            Ok(ids) => Some(ids),
            Err(e) => {
                println!("❌ Error parsing song IDs: {}", e);
                None
            }
        }
    } else {
        None
    };

    match playlist_service
        .create_playlist_with_songs(create_params, song_ids, Some("cli".to_string()))
        .await
    {
        Ok((playlist, added_song_ids)) => {
            println!(
                "✅ Created playlist: {} (ID: {})",
                playlist.title, playlist.id
            );

            for song_id in added_song_ids {
                println!("  ➕ Added song {}", song_id);
            }
        }
        Err(e) => {
            println!("❌ Failed to create playlist: {}", e);
        }
    }

    Ok(())
}

/// Handle adding songs to playlist
pub async fn handle_add_to_playlist(
    service: &MusicService<'_>,
    playlist_input: String,
    songs_input: String,
) -> Result<(), Box<dyn std::error::Error>> {
    let repository = MusicRepository::new(service.db().pool().clone());
    let playlist_service = PlaylistService::new(repository);

    // Parse song IDs
    let song_ids = match parse_song_ids(&songs_input) {
        Ok(ids) => ids,
        Err(e) => {
            println!("❌ Error parsing song IDs: {}", e);
            return Ok(());
        }
    };

    // Try to find playlist by ID first, then by title
    let playlist = if let Ok(playlist_id) = Uuid::parse_str(&playlist_input) {
        match playlist_service
            .repository()
            .get_playlist(playlist_id)
            .await
        {
            Ok(playlist) => playlist,
            Err(_) => {
                println!("❌ Playlist not found by ID: {}", playlist_input);
                return Ok(());
            }
        }
    } else {
        // Search by title
        match playlist_service
            .repository()
            .find_playlists_by_title(&playlist_input, true)
            .await
        {
            Ok(mut playlists) if !playlists.is_empty() => {
                if playlists.len() == 1 {
                    playlists.pop().unwrap()
                } else {
                    println!("❌ Multiple playlists found with title '{}'. Please use playlist ID instead.", playlist_input);
                    for p in playlists {
                        println!("  - {} (ID: {})", p.title, p.id);
                    }
                    return Ok(());
                }
            }
            _ => {
                println!("❌ Playlist not found: {}", playlist_input);
                return Ok(());
            }
        }
    };

    println!("📋 Adding songs to playlist: {}", playlist.title);

    // Add songs to playlist
    let mut added_count = 0;
    let mut skipped_count = 0;

    for song_id in song_ids {
        match playlist_service
            .repository()
            .add_songs_to_playlist(playlist.id, &[song_id], Some("cli".to_string()))
            .await
        {
            Ok(_) => {
                println!("  ➕ Added song {}", song_id);
                added_count += 1;
            }
            Err(e) => {
                println!("  ❌ Failed to add song {}: {}", song_id, e);
                skipped_count += 1;
            }
        }
    }

    println!(
        "✅ Added {} songs, skipped {} songs",
        added_count, skipped_count
    );

    Ok(())
}

/// Handle showing playlist contents
pub async fn handle_show_playlist(
    service: &MusicService<'_>,
    playlist_input: String,
    verbose: bool,
    user_id: Option<String>,
) -> Result<(), Box<dyn std::error::Error>> {
    let repository = MusicRepository::new(service.db().pool().clone());

    // parse user id if provided
    let parsed_user_id = if let Some(user_id_str) = user_id {
        match Uuid::parse_str(&user_id_str) {
            Ok(id) => Some(id),
            Err(_) => {
                eprintln!("❌ Invalid user ID format: {}", user_id_str);
                return Err("Invalid user ID".into());
            }
        }
    } else {
        None
    };

    // Try to find playlist by ID first, then by title
    let playlist = if let Ok(playlist_id) = Uuid::parse_str(&playlist_input) {
        match repository.get_playlist(playlist_id).await {
            Ok(playlist) => playlist,
            Err(_) => {
                println!("❌ Playlist not found by ID: {}", playlist_input);
                return Ok(());
            }
        }
    } else {
        // Search by title
        match repository
            .find_playlists_by_title(&playlist_input, true)
            .await
        {
            Ok(mut playlists) if !playlists.is_empty() => {
                if playlists.len() == 1 {
                    playlists.pop().unwrap()
                } else {
                    println!("❌ Multiple playlists found with title '{}'. Please use playlist ID instead.", playlist_input);
                    for p in playlists {
                        println!("  - {} (ID: {})", p.title, p.id);
                    }
                    return Ok(());
                }
            }
            _ => {
                println!("❌ Playlist not found: {}", playlist_input);
                return Ok(());
            }
        }
    };

    let title_header = if parsed_user_id.is_some() {
        format!("📋 Playlist: {} (user preferences)", playlist.title)
    } else {
        format!("📋 Playlist: {} (global view)", playlist.title)
    };
    println!("{}", title_header);
    println!("{}", "=".repeat(title_header.len()));

    // Get playlist songs
    let playlist_songs = repository.get_playlist_songs(playlist.id).await?;

    if playlist_songs.is_empty() {
        println!("Empty playlist.");
        return Ok(());
    }

    for playlist_song in playlist_songs {
        let song = &playlist_song.song;

        // get user-specific song data if user_id provided
        let (user_is_favorite, user_rating) = if let Some(_uid) = parsed_user_id {
            // for user-specific view, we'd need to fetch user preferences
            // for now, show that this would be user-specific data
            (song.is_favorite, song.rating) // TODO: fetch actual user preferences
        } else {
            (song.is_favorite, song.rating)
        };

        if verbose {
            let duration_str = if let Some(duration) = &song.duration {
                let total_seconds = duration.microseconds / 1_000_000;
                let minutes = total_seconds / 60;
                let seconds = total_seconds % 60;
                format!("({}:{:02})", minutes, seconds)
            } else {
                "Unknown".to_string()
            };

            let favorite_indicator = if user_is_favorite { " ⭐" } else { "" };
            let rating_indicator = if let Some(rating) = user_rating {
                format!(" 📊{}/5", rating)
            } else {
                String::new()
            };

            println!(
                "  {}. {} | {} - {} [{}]{}{}",
                playlist_song.position,
                song.id,
                song.title,
                song.artist.as_deref().unwrap_or("Unknown Artist"),
                duration_str,
                favorite_indicator,
                rating_indicator
            );
        } else {
            let favorite_indicator = if user_is_favorite { " ⭐" } else { "" };
            println!(
                "  {}. {} | {} - {}{}",
                playlist_song.position,
                song.id,
                song.title,
                song.artist.as_deref().unwrap_or("Unknown Artist"),
                favorite_indicator
            );
        }
    }

    Ok(())
}

/// Handle deleting a playlist
pub async fn handle_delete_playlist(
    service: &MusicService<'_>,
    playlist_input: String,
    force: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let repository = MusicRepository::new(service.db().pool().clone());

    // Try to find playlist by ID first, then by title
    let playlist = if let Ok(playlist_id) = Uuid::parse_str(&playlist_input) {
        match repository.get_playlist(playlist_id).await {
            Ok(playlist) => playlist,
            Err(_) => {
                println!("❌ Playlist not found by ID: {}", playlist_input);
                return Ok(());
            }
        }
    } else {
        // Search by title
        match repository
            .find_playlists_by_title(&playlist_input, true)
            .await
        {
            Ok(mut playlists) if !playlists.is_empty() => {
                if playlists.len() == 1 {
                    playlists.pop().unwrap()
                } else {
                    println!("❌ Multiple playlists found with title '{}'. Please use playlist ID instead.", playlist_input);
                    for p in playlists {
                        println!("  - {} (ID: {})", p.title, p.id);
                    }
                    return Ok(());
                }
            }
            _ => {
                println!("❌ Playlist not found: {}", playlist_input);
                return Ok(());
            }
        }
    };

    if !force {
        // Check song count
        let song_count = repository.get_playlist_song_count(playlist.id).await?;

        println!(
            "⚠️  About to delete playlist '{}' with {} songs.",
            playlist.title, song_count
        );
        print!("Are you sure? (y/N): ");
        io::stdout().flush()?;

        let mut input = String::new();
        io::stdin().read_line(&mut input)?;

        if !input.trim().to_lowercase().starts_with('y') {
            println!("Cancelled.");
            return Ok(());
        }
    }

    match repository.delete_playlist(playlist.id, None).await {
        Ok(_) => {
            println!("✅ Deleted playlist: {}", playlist.title);
        }
        Err(e) => {
            println!("❌ Failed to delete playlist: {}", e);
        }
    }

    Ok(())
}

/// Handle playlist summaries command
pub async fn handle_playlist_summaries(
    service: &MusicService<'_>,
    limit: i64,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("📋 Playlist Summaries:");
    println!("======================");

    let repository = MusicRepository::new(service.db().pool().clone());
    let playlists = repository.get_playlist_summaries(Some(limit)).await?;

    if playlists.is_empty() {
        println!("No playlists found.");
        return Ok(());
    }

    for playlist in playlists {
        let visibility = if playlist.is_public {
            "Public"
        } else {
            "Private"
        };

        println!(
            "📋 {} ({} songs) - {}",
            playlist.title, playlist.song_count, visibility
        );

        if let Some(ref description) = playlist.description {
            println!("   {}", description);
        }
    }

    Ok(())
}

/// Handle play playlist command
pub async fn handle_play_playlist(
    service: &MusicService<'_>,
    playlist_input: String,
    shuffle: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let repository = MusicRepository::new(service.db().pool().clone());

    // Try to find playlist by ID first, then by title
    let playlist = if let Ok(playlist_id) = Uuid::parse_str(&playlist_input) {
        match repository.get_playlist(playlist_id).await {
            Ok(playlist) => playlist,
            Err(_) => {
                println!("❌ Playlist not found by ID: {}", playlist_input);
                return Ok(());
            }
        }
    } else {
        // Search by title
        match repository
            .find_playlists_by_title(&playlist_input, true)
            .await
        {
            Ok(mut playlists) if !playlists.is_empty() => {
                if playlists.len() == 1 {
                    playlists.pop().unwrap()
                } else {
                    println!("❌ Multiple playlists found with title '{}'. Please use playlist ID instead.", playlist_input);
                    for p in playlists {
                        println!("  - {} (ID: {})", p.title, p.id);
                    }
                    return Ok(());
                }
            }
            _ => {
                println!("❌ Playlist not found: {}", playlist_input);
                return Ok(());
            }
        }
    };

    println!("🎵 Playing playlist: {}", playlist.title);
    if shuffle {
        println!("🔀 Shuffle mode enabled");
    }

    // Get playlist songs with media info
    let mut songs = repository
        .get_playlist_songs_with_media(playlist.id)
        .await?;

    if songs.is_empty() {
        println!("❌ Playlist is empty");
        return Ok(());
    }

    if shuffle {
        use rand::seq::SliceRandom;
        let mut rng = rand::thread_rng();
        songs.shuffle(&mut rng);
    }

    // Get audio playback config
    let config = service.config();
    let playback_config = &config.media.playback;

    let player_cmd = if let Some(path) = &playback_config.player_path {
        path.clone()
    } else {
        playback_config.player_command.clone()
    };

    println!("🎵 Playing {} songs", songs.len());
    println!(
        "⌨️  Controls: Space=pause/play, q/n=next song, ←/→=seek, 9/0=volume, Ctrl+C=stop playlist"
    );
    println!();

    for (index, song) in songs.iter().enumerate() {
        if let Some(file_path) = &song.local_path {
            let duration_str = if let Some(duration) = &song.duration {
                let total_seconds = duration.microseconds / 1_000_000;
                let minutes = total_seconds / 60;
                let seconds = total_seconds % 60;
                format!(" ({}:{:02})", minutes, seconds)
            } else {
                String::new()
            };

            println!(
                "▶️  [{}/{}] {} - {}{}",
                index + 1,
                songs.len(),
                song.title,
                song.artist.as_deref().unwrap_or("Unknown Artist"),
                duration_str
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
    Ok(())
}

/// Handle direct play command (same as play playlist for now)
pub async fn handle_direct_play(
    service: &MusicService<'_>,
    playlist: String,
    shuffle: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    handle_play_playlist(service, playlist, shuffle).await
}

/// Parse comma-separated song IDs
fn parse_song_ids(songs_input: &str) -> Result<Vec<Uuid>, Box<dyn std::error::Error>> {
    let mut song_ids = Vec::new();

    for id_str in songs_input.split(',') {
        let trimmed = id_str.trim();
        if !trimmed.is_empty() {
            let uuid = Uuid::parse_str(trimmed)
                .map_err(|_| format!("Invalid UUID format: {}", trimmed))?;
            song_ids.push(uuid);
        }
    }

    if song_ids.is_empty() {
        return Err("No valid song IDs provided".into());
    }

    Ok(song_ids)
}

/// Handle add to playlist by title command (create if not exists)
pub async fn handle_add_to_playlist_by_title(
    service: &MusicService<'_>,
    title: String,
    songs: String,
    description: Option<String>,
    public: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let repository = MusicRepository::new(service.db().pool().clone());
    let playlist_service = PlaylistService::new(repository);

    // Parse song IDs
    let song_ids = match parse_song_ids(&songs) {
        Ok(ids) => ids,
        Err(e) => {
            println!("❌ Error parsing song IDs: {}", e);
            return Ok(());
        }
    };

    // Try to find existing playlist by title
    match playlist_service
        .repository()
        .find_playlists_by_title(&title, true)
        .await
    {
        Ok(mut playlists) if !playlists.is_empty() => {
            // Found existing playlist(s)
            let playlist = if playlists.len() == 1 {
                playlists.pop().unwrap()
            } else {
                println!("❌ Multiple playlists found with title '{}'. Please use a more specific title or playlist ID.", title);
                for p in playlists {
                    println!("  - {} (ID: {})", p.title, p.id);
                }
                return Ok(());
            };

            println!("📋 Adding songs to existing playlist: {}", playlist.title);

            // Add songs to existing playlist
            let mut added_count = 0;
            let mut skipped_count = 0;

            for song_id in song_ids {
                match playlist_service
                    .repository()
                    .add_songs_to_playlist(playlist.id, &[song_id], Some("cli".to_string()))
                    .await
                {
                    Ok(_) => {
                        println!("  ➕ Added song {}", song_id);
                        added_count += 1;
                    }
                    Err(e) => {
                        println!("  ❌ Failed to add song {}: {}", song_id, e);
                        skipped_count += 1;
                    }
                }
            }

            println!(
                "✅ Added {} songs, skipped {} songs",
                added_count, skipped_count
            );
        }
        _ => {
            // No existing playlist found, create new one
            println!("📝 Creating new playlist: {}", title);

            let create_params = CreatePlaylist {
                title: title.clone(),
                description,
                client_id: Some("cli".to_string()),
                is_public: Some(public),
                is_collaborative: Some(false),
                metadata: None,
                media_blob_id: None,
                thumbnail_blob_id: None,
            };

            match playlist_service
                .create_playlist_with_songs(create_params, Some(song_ids), Some("cli".to_string()))
                .await
            {
                Ok((playlist, added_song_ids)) => {
                    println!(
                        "✅ Created playlist: {} (ID: {})",
                        playlist.title, playlist.id
                    );

                    for song_id in added_song_ids {
                        println!("  ➕ Added song {}", song_id);
                    }
                }
                Err(e) => {
                    println!("❌ Failed to create playlist: {}", e);
                }
            }
        }
    }

    Ok(())
}

/// Handle remove from playlist command
pub async fn handle_remove_from_playlist(
    service: &MusicService<'_>,
    playlist_input: String,
    songs_input: String,
    user_id: String,
) -> Result<(), Box<dyn std::error::Error>> {
    let repository = MusicRepository::new(service.db().pool().clone());
    let playlist_service = PlaylistService::new(repository);

    // Parse song IDs
    let song_ids = match parse_song_ids(&songs_input) {
        Ok(ids) => ids,
        Err(e) => {
            println!("❌ Error parsing song IDs: {}", e);
            return Ok(());
        }
    };

    // Parse user ID
    let parsed_user_id = match Uuid::parse_str(&user_id) {
        Ok(id) => id,
        Err(_) => {
            println!("❌ Invalid user ID format: {}", user_id);
            return Err("Invalid user ID".into());
        }
    };

    println!("🗑️  Removing songs from playlist: {}", playlist_input);

    match playlist_service
        .remove_songs_from_playlist_by_title_or_id(&playlist_input, song_ids, parsed_user_id)
        .await
    {
        Ok((playlist, removed_count, not_found_songs)) => {
            println!(
                "✅ Removed {} songs from playlist: {}",
                removed_count, playlist.title
            );

            if !not_found_songs.is_empty() {
                println!("⚠️  Songs not found in playlist:");
                for song_id in not_found_songs {
                    println!("  - {}", song_id);
                }
            }
        }
        Err(e) => {
            println!("❌ Failed to remove songs from playlist: {}", e);
        }
    }

    Ok(())
}

/// Handle move song command
pub async fn handle_move_song(
    service: &MusicService<'_>,
    playlist_input: String,
    song_id: Uuid,
    position: i32,
) -> Result<(), Box<dyn std::error::Error>> {
    let repository = MusicRepository::new(service.db().pool().clone());
    let playlist_service = PlaylistService::new(repository);

    println!(
        "🔄 Moving song {} to position {} in playlist: {}",
        song_id, position, playlist_input
    );

    match playlist_service
        .move_playlist_song_by_title_or_id(&playlist_input, song_id, position)
        .await
    {
        Ok(playlist) => {
            println!("✅ Moved song in playlist: {}", playlist.title);
        }
        Err(e) => {
            println!("❌ Failed to move song: {}", e);
        }
    }

    Ok(())
}

/// Handle reorder playlist command
pub async fn handle_reorder_playlist(
    service: &MusicService<'_>,
    playlist_input: String,
    song_ids_input: String,
) -> Result<(), Box<dyn std::error::Error>> {
    let repository = MusicRepository::new(service.db().pool().clone());
    let playlist_service = PlaylistService::new(repository);

    // Parse song IDs
    let song_ids = match parse_song_ids(&song_ids_input) {
        Ok(ids) => ids,
        Err(e) => {
            println!("❌ Error parsing song IDs: {}", e);
            return Ok(());
        }
    };

    println!("🔄 Reordering playlist: {}", playlist_input);

    match playlist_service
        .reorder_playlist_by_title_or_id(&playlist_input, &song_ids)
        .await
    {
        Ok(playlist) => {
            println!(
                "✅ Reordered playlist: {} ({} songs)",
                playlist.title,
                song_ids.len()
            );
        }
        Err(e) => {
            println!("❌ Failed to reorder playlist: {}", e);
        }
    }

    Ok(())
}

/// Handle playlist from album command
pub async fn handle_playlist_from_album(
    service: &MusicService<'_>,
    album: String,
    artist: Option<String>,
    title: Option<String>,
    public: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let repository = MusicRepository::new(service.db().pool().clone());
    let playlist_service = PlaylistService::new(repository);

    // Generate playlist title if not provided
    let playlist_title = title.unwrap_or_else(|| {
        if let Some(ref artist_name) = artist {
            format!("{} - {}", artist_name, album)
        } else {
            album.clone()
        }
    });

    println!("📝 Creating playlist from album: {}", album);
    if let Some(ref artist_name) = artist {
        println!("🎤 Artist: {}", artist_name);
    }
    println!("📋 Playlist title: {}", playlist_title);

    match playlist_service
        .create_playlist_from_album(
            playlist_title.clone(),
            &album,
            artist.as_deref(),
            Some(public),
            Some("cli".to_string()),
        )
        .await
    {
        Ok(playlist) => {
            println!(
                "✅ Created playlist: {} (ID: {})",
                playlist.title, playlist.id
            );

            // Show summary of tracks added
            let tracks = playlist_service
                .get_album_tracks(&album, artist.as_deref())
                .await?;
            println!("🎵 Added {} tracks from album", tracks.len());

            for (i, track) in tracks.iter().enumerate() {
                println!("  {}. {}", i + 1, track.display_title());
            }
        }
        Err(e) => {
            println!("❌ Failed to create playlist from album: {}", e);
        }
    }

    Ok(())
}
