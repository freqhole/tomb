//! Music query commands

use super::MusicAction;
use crate::plumbing::utils::CommandOutput;
use grimoire::music::crud::{
    delete_album, delete_artist, delete_song, delete_sub_genre, delete_tag,
    find_or_create_sub_genre, get_album, get_album_tags, get_artist, get_genre, get_genre_stats,
    get_sub_genre, get_tag, list_albums, list_artists, list_genres, list_songs, list_sub_genres,
    list_sub_genres_for_genre, list_tags, query_albums, query_artists, query_genres,
    query_playlist_songs, query_playlists, query_songs, search_genres, search_sub_genres,
    search_tags,
};

pub async fn handle_query_songs(action: MusicAction) -> CommandOutput<serde_json::Value> {
    if let MusicAction::QuerySongs { params } = action {
        let response = query_songs(params).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(result) = response.data else {
            return CommandOutput::failure("No query results returned", vec![], ());
        };

        let message = format!(
            "found {} songs (total: {})",
            result.items.len(),
            result.total_count
        );

        CommandOutput::success(message, result)
    } else {
        unreachable!("handle_query_songs called with wrong action variant")
    }
}

pub async fn handle_query_artists(action: MusicAction) -> CommandOutput<serde_json::Value> {
    if let MusicAction::QueryArtists {
        params,
        starts_with: _,
    } = action
    {
        let response = query_artists(params).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(result) = response.data else {
            return CommandOutput::failure("No query results returned", vec![], ());
        };

        let message = format!(
            "found {} artists (total: {})",
            result.items.len(),
            result.total_count
        );

        CommandOutput::success(message, result)
    } else {
        unreachable!("handle_query_artists called with wrong action variant")
    }
}

pub async fn handle_query_albums(action: MusicAction) -> CommandOutput<serde_json::Value> {
    if let MusicAction::QueryAlbums { params } = action {
        let response = query_albums(params).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(result) = response.data else {
            return CommandOutput::failure("No query results returned", vec![], ());
        };

        let message = format!(
            "found {} albums (total: {})",
            result.items.len(),
            result.total_count
        );

        CommandOutput::success(message, result)
    } else {
        unreachable!("handle_query_albums called with wrong action variant")
    }
}

pub async fn handle_query_genres(action: MusicAction) -> CommandOutput<serde_json::Value> {
    if let MusicAction::QueryGenres { params } = action {
        let response = query_genres(params).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(result) = response.data else {
            return CommandOutput::failure("No query results returned", vec![], ());
        };

        let message = format!(
            "found {} genres (total: {})",
            result.items.len(),
            result.total_count
        );

        CommandOutput::success(message, result)
    } else {
        unreachable!("handle_query_genres called with wrong action variant")
    }
}

pub async fn handle_query_playlists(action: MusicAction) -> CommandOutput<serde_json::Value> {
    if let MusicAction::QueryPlaylists {
        mut params,
        is_public,
    } = action
    {
        if let Some(public) = is_public {
            params
                .filters
                .insert("is_public".to_string(), serde_json::json!(public));
        }

        let response = query_playlists(params).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(result) = response.data else {
            return CommandOutput::failure("No query results returned", vec![], ());
        };

        let message = format!(
            "found {} playlists (total: {})",
            result.items.len(),
            result.total_count
        );

        CommandOutput::success(message, result)
    } else {
        unreachable!("handle_query_playlists called with wrong action variant")
    }
}

pub async fn handle_query_playlist_songs(action: MusicAction) -> CommandOutput<serde_json::Value> {
    if let MusicAction::QueryPlaylistSongs {
        playlist_id,
        params,
    } = action
    {
        let response = query_playlist_songs(&playlist_id, params).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(result) = response.data else {
            return CommandOutput::failure("No query results returned", vec![], ());
        };

        let message = format!(
            "found {} songs in playlist {} (total: {})",
            result.items.len(),
            playlist_id,
            result.total_count
        );

        CommandOutput::success(message, result)
    } else {
        unreachable!("handle_query_playlist_songs called with wrong action variant")
    }
}

