//! Music query commands

use super::MusicAction;
use crate::cli::output::CommandOutput;
use crate::error::GrimoireResult;
use crate::music::crud::{
    delete_album, delete_artist, delete_song, delete_sub_genre, delete_tag,
    find_or_create_sub_genre, get_album, get_album_tags, get_artist, get_genre, get_genre_stats,
    get_sub_genre, get_tag, list_albums, list_artists, list_genres, list_songs, list_sub_genres,
    list_sub_genres_for_genre, list_tags, query_albums, query_artists, query_genres,
    query_playlist_songs, query_playlists, query_songs, search_genres, search_sub_genres,
    search_tags, QueryParams,
};
use crate::music::{Album, Artist, Genre, Song, SubGenre, Tag};
use std::collections::HashMap;

pub async fn handle_query_songs(
    action: MusicAction,
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
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

pub async fn handle_query_artists(
    action: MusicAction,
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
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

pub async fn handle_query_albums(
    action: MusicAction,
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
    if let MusicAction::QueryAlbums {
        search,
        sort_by,
        sort_direction,
        limit,
        offset,
    } = action
    {
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

pub async fn handle_query_genres(
    action: MusicAction,
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
    if let MusicAction::QueryGenres {
        search,
        sort_by,
        sort_direction,
        limit,
        offset,
    } = action
    {
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

pub async fn handle_query_playlists(
    action: MusicAction,
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
    if let MusicAction::QueryPlaylists {
        search,
        sort_by,
        sort_direction,
        is_public,
        limit,
        offset,
    } = action
    {
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

pub async fn handle_query_playlist_songs(
    action: MusicAction,
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
    if let MusicAction::QueryPlaylistSongs {
        playlist_id,
        search,
        sort_by,
        sort_direction,
        limit,
        offset,
    } = action
    {
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
                for item in result.items {
                    let track_info = format!(
                        "D{:02}T{:02}",
                        item.details.song.disc_number, item.details.song.track_number
                    );
                    println!(
                        "  [pos {}] [{}] {} - {} ({})",
                        item.position,
                        track_info,
                        item.details
                            .artist
                            .as_ref()
                            .map(|a| a.name.clone())
                            .unwrap_or("Unknown".to_string()),
                        item.details.song.title,
                        item.details
                            .album
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

// Album operations
pub async fn handle_list_albums(action: MusicAction) -> GrimoireResult<CommandOutput<Vec<Album>>> {
    if let MusicAction::ListAlbums { limit, offset } = action {
        match list_albums(limit, offset).await {
            Ok(albums) => {
                let message = format!("Found {} albums", albums.len());
                Ok(CommandOutput::new(message, albums))
            }
            Err(e) => Err(e),
        }
    } else {
        unreachable!("handle_list_albums called with wrong action variant")
    }
}

pub async fn handle_get_album(
    action: MusicAction,
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
    if let MusicAction::GetAlbum { album_id } = action {
        println!("getting album: {}", album_id);
        match get_album(&album_id).await {
            Ok(album) => {
                println!("Album: {} - {}", album.id, album.title);
                println!("  Type: {}", album.album_type);
                if let Some(date) = album.release_date {
                    println!("  Release date: {}", date);
                }
                Ok(())
            }
            Err(e) => {
                eprintln!("failed to get album: {}", e);
                Err(e)
            }
        }
    } else {
        unreachable!("handle_get_album called with wrong action variant")
    }
}

pub async fn handle_delete_album(
    action: MusicAction,
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
    if let MusicAction::DeleteAlbum {
        album_id,
        deleted_by,
    } = action
    {
        println!("deleting album: {}", album_id);
        match delete_album(&album_id, deleted_by).await {
            Ok(_) => {
                println!("successfully deleted album {}", album_id);
                Ok(())
            }
            Err(e) => {
                eprintln!("failed to delete album: {}", e);
                Err(e)
            }
        }
    } else {
        unreachable!("handle_delete_album called with wrong action variant")
    }
}

pub async fn handle_get_album_tags(
    action: MusicAction,
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
    if let MusicAction::GetAlbumTags { album_id } = action {
        println!("getting tags for album: {}", album_id);
        match get_album_tags(&album_id).await {
            Ok(tags) => {
                println!("found {} tags for album {}", tags.len(), album_id);
                for tag in tags {
                    println!("  {} - {}", tag.id, tag.name);
                }
                Ok(())
            }
            Err(e) => {
                eprintln!("failed to get album tags: {}", e);
                Err(e)
            }
        }
    } else {
        unreachable!("handle_get_album_tags called with wrong action variant")
    }
}

// Artist operations
pub async fn handle_list_artists(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<Vec<Artist>>> {
    if let MusicAction::ListArtists { limit, offset } = action {
        match list_artists(limit, offset).await {
            Ok(artists) => {
                let message = format!("Found {} artists", artists.len());
                Ok(CommandOutput::new(message, artists))
            }
            Err(e) => Err(e),
        }
    } else {
        unreachable!("handle_list_artists called with wrong action variant")
    }
}

pub async fn handle_get_artist(
    action: MusicAction,
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
    if let MusicAction::GetArtist { artist_id } = action {
        println!("getting artist: {}", artist_id);
        match get_artist(&artist_id).await {
            Ok(artist) => {
                println!("Artist: {} - {}", artist.id, artist.name);
                Ok(())
            }
            Err(e) => {
                eprintln!("failed to get artist: {}", e);
                Err(e)
            }
        }
    } else {
        unreachable!("handle_get_artist called with wrong action variant")
    }
}

pub async fn handle_delete_artist(
    action: MusicAction,
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
    if let MusicAction::DeleteArtist {
        artist_id,
        deleted_by,
    } = action
    {
        println!("deleting artist: {}", artist_id);
        match delete_artist(&artist_id, deleted_by).await {
            Ok(_) => {
                println!("successfully deleted artist {}", artist_id);
                Ok(())
            }
            Err(e) => {
                eprintln!("failed to delete artist: {}", e);
                Err(e)
            }
        }
    } else {
        unreachable!("handle_delete_artist called with wrong action variant")
    }
}

// Song operations
pub async fn handle_list_songs(action: MusicAction) -> GrimoireResult<CommandOutput<Vec<Song>>> {
    if let MusicAction::ListSongs { limit, offset } = action {
        match list_songs(limit, offset).await {
            Ok(songs) => {
                let message = format!("Found {} songs", songs.len());
                Ok(CommandOutput::new(message, songs))
            }
            Err(e) => Err(e),
        }
    } else {
        unreachable!("handle_list_songs called with wrong action variant")
    }
}

pub async fn handle_delete_song(
    action: MusicAction,
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
    if let MusicAction::DeleteSong {
        song_id,
        deleted_by,
    } = action
    {
        println!("deleting song: {}", song_id);
        match delete_song(&song_id, deleted_by).await {
            Ok(_) => {
                println!("successfully deleted song {}", song_id);
                Ok(())
            }
            Err(e) => {
                eprintln!("failed to delete song: {}", e);
                Err(e)
            }
        }
    } else {
        unreachable!("handle_delete_song called with wrong action variant")
    }
}

// Genre operations
pub async fn handle_list_genres(_action: MusicAction) -> GrimoireResult<CommandOutput<Vec<Genre>>> {
    match list_genres().await {
        Ok(genres) => {
            let message = format!("Found {} genres", genres.len());
            Ok(CommandOutput::new(message, genres))
        }
        Err(e) => Err(e),
    }
}

pub async fn handle_get_genre(
    action: MusicAction,
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
    if let MusicAction::GetGenre { genre_id } = action {
        println!("getting genre: {}", genre_id);
        match get_genre(&genre_id).await {
            Ok(genre) => {
                println!("Genre: {} - {}", genre.id, genre.name);
                Ok(())
            }
            Err(e) => {
                eprintln!("failed to get genre: {}", e);
                Err(e)
            }
        }
    } else {
        unreachable!("handle_get_genre called with wrong action variant")
    }
}

pub async fn handle_get_genre_stats(
    action: MusicAction,
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
    if let MusicAction::GetGenreStats { genre_id: _ } = action {
        println!("getting genre stats for all genres...");
        match get_genre_stats().await {
            Ok(stats) => {
                println!("Genre stats: {} genres", stats.len());
                for stat in stats {
                    println!("  {}: {} songs", stat.name, stat.song_count);
                }
                Ok(())
            }
            Err(e) => {
                eprintln!("failed to get genre stats: {}", e);
                Err(e)
            }
        }
    } else {
        unreachable!("handle_get_genre_stats called with wrong action variant")
    }
}

// Sub-genre operations
pub async fn handle_list_sub_genres(
    _action: MusicAction,
) -> GrimoireResult<CommandOutput<Vec<SubGenre>>> {
    match list_sub_genres().await {
        Ok(sub_genres) => {
            let message = format!("Found {} sub-genres", sub_genres.len());
            Ok(CommandOutput::new(message, sub_genres))
        }
        Err(e) => Err(e),
    }
}

pub async fn handle_list_sub_genres_for_genre(
    action: MusicAction,
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
    if let MusicAction::ListSubGenresForGenre { genre_id } = action {
        println!("listing sub-genres for genre: {}", genre_id);
        match list_sub_genres_for_genre(&genre_id).await {
            Ok(sub_genres) => {
                println!(
                    "found {} sub-genres for genre {}",
                    sub_genres.len(),
                    genre_id
                );
                for sub_genre in sub_genres {
                    println!("  {} - {}", sub_genre.id, sub_genre.name);
                }
                Ok(())
            }
            Err(e) => {
                eprintln!("failed to list sub-genres for genre: {}", e);
                Err(e)
            }
        }
    } else {
        unreachable!("handle_list_sub_genres_for_genre called with wrong action variant")
    }
}

pub async fn handle_get_sub_genre(
    action: MusicAction,
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
    if let MusicAction::GetSubGenre { sub_genre_id } = action {
        println!("getting sub-genre: {}", sub_genre_id);
        match get_sub_genre(&sub_genre_id).await {
            Ok(sub_genre) => {
                println!("Sub-genre: {} - {}", sub_genre.id, sub_genre.name);
                Ok(())
            }
            Err(e) => {
                eprintln!("failed to get sub-genre: {}", e);
                Err(e)
            }
        }
    } else {
        unreachable!("handle_get_sub_genre called with wrong action variant")
    }
}

pub async fn handle_delete_sub_genre(
    action: MusicAction,
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
    if let MusicAction::DeleteSubGenre { sub_genre_id } = action {
        println!("deleting sub-genre: {}", sub_genre_id);
        match delete_sub_genre(&sub_genre_id, None).await {
            Ok(_) => {
                println!("successfully deleted sub-genre {}", sub_genre_id);
                Ok(())
            }
            Err(e) => {
                eprintln!("failed to delete sub-genre: {}", e);
                Err(e)
            }
        }
    } else {
        unreachable!("handle_delete_sub_genre called with wrong action variant")
    }
}

pub async fn handle_find_or_create_sub_genre(
    action: MusicAction,
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
    if let MusicAction::FindOrCreateSubGenre { name, genre_id } = action {
        println!(
            "finding or creating sub-genre: {} for genre {}",
            name, genre_id
        );
        match find_or_create_sub_genre(name, genre_id).await {
            Ok((sub_genre, created)) => {
                if created {
                    println!("Created sub-genre: {} - {}", sub_genre.id, sub_genre.name);
                } else {
                    println!(
                        "Found existing sub-genre: {} - {}",
                        sub_genre.id, sub_genre.name
                    );
                }
                Ok(())
            }
            Err(e) => {
                eprintln!("failed to find or create sub-genre: {}", e);
                Err(e)
            }
        }
    } else {
        unreachable!("handle_find_or_create_sub_genre called with wrong action variant")
    }
}

// Tag operations
pub async fn handle_list_tags(_action: MusicAction) -> GrimoireResult<CommandOutput<Vec<Tag>>> {
    match list_tags().await {
        Ok(tags) => {
            let message = format!("Found {} tags", tags.len());
            Ok(CommandOutput::new(message, tags))
        }
        Err(e) => Err(e),
    }
}

pub async fn handle_get_tag(
    action: MusicAction,
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
    if let MusicAction::GetTag { tag_id } = action {
        println!("getting tag: {}", tag_id);
        match get_tag(&tag_id).await {
            Ok(tag) => {
                println!("Tag: {} - {}", tag.id, tag.name);
                Ok(())
            }
            Err(e) => {
                eprintln!("failed to get tag: {}", e);
                Err(e)
            }
        }
    } else {
        unreachable!("handle_get_tag called with wrong action variant")
    }
}

pub async fn handle_delete_tag(
    action: MusicAction,
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
    if let MusicAction::DeleteTag { tag_id } = action {
        println!("deleting tag: {}", tag_id);
        match delete_tag(&tag_id, None).await {
            Ok(_) => {
                println!("successfully deleted tag {}", tag_id);
                Ok(())
            }
            Err(e) => {
                eprintln!("failed to delete tag: {}", e);
                Err(e)
            }
        }
    } else {
        unreachable!("handle_delete_tag called with wrong action variant")
    }
}

// Query/search operations
pub async fn handle_query_genres_search(
    action: MusicAction,
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
    if let MusicAction::QueryGenresSearch { search } = action {
        println!("searching genres: {}", search);
        match search_genres(&search).await {
            Ok(genres) => {
                println!("found {} genres matching '{}'", genres.len(), search);
                for genre in genres {
                    println!("  {} - {}", genre.id, genre.name);
                }
                Ok(())
            }
            Err(e) => {
                eprintln!("failed to search genres: {}", e);
                Err(e)
            }
        }
    } else {
        unreachable!("handle_query_genres_search called with wrong action variant")
    }
}

pub async fn handle_query_sub_genres_search(
    action: MusicAction,
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
    if let MusicAction::QuerySubGenresSearch { search } = action {
        println!("searching sub-genres: {}", search);
        match search_sub_genres(&search).await {
            Ok(sub_genres) => {
                println!(
                    "found {} sub-genres matching '{}'",
                    sub_genres.len(),
                    search
                );
                for sub_genre in sub_genres {
                    println!("  {} - {}", sub_genre.id, sub_genre.name);
                }
                Ok(())
            }
            Err(e) => {
                eprintln!("failed to search sub-genres: {}", e);
                Err(e)
            }
        }
    } else {
        unreachable!("handle_query_sub_genres_search called with wrong action variant")
    }
}

pub async fn handle_query_tags_search(
    action: MusicAction,
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
    if let MusicAction::QueryTagsSearch { search } = action {
        println!("searching tags: {}", search);
        match search_tags(&search).await {
            Ok(tags) => {
                println!("found {} tags matching '{}'", tags.len(), search);
                for tag in tags {
                    println!("  {} - {}", tag.id, tag.name);
                }
                Ok(())
            }
            Err(e) => {
                eprintln!("failed to search tags: {}", e);
                Err(e)
            }
        }
    } else {
        unreachable!("handle_query_tags_search called with wrong action variant")
    }
}
