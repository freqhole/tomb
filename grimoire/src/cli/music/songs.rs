//! Music song commands

use super::MusicAction;
use crate::error::GrimoireResult;
use crate::music::crud::{
    list_recent_songs, update_songs, FavoriteTargetType, RatingTargetType, SetFavoriteRequest,
    SetRatingRequest, UpdateAlbumRequest, UpdateArtistRequest, UpdateSongsRequest,
};

pub async fn handle_recent_songs(action: MusicAction) -> GrimoireResult<()> {
    if let MusicAction::RecentSongs { limit } = action {
        println!("listing recent songs...");
        match list_recent_songs(Some(limit as u32)).await {
            Ok(result) => {
                println!("found {} recent songs", result.items.len());
                for song in result.items {
                    println!(
                        "  {} - {} ({})",
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
                Ok(())
            }
            Err(e) => {
                eprintln!("failed to list recent songs: {}", e);
                Err(e.into())
            }
        }
    } else {
        unreachable!("handle_recent_songs called with wrong action variant")
    }
}

pub async fn handle_update_songs(action: MusicAction) -> GrimoireResult<()> {
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
        let song_id_vec: Vec<String> = song_ids;

        println!("updating {} song(s)...", song_id_vec.len());

        let req = UpdateSongsRequest {
            song_ids: song_id_vec,
            updated_by,
            title,
            track_number: track_number.map(|n| n as i64),
            disc_number: disc_number.map(|n| n as i64),
            duration: None,
            year: year.map(|n| n as i64),
            bpm: bpm.map(|n| n as i64),
            key_signature,
            lyrics,
            metadata: None,
            artist: artist.map(|name| UpdateArtistRequest { name }),
            album: album.map(|title| UpdateAlbumRequest {
                title,
                album_type,
                release_date,
                release_date_precision: None,
                label,
                year: None,
            }),
            genre,
            sub_genre,
            thumbnail_blob_id,
            thumbnail_from_file: thumbnail_file,
            thumbnail_from_bytes: None,
            add_tags: if add_tags.is_empty() {
                None
            } else {
                Some(add_tags.clone())
            },
            remove_tags: if remove_tags.is_empty() {
                None
            } else {
                Some(remove_tags.clone())
            },
            replace_tags: if replace_tags.is_empty() {
                None
            } else {
                Some(replace_tags.clone())
            },
            user_id: Some(user_id.clone()),
            set_favorite: if favorite_song {
                Some(SetFavoriteRequest {
                    target_type: FavoriteTargetType::Song,
                    is_favorite: favorite_song,
                })
            } else if favorite_artist {
                Some(SetFavoriteRequest {
                    target_type: FavoriteTargetType::Artist,
                    is_favorite: favorite_artist,
                })
            } else if favorite_album {
                Some(SetFavoriteRequest {
                    target_type: FavoriteTargetType::Album,
                    is_favorite: favorite_album,
                })
            } else {
                None
            },
            set_rating: if let Some(rating) = rate_song {
                Some(SetRatingRequest {
                    target_type: RatingTargetType::Song,
                    rating,
                })
            } else if let Some(rating) = rate_artist {
                Some(SetRatingRequest {
                    target_type: RatingTargetType::Artist,
                    rating,
                })
            } else if let Some(rating) = rate_album {
                Some(SetRatingRequest {
                    target_type: RatingTargetType::Album,
                    rating,
                })
            } else {
                None
            },
        };

        match update_songs(req).await {
            Ok(result) => {
                println!("successfully updated {} song(s)", result.songs_updated);
                if let Some(artist) = result.artist {
                    println!("  artist: {}", artist.name);
                }
                if let Some(album) = result.album {
                    println!("  album: {}", album.title);
                }
                if let Some(genre) = result.genre {
                    println!("  genre: {}", genre.name);
                }
                if let Some(sub_genre) = result.sub_genre {
                    println!("  sub-genre: {}", sub_genre.name);
                }
                if let Some(thumbnail_id) = result.thumbnail_blob_id {
                    println!("  thumbnail: {}", thumbnail_id);
                }
                if result.tags_modified {
                    println!("  tags modified");
                }
                if !result.songs_failed.is_empty() {
                    println!("failed to update {} song(s):", result.songs_failed.len());
                    for (song_id, error) in result.songs_failed {
                        println!("  {}: {}", song_id, error);
                    }
                }
                Ok(())
            }
            Err(e) => {
                eprintln!("failed to update songs: {}", e);
                Err(e.into())
            }
        }
    } else {
        unreachable!("handle_update_songs called with wrong action variant")
    }
}
