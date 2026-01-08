//! Music song commands

use super::MusicAction;

pub async fn handle_recent_songs(action: MusicAction) -> anyhow::Result<()> {
    if let MusicAction::RecentSongs { limit } = action {
        // TODO: Move implementation from cli.rs
        println!("Recent songs: limit={}", limit);
        Ok(())
    } else {
        unreachable!("handle_recent_songs called with wrong action variant")
    }
}

pub async fn handle_update_songs(action: MusicAction) -> anyhow::Result<()> {
    if let MusicAction::UpdateSongs {
        song_ids,
        user_id,
        updated_by,
        title,
        track_number,
        disc_number,
        year,
        bpm,
        key_signature,
        lyrics,
        artist,
        album,
        album_type,
        release_date,
        label,
        genre,
        sub_genre,
        thumbnail_blob_id,
        thumbnail_file,
        add_tags,
        remove_tags,
        replace_tags,
        favorite_song,
        favorite_artist,
        favorite_album,
        rate_song,
        rate_artist,
        rate_album,
    } = action
    {
        // TODO: Move implementation from cli.rs
        println!(
            "Update songs: song_ids={:?}, user_id={}, updated_by={:?}",
            song_ids, user_id, updated_by
        );
        println!(
            "  title={:?}, track_number={:?}, disc_number={:?}, year={:?}",
            title, track_number, disc_number, year
        );
        println!(
            "  bpm={:?}, key_signature={:?}, lyrics={:?}",
            bpm, key_signature, lyrics
        );
        println!(
            "  artist={:?}, album={:?}, album_type={:?}",
            artist, album, album_type
        );
        println!(
            "  release_date={:?}, label={:?}, genre={:?}, sub_genre={:?}",
            release_date, label, genre, sub_genre
        );
        println!(
            "  thumbnail_blob_id={:?}, thumbnail_file={:?}",
            thumbnail_blob_id, thumbnail_file
        );
        println!(
            "  add_tags={:?}, remove_tags={:?}, replace_tags={:?}",
            add_tags, remove_tags, replace_tags
        );
        println!(
            "  favorite_song={}, favorite_artist={}, favorite_album={}",
            favorite_song, favorite_artist, favorite_album
        );
        println!(
            "  rate_song={:?}, rate_artist={:?}, rate_album={:?}",
            rate_song, rate_artist, rate_album
        );
        Ok(())
    } else {
        unreachable!("handle_update_songs called with wrong action variant")
    }
}
