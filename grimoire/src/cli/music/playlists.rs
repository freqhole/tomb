//! Music playlist commands

use super::MusicAction;
use crate::cli::utils::resolve_request;
use crate::cli::utils::CommandOutput;
use crate::music::crud::{
    add_songs_to_playlist, create_playlist, delete_playlist, list_playlists, list_user_playlists,
    remove_playlist_thumbnail, search_playlists, update_playlist, update_songs_position,
    AddSongsToPlaylistRequest, CreatePlaylistRequest, UpdatePlaylistRequest,
};
use crate::music::Playlist;

pub async fn handle_create_playlist(action: MusicAction) -> CommandOutput<()> {
    if let MusicAction::CreatePlaylist {
        json_input,
        request,
    } = action
    {
        let req = match resolve_request::<CreatePlaylistRequest>(json_input, request) {
            Ok(r) => r,
            Err(e) => {
                return CommandOutput::failure(
                    "Invalid request",
                    vec![crate::error::ErrorDetail::from(&e)],
                    (),
                );
            }
        };

        let response = create_playlist(req).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(playlist) = response.data else {
            return CommandOutput::failure("No playlist returned", vec![], ());
        };

        let message = format!(
            "Created playlist: {} (ID: {}) - {}",
            playlist.title,
            playlist.id,
            if playlist.is_public == 1 {
                "public"
            } else {
                "private"
            }
        );

        CommandOutput::success(message, vec![playlist]).map_data(|_| ())
    } else {
        unreachable!("handle_create_playlist called with wrong action variant")
    }
}

pub async fn handle_add_songs(action: MusicAction) -> CommandOutput<()> {
    if let MusicAction::AddSongsToPlaylist {
        json_input,
        request,
    } = action
    {
        let req = match resolve_request::<AddSongsToPlaylistRequest>(json_input, request) {
            Ok(r) => r,
            Err(e) => {
                return CommandOutput::failure(
                    "Invalid request",
                    vec![crate::error::ErrorDetail::from(&e)],
                    (),
                );
            }
        };

        let response = add_songs_to_playlist(&req.playlist_id, &req.song_ids).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let message = format!(
            "Added {} songs to playlist {}",
            req.song_ids.len(),
            req.playlist_id
        );

        CommandOutput::success(message, ())
    } else {
        unreachable!("handle_add_songs called with wrong action variant")
    }
}

pub async fn handle_update_position(action: MusicAction) -> CommandOutput<()> {
    if let MusicAction::UpdateSongPosition {
        playlist_id,
        song_ids,
        new_position,
    } = action
    {
        let song_id_list: Vec<&str> = song_ids.iter().map(|s| s.as_str()).collect();
        let response =
            update_songs_position(&playlist_id, &song_id_list, new_position as i64).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let message = format!(
            "successfully moved {} song(s) to position {} in playlist {}",
            song_id_list.len(),
            new_position,
            playlist_id
        );

        CommandOutput::success(message, ())
    } else {
        unreachable!("handle_update_position called with wrong action variant")
    }
}

pub async fn handle_delete_playlist(action: MusicAction) -> CommandOutput<()> {
    if let MusicAction::DeletePlaylist { playlist_id } = action {
        let response = delete_playlist(&playlist_id, None).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let message = format!("successfully deleted playlist {}", playlist_id);
        CommandOutput::success(message, ())
    } else {
        unreachable!("handle_delete_playlist called with wrong action variant")
    }
}

pub async fn handle_update_playlist(action: MusicAction) -> CommandOutput<()> {
    if let MusicAction::UpdatePlaylist {
        playlist_id,
        json_input,
        request,
    } = action
    {
        let req = match resolve_request::<UpdatePlaylistRequest>(json_input, request) {
            Ok(r) => r,
            Err(e) => {
                return CommandOutput::failure(
                    "Invalid request",
                    vec![crate::error::ErrorDetail::from(&e)],
                    (),
                );
            }
        };

        let response = update_playlist(&playlist_id, req).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(playlist) = response.data else {
            return CommandOutput::failure("No playlist returned", vec![], ());
        };

        let message = format!("Updated playlist: {}", playlist.title);
        CommandOutput::success(message, vec![playlist]).map_data(|_| ())
    } else {
        unreachable!("handle_update_playlist called with wrong action variant")
    }
}

pub async fn handle_remove_thumbnail(action: MusicAction) -> CommandOutput<()> {
    if let MusicAction::RemovePlaylistThumbnail {
        playlist_id,
        cleanup_blob,
    } = action
    {
        let response = remove_playlist_thumbnail(&playlist_id, cleanup_blob, None).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(playlist) = response.data else {
            return CommandOutput::failure("No playlist returned", vec![], ());
        };

        let message = format!(
            "successfully removed thumbnail from playlist: {}",
            playlist.title
        );
        CommandOutput::success(message, vec![playlist]).map_data(|_| ())
    } else {
        unreachable!("handle_remove_thumbnail called with wrong action variant")
    }
}

pub async fn handle_list_playlists(_action: MusicAction) -> CommandOutput<()> {
    let response = list_playlists().await;
    if !response.success {
        return CommandOutput::failure(response.message, response.errors, ());
    }

    let Some(playlists) = response.data else {
        return CommandOutput::failure("No playlists returned", vec![], ());
    };

    let message = format!("Found {} playlists", playlists.len());
    CommandOutput::success(message, playlists).map_data(|_| ())
}

pub async fn handle_list_user_playlists(action: MusicAction) -> CommandOutput<()> {
    if let MusicAction::ListUserPlaylists {
        user_id,
        limit,
        offset,
    } = action
    {
        let response = list_user_playlists(user_id.clone(), Some(limit), Some(offset)).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(result) = response.data else {
            return CommandOutput::failure("No playlists returned", vec![], ());
        };

        let message = format!(
            "found {} playlists for user {}",
            result.total_count, user_id
        );

        CommandOutput::success(message, result).map_data(|_| ())
    } else {
        unreachable!("handle_list_user_playlists called with wrong action variant")
    }
}

pub async fn handle_search_playlists(action: MusicAction) -> CommandOutput<()> {
    if let MusicAction::SearchPlaylists {
        query,
        limit,
        offset,
    } = action
    {
        let response = search_playlists(&query, Some(limit), Some(offset)).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(result) = response.data else {
            return CommandOutput::failure("No playlists returned", vec![], ());
        };

        let message = format!(
            "found {} playlists matching '{}'",
            result.total_count, query
        );

        CommandOutput::success(message, result).map_data(|_| ())
    } else {
        unreachable!("handle_search_playlists called with wrong action variant")
    }
}
