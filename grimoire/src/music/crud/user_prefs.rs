//! user preferences enrichment for query results
//!
//! applies user-specific favorites and ratings to entity query results.
//! called at the end of query functions when user_id is provided.

use crate::music::users::favorites::FavoritesService;
use crate::music::users::models::{FavoriteTarget, RatingTarget};
use crate::music::users::ratings::RatingsService;

use super::models::{
    AlbumQueryResult, ArtistQueryResult, PlaylistQueryResult, PlaylistSongResult, SongQueryResult,
};

/// apply user favorites and ratings to artist results
pub async fn apply_user_preferences_artists(items: &mut [ArtistQueryResult], user_id: &str) {
    if items.is_empty() {
        return;
    }

    let ids: Vec<_> = items
        .iter()
        .map(|a| (FavoriteTarget::Artist, a.artist.id.clone()))
        .collect();

    let rating_ids: Vec<_> = items
        .iter()
        .map(|a| (RatingTarget::Artist, a.artist.id.clone()))
        .collect();

    // fetch favorites
    let favorites = FavoritesService::new()
        .get_favorite_status_bulk(user_id, ids)
        .await;

    if let Some(favs) = favorites.data {
        let fav_set: std::collections::HashSet<String> = favs
            .into_iter()
            .filter(|(_, _, is_fav)| *is_fav)
            .map(|(_, id, _)| id)
            .collect();

        for item in items.iter_mut() {
            item.is_favorite = Some(fav_set.contains(&item.artist.id));
        }
    }

    // fetch ratings
    let ratings = RatingsService::new()
        .get_ratings_bulk(user_id, rating_ids)
        .await;

    if let Ok(ratings_list) = ratings {
        let rating_map: std::collections::HashMap<String, i32> = ratings_list
            .into_iter()
            .filter_map(|(_, id, rating)| rating.map(|r| (id, r)))
            .collect();

        for item in items.iter_mut() {
            item.rating = rating_map.get(&item.artist.id).copied();
        }
    }
}

/// apply user favorites and ratings to album results
pub async fn apply_user_preferences_albums(items: &mut [AlbumQueryResult], user_id: &str) {
    if items.is_empty() {
        return;
    }

    let ids: Vec<_> = items
        .iter()
        .map(|a| (FavoriteTarget::Album, a.album.id.clone()))
        .collect();

    let rating_ids: Vec<_> = items
        .iter()
        .map(|a| (RatingTarget::Album, a.album.id.clone()))
        .collect();

    // fetch favorites
    let favorites = FavoritesService::new()
        .get_favorite_status_bulk(user_id, ids)
        .await;

    if let Some(favs) = favorites.data {
        let fav_set: std::collections::HashSet<String> = favs
            .into_iter()
            .filter(|(_, _, is_fav)| *is_fav)
            .map(|(_, id, _)| id)
            .collect();

        for item in items.iter_mut() {
            item.is_favorite = Some(fav_set.contains(&item.album.id));
        }
    }

    // fetch ratings
    let ratings = RatingsService::new()
        .get_ratings_bulk(user_id, rating_ids)
        .await;

    if let Ok(ratings_list) = ratings {
        let rating_map: std::collections::HashMap<String, i32> = ratings_list
            .into_iter()
            .filter_map(|(_, id, rating)| rating.map(|r| (id, r)))
            .collect();

        for item in items.iter_mut() {
            item.rating = rating_map.get(&item.album.id).copied();
        }
    }
}

