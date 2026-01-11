//! Analytics operations CLI commands

use crate::cli::utils::OutputFormat;
use crate::error::{GrimoireError, GrimoireResult};
use crate::music::analytics::{
    create_play_event, get_album_play_count, get_all_user_stats, get_artist_play_count,
    get_combined_feed, get_overview_stats, get_recent_albums, get_recent_favorites,
    get_recent_listens, get_session_summary, get_song_play_analytics, get_song_play_count,
    get_top_albums, get_top_artists, get_top_songs, get_user_listening_history, get_user_stats,
    record_play_event, FeedItemType,
};
use crate::music::crud::{query_albums, query_artists, query_songs, QueryParams};
use crate::response::GrimoireResponse;
use clap::Subcommand;

// Temporary adapter to convert GrimoireResponse to Result for CLI compatibility
// TODO: Phase 5 will update CLI to use GrimoireResponse directly
fn to_result<T>(response: GrimoireResponse<T>) -> GrimoireResult<T> {
    if response.success {
        response
            .data
            .ok_or_else(|| GrimoireError::ProcessingFailed {
                message: "Response succeeded but contained no data".to_string(),
            })
    } else {
        let error_messages: Vec<String> =
            response.errors.iter().map(|e| e.detail.clone()).collect();
        Err(GrimoireError::ProcessingFailed {
            message: format!("{}: {}", response.message, error_messages.join(", ")),
        })
    }
}

#[derive(Subcommand)]
pub enum AnalyticsAction {
    /// Record a play event
    RecordPlay {
        #[arg(long)]
        song_id: String,
        #[arg(long)]
        user_id: String,
        /// Optional session ID
        #[arg(long)]
        session_id: Option<String>,
        /// Position in seconds where playback started
        #[arg(long)]
        position: Option<i64>,
        /// Optional playlist ID if played from a playlist
        #[arg(long)]
        playlist_id: Option<String>,
    },
    /// Show statistics for a song
    SongStats { song_id: String },
    /// Show play history for a user
    UserHistory {
        user_id: String,
        #[arg(long, default_value = "50")]
        limit: i64,
        #[arg(long, default_value = "0")]
        offset: i64,
    },
    /// Show session summary
    Session { session_id: String },
    /// Show event counts for an entity
    Counts {
        entity_type: String,
        entity_id: String,
    },
    /// Show recent listens across all users
    RecentListens {
        #[arg(long, default_value = "20")]
        limit: i64,
        #[arg(long, default_value = "0")]
        offset: i64,
    },
    /// Show recent favorites
    RecentFavorites {
        #[arg(long, default_value = "20")]
        limit: i64,
        #[arg(long, default_value = "0")]
        offset: i64,
    },
    /// Show recently played albums
    RecentAlbums {
        #[arg(long, default_value = "20")]
        limit: i64,
        #[arg(long, default_value = "0")]
        offset: i64,
    },
    /// Show combined feed of recent activity
    Feed {
        #[arg(long, default_value = "20")]
        limit: i64,
        #[arg(long, default_value = "0")]
        offset: i64,
    },
    /// Admin: System overview
    AdminOverview,
    /// Admin: Top songs by play count
    TopSongs {
        #[arg(long, default_value = "20")]
        limit: i64,
    },
    /// Admin: Top albums by play count
    TopAlbums {
        #[arg(long, default_value = "20")]
        limit: i64,
    },
    /// Admin: Top artists by play count
    TopArtists {
        #[arg(long, default_value = "20")]
        limit: i64,
    },
    /// Admin: User statistics
    UserStats { user_id: String },
    /// Admin: All user statistics
    AllUserStats {
        #[arg(long, default_value = "50")]
        limit: i64,
    },
}