// Album operations
pub async fn handle_list_albums(action: MusicAction) -> CommandOutput<serde_json::Value> {
    if let MusicAction::ListAlbums { limit, offset } = action {
        let response = list_albums(limit, offset).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(albums) = response.data else {
            return CommandOutput::failure("No albums returned", vec![], ());
        };

        let message = format!("Found {} albums", albums.len());
        CommandOutput::success(message, albums)
    } else {
        unreachable!("handle_list_albums called with wrong action variant")
    }
}

pub async fn handle_get_album(action: MusicAction) -> CommandOutput<serde_json::Value> {
    if let MusicAction::GetAlbum { album_id } = action {
        let response = get_album(&album_id).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(album) = response.data else {
            return CommandOutput::failure("No album returned", vec![], ());
        };

        CommandOutput::success("Album retrieved", vec![album])
    } else {
        unreachable!("handle_get_album called with wrong action variant")
    }
}

pub async fn handle_delete_album(action: MusicAction) -> CommandOutput<serde_json::Value> {
    if let MusicAction::DeleteAlbum {
        album_id,
        deleted_by,
    } = action
    {
        let response = delete_album(&album_id, deleted_by).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let message = format!("successfully deleted album {}", album_id);
        CommandOutput::success(message, ())
    } else {
        unreachable!("handle_delete_album called with wrong action variant")
    }
}

pub async fn handle_get_album_tags(action: MusicAction) -> CommandOutput<serde_json::Value> {
    if let MusicAction::GetAlbumTags { album_id } = action {
        let response = get_album_tags(&album_id).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(tags) = response.data else {
            return CommandOutput::failure("No tags returned", vec![], ());
        };

        let message = format!("found {} tags for album {}", tags.len(), album_id);
        CommandOutput::success(message, tags)
    } else {
        unreachable!("handle_get_album_tags called with wrong action variant")
    }
}

// Artist operations
pub async fn handle_list_artists(action: MusicAction) -> CommandOutput<serde_json::Value> {
    if let MusicAction::ListArtists { limit, offset } = action {
        let response = list_artists(limit, offset).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(artists) = response.data else {
            return CommandOutput::failure("No artists returned", vec![], ());
        };

        let message = format!("Found {} artists", artists.len());
        CommandOutput::success(message, artists)
    } else {
        unreachable!("handle_list_artists called with wrong action variant")
    }
}

pub async fn handle_get_artist(action: MusicAction) -> CommandOutput<serde_json::Value> {
    if let MusicAction::GetArtist { artist_id } = action {
        let response = get_artist(&artist_id).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(artist) = response.data else {
            return CommandOutput::failure("No artist returned", vec![], ());
        };

        CommandOutput::success("Artist retrieved", vec![artist])
    } else {
        unreachable!("handle_get_artist called with wrong action variant")
    }
}

pub async fn handle_delete_artist(action: MusicAction) -> CommandOutput<serde_json::Value> {
    if let MusicAction::DeleteArtist {
        artist_id,
        deleted_by,
    } = action
    {
        let response = delete_artist(&artist_id, deleted_by).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let message = format!("successfully deleted artist {}", artist_id);
        CommandOutput::success(message, ())
    } else {
        unreachable!("handle_delete_artist called with wrong action variant")
    }
}

// Song operations
pub async fn handle_list_songs(action: MusicAction) -> CommandOutput<serde_json::Value> {
    if let MusicAction::ListSongs { limit, offset } = action {
        let response = list_songs(limit, offset).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(songs) = response.data else {
            return CommandOutput::failure("No songs returned", vec![], ());
        };

        let message = format!("Found {} songs", songs.len());
        CommandOutput::success(message, songs)
    } else {
        unreachable!("handle_list_songs called with wrong action variant")
    }
}

