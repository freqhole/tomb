//! query favorites with full metadata from views
//! returns typed favorites (song, album, artist, playlist) sorted by favorited_at DESC

use crate::database;
use crate::music::crud::models::{
    FavoriteAlbumResult, FavoriteArtistResult, FavoriteItem, FavoritePlaylistResult,
    FavoriteSongResult,
};
use crate::music::crud::query::{AlbumViewRow, ArtistViewRow, SongViewRow};
use crate::music::crud::query_playlists::PlaylistViewRow;
use crate::response::GrimoireResponse;
use sqlx::{FromRow, Row};

/// query user favorites with full metadata from views
pub async fn query_favorites(
    user_id: &str,
    target_type: Option<&str>,
    limit: u32,
    offset: u32,
) -> GrimoireResponse<Vec<FavoriteItem>> {
    let pool = match database::connect().await {
        Ok(pool) => pool,
        Err(err) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![err.into()])
        }
    };

    // determine which types to query
    let types_to_query = match target_type {
        Some("song") => vec!["song"],
        Some("album") => vec!["album"],
        Some("artist") => vec!["artist"],
        Some("playlist") => vec!["playlist"],
        _ => vec!["song", "album", "artist", "playlist"],
    };

    // query each type and collect all favorites with their timestamps
    let mut all_favorites: Vec<(i64, FavoriteItem)> = Vec::new();

    for target in types_to_query {
        match target {
            "song" => {
                let songs = match query_song_favorites(&pool, user_id).await {
                    Ok(s) => s,
                    Err(e) => {
                        return GrimoireResponse::failure(
                            "Failed to query song favorites",
                            vec![e.into()],
                        )
                    }
                };
                for song in songs {
                    all_favorites.push((song.favorited_at, FavoriteItem::Song(song)));
                }
            }
            "album" => {
                let albums = match query_album_favorites(&pool, user_id).await {
                    Ok(a) => a,
                    Err(e) => {
                        return GrimoireResponse::failure(
                            "Failed to query album favorites",
                            vec![e.into()],
                        )
                    }
                };
                for album in albums {
                    all_favorites.push((album.favorited_at, FavoriteItem::Album(album)));
                }
            }
            "artist" => {
                let artists = match query_artist_favorites(&pool, user_id).await {
                    Ok(a) => a,
                    Err(e) => {
                        return GrimoireResponse::failure(
                            "Failed to query artist favorites",
                            vec![e.into()],
                        )
                    }
                };
                for artist in artists {
                    all_favorites.push((artist.favorited_at, FavoriteItem::Artist(artist)));
                }
            }
            "playlist" => {
                let playlists = match query_playlist_favorites(&pool, user_id).await {
                    Ok(p) => p,
                    Err(e) => {
                        return GrimoireResponse::failure(
                            "Failed to query playlist favorites",
                            vec![e.into()],
                        )
                    }
                };
                for playlist in playlists {
                    all_favorites.push((playlist.favorited_at, FavoriteItem::Playlist(playlist)));
                }
            }
            _ => {}
        }
    }

    // sort by favorited_at DESC (most recent first)
    all_favorites.sort_by_key(|b| std::cmp::Reverse(b.0));

    // apply pagination
    let paginated: Vec<FavoriteItem> = all_favorites
        .into_iter()
        .skip(offset as usize)
        .take(limit as usize)
        .map(|(_, item)| item)
        .collect();

    GrimoireResponse::success(format!("Found {} favorite(s)", paginated.len()), paginated)
}

// query song favorites with full metadata
async fn query_song_favorites(
    pool: &sqlx::SqlitePool,
    user_id: &str,
) -> Result<Vec<FavoriteSongResult>, crate::error::GrimoireError> {
    // use regular query and manually extract the timestamp
    let rows = sqlx::query(
        r#"
        SELECT sv.*, uf.created_at as user_favorited_at
        FROM user_favoritez uf
        INNER JOIN song_query_view sv ON sv.song_id = uf.target_id
        WHERE uf.user_id = ?1 AND uf.target_type = 'song'
        ORDER BY uf.created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let results = rows
        .into_iter()
        .map(|row| {
            let user_favorited_at: i64 = row.try_get("user_favorited_at").unwrap_or(0);
            let song_view = SongViewRow::from_row(&row).unwrap();
            let song_result = song_view.to_song_query_result(Some(user_id));
            FavoriteSongResult {
                favorited_at: user_favorited_at,
                song: song_result,
            }
        })
        .collect();

    Ok(results)
}

// query album favorites with full metadata
async fn query_album_favorites(
    pool: &sqlx::SqlitePool,
    user_id: &str,
) -> Result<Vec<FavoriteAlbumResult>, crate::error::GrimoireError> {
    let rows = sqlx::query(
        r#"
        SELECT av.*, uf.created_at as user_favorited_at
        FROM user_favoritez uf
        INNER JOIN album_query_view av ON av.album_id = uf.target_id
        WHERE uf.user_id = ?1 AND uf.target_type = 'album'
        ORDER BY uf.created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let results = rows
        .into_iter()
        .map(|row| {
            let user_favorited_at: i64 = row.try_get("user_favorited_at").unwrap_or(0);
            let album_view = AlbumViewRow::from_row(&row).unwrap();
            let album_result = album_view.to_album_query_result(Some(user_id));
            FavoriteAlbumResult {
                favorited_at: user_favorited_at,
                album: album_result,
            }
        })
        .collect();

    Ok(results)
}

// query artist favorites with full metadata
async fn query_artist_favorites(
    pool: &sqlx::SqlitePool,
    user_id: &str,
) -> Result<Vec<FavoriteArtistResult>, crate::error::GrimoireError> {
    let rows = sqlx::query(
        r#"
        SELECT av.*, uf.created_at as user_favorited_at
        FROM user_favoritez uf
        INNER JOIN artist_query_view av ON av.artist_id = uf.target_id
        WHERE uf.user_id = ?1 AND uf.target_type = 'artist'
        ORDER BY uf.created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let results = rows
        .into_iter()
        .map(|row| {
            let user_favorited_at: i64 = row.try_get("user_favorited_at").unwrap_or(0);
            let artist_view = ArtistViewRow::from_row(&row).unwrap();
            let artist_result = artist_view.to_artist_query_result(Some(user_id));
            FavoriteArtistResult {
                favorited_at: user_favorited_at,
                artist: artist_result,
            }
        })
        .collect();

    Ok(results)
}

// query playlist favorites with full metadata
async fn query_playlist_favorites(
    pool: &sqlx::SqlitePool,
    user_id: &str,
) -> Result<Vec<FavoritePlaylistResult>, crate::error::GrimoireError> {
    let rows = sqlx::query(
        r#"
        SELECT pv.*, uf.created_at as user_favorited_at
        FROM user_favoritez uf
        INNER JOIN playlist_query_view pv ON pv.playlist_id = uf.target_id
        WHERE uf.user_id = ?1 AND uf.target_type = 'playlist'
        ORDER BY uf.created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let results = rows
        .into_iter()
        .map(|row| {
            let user_favorited_at: i64 = row.try_get("user_favorited_at").unwrap_or(0);
            let playlist_view = PlaylistViewRow::from_row(&row).unwrap();
            let playlist_result = playlist_view.to_playlist_query_result(Some(user_id));
            FavoritePlaylistResult {
                favorited_at: user_favorited_at,
                playlist: playlist_result,
            }
        })
        .collect();

    Ok(results)
}