/// Handle analytics commands
pub async fn handle_command(action: AnalyticsAction, _format: OutputFormat) -> GrimoireResult<()> {
    match action {
        AnalyticsAction::RecordPlay {
            song_id,
            user_id,
            session_id,
            position,
            playlist_id,
        } => {
            println!("Recording play event...");

            // Get song details using query API
            let mut filters = std::collections::HashMap::new();
            filters.insert("id".to_string(), serde_json::json!(song_id.clone()));

            let params = QueryParams {
                q: None,
                search_fields: None,
                filters,
                sort_by: None,
                sort_direction: None,
                limit: Some(1),
                offset: Some(0),
                user_id: None,
                favorites_only: None,
                min_rating: None,
            };

            let result = to_result(query_songs(params).await)?;
            let song_result = result
                .items
                .first()
                .ok_or_else(|| GrimoireError::SongNotFound {
                    id: song_id.clone(),
                })?;

            // Create event data with position if provided
            let event_data = if let Some(pos) = position {
                Some(serde_json::json!({
                    "position": pos,
                    "playlist_id": playlist_id
                }))
            } else if playlist_id.is_some() {
                Some(serde_json::json!({
                    "playlist_id": playlist_id
                }))
            } else {
                None
            };

            // Create the play event using the correct signature
            let (media_event, mut music_event) = create_play_event(
                song_result.song.media_blob_id.clone(),
                song_id.clone(),
                Some(user_id.clone()),
                session_id.clone(),
                event_data,
            );

            // Add album and artist IDs to music event
            if let Some(artist) = &song_result.artist {
                music_event = music_event.with_artist_id(&artist.id);
            }
            if let Some(album) = &song_result.album {
                music_event = music_event.with_album_id(&album.id);
            }
            if let Some(pid) = &playlist_id {
                music_event = music_event.with_playlist_id(pid);
            }

            // Record the event
            let (media_event_id, music_event_id) =
                record_play_event(&media_event, &music_event).await?;

            println!("✓ Play event recorded successfully");
            println!("  Media Event ID: {}", media_event_id);
            println!("  Music Event ID: {}", music_event_id);
            println!("  Song: {}", song_result.song.title);
            println!("  User: {}", user_id);
            if let Some(sid) = session_id {
                println!("  Session: {}", sid);
            }
        }
        AnalyticsAction::SongStats { song_id } => {
            println!("Fetching analytics for song {}...\n", song_id);

            // Get song details using query API
            let mut filters = std::collections::HashMap::new();
            filters.insert("id".to_string(), serde_json::json!(song_id.clone()));

            let params = QueryParams {
                q: None,
                search_fields: None,
                filters,
                sort_by: None,
                sort_direction: None,
                limit: Some(1),
                offset: Some(0),
                user_id: None,
                favorites_only: None,
                min_rating: None,
            };

            let result = to_result(query_songs(params).await)?;
            let song_result = result
                .items
                .first()
                .ok_or_else(|| GrimoireError::SongNotFound {
                    id: song_id.clone(),
                })?;

            // Get play analytics
            let analytics = get_song_play_analytics(&song_id).await?;

            println!("Song: {}", song_result.song.title);
            if let Some(artist) = &song_result.artist {
                println!("Artist: {}", artist.name);
            }
            println!();

            println!("Play Statistics:");
            println!("  Total Plays: {}", analytics.total_plays);
            println!("  Unique Users: {}", analytics.unique_users);
            println!("  Unique Sessions: {}", analytics.unique_sessions);
            println!();

            if let Some(first_played) = analytics.first_played_at {
                println!(
                    "  First Played: {}",
                    super::utils::format_timestamp(first_played)
                );
            }
            if let Some(last_played) = analytics.last_played_at {
                println!(
                    "  Last Played: {}",
                    super::utils::format_timestamp(last_played)
                );
            }
            println!();

            println!("Engagement:");
            println!(
                "  Completion Rate: {:.1}%",
                analytics.completion_rate * 100.0
            );
            println!("  Avg Play Time: {:.1}s", analytics.avg_play_time_seconds);
            println!("  Total Play Time: {}s", analytics.total_play_time_seconds);
        }
        AnalyticsAction::UserHistory {
            user_id,
            limit,
            offset,
        } => {
            println!("Fetching listening history for user {}...\n", user_id);

            let (history, total_count) =
                get_user_listening_history(&user_id, limit, offset).await?;

            if history.is_empty() {
                println!("No listening history found.");
                return Ok(());
            }

            println!(
                "Showing {} of {} total items (offset: {})\n",
                history.len(),
                total_count,
                offset
            );

            for item in history {
                let artist = item.artist.as_deref().unwrap_or("Unknown Artist");
                println!("• {} - {}", item.title, artist);
                println!(
                    "  Played: {}",
                    super::utils::format_timestamp(item.created_at)
                );
                if let Some(album) = item.album {
                    println!("  Album: {}", album);
                }
                if let Some(session) = item.session_id {
                    println!("  Session: {}", session);
                }
                println!();
            }
        }
        AnalyticsAction::Session { session_id } => {
            println!("Fetching session summary for {}...\n", session_id);

            let summary = get_session_summary(&session_id).await?;

            println!("Session: {}", summary.session_id);
            if let Some(user_id) = &summary.user_id {
                println!("User: {}", user_id);
            }
            if let Some(username) = &summary.username {
                println!("Username: {}", username);
            }
            println!("Song Count: {}", summary.song_count);
            println!("Duration: {}s", summary.total_duration);
            println!(
                "Started: {}",
                super::utils::format_timestamp(summary.session_start)
            );
            println!(
                "Ended: {}",
                super::utils::format_timestamp(summary.session_end)
            );
            println!();

            if !summary.songs.is_empty() {
                println!("Songs Played:");
                for song in summary.songs {
                    let artist = song.artist.as_deref().unwrap_or("Unknown Artist");
                    println!("  • {} - {}", song.title, artist);
                    println!(
                        "    Played: {}",
                        super::utils::format_timestamp(song.played_at)
                    );
                    if let Some(album) = song.album {
                        println!("    Album: {}", album);
                    }
                }
            }
        }
        AnalyticsAction::Counts {
            entity_type,
            entity_id,
        } => {
            let entity_type_lower = entity_type.to_lowercase();

            match entity_type_lower.as_str() {
                "song" => {
                    let count = get_song_play_count(&entity_id).await?;

                    // Get song details using query API
                    let mut filters = std::collections::HashMap::new();
                    filters.insert("id".to_string(), serde_json::json!(entity_id.clone()));

                    let params = QueryParams {
                        q: None,
                        search_fields: None,
                        filters,
                        sort_by: None,
                        sort_direction: None,
                        limit: Some(1),
                        offset: Some(0),
                        user_id: None,
                        favorites_only: None,
                        min_rating: None,
                    };

                    let result = to_result(query_songs(params).await)?;
                    let song_result = result.items.first().ok_or_else(|| {
                        crate::error::GrimoireError::SongNotFound {
                            id: entity_id.clone(),
                        }
                    })?;

                    println!("Song: {}", song_result.song.title);
                    println!("Play Count: {}", count);
                }
                "album" => {
                    let count = get_album_play_count(&entity_id).await?;

                    // Get album details using query API
                    let mut filters = std::collections::HashMap::new();
                    filters.insert("id".to_string(), serde_json::json!(entity_id.clone()));

                    let params = QueryParams {
                        q: None,
                        search_fields: None,
                        filters,
                        sort_by: None,
                        sort_direction: None,
                        limit: Some(1),
                        offset: Some(0),
                        user_id: None,
                        favorites_only: None,
                        min_rating: None,
                    };

                    let result = to_result(query_albums(params).await)?;
                    let album_result = result.items.first().ok_or_else(|| {
                        crate::error::GrimoireError::AlbumNotFound {
                            id: entity_id.clone(),
                        }
                    })?;

                    println!("Album: {}", album_result.album.title);
                    println!("Total Plays: {}", count);
                }
                "artist" => {
                    let count = get_artist_play_count(&entity_id).await?;

                    // Get artist details using query API
                    let mut filters = std::collections::HashMap::new();
                    filters.insert("id".to_string(), serde_json::json!(entity_id.clone()));

                    let params = QueryParams {
                        q: None,
                        search_fields: None,
                        filters,
                        sort_by: None,
                        sort_direction: None,
                        limit: Some(1),
                        offset: Some(0),
                        user_id: None,
                        favorites_only: None,
                        min_rating: None,
                    };

                    let result = to_result(query_artists(params).await)?;
                    let artist_result = result.items.first().ok_or_else(|| {
                        crate::error::GrimoireError::ArtistNotFound {
                            id: entity_id.clone(),
                        }
                    })?;

                    println!("Artist: {}", artist_result.artist.name);
                    println!("Total Plays: {}", count);
                }
                _ => {
                    return Err(crate::error::GrimoireError::Validation {
                        field: "entity_type".to_string(),
                        message: "Must be 'song', 'album', or 'artist'".to_string(),
                    });
                }
            }
        }
        AnalyticsAction::RecentListens { limit, offset } => {
            println!("Fetching recent listening activity...\n");

            let (items, total_count) = get_recent_listens(limit, offset).await?;

            if items.is_empty() {
                println!("No recent listening activity found.");
                return Ok(());
            }

            println!(
                "Showing {} of {} items (offset: {})\n",
                items.len(),
                total_count,
                offset
            );

            for item in items {
                let subtitle = item.subtitle.as_deref().unwrap_or("Unknown Artist");
                let play_count = item.play_count.unwrap_or(0);
                println!("🎵 {} - {}", item.title, subtitle);
                println!(
                    "   Played {} time{} • Last: {}",
                    play_count,
                    if play_count == 1 { "" } else { "s" },
                    super::utils::format_timestamp(item.created_at)
                );
                if let Some(username) = item.username {
                    println!("   User: {}", username);
                }
                println!();
            }
        }
        AnalyticsAction::RecentFavorites { limit, offset } => {
            println!("Fetching recent favorites...\n");

            let (items, total_count) = get_recent_favorites(limit, offset).await?;

            if items.is_empty() {
                println!("No recent favorites found.");
                return Ok(());
            }

            println!(
                "Showing {} of {} items (offset: {})\n",
                items.len(),
                total_count,
                offset
            );

            for item in items {
                let subtitle = item.subtitle.as_deref().unwrap_or("Unknown Artist");
                println!("⭐ {} - {}", item.title, subtitle);
                println!(
                    "   Favorited: {}",
                    super::utils::format_timestamp(item.created_at)
                );
                if let Some(username) = item.username {
                    println!("   By: {}", username);
                }
                println!();
            }
        }
        AnalyticsAction::RecentAlbums { limit, offset } => {
            println!("Fetching recently added albums...\n");

            let (items, total_count) = get_recent_albums(limit, offset).await?;

            if items.is_empty() {
                println!("No recent albums found.");
                return Ok(());
            }

            println!(
                "Showing {} of {} items (offset: {})\n",
                items.len(),
                total_count,
                offset
            );

            for item in items {
                let subtitle = item.subtitle.as_deref().unwrap_or("Unknown Artist");
                println!("💿 {} - {}", item.title, subtitle);
                println!(
                    "   Added: {}",
                    super::utils::format_timestamp(item.created_at)
                );
                println!();
            }
        }
        AnalyticsAction::Feed { limit, offset } => {
            println!("Fetching combined activity feed...\n");

            let (items, total_count) = get_combined_feed(limit, offset).await?;

            if items.is_empty() {
                println!("No activity found.");
                return Ok(());
            }

            println!(
                "Showing {} of {} items (offset: {})\n",
                items.len(),
                total_count,
                offset
            );

            for item in items {
                let icon = match item.feed_type {
                    FeedItemType::RecentListen => "🎵",
                    FeedItemType::RecentFavorite => "⭐",
                    FeedItemType::RecentAlbum => "💿",
                };

                let action = match item.feed_type {
                    FeedItemType::RecentListen => {
                        let count = item.play_count.unwrap_or(1);
                        if count > 1 {
                            format!("Played {} times", count)
                        } else {
                            "Played".to_string()
                        }
                    }
                    FeedItemType::RecentFavorite => "Favorited".to_string(),
                    FeedItemType::RecentAlbum => "Album added".to_string(),
                };

                let subtitle = item.subtitle.as_deref().unwrap_or("Unknown Artist");
                println!("{} {} - {}", icon, item.title, subtitle);
                println!(
                    "   {} • {}",
                    action,
                    super::utils::format_timestamp(item.created_at)
                );
                if let Some(username) = item.username {
                    println!("   User: {}", username);
                }
                println!();
            }
        }
        AnalyticsAction::AdminOverview => {
            println!("Fetching overview statistics...\n");

            let stats = get_overview_stats().await?;

            println!("📊 System Overview\n");
            println!("Library:");
            println!("  Songs:    {:>8}", stats.total_songs);
            println!("  Albums:   {:>8}", stats.total_albums);
            println!("  Artists:  {:>8}", stats.total_artists);
            println!(
                "  Duration: {:>8} hours",
                stats.total_duration_seconds / 3600
            );
            println!();
            println!("Users:");
            println!("  Total:    {:>8}", stats.total_users);
            println!();
            println!("Activity:");
            println!("  Plays:     {:>8}", stats.total_plays);
            println!("  Sessions:  {:>8}", stats.total_sessions);
            println!("  Favorites: {:>8}", stats.total_favorites);
        }
        AnalyticsAction::TopSongs { limit } => {
            println!("Fetching top {} songs...\n", limit);

            let songs = get_top_songs(limit).await?;

            if songs.is_empty() {
                println!("No songs found.");
                return Ok(());
            }

            println!("🎵 Top Songs by Play Count\n");

            for (i, song) in songs.iter().enumerate() {
                let artist = song.artist_name.as_deref().unwrap_or("Unknown Artist");
                let album = song.album_title.as_deref().unwrap_or("");

                println!("{}. {} - {}", i + 1, song.title, artist);
                println!(
                    "   Plays: {} • Unique users: {}",
                    song.play_count, song.unique_users
                );
                if !album.is_empty() {
                    println!("   Album: {}", album);
                }
                if let Some(last_played) = song.last_played_at {
                    println!(
                        "   Last played: {}",
                        super::utils::format_timestamp(last_played)
                    );
                }
                println!();
            }
        }
        AnalyticsAction::TopAlbums { limit } => {
            println!("Fetching top {} albums...\n", limit);

            let albums = get_top_albums(limit).await?;

            if albums.is_empty() {
                println!("No albums found.");
                return Ok(());
            }

            println!("💿 Top Albums by Play Count\n");

            for (i, album) in albums.iter().enumerate() {
                let artist = album.artist_name.as_deref().unwrap_or("Unknown Artist");

                println!("{}. {} - {}", i + 1, album.title, artist);
                println!(
                    "   Plays: {} • Songs: {} • Unique users: {}",
                    album.total_plays, album.song_count, album.unique_users
                );
                println!();
            }
        }
        AnalyticsAction::TopArtists { limit } => {
            println!("Fetching top {} artists...\n", limit);

            let artists = get_top_artists(limit).await?;

            if artists.is_empty() {
                println!("No artists found.");
                return Ok(());
            }

            println!("🎤 Top Artists by Play Count\n");

            for (i, artist) in artists.iter().enumerate() {
                println!("{}. {}", i + 1, artist.name);
                println!(
                    "   Plays: {} • Songs: {} • Albums: {} • Unique users: {}",
                    artist.total_plays, artist.song_count, artist.album_count, artist.unique_users
                );
                println!();
            }
        }
        AnalyticsAction::UserStats { user_id } => {
            println!("Fetching statistics for user {}...\n", user_id);

            let stats = get_user_stats(&user_id).await?;

            println!("👤 User: {}\n", stats.username);
            println!("Activity:");
            println!("  Total Plays:       {:>8}", stats.total_plays);
            println!("  Unique Songs:      {:>8}", stats.unique_songs_played);
            println!("  Sessions:          {:>8}", stats.unique_sessions);
            println!("  Favorites:         {:>8}", stats.total_favorites);
            println!();

            if let Some(first) = stats.first_activity_at {
                println!(
                    "  First Activity:    {}",
                    super::utils::format_timestamp(first)
                );
            }
            if let Some(last) = stats.last_activity_at {
                println!(
                    "  Last Activity:     {}",
                    super::utils::format_timestamp(last)
                );
            }
        }
        AnalyticsAction::AllUserStats { limit } => {
            println!("Fetching statistics for all users...\n");

            let users = get_all_user_stats(limit).await?;

            if users.is_empty() {
                println!("No users found.");
                return Ok(());
            }

            println!("👥 User Statistics (Top {} by plays)\n", limit);

            for (i, user) in users.iter().enumerate() {
                println!("{}. {}", i + 1, user.username);
                println!(
                    "   Plays: {} • Songs: {} • Sessions: {} • Favorites: {}",
                    user.total_plays,
                    user.unique_songs_played,
                    user.unique_sessions,
                    user.total_favorites
                );
                if let Some(last) = user.last_activity_at {
                    println!("   Last activity: {}", super::utils::format_timestamp(last));
                }
                println!();
            }
        }
    }

    Ok(())
}
