//! Analytics operations CLI commands

use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use grimoire::music::analytics::{
    create_play_event, get_album_play_count, get_all_user_stats, get_artist_play_count,
    get_combined_feed, get_overview_stats, get_session_summary, get_song_play_analytics,
    get_song_play_count, get_top_albums, get_top_artists, get_top_songs,
    get_user_listening_history, get_user_stats, record_play_event, FeedItemType,
};
use grimoire::music::crud::{query_songs, QueryParams};
use serde::Serialize;

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

#[derive(Serialize)]
struct PlayEventResult {
    media_event_id: String,
    music_event_id: String,
    song_title: String,
    user_id: String,
    session_id: Option<String>,
}

/// Handle analytics commands
pub async fn handle_command(action: AnalyticsAction) -> CommandOutput<serde_json::Value> {
    match action {
        AnalyticsAction::RecordPlay {
            song_id,
            user_id,
            session_id,
            position,
            playlist_id,
        } => {
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
                mb_lookup_status: None,
            };

            let response = query_songs(params).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(result) = response.data else {
                return CommandOutput::failure("No data returned from query", vec![], ());
            };

            let Some(song_result) = result.items.first() else {
                return CommandOutput::failure(format!("Song not found: {}", song_id), vec![], ());
            };

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
            let response = record_play_event(&media_event, &music_event).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some((media_event_id, music_event_id)) = response.data else {
                return CommandOutput::failure("No event IDs returned", vec![], ());
            };

            let result = PlayEventResult {
                media_event_id,
                music_event_id,
                song_title: song_result.song.title.clone(),
                user_id: user_id.clone(),
                session_id: session_id.clone(),
            };

            CommandOutput::success("Play event recorded successfully", result)
        }
        AnalyticsAction::SongStats { song_id } => {
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
                mb_lookup_status: None,
            };

            let response = query_songs(params).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(result) = response.data else {
                return CommandOutput::failure("No data returned from query", vec![], ());
            };

            let Some(_song_result) = result.items.first() else {
                return CommandOutput::failure(format!("Song not found: {}", song_id), vec![], ());
            };

            // Get play analytics
            let response = get_song_play_analytics(&song_id).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(analytics) = response.data else {
                return CommandOutput::failure("No analytics data returned", vec![], ());
            };

            CommandOutput::success(format!("Song analytics for {}", song_id), analytics)
        }
        AnalyticsAction::UserHistory {
            user_id,
            limit,
            offset,
        } => {
            let response = get_user_listening_history(&user_id, limit, offset).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some((history, total_count)) = response.data else {
                return CommandOutput::failure("No history data returned", vec![], ());
            };

            CommandOutput::success(
                format!(
                    "User listening history: {} of {} items (offset: {})",
                    history.len(),
                    total_count,
                    offset
                ),
                history,
            )
        }
        AnalyticsAction::Session { session_id } => {
            let response = get_session_summary(&session_id).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(summary) = response.data else {
                return CommandOutput::failure("No session summary returned", vec![], ());
            };

            CommandOutput::success(format!("Session summary for {}", session_id), summary)
        }
        AnalyticsAction::Counts {
            entity_type,
            entity_id,
        } => {
            let entity_type_lower = entity_type.to_lowercase();

            match entity_type_lower.as_str() {
                "song" => {
                    let response = get_song_play_count(&entity_id).await;
                    if !response.success {
                        return CommandOutput::failure(response.message, response.errors, ());
                    }

                    let Some(count) = response.data else {
                        return CommandOutput::failure("No count data returned", vec![], ());
                    };

                    CommandOutput::success(
                        format!("Play count for song {}: {}", entity_id, count),
                        count,
                    )
                }
                "album" => {
                    let response = get_album_play_count(&entity_id).await;
                    if !response.success {
                        return CommandOutput::failure(response.message, response.errors, ());
                    }

                    let Some(count) = response.data else {
                        return CommandOutput::failure("No count data returned", vec![], ());
                    };

                    CommandOutput::success(
                        format!("Play count for album {}: {}", entity_id, count),
                        count,
                    )
                }
                "artist" => {
                    let response = get_artist_play_count(&entity_id).await;
                    if !response.success {
                        return CommandOutput::failure(response.message, response.errors, ());
                    }

                    let Some(count) = response.data else {
                        return CommandOutput::failure("No count data returned", vec![], ());
                    };

                    CommandOutput::success(
                        format!("Play count for artist {}: {}", entity_id, count),
                        count,
                    )
                }
                _ => {
                    CommandOutput::failure(
                        "Invalid entity_type",
                        vec![grimoire::error::ErrorDetail {
                            error_type: "validation_error".to_string(),
                            title: "Invalid entity type".to_string(),
                            detail: "Must be 'song', 'album', or 'artist'".to_string(),
                        }],
                        (),
                    )
                }
            }
        }
        AnalyticsAction::RecentListens { limit, offset } => {
            let types = vec![FeedItemType::RecentListen];
            let response = get_combined_feed(limit, offset, Some(&types), None, None).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some((items, total_count)) = response.data else {
                return CommandOutput::failure("No recent listens data returned", vec![], ());
            };

            CommandOutput::success(
                format!(
                    "Recent listens: {} of {} items (offset: {})",
                    items.len(),
                    total_count,
                    offset
                ),
                items,
            )
        }
        AnalyticsAction::RecentFavorites { limit, offset } => {
            let types = vec![FeedItemType::RecentFavorite];
            let response = get_combined_feed(limit, offset, Some(&types), None, None).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some((items, total_count)) = response.data else {
                return CommandOutput::failure("No recent favorites data returned", vec![], ());
            };

            CommandOutput::success(
                format!(
                    "Recent favorites: {} of {} items (offset: {})",
                    items.len(),
                    total_count,
                    offset
                ),
                items,
            )
        }
        AnalyticsAction::RecentAlbums { limit, offset } => {
            let types = vec![FeedItemType::RecentAlbum];
            let response = get_combined_feed(limit, offset, Some(&types), None, None).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some((items, total_count)) = response.data else {
                return CommandOutput::failure("No recent albums data returned", vec![], ());
            };

            CommandOutput::success(
                format!(
                    "Recent albums: {} of {} items (offset: {})",
                    items.len(),
                    total_count,
                    offset
                ),
                items,
            )
        }
        AnalyticsAction::Feed { limit, offset } => {
            let response = get_combined_feed(limit, offset, None, None, None).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some((items, total_count)) = response.data else {
                return CommandOutput::failure("No feed data returned", vec![], ());
            };

            CommandOutput::success(
                format!(
                    "Activity feed: {} of {} items (offset: {})",
                    items.len(),
                    total_count,
                    offset
                ),
                items,
            )
        }
        AnalyticsAction::AdminOverview => {
            let response = get_overview_stats().await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(stats) = response.data else {
                return CommandOutput::failure("No overview stats returned", vec![], ());
            };

            CommandOutput::success("System overview statistics", stats)
        }
        AnalyticsAction::TopSongs { limit } => {
            let response = get_top_songs(limit).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(songs) = response.data else {
                return CommandOutput::failure("No top songs data returned", vec![], ());
            };

            CommandOutput::success(format!("Top {} songs by play count", limit), songs)
        }
        AnalyticsAction::TopAlbums { limit } => {
            let response = get_top_albums(limit).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(albums) = response.data else {
                return CommandOutput::failure("No top albums data returned", vec![], ());
            };

            CommandOutput::success(format!("Top {} albums by play count", limit), albums)
        }
        AnalyticsAction::TopArtists { limit } => {
            let response = get_top_artists(limit).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(artists) = response.data else {
                return CommandOutput::failure("No top artists data returned", vec![], ());
            };

            CommandOutput::success(format!("Top {} artists by play count", limit), artists)
        }
        AnalyticsAction::UserStats { user_id } => {
            let response = get_user_stats(&user_id).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(stats) = response.data else {
                return CommandOutput::failure("No user stats returned", vec![], ());
            };

            CommandOutput::success(format!("Statistics for user {}", user_id), stats)
        }
        AnalyticsAction::AllUserStats { limit } => {
            let response = get_all_user_stats(limit).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(users) = response.data else {
                return CommandOutput::failure("No user stats returned", vec![], ());
            };

            CommandOutput::success(
                format!("Statistics for all users (top {} by plays)", limit),
                users,
            )
        }
    }
}
