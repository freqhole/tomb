//! Music playlist commands

use super::MusicAction;
use crate::cli::output::CommandOutput;
use crate::cli::utils::resolve_request;
use crate::error::GrimoireResult;
use crate::music::crud::{
    add_songs_to_playlist, create_playlist, delete_playlist, list_playlists, list_user_playlists,
    remove_playlist_thumbnail, search_playlists, update_playlist, update_songs_position,
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
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
    let MusicAction::AddSongsToPlaylist {
        json_input,
        request,
    } = action
    else {
        unreachable!("handle_add_songs called with wrong action variant")
    };

    let req = resolve_request(json_input, request)?;
    add_songs_to_playlist(&req.playlist_id, &req.song_ids).await?;

    match format {
        crate::cli::output::OutputFormat::Default => {
            println!(
                "Added {} songs to playlist {}",
                req.song_ids.len(),
                req.playlist_id
            );
        }
        crate::cli::output::OutputFormat::Json => {
            let output = serde_json::json!({
                "messages": [format!("Added {} songs to playlist {}", req.song_ids.len(), req.playlist_id)],
                "data": {
                    "playlist_id": req.playlist_id,
                    "songs_added": req.song_ids.len()
                }
            });
            println!("{}", serde_json::to_string_pretty(&output).unwrap());
        }
    }

    Ok(())
}

pub async fn handle_update_position(action: MusicAction) -> GrimoireResult<()> {
    if let MusicAction::UpdateSongPosition {
        playlist_id,
        song_ids,
        new_position,
    } = action
    {
        println!("updating song position(s) in playlist...");
        let song_id_list: Vec<&str> = song_ids.iter().map(|s| s.as_str()).collect();
        match update_songs_position(&playlist_id, &song_id_list, new_position as i64).await {
            Ok(()) => {
                println!(
                    "successfully moved {} song(s) to position {} in playlist {}",
                    song_id_list.len(),
                    new_position,
                    playlist_id
                );
            }
            Err(e) => {
                eprintln!("failed to update song position: {}", e);
                return Err(e.into());
            }
        }
        Ok(())
    } else {
        unreachable!("handle_update_position called with wrong action variant")
    }
}

pub async fn handle_delete_playlist(action: MusicAction) -> GrimoireResult<()> {
    if let MusicAction::DeletePlaylist { playlist_id } = action {
        println!("deleting playlist...");
        match delete_playlist(&playlist_id, None).await {
            Ok(()) => {
                println!("successfully deleted playlist {}", playlist_id);
            }
            Err(e) => {
                eprintln!("failed to delete playlist: {}", e);
                return Err(e.into());
            }
        }
        Ok(())
    } else {
        unreachable!("handle_delete_playlist called with wrong action variant")
    }
}

pub async fn handle_update_playlist(
    action: MusicAction,
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
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

    match format {
        crate::cli::output::OutputFormat::Default => {
            println!("Updated playlist: {}", playlist.title);
            if let Some(ref desc) = playlist.description {
                println!("  description: {}", desc);
            }
            println!(
                "  visibility: {}",
                if playlist.is_public == 1 {
                    "public"
                } else {
                    "private"
                }
            );
            if let Some(ref blob_id) = playlist.thumbnail_blob_id {
                println!("  thumbnail: {}", blob_id);
            }
        }
        crate::cli::output::OutputFormat::Json => {
            let output = serde_json::json!({
                "messages": [format!("Updated playlist: {}", playlist.title)],
                "data": playlist
            });
            println!("{}", serde_json::to_string_pretty(&output).unwrap());
        }
    }

    Ok(())
}

pub async fn handle_remove_thumbnail(action: MusicAction) -> GrimoireResult<()> {
    if let MusicAction::RemovePlaylistThumbnail {
        playlist_id,
        cleanup_blob,
    } = action
    {
        println!("removing playlist thumbnail...");
        match remove_playlist_thumbnail(&playlist_id, cleanup_blob, None).await {
            Ok(playlist) => {
                println!(
                    "successfully removed thumbnail from playlist: {}",
                    playlist.title
                );
                if cleanup_blob {
                    println!("  checked for unused media blob cleanup");
                }
            }
            Err(e) => {
                eprintln!("failed to remove playlist thumbnail: {}", e);
                return Err(e.into());
            }
        }
        Ok(())
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

pub async fn handle_list_user_playlists(action: MusicAction) -> GrimoireResult<()> {
    if let MusicAction::ListUserPlaylists {
        user_id,
        limit,
        offset,
    } = action
    {
        println!("listing playlists for user: {}", user_id);
        match list_user_playlists(user_id.clone(), Some(limit), Some(offset)).await {
            Ok(result) => {
                println!(
                    "found {} playlists for user {}",
                    result.total_count, user_id
                );
                for playlist in result.items {
                    println!(
                        "  {} - {} (songs: {})",
                        playlist.playlist.id, playlist.playlist.title, playlist.song_count
                    );
                }
                Ok(())
            }
            Err(e) => {
                eprintln!("failed to list user playlists: {}", e);
                Err(e)
            }
        }
    } else {
        unreachable!("handle_list_user_playlists called with wrong action variant")
    }
}

pub async fn handle_search_playlists(action: MusicAction) -> GrimoireResult<()> {
    if let MusicAction::SearchPlaylists {
        query,
        limit,
        offset,
    } = action
    {
        println!("searching playlists: {}", query);
        match search_playlists(&query, Some(limit), Some(offset)).await {
            Ok(result) => {
                println!(
                    "found {} playlists matching '{}'",
                    result.total_count, query
                );
                for playlist in result.items {
                    println!(
                        "  {} - {} (songs: {})",
                        playlist.playlist.id, playlist.playlist.title, playlist.song_count
                    );
                }
                Ok(())
            }
            Err(e) => {
                eprintln!("failed to search playlists: {}", e);
                Err(e)
            }
        }
    } else {
        unreachable!("handle_search_playlists called with wrong action variant")
    }
}
