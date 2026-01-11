//! Music query commands

use super::MusicAction;
use crate::cli::utils::CommandOutput;
use crate::error::{GrimoireError, GrimoireResult};
use crate::music::crud::{
    delete_album, delete_artist, delete_song, delete_sub_genre, delete_tag,
    find_or_create_sub_genre, get_album, get_album_tags, get_artist, get_genre, get_genre_stats,
    get_sub_genre, get_tag, list_albums, list_artists, list_genres, list_songs, list_sub_genres,
    list_sub_genres_for_genre, list_tags, query_albums, query_artists, query_genres,
    query_playlist_songs, query_playlists, query_songs, search_genres, search_sub_genres,
    search_tags, AlbumQueryResult, ArtistQueryResult, GenreQueryResult, PlaylistQueryResult,
    PlaylistSongResult, QueryResult, SongQueryResult,
};
use crate::music::{Album, Artist, Genre, GenreStat, Song, SubGenre, Tag};
use crate::response::GrimoireResponse;

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

pub async fn handle_query_songs(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<QueryResult<SongQueryResult>>> {
    if let MusicAction::QuerySongs { params } = action {
        let result = to_result(query_songs(params).await)?;

        let message = format!(
            "found {} songs (total: {})",
            result.items.len(),
            result.total_count
        );

        Ok(CommandOutput::new(message, result))
    } else {
        unreachable!("handle_query_songs called with wrong action variant")
    }
}

pub async fn handle_query_artists(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<QueryResult<ArtistQueryResult>>> {
    if let MusicAction::QueryArtists {
        params,
        starts_with: _,
    } = action
    {
        let result = to_result(query_artists(params).await)?;

        let message = format!(
            "found {} artists (total: {})",
            result.items.len(),
            result.total_count
        );

        Ok(CommandOutput::new(message, result))
    } else {
        unreachable!("handle_query_artists called with wrong action variant")
    }
}

pub async fn handle_query_albums(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<QueryResult<AlbumQueryResult>>> {
    if let MusicAction::QueryAlbums { params } = action {
        let result = to_result(query_albums(params).await)?;

        let message = format!(
            "found {} albums (total: {})",
            result.items.len(),
            result.total_count
        );

        Ok(CommandOutput::new(message, result))
    } else {
        unreachable!("handle_query_albums called with wrong action variant")
    }
}

pub async fn handle_query_genres(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<QueryResult<GenreQueryResult>>> {
    if let MusicAction::QueryGenres { params } = action {
        let result = to_result(query_genres(params).await)?;

        let message = format!(
            "found {} genres (total: {})",
            result.items.len(),
            result.total_count
        );

        Ok(CommandOutput::new(message, result))
    } else {
        unreachable!("handle_query_genres called with wrong action variant")
    }
}

pub async fn handle_query_playlists(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<QueryResult<PlaylistQueryResult>>> {
    if let MusicAction::QueryPlaylists {
        mut params,
        is_public,
    } = action
    {
        if let Some(public) = is_public {
            params
                .filters
                .insert("is_public".to_string(), serde_json::Value::Bool(public));
        }

        let result = query_playlists(params).await?;

        let message = format!(
            "found {} playlists (total: {})",
            result.items.len(),
            result.total_count
        );

        Ok(CommandOutput::new(message, result))
    } else {
        unreachable!("handle_query_playlists called with wrong action variant")
    }
}

pub async fn handle_query_playlist_songs(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<QueryResult<PlaylistSongResult>>> {
    if let MusicAction::QueryPlaylistSongs {
        playlist_id,
        params,
    } = action
    {
        let result = query_playlist_songs(&playlist_id, params).await?;

        let message = format!(
            "found {} songs in playlist (total: {})",
            result.items.len(),
            result.total_count
        );

        Ok(CommandOutput::new(message, result))
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

pub async fn handle_get_album(action: MusicAction) -> GrimoireResult<CommandOutput<Vec<Album>>> {
    if let MusicAction::GetAlbum { album_id } = action {
        let album = get_album(&album_id).await?;

        Ok(CommandOutput::new("Album retrieved", vec![album]))
    } else {
        unreachable!("handle_get_album called with wrong action variant")
    }
}

pub async fn handle_delete_album(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<Vec<serde_json::Value>>> {
    if let MusicAction::DeleteAlbum {
        album_id,
        deleted_by,
    } = action
    {
        delete_album(&album_id, deleted_by).await?;

        let message = format!("successfully deleted album {}", album_id);
        let data = vec![serde_json::json!({ "album_id": album_id })];
        Ok(CommandOutput::new(message, data))
    } else {
        unreachable!("handle_delete_album called with wrong action variant")
    }
}

pub async fn handle_get_album_tags(action: MusicAction) -> GrimoireResult<CommandOutput<Vec<Tag>>> {
    if let MusicAction::GetAlbumTags { album_id } = action {
        let tags = get_album_tags(&album_id).await?;

        let message = format!("found {} tags for album {}", tags.len(), album_id);
        Ok(CommandOutput::new(message, tags))
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

pub async fn handle_get_artist(action: MusicAction) -> GrimoireResult<CommandOutput<Vec<Artist>>> {
    if let MusicAction::GetArtist { artist_id } = action {
        let artist = get_artist(&artist_id).await?;

        Ok(CommandOutput::new("Artist retrieved", vec![artist]))
    } else {
        unreachable!("handle_get_artist called with wrong action variant")
    }
}

pub async fn handle_delete_artist(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<Vec<serde_json::Value>>> {
    if let MusicAction::DeleteArtist {
        artist_id,
        deleted_by,
    } = action
    {
        delete_artist(&artist_id, deleted_by).await?;

        let message = format!("successfully deleted artist {}", artist_id);
        let data = vec![serde_json::json!({ "artist_id": artist_id })];
        Ok(CommandOutput::new(message, data))
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
) -> GrimoireResult<CommandOutput<Vec<serde_json::Value>>> {
    if let MusicAction::DeleteSong {
        song_id,
        deleted_by,
    } = action
    {
        delete_song(&song_id, deleted_by).await?;

        let message = format!("successfully deleted song {}", song_id);
        let data = vec![serde_json::json!({ "song_id": song_id })];
        Ok(CommandOutput::new(message, data))
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

pub async fn handle_get_genre(action: MusicAction) -> GrimoireResult<CommandOutput<Vec<Genre>>> {
    if let MusicAction::GetGenre { genre_id } = action {
        let genre = get_genre(&genre_id).await?;

        Ok(CommandOutput::new("Genre retrieved", vec![genre]))
    } else {
        unreachable!("handle_get_genre called with wrong action variant")
    }
}

pub async fn handle_get_genre_stats(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<Vec<GenreStat>>> {
    if let MusicAction::GetGenreStats { genre_id: _ } = action {
        let stats = get_genre_stats().await?;

        let message = format!("Genre stats: {} genres", stats.len());
        Ok(CommandOutput::new(message, stats))
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
) -> GrimoireResult<CommandOutput<Vec<SubGenre>>> {
    if let MusicAction::ListSubGenresForGenre { genre_id } = action {
        let sub_genres = list_sub_genres_for_genre(&genre_id).await?;

        let message = format!(
            "found {} sub-genres for genre {}",
            sub_genres.len(),
            genre_id
        );
        Ok(CommandOutput::new(message, sub_genres))
    } else {
        unreachable!("handle_list_sub_genres_for_genre called with wrong action variant")
    }
}

pub async fn handle_get_sub_genre(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<Vec<SubGenre>>> {
    if let MusicAction::GetSubGenre { sub_genre_id } = action {
        let sub_genre = get_sub_genre(&sub_genre_id).await?;

        Ok(CommandOutput::new("Sub-genre retrieved", vec![sub_genre]))
    } else {
        unreachable!("handle_get_sub_genre called with wrong action variant")
    }
}

pub async fn handle_delete_sub_genre(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<Vec<serde_json::Value>>> {
    if let MusicAction::DeleteSubGenre { sub_genre_id } = action {
        delete_sub_genre(&sub_genre_id, None).await?;

        let message = format!("successfully deleted sub-genre {}", sub_genre_id);
        let data = vec![serde_json::json!({ "sub_genre_id": sub_genre_id })];
        Ok(CommandOutput::new(message, data))
    } else {
        unreachable!("handle_delete_sub_genre called with wrong action variant")
    }
}

pub async fn handle_find_or_create_sub_genre(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<Vec<SubGenre>>> {
    if let MusicAction::FindOrCreateSubGenre { name, genre_id } = action {
        let (sub_genre, created) = find_or_create_sub_genre(name, genre_id).await?;

        let message = if created {
            format!("Created sub-genre: {} - {}", sub_genre.id, sub_genre.name)
        } else {
            format!(
                "Found existing sub-genre: {} - {}",
                sub_genre.id, sub_genre.name
            )
        };

        Ok(CommandOutput::new(message, vec![sub_genre]))
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

pub async fn handle_get_tag(action: MusicAction) -> GrimoireResult<CommandOutput<Vec<Tag>>> {
    if let MusicAction::GetTag { tag_id } = action {
        let tag = get_tag(&tag_id).await?;

        Ok(CommandOutput::new("Tag retrieved", vec![tag]))
    } else {
        unreachable!("handle_get_tag called with wrong action variant")
    }
}

pub async fn handle_delete_tag(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<Vec<serde_json::Value>>> {
    if let MusicAction::DeleteTag { tag_id } = action {
        delete_tag(&tag_id, None).await?;

        let message = format!("successfully deleted tag {}", tag_id);
        let data = vec![serde_json::json!({ "tag_id": tag_id })];
        Ok(CommandOutput::new(message, data))
    } else {
        unreachable!("handle_delete_tag called with wrong action variant")
    }
}

// Query/search operations
pub async fn handle_query_genres_search(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<Vec<Genre>>> {
    if let MusicAction::QueryGenresSearch { search } = action {
        let genres = search_genres(&search).await?;

        let message = format!("found {} genres matching '{}'", genres.len(), search);
        Ok(CommandOutput::new(message, genres))
    } else {
        unreachable!("handle_query_genres_search called with wrong action variant")
    }
}

pub async fn handle_query_sub_genres_search(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<Vec<SubGenre>>> {
    if let MusicAction::QuerySubGenresSearch { search } = action {
        let sub_genres = search_sub_genres(&search).await?;

        let message = format!(
            "found {} sub-genres matching '{}'",
            sub_genres.len(),
            search
        );
        Ok(CommandOutput::new(message, sub_genres))
    } else {
        unreachable!("handle_query_sub_genres_search called with wrong action variant")
    }
}

pub async fn handle_query_tags_search(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<Vec<Tag>>> {
    if let MusicAction::QueryTagsSearch { search } = action {
        let tags = search_tags(&search).await?;

        let message = format!("found {} tags matching '{}'", tags.len(), search);
        Ok(CommandOutput::new(message, tags))
    } else {
        unreachable!("handle_query_tags_search called with wrong action variant")
    }
}