pub async fn handle_delete_song(action: MusicAction) -> CommandOutput<serde_json::Value> {
    if let MusicAction::DeleteSong {
        song_id,
        deleted_by,
    } = action
    {
        let response = delete_song(&song_id, deleted_by).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let message = format!("successfully deleted song {}", song_id);
        CommandOutput::success(message, ())
    } else {
        unreachable!("handle_delete_song called with wrong action variant")
    }
}

// Genre operations
pub async fn handle_list_genres(_action: MusicAction) -> CommandOutput<serde_json::Value> {
    let response = list_genres().await;
    if !response.success {
        return CommandOutput::failure(response.message, response.errors, ());
    }

    let Some(genres) = response.data else {
        return CommandOutput::failure("No genres returned", vec![], ());
    };

    let message = format!("Found {} genres", genres.len());
    CommandOutput::success(message, genres)
}

pub async fn handle_get_genre(action: MusicAction) -> CommandOutput<serde_json::Value> {
    if let MusicAction::GetGenre { genre_id } = action {
        let response = get_genre(&genre_id).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(genre) = response.data else {
            return CommandOutput::failure("No genre returned", vec![], ());
        };

        CommandOutput::success("Genre retrieved", vec![genre])
    } else {
        unreachable!("handle_get_genre called with wrong action variant")
    }
}

pub async fn handle_get_genre_stats(action: MusicAction) -> CommandOutput<serde_json::Value> {
    if let MusicAction::GetGenreStats { genre_id: _ } = action {
        let response = get_genre_stats().await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(stats) = response.data else {
            return CommandOutput::failure("No genre stats returned", vec![], ());
        };

        let message = format!("Genre stats: {} genres", stats.len());
        CommandOutput::success(message, stats)
    } else {
        unreachable!("handle_get_genre_stats called with wrong action variant")
    }
}

// Sub-genre operations
pub async fn handle_list_sub_genres(_action: MusicAction) -> CommandOutput<serde_json::Value> {
    let response = list_sub_genres().await;
    if !response.success {
        return CommandOutput::failure(response.message, response.errors, ());
    }

    let Some(sub_genres) = response.data else {
        return CommandOutput::failure("No sub-genres returned", vec![], ());
    };

    let message = format!("Found {} sub-genres", sub_genres.len());
    CommandOutput::success(message, sub_genres)
}

pub async fn handle_list_sub_genres_for_genre(
    action: MusicAction,
) -> CommandOutput<serde_json::Value> {
    if let MusicAction::ListSubGenresForGenre { genre_id } = action {
        let response = list_sub_genres_for_genre(&genre_id).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(sub_genres) = response.data else {
            return CommandOutput::failure("No sub-genres returned", vec![], ());
        };

        let message = format!(
            "found {} sub-genres for genre {}",
            sub_genres.len(),
            genre_id
        );
        CommandOutput::success(message, sub_genres)
    } else {
        unreachable!("handle_list_sub_genres_for_genre called with wrong action variant")
    }
}

pub async fn handle_get_sub_genre(action: MusicAction) -> CommandOutput<serde_json::Value> {
    if let MusicAction::GetSubGenre { sub_genre_id } = action {
        let response = get_sub_genre(&sub_genre_id).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(sub_genre) = response.data else {
            return CommandOutput::failure("No sub-genre returned", vec![], ());
        };

        CommandOutput::success("Sub-genre retrieved", vec![sub_genre])
    } else {
        unreachable!("handle_get_sub_genre called with wrong action variant")
    }
}

pub async fn handle_delete_sub_genre(action: MusicAction) -> CommandOutput<serde_json::Value> {
    if let MusicAction::DeleteSubGenre { sub_genre_id } = action {
        let response = delete_sub_genre(&sub_genre_id, None).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let message = format!("successfully deleted sub-genre {}", sub_genre_id);
        CommandOutput::success(message, ())
    } else {
        unreachable!("handle_delete_sub_genre called with wrong action variant")
    }
}

