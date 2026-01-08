//! Music query commands

use super::MusicAction;

pub async fn handle_query_songs(action: MusicAction) -> antml::Result<()> {
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
        // TODO: Move implementation from cli.rs
        println!(
            "Query songs: search={:?}, sort_by={:?}, sort_direction={:?}, limit={}, offset={}, user_id={:?}, favorites_only={}, min_rating={:?}",
            search, sort_by, sort_direction, limit, offset, user_id, favorites_only, min_rating
        );
        Ok(())
    } else {
        unreachable!("handle_query_songs called with wrong action variant")
    }
}

pub async fn handle_query_artists(action: MusicAction) -> antml::Result<()> {
    if let MusicAction::QueryArtists {
        search,
        starts_with,
        sort_by,
        sort_direction,
        limit,
        offset,
    } = action
    {
        // TODO: Move implementation from cli.rs
        println!(
            "Query artists: search={:?}, starts_with={:?}, sort_by={:?}, sort_direction={:?}, limit={}, offset={}",
            search, starts_with, sort_by, sort_direction, limit, offset
        );
        Ok(())
    } else {
        unreachable!("handle_query_artists called with wrong action variant")
    }
}

pub async fn handle_query_albums(action: MusicAction) -> antml::Result<()> {
    if let MusicAction::QueryAlbums {
        search,
        sort_by,
        sort_direction,
        limit,
        offset,
    } = action
    {
        // TODO: Move implementation from cli.rs
        println!(
            "Query albums: search={:?}, sort_by={:?}, sort_direction={:?}, limit={}, offset={}",
            search, sort_by, sort_direction, limit, offset
        );
        Ok(())
    } else {
        unreachable!("handle_query_albums called with wrong action variant")
    }
}

pub async fn handle_query_genres(action: MusicAction) -> antml::Result<()> {
    if let MusicAction::QueryGenres {
        search,
        sort_by,
        sort_direction,
        limit,
        offset,
    } = action
    {
        // TODO: Move implementation from cli.rs
        println!(
            "Query genres: search={:?}, sort_by={:?}, sort_direction={:?}, limit={}, offset={}",
            search, sort_by, sort_direction, limit, offset
        );
        Ok(())
    } else {
        unreachable!("handle_query_genres called with wrong action variant")
    }
}

pub async fn handle_query_playlists(action: MusicAction) -> antml::Result<()> {
    if let MusicAction::QueryPlaylists {
        search,
        sort_by,
        sort_direction,
        is_public,
        limit,
        offset,
    } = action
    {
        // TODO: Move implementation from cli.rs
        println!(
            "Query playlists: search={:?}, sort_by={:?}, sort_direction={:?}, is_public={:?}, limit={}, offset={}",
            search, sort_by, sort_direction, is_public, limit, offset
        );
        Ok(())
    } else {
        unreachable!("handle_query_playlists called with wrong action variant")
    }
}

pub async fn handle_query_playlist_songs(action: MusicAction) -> antml::Result<()> {
    if let MusicAction::QueryPlaylistSongs {
        playlist_id,
        search,
        sort_by,
        sort_direction,
        limit,
        offset,
    } = action
    {
        // TODO: Move implementation from cli.rs
        println!(
            "Query playlist songs: playlist_id={}, search={:?}, sort_by={:?}, sort_direction={:?}, limit={}, offset={}",
            playlist_id, search, sort_by, sort_direction, limit, offset
        );
        Ok(())
    } else {
        unreachable!("handle_query_playlist_songs called with wrong action variant")
    }
}
