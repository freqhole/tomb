//! Music query commands

use super::MusicAction;
use crate::error::GrimoireResult;
use crate::music::crud::{
    query_albums, query_artists, query_genres, query_playlist_songs, query_playlists, query_songs,
    QueryParams,
};
use std::collections::HashMap;

pub async fn handle_query_songs(action: MusicAction) -> GrimoireResult<()> {
    if let MusicAction::QuerySongs {
        search,
        sort_by,
        sort_direction,
        limit,
        offset,
        user_id,
        favorites_only,
        min_rating,
    } = action
    {
        println!("querying songs...");
        let params = QueryParams {
            q: search,
            search_fields: None,
            filters: std::collections::HashMap::new(),
            sort_by,
            sort_direction,
            limit: Some(limit as u32),
            offset: Some(offset as u32),
            user_id,
            favorites_only: if favorites_only { Some(true) } else { None },
            min_rating,
        };

        match query_songs(params).await {
            Ok(result) => {
                println!(
                    "found {} songs (total: {})",
                    result.items.len(),
                    result.total_count
                );
                for song in result.items {
                    let track_info = format!(
                        "D{:02}T{:02}",
                        song.song.disc_number, song.song.track_number
                    );
                    let track_display = format!("[{}]", track_info);

                    println!(
                        "  {}{} - {} ({})",
                        track_display,
                        song.artist
                            .as_ref()
                            .map(|a| a.name.clone())
                            .unwrap_or("Unknown".to_string()),
                        song.song.title,
                        song.album
                            .as_ref()
                            .map(|a| a.title.clone())
                            .unwrap_or("No Album".to_string())
                    );
                }
                if result.has_more {
                    println!(
                        "...more results available (use --offset {})",
                        offset + limit
                    );
                }
            }
            Err(e) => {
                eprintln!("failed to query songs: {}", e);
            }
        }
        Ok(())
    } else {
        unreachable!("handle_query_songs called with wrong action variant")
    }
}

pub async fn handle_query_artists(action: MusicAction) -> GrimoireResult<()> {
    if let MusicAction::QueryArtists {
        search,
        starts_with,
        sort_by,
        sort_direction,
        limit,
        offset,
    } = action
    {
        println!("querying artists...");
        let mut filters = HashMap::new();
        if let Some(starts_with) = starts_with {
            filters.insert(
                "starts_with".to_string(),
                serde_json::Value::String(starts_with),
            );
        }
        let params = QueryParams {
            q: search,
            search_fields: None,
            filters: std::collections::HashMap::new(),
            sort_by,
            sort_direction,
            limit: Some(limit as u32),
            offset: Some(offset as u32),
            user_id: None,
            favorites_only: None,
            min_rating: None,
        };

        match query_artists(params).await {
            Ok(result) => {
                println!(
                    "found {} artists (total: {})",
                    result.items.len(),
                    result.total_count
                );
                for artist in result.items {
                    println!(
                        "  {} ({} songs, {} albums)",
                        artist.artist.name, artist.song_count, artist.album_count
                    );
                }
                if result.has_more {
                    println!(
                        "...more results available (use --offset {})",
                        offset + limit
                    );
                }
            }
            Err(e) => {
                eprintln!("failed to query artists: {}", e);
            }
        }
        Ok(())
    } else {
        unreachable!("handle_query_artists called with wrong action variant")
    }
}

pub async fn handle_query_albums(action: MusicAction) -> GrimoireResult<()> {
    if let MusicAction::QueryAlbums {
        search,
        sort_by,
        sort_direction,
        limit,
        offset,
    } = action
    {
        println!("querying albums...");
        let params = QueryParams {
            q: search,
            search_fields: None,
            filters: std::collections::HashMap::new(),
            sort_by,
            sort_direction,
            limit: Some(limit as u32),
            offset: Some(offset as u32),
            user_id: None,
            favorites_only: None,
            min_rating: None,
        };

        match query_albums(params).await {
            Ok(result) => {
                println!(
                    "found {} albums (total: {})",
                    result.items.len(),
                    result.total_count
                );
                for album in result.items {
                    println!(
                        "  {} - {} ({} songs)",
                        album
                            .artist
                            .as_ref()
                            .map(|a| a.name.clone())
                            .unwrap_or("Unknown".to_string()),
                        album.album.title,
                        album.album.song_count
                    );
                }
                if result.has_more {
                    println!(
                        "...more results available (use --offset {})",
                        offset + limit
                    );
                }
            }
            Err(e) => {
                eprintln!("failed to query albums: {}", e);
            }
        }
        Ok(())
    } else {
        unreachable!("handle_query_albums called with wrong action variant")
    }
}

