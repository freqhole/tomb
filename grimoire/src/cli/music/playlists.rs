//! Music playlist commands

use super::MusicAction;
use crate::cli::output::CommandOutput;
use crate::cli::utils::resolve_request;
use crate::error::GrimoireResult;
use crate::music::crud::{
    add_songs_to_playlist, create_playlist, delete_playlist, list_playlists, list_user_playlists,
    remove_playlist_thumbnail, search_playlists, update_playlist, update_songs_position,
    PlaylistQueryResult, QueryResult,
};
use crate::music::Playlist;

pub async fn handle_create_playlist(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<Vec<Playlist>>> {
    let MusicAction::CreatePlaylist {
        json_input,
        request,
    } = action
    else {
        unreachable!("handle_create_playlist called with wrong action variant")
    };

    let req = resolve_request(json_input, request)?;
    let playlist = create_playlist(req).await?;

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

    Ok(CommandOutput::new(message, vec![playlist]))
}

pub async fn handle_add_songs(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<Vec<serde_json::Value>>> {
    let MusicAction::AddSongsToPlaylist {
        json_input,
        request,
    } = action
    else {
        unreachable!("handle_add_songs called with wrong action variant")
    };

    let req = resolve_request(json_input, request)?;
    add_songs_to_playlist(&req.playlist_id, &req.song_ids).await?;

    let message = format!(
        "Added {} songs to playlist {}",
        req.song_ids.len(),
        req.playlist_id
    );
    let data = vec![serde_json::json!({
        "playlist_id": req.playlist_id,
        "songs_added": req.song_ids.len()
    })];

    Ok(CommandOutput::new(message, data))
}

pub async fn handle_update_position(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<Vec<serde_json::Value>>> {
    if let MusicAction::UpdateSongPosition {
        playlist_id,
        song_ids,
        new_position,
    } = action
    {
        let song_id_list: Vec<&str> = song_ids.iter().map(|s| s.as_str()).collect();
        update_songs_position(&playlist_id, &song_id_list, new_position as i64).await?;

        let message = format!(
            "successfully moved {} song(s) to position {} in playlist {}",
            song_id_list.len(),
            new_position,
            playlist_id
        );
        let data = vec![serde_json::json!({
            "playlist_id": playlist_id,
            "songs_moved": song_id_list.len(),
            "new_position": new_position
        })];

        Ok(CommandOutput::new(message, data))
    } else {
        unreachable!("handle_update_position called with wrong action variant")
    }
}

pub async fn handle_delete_playlist(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<Vec<serde_json::Value>>> {
    if let MusicAction::DeletePlaylist { playlist_id } = action {
        delete_playlist(&playlist_id, None).await?;

        let message = format!("successfully deleted playlist {}", playlist_id);
        let data = vec![serde_json::json!({ "playlist_id": playlist_id })];
        Ok(CommandOutput::new(message, data))
    } else {
        unreachable!("handle_delete_playlist called with wrong action variant")
    }
}

pub async fn handle_update_playlist(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<Vec<Playlist>>> {
    let MusicAction::UpdatePlaylist {
        playlist_id,
        json_input,
        request,
    } = action
    else {
        unreachable!("handle_update_playlist called with wrong action variant")
    };

    let req = resolve_request(json_input, request)?;
    let playlist = update_playlist(&playlist_id, req).await?;

    let message = format!("Updated playlist: {}", playlist.title);
    Ok(CommandOutput::new(message, vec![playlist]))
}

pub async fn handle_remove_thumbnail(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<Vec<Playlist>>> {
    if let MusicAction::RemovePlaylistThumbnail {
        playlist_id,
        cleanup_blob,
    } = action
    {
        let playlist = remove_playlist_thumbnail(&playlist_id, cleanup_blob, None).await?;

        let message = format!(
            "successfully removed thumbnail from playlist: {}",
            playlist.title
        );
        Ok(CommandOutput::new(message, vec![playlist]))
    } else {
        unreachable!("handle_remove_thumbnail called with wrong action variant")
    }
}

pub async fn handle_list_playlists(
    _action: MusicAction,
) -> GrimoireResult<CommandOutput<Vec<Playlist>>> {
    match list_playlists().await {
        Ok(playlists) => {
            let message = format!("Found {} playlists", playlists.len());
            Ok(CommandOutput::new(message, playlists))
        }
        Err(e) => Err(e),
    }
}

pub async fn handle_list_user_playlists(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<QueryResult<PlaylistQueryResult>>> {
    if let MusicAction::ListUserPlaylists {
        user_id,
        limit,
        offset,
    } = action
    {
        let result = list_user_playlists(user_id.clone(), Some(limit), Some(offset)).await?;

        let message = format!(
            "found {} playlists for user {}",
            result.total_count, user_id
        );

        Ok(CommandOutput::new(message, result))
    } else {
        unreachable!("handle_list_user_playlists called with wrong action variant")
    }
}

pub async fn handle_search_playlists(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<QueryResult<PlaylistQueryResult>>> {
    if let MusicAction::SearchPlaylists {
        query,
        limit,
        offset,
    } = action
    {
        let result = search_playlists(&query, Some(limit), Some(offset)).await?;

        let message = format!(
            "found {} playlists matching '{}'",
            result.total_count, query
        );

        Ok(CommandOutput::new(message, result))
    } else {
        unreachable!("handle_search_playlists called with wrong action variant")
    }
}
