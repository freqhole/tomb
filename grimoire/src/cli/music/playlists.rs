//! Music playlist commands

use super::MusicAction;
use crate::error::GrimoireResult;
use crate::music::crud::{
    add_songs_to_playlist, create_playlist, create_thumbnail_from_file, delete_playlist,
    remove_playlist_thumbnail, update_playlist, update_songs_position, CreatePlaylistRequest,
    UpdatePlaylistRequest,
};

pub async fn handle_create_playlist(action: MusicAction) -> GrimoireResult<()> {
    if let MusicAction::CreatePlaylist {
        title,
        description,
        public,
    } = action
    {
        println!("creating playlist...");
        let req = CreatePlaylistRequest {
            title: title.clone(),
            description,
            is_public: Some(public),
            created_by_id: None, // TODO: add user management
        };

        match create_playlist(req).await {
            Ok(playlist) => {
                println!("created playlist: {} (ID: {})", playlist.title, playlist.id);
                if playlist.is_public == 1 {
                    println!("  visibility: public");
                } else {
                    println!("  visibility: private");
                }
                if let Some(desc) = &playlist.description {
                    println!("  description: {}", desc);
                }
            }
            Err(e) => {
                eprintln!("failed to create playlist: {}", e);
            }
        }
        Ok(())
    } else {
        unreachable!("handle_create_playlist called with wrong action variant")
    }
}

pub async fn handle_add_songs(action: MusicAction) -> GrimoireResult<()> {
    if let MusicAction::AddSongsToPlaylist {
        playlist_id,
        song_ids,
    } = action
    {
        println!("adding songs to playlist...");
        let song_id_list: Vec<String> = song_ids
            .iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        if song_id_list.is_empty() {
            eprintln!("no valid song IDs provided");
            return Ok(());
        }

        match add_songs_to_playlist(&playlist_id, &song_id_list).await {
            Ok(()) => {
                println!(
                    "successfully added {} songs to playlist {}",
                    song_id_list.len(),
                    playlist_id
                );
                println!("song IDs: {:?}", song_id_list);
            }
            Err(e) => {
                eprintln!("failed to add songs to playlist: {}", e);
            }
        }
        Ok(())
    } else {
        unreachable!("handle_add_songs called with wrong action variant")
    }
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
        match update_songs_position(&playlist_id, &song_id_list, new_position).await {
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

pub async fn handle_update_playlist(action: MusicAction) -> GrimoireResult<()> {
    if let MusicAction::UpdatePlaylist {
        playlist_id,
        title,
        description,
        public,
        private,
        thumbnail_path,
        thumbnail_blob_id,
    } = action
    {
        println!("updating playlist metadata...");

        // Handle public/private flags
        let is_public = if public && private {
            eprintln!("error: cannot specify both --public and --private flags");
            return Ok(());
        } else if public {
            Some(true)
        } else if private {
            Some(false)
        } else {
            None
        };

        // Handle thumbnail options (mutually exclusive)
        let final_thumbnail_blob_id = if thumbnail_path.is_some() && thumbnail_blob_id.is_some() {
            eprintln!("error: cannot specify both --thumbnail-path and --thumbnail-blob-id");
            return Ok(());
        } else if let Some(path) = thumbnail_path {
            println!("creating thumbnail from file: {}", path);
            match create_thumbnail_from_file(&path, None).await {
                Ok(blob_id) => {
                    println!("  created thumbnail blob: {}", blob_id);
                    Some(blob_id)
                }
                Err(e) => {
                    eprintln!("failed to create thumbnail from file: {}", e);
                    return Err(e.into());
                }
            }
        } else if let Some(blob_id) = thumbnail_blob_id {
            println!("using existing thumbnail blob: {}", blob_id);
            Some(blob_id)
        } else {
            None
        };

        let req = UpdatePlaylistRequest {
            title: title.clone(),
            description: description.clone(),
            is_public,
            thumbnail_blob_id: final_thumbnail_blob_id,
            updated_by: None, // TODO: add user management
        };

        match update_playlist(&playlist_id, req).await {
            Ok(playlist) => {
                println!("successfully updated playlist: {}", playlist.title);
                if let Some(new_title) = &title {
                    println!("  title: {}", new_title);
                }
                if let Some(new_desc) = &description {
                    println!("  description: {}", new_desc);
                }
                if let Some(public) = is_public {
                    println!(
                        "  visibility: {}",
                        if public { "public" } else { "private" }
                    );
                }
                if let Some(blob_id) = &playlist.thumbnail_blob_id {
                    println!("  thumbnail blob: {}", blob_id);
                }
            }
            Err(e) => {
                eprintln!("failed to update playlist: {}", e);
                return Err(e.into());
            }
        }
        Ok(())
    } else {
        unreachable!("handle_update_playlist called with wrong action variant")
    }
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