pub async fn handle_query_genres(action: MusicAction) -> GrimoireResult<()> {
    if let MusicAction::QueryGenres {
        search,
        sort_by,
        sort_direction,
        limit,
        offset,
    } = action
    {
        println!("querying genres...");
        let params = QueryParams {
            q: search,
            search_fields: None,
            filters: std::collections::HashMap::new(),
            sort_by,
            sort_direction,
            limit: Some(limit as u32),
            offset: Some(offset as u32),
            user_id: None,
            favorites_only: None,
            min_rating: None,
        };

        match query_genres(params).await {
            Ok(result) => {
                println!(
                    "found {} genres (total: {})",
                    result.items.len(),
                    result.total_count
                );
                for genre in result.items {
                    println!("  {}", genre.genre.name);
                }
                if result.has_more {
                    println!(
                        "...more results available (use --offset {})",
                        offset + limit
                    );
                }
            }
            Err(e) => {
                eprintln!("failed to query genres: {}", e);
            }
        }
        Ok(())
    } else {
        unreachable!("handle_query_genres called with wrong action variant")
    }
}

pub async fn handle_query_playlists(action: MusicAction) -> GrimoireResult<()> {
    if let MusicAction::QueryPlaylists {
        search,
        sort_by,
        sort_direction,
        is_public,
        limit,
        offset,
    } = action
    {
        println!("querying playlists...");
        let mut filters = HashMap::new();
        if let Some(public) = is_public {
            filters.insert("is_public".to_string(), serde_json::Value::Bool(public));
        }

        let params = QueryParams {
            q: search,
            search_fields: None,
            filters: std::collections::HashMap::new(),
            sort_by,
            sort_direction,
            limit: Some(limit as u32),
            offset: Some(offset as u32),
            user_id: None,
            favorites_only: None,
            min_rating: None,
        };

        match query_playlists(params).await {
            Ok(result) => {
                println!(
                    "found {} playlists (total: {})",
                    result.items.len(),
                    result.total_count
                );
                for playlist in result.items {
                    let public_status = if playlist.playlist.is_public == 1 {
                        "public"
                    } else {
                        "private"
                    };
                    println!(
                        "  {} ({} songs, {}) - {}",
                        playlist.playlist.title,
                        playlist.song_count,
                        public_status,
                        playlist
                            .playlist
                            .description
                            .unwrap_or_else(|| "No description".to_string())
                    );
                }
                if result.has_more {
                    println!(
                        "...more results available (use --offset {})",
                        offset + limit
                    );
                }
            }
            Err(e) => {
                eprintln!("failed to query playlists: {}", e);
            }
        }
        Ok(())
    } else {
        unreachable!("handle_query_playlists called with wrong action variant")
    }
}

pub async fn handle_query_playlist_songs(action: MusicAction) -> GrimoireResult<()> {
    if let MusicAction::QueryPlaylistSongs {
        playlist_id,
        search,
        sort_by,
        sort_direction,
        limit,
        offset,
    } = action
    {
        println!("querying playlist songs...");
        let params = QueryParams {
            q: search,
            search_fields: None,
            filters: HashMap::new(),
            sort_by,
            sort_direction,
            limit: Some(limit as u32),
            offset: Some(offset as u32),
            user_id: None,
            favorites_only: None,
            min_rating: None,
        };

        match query_playlist_songs(&playlist_id, params).await {
            Ok(result) => {
                println!(
                    "found {} songs in playlist (total: {})",
                    result.items.len(),
                    result.total_count
                );
                for song in result.items {
                    let track_info = format!(
                        "D{:02}T{:02}",
                        song.song.disc_number, song.song.track_number
                    );
                    println!(
                        "  [{}] {} - {} ({})",
                        track_info,
                        song.artist
                            .as_ref()
                            .map(|a| a.name.clone())
                            .unwrap_or("Unknown".to_string()),
                        song.song.title,
                        song.album
                            .as_ref()
                            .map(|a| a.title.clone())
                            .unwrap_or("Unknown".to_string())
                    );
                }
                if result.has_more {
                    println!(
                        "...more results available (use --offset {})",
                        offset + limit
                    );
                }
            }
            Err(e) => {
                eprintln!("failed to query playlist songs: {}", e);
            }
        }
        Ok(())
    } else {
        unreachable!("handle_query_playlist_songs called with wrong action variant")
    }
}
