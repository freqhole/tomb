//! Music playlist commands

use super::MusicAction;

pub async fn handle_create_playlist(action: MusicAction) -> anyhow::Result<()> {
    if let MusicAction::CreatePlaylist {
        title,
        description,
        public,
    } = action
    {
        // TODO: Move implementation from cli.rs
        println!(
            "Create playlist: title={}, description={:?}, public={}",
            title, description, public
        );
        Ok(())
    } else {
        unreachable!("handle_create_playlist called with wrong action variant")
    }
}

pub async fn handle_add_songs(action: MusicAction) -> anyhow::Result<()> {
    if let MusicAction::AddSongsToPlaylist {
        playlist_id,
        song_ids,
    } = action
    {
        // TODO: Move implementation from cli.rs
        println!(
            "Add songs to playlist: playlist_id={}, song_ids={:?}",
            playlist_id, song_ids
        );
        Ok(())
    } else {
        unreachable!("handle_add_songs called with wrong action variant")
    }
}

pub async fn handle_update_position(action: MusicAction) -> anyhow::Result<()> {
    if let MusicAction::UpdateSongPosition {
        playlist_id,
        song_ids,
        new_position,
    } = action
    {
        // TODO: Move implementation from cli.rs
        println!(
            "Update song position: playlist_id={}, song_ids={:?}, new_position={}",
            playlist_id, song_ids, new_position
        );
        Ok(())
    } else {
        unreachable!("handle_update_position called with wrong action variant")
    }
}

pub async fn handle_delete_playlist(action: MusicAction) -> anyhow::Result<()> {
    if let MusicAction::DeletePlaylist { playlist_id } = action {
        // TODO: Move implementation from cli.rs
        println!("Delete playlist: playlist_id={}", playlist_id);
        Ok(())
    } else {
        unreachable!("handle_delete_playlist called with wrong action variant")
    }
}

pub async fn handle_update_playlist(action: MusicAction) -> anyhow::Result<()> {
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
        // TODO: Move implementation from cli.rs
        println!(
            "Update playlist: playlist_id={}, title={:?}, description={:?}, public={}, private={}, thumbnail_path={:?}, thumbnail_blob_id={:?}",
            playlist_id, title, description, public, private, thumbnail_path, thumbnail_blob_id
        );
        Ok(())
    } else {
        unreachable!("handle_update_playlist called with wrong action variant")
    }
}

pub async fn handle_remove_thumbnail(action: MusicAction) -> anyhow::Result<()> {
    if let MusicAction::RemovePlaylistThumbnail {
        playlist_id,
        cleanup_blob,
    } = action
    {
        // TODO: Move implementation from cli.rs
        println!(
            "Remove playlist thumbnail: playlist_id={}, cleanup_blob={}",
            playlist_id, cleanup_blob
        );
        Ok(())
    } else {
        unreachable!("handle_remove_thumbnail called with wrong action variant")
    }
}