/// apply user favorites and ratings to song results
pub async fn apply_user_preferences_songs(items: &mut [SongQueryResult], user_id: &str) {
    if items.is_empty() {
        return;
    }

    // collect song ids for favorites and ratings
    let song_ids: Vec<_> = items
        .iter()
        .map(|s| (FavoriteTarget::Song, s.song.id.clone()))
        .collect();

    let song_rating_ids: Vec<_> = items
        .iter()
        .map(|s| (RatingTarget::Song, s.song.id.clone()))
        .collect();

    // collect album ids for album favorites/ratings (songs include album context)
    let album_ids: Vec<_> = items
        .iter()
        .filter_map(|s| {
            s.album
                .as_ref()
                .map(|a| (FavoriteTarget::Album, a.id.clone()))
        })
        .collect();

    let album_rating_ids: Vec<_> = items
        .iter()
        .filter_map(|s| {
            s.album
                .as_ref()
                .map(|a| (RatingTarget::Album, a.id.clone()))
        })
        .collect();

    // fetch song favorites
    let favorites = FavoritesService::new()
        .get_favorite_status_bulk(user_id, song_ids)
        .await;

    let song_fav_set: std::collections::HashSet<String> = favorites
        .data
        .map(|favs| {
            favs.into_iter()
                .filter(|(_, _, is_fav)| *is_fav)
                .map(|(_, id, _)| id)
                .collect()
        })
        .unwrap_or_default();

    // fetch album favorites
    let album_favorites = FavoritesService::new()
        .get_favorite_status_bulk(user_id, album_ids)
        .await;

    let album_fav_set: std::collections::HashSet<String> = album_favorites
        .data
        .map(|favs| {
            favs.into_iter()
                .filter(|(_, _, is_fav)| *is_fav)
                .map(|(_, id, _)| id)
                .collect()
        })
        .unwrap_or_default();

    // fetch song ratings
    let song_ratings = RatingsService::new()
        .get_ratings_bulk(user_id, song_rating_ids)
        .await;

    let song_rating_map: std::collections::HashMap<String, i32> = song_ratings
        .map(|ratings| {
            ratings
                .into_iter()
                .filter_map(|(_, id, rating)| rating.map(|r| (id, r)))
                .collect()
        })
        .unwrap_or_default();

    // fetch album ratings
    let album_ratings = RatingsService::new()
        .get_ratings_bulk(user_id, album_rating_ids)
        .await;

    let album_rating_map: std::collections::HashMap<String, i32> = album_ratings
        .map(|ratings| {
            ratings
                .into_iter()
                .filter_map(|(_, id, rating)| rating.map(|r| (id, r)))
                .collect()
        })
        .unwrap_or_default();

    // apply to items
    for item in items.iter_mut() {
        item.is_favorite = Some(song_fav_set.contains(&item.song.id));
        item.rating = song_rating_map.get(&item.song.id).copied();

        if let Some(ref album) = item.album {
            item.album_is_favorite = Some(album_fav_set.contains(&album.id));
            item.album_rating = album_rating_map.get(&album.id).copied();
        }
    }
}

/// apply user favorites to playlist results (playlists don't have ratings)
pub async fn apply_user_preferences_playlists(items: &mut [PlaylistQueryResult], user_id: &str) {
    if items.is_empty() {
        return;
    }

    let ids: Vec<_> = items
        .iter()
        .map(|p| (FavoriteTarget::Playlist, p.playlist.id.clone()))
        .collect();

    let favorites = FavoritesService::new()
        .get_favorite_status_bulk(user_id, ids)
        .await;

    if let Some(favs) = favorites.data {
        let fav_set: std::collections::HashSet<String> = favs
            .into_iter()
            .filter(|(_, _, is_fav)| *is_fav)
            .map(|(_, id, _)| id)
            .collect();

        for item in items.iter_mut() {
            item.is_favorite = Some(fav_set.contains(&item.playlist.id));
        }
    }
}

/// apply user preferences to playlist song results (delegates to song enrichment)
pub async fn apply_user_preferences_playlist_songs(
    items: &mut [PlaylistSongResult],
    user_id: &str,
) {
    if items.is_empty() {
        return;
    }

    // extract the inner SongQueryResults, enrich them, then put back
    let mut songs: Vec<SongQueryResult> = items.iter().map(|p| p.details.clone()).collect();
    apply_user_preferences_songs(&mut songs, user_id).await;

    for (item, enriched_song) in items.iter_mut().zip(songs) {
        item.details = enriched_song;
    }
}