pub async fn handle_find_or_create_sub_genre(
    action: MusicAction,
) -> CommandOutput<serde_json::Value> {
    if let MusicAction::FindOrCreateSubGenre { name, genre_id } = action {
        let response = find_or_create_sub_genre(name, genre_id).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some((sub_genre, created)) = response.data else {
            return CommandOutput::failure("No sub-genre returned", vec![], ());
        };

        let message = if created {
            format!("Created sub-genre: {} - {}", sub_genre.id, sub_genre.name)
        } else {
            format!(
                "Found existing sub-genre: {} - {}",
                sub_genre.id, sub_genre.name
            )
        };

        CommandOutput::success(message, vec![sub_genre])
    } else {
        unreachable!("handle_find_or_create_sub_genre called with wrong action variant")
    }
}

// Tag operations
pub async fn handle_list_tags(_action: MusicAction) -> CommandOutput<serde_json::Value> {
    let response = list_tags().await;
    if !response.success {
        return CommandOutput::failure(response.message, response.errors, ());
    }

    let Some(tags) = response.data else {
        return CommandOutput::failure("No tags returned", vec![], ());
    };

    let message = format!("Found {} tags", tags.len());
    CommandOutput::success(message, tags)
}

pub async fn handle_get_tag(action: MusicAction) -> CommandOutput<serde_json::Value> {
    if let MusicAction::GetTag { tag_id } = action {
        let response = get_tag(&tag_id).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(tag) = response.data else {
            return CommandOutput::failure("No tag returned", vec![], ());
        };

        CommandOutput::success("Tag retrieved", vec![tag])
    } else {
        unreachable!("handle_get_tag called with wrong action variant")
    }
}

pub async fn handle_delete_tag(action: MusicAction) -> CommandOutput<serde_json::Value> {
    if let MusicAction::DeleteTag { tag_id } = action {
        let response = delete_tag(&tag_id, None).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let message = format!("successfully deleted tag {}", tag_id);
        CommandOutput::success(message, ())
    } else {
        unreachable!("handle_delete_tag called with wrong action variant")
    }
}

// Query/search operations
pub async fn handle_query_genres_search(action: MusicAction) -> CommandOutput<serde_json::Value> {
    if let MusicAction::QueryGenresSearch { search } = action {
        let response = search_genres(&search).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(genres) = response.data else {
            return CommandOutput::failure("No genres returned", vec![], ());
        };

        let message = format!("found {} genres matching '{}'", genres.len(), search);
        CommandOutput::success(message, genres)
    } else {
        unreachable!("handle_query_genres_search called with wrong action variant")
    }
}

pub async fn handle_query_sub_genres_search(
    action: MusicAction,
) -> CommandOutput<serde_json::Value> {
    if let MusicAction::QuerySubGenresSearch { search } = action {
        let response = search_sub_genres(&search).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(sub_genres) = response.data else {
            return CommandOutput::failure("No sub-genres returned", vec![], ());
        };

        let message = format!(
            "found {} sub-genres matching '{}'",
            sub_genres.len(),
            search
        );
        CommandOutput::success(message, sub_genres)
    } else {
        unreachable!("handle_query_sub_genres_search called with wrong action variant")
    }
}

pub async fn handle_query_tags_search(action: MusicAction) -> CommandOutput<serde_json::Value> {
    if let MusicAction::QueryTagsSearch { search } = action {
        let response = search_tags(&search).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(tags) = response.data else {
            return CommandOutput::failure("No tags returned", vec![], ());
        };

        let message = format!("found {} tags matching '{}'", tags.len(), search);
        CommandOutput::success(message, tags)
    } else {
        unreachable!("handle_query_tags_search called with wrong action variant")
    }
}
