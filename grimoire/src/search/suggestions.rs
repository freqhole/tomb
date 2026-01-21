//! autocomplete suggestion functions for FTS search

use crate::error::GrimoireResult;
use crate::search::helpers::{
    apply_user_preference_multiplier, calculate_confidence, generate_highlight,
};
use crate::search::models::{Suggestion, SuggestionType};
use sqlx::SqlitePool;

/// get song suggestions from FTS with user preferences
pub async fn get_song_suggestions(
    pool: &SqlitePool,
    partial: &str,
    user_id: Option<&str>,
) -> GrimoireResult<Vec<Suggestion>> {
    // query songz_fts with prefix match: `title:partial* OR artist_name:partial*`
    // join to songz for full details and user preferences
    // calculate confidence based on which field matched

    #[derive(sqlx::FromRow)]
    struct SongSuggestionRow {
        song_id: String,
        song_title: String,
        thumbnail_blob_id: Option<String>,
        album_id: Option<String>,
        fts_rank: f64,
        user_rating: Option<i64>,
        is_favorite: i64,
    }

    let match_query = format!("{}*", partial);
    let user_id_param = user_id.unwrap_or("");

    let rows = sqlx::query_as!(
        SongSuggestionRow,
        r#"
        SELECT
            song.id as "song_id!: String",
            song.title as "song_title!: String",
            song.thumbnail_blob_id as "thumbnail_blob_id: String",
            (SELECT album_id FROM album_songz WHERE song_id = song.id LIMIT 1) as "album_id: String",
            fts.rank as "fts_rank!: f64",
            rating.rating as "user_rating: i64",
            CASE WHEN favorite.id IS NOT NULL THEN 1 ELSE 0 END as "is_favorite!: i64"
        FROM songz_fts fts
        JOIN songz song ON fts.song_id = song.id
        LEFT JOIN user_ratingz rating
            ON rating.target_id = song.id
            AND rating.target_type = 'song'
            AND rating.user_id = ?
        LEFT JOIN user_favoritez favorite
            ON favorite.target_id = song.id
            AND favorite.target_type = 'song'
            AND favorite.user_id = ?
        WHERE songz_fts MATCH ?
            AND song.deleted_at IS NULL
            AND (rating.rating IS NULL OR rating.rating != 0)
        ORDER BY fts.rank DESC
        LIMIT 10
        "#,
        user_id_param,
        user_id_param,
        match_query
    )
    .fetch_all(pool)
    .await?;

    let suggestions = rows
        .into_iter()
        .map(|row| {
            let base_confidence =
                calculate_confidence(partial, &row.song_title, row.fts_rank as f32);
            let confidence = apply_user_preference_multiplier(
                base_confidence,
                row.user_rating.map(|r| r as i32),
                row.is_favorite != 0,
            );
            let highlight = generate_highlight(&row.song_title, partial);

            Suggestion {
                value: row.song_title.clone(),
                display: row.song_title.clone(),
                highlight,
                count: 1, // individual song
                suggestion_type: SuggestionType::Song,
                confidence,
                metadata: Some(serde_json::json!({
                    "match_type": "title",
                    "thumbnail_blob_id": row.thumbnail_blob_id,
                    "album_id": row.album_id
                })),
                entity_id: row.song_id,
            }
        })
        .collect();

    Ok(suggestions)
}

/// get artist suggestions from FTS with user preferences
pub async fn get_artist_suggestions(
    pool: &SqlitePool,
    partial: &str,
    user_id: Option<&str>,
) -> GrimoireResult<Vec<Suggestion>> {
    // query artistz_fts with prefix match: `name:partial*`
    // join to artistz for full details and user preferences
    // count associated songs for each artist

    #[derive(sqlx::FromRow)]
    struct ArtistSuggestionRow {
        artist_id: String,
        artist_name: String,
        thumbnail_blob_id: Option<String>,
        fts_rank: f64,
        song_count: i64,
        user_rating: Option<i64>,
        is_favorite: i64,
    }

    let match_query = format!("{}*", partial);
    let user_id_param = user_id.unwrap_or("");

    let rows = sqlx::query_as!(
        ArtistSuggestionRow,
        r#"
        SELECT
            artist.id as "artist_id!: String",
            artist.name as "artist_name!: String",
            (SELECT media_blob_id FROM artist_imagez WHERE artist_id = artist.id AND is_primary = 1 LIMIT 1) as "thumbnail_blob_id: String",
            fts.rank as "fts_rank!: f64",
            COUNT(DISTINCT artist_song.song_id) as "song_count!: i64",
            rating.rating as "user_rating: i64",
            CASE WHEN favorite.id IS NOT NULL THEN 1 ELSE 0 END as "is_favorite!: i64"
        FROM artistz_fts fts
        JOIN artistz artist ON fts.artist_id = artist.id
        LEFT JOIN artist_songz artist_song ON artist_song.artist_id = artist.id
        LEFT JOIN user_ratingz rating
            ON rating.target_id = artist.id
            AND rating.target_type = 'artist'
            AND rating.user_id = ?
        LEFT JOIN user_favoritez favorite
            ON favorite.target_id = artist.id
            AND favorite.target_type = 'artist'
            AND favorite.user_id = ?
        WHERE artistz_fts MATCH ?
            AND artist.deleted_at IS NULL
            AND (rating.rating IS NULL OR rating.rating != 0)
        GROUP BY artist.id, artist.name, fts.rank, rating.rating, favorite.id
        ORDER BY fts.rank DESC
        LIMIT 10
        "#,
        user_id_param,
        user_id_param,
        match_query
    )
    .fetch_all(pool)
    .await?;

    let suggestions = rows
        .into_iter()
        .map(|row| {
            let base_confidence =
                calculate_confidence(partial, &row.artist_name, row.fts_rank as f32);
            let confidence = apply_user_preference_multiplier(
                base_confidence,
                row.user_rating.map(|r| r as i32),
                row.is_favorite != 0,
            );
            let highlight = generate_highlight(&row.artist_name, partial);

            Suggestion {
                value: row.artist_name.clone(),
                display: row.artist_name.clone(),
                highlight,
                count: row.song_count,
                suggestion_type: SuggestionType::Artist,
                confidence,
                metadata: Some(serde_json::json!({
                    "match_type": "name",
                    "thumbnail_blob_id": row.thumbnail_blob_id
                })),
                entity_id: row.artist_id,
            }
        })
        .collect();

    Ok(suggestions)
}

/// get album suggestions from FTS with user preferences
pub async fn get_album_suggestions(
    pool: &SqlitePool,
    partial: &str,
    user_id: Option<&str>,
) -> GrimoireResult<Vec<Suggestion>> {
    // query albumz_fts with prefix match: `title:partial* OR artist_name:partial*`
    // join to albumz for full details and user preferences
    // count associated songs

    #[derive(sqlx::FromRow)]
    struct AlbumSuggestionRow {
        album_id: String,
        album_title: String,
        thumbnail_blob_id: Option<String>,
        fts_rank: f64,
        song_count: i64,
        user_rating: Option<i64>,
        is_favorite: i64,
    }

    let match_query = format!("{}*", partial);
    let user_id_param = user_id.unwrap_or("");

    let rows = sqlx::query_as!(
        AlbumSuggestionRow,
        r#"
        SELECT
            album.id as "album_id!: String",
            album.title as "album_title!: String",
            (SELECT media_blob_id FROM album_imagez WHERE album_id = album.id AND is_primary = 1 LIMIT 1) as "thumbnail_blob_id: String",
            fts.rank as "fts_rank!: f64",
            COUNT(DISTINCT album_song.song_id) as "song_count!: i64",
            rating.rating as "user_rating: i64",
            CASE WHEN favorite.id IS NOT NULL THEN 1 ELSE 0 END as "is_favorite!: i64"
        FROM albumz_fts fts
        JOIN albumz album ON fts.album_id = album.id
        LEFT JOIN album_songz album_song ON album_song.album_id = album.id
        LEFT JOIN user_ratingz rating
            ON rating.target_id = album.id
            AND rating.target_type = 'album'
            AND rating.user_id = ?
        LEFT JOIN user_favoritez favorite
            ON favorite.target_id = album.id
            AND favorite.target_type = 'album'
            AND favorite.user_id = ?
        WHERE albumz_fts MATCH ?
            AND album.deleted_at IS NULL
            AND (rating.rating IS NULL OR rating.rating != 0)
        GROUP BY album.id, album.title, fts.rank, rating.rating, favorite.id
        ORDER BY fts.rank DESC
        LIMIT 10
        "#,
        user_id_param,
        user_id_param,
        match_query
    )
    .fetch_all(pool)
    .await?;

    let suggestions = rows
        .into_iter()
        .map(|row| {
            let base_confidence =
                calculate_confidence(partial, &row.album_title, row.fts_rank as f32);
            let confidence = apply_user_preference_multiplier(
                base_confidence,
                row.user_rating.map(|r| r as i32),
                row.is_favorite != 0,
            );
            let highlight = generate_highlight(&row.album_title, partial);

            Suggestion {
                value: row.album_title.clone(),
                display: row.album_title.clone(),
                highlight,
                count: row.song_count,
                suggestion_type: SuggestionType::Album,
                confidence,
                metadata: Some(serde_json::json!({
                    "match_type": "title",
                    "thumbnail_blob_id": row.thumbnail_blob_id
                })),
                entity_id: row.album_id,
            }
        })
        .collect();

    Ok(suggestions)
}

/// get genre suggestions from FTS
pub async fn get_genre_suggestions(
    pool: &SqlitePool,
    partial: &str,
) -> GrimoireResult<Vec<Suggestion>> {
    // query genrez_fts with prefix match: `name:partial*`
    // join to genrez for full details and count associated albums/songs
    // calculate confidence (no user prefs for genres)

    let match_query = format!("{}*", partial);

    let rows = sqlx::query!(
        r#"
        SELECT
            genre.id as "genre_id!: String",
            genre.name as "genre_name!: String",
            fts.rank as "fts_rank!: f64",
            COUNT(DISTINCT album.id) as "song_count!: i64"
        FROM genrez_fts fts
        JOIN genrez genre ON fts.genre_id = genre.id
        LEFT JOIN albumz album ON album.genre_id = genre.id AND album.deleted_at IS NULL
        WHERE genrez_fts MATCH ?
            AND genre.deleted_at IS NULL
        GROUP BY genre.id, genre.name, fts.rank
        ORDER BY fts.rank DESC
        LIMIT 10
        "#,
        match_query
    )
    .fetch_all(pool)
    .await?;

    let suggestions = rows
        .into_iter()
        .map(|row| {
            let confidence = calculate_confidence(partial, &row.genre_name, row.fts_rank as f32);
            let highlight = generate_highlight(&row.genre_name, partial);

            Suggestion {
                value: row.genre_name.clone(),
                display: row.genre_name.clone(),
                highlight,
                count: row.song_count,
                suggestion_type: SuggestionType::Genre,
                confidence,
                metadata: Some(serde_json::json!({
                    "match_type": "name"
                })),
                entity_id: row.genre_id,
            }
        })
        .collect();

    Ok(suggestions)
}

/// get sub-genre suggestions from FTS
pub async fn get_sub_genre_suggestions(
    pool: &SqlitePool,
    partial: &str,
) -> GrimoireResult<Vec<Suggestion>> {
    // query sub_genrez_fts with prefix match: `name:partial*`
    // join to sub_genrez and parent genrez for full details

    let match_query = format!("{}*", partial);

    let rows = sqlx::query!(
        r#"
        SELECT
            sub_genre.id as "sub_genre_id!: String",
            sub_genre.name as "sub_genre_name!: String",
            parent_genre.name as "parent_genre_name: Option<String>",
            fts.rank as "fts_rank!: f64",
            COUNT(DISTINCT asg.album_id) as "song_count!: i64"
        FROM sub_genrez_fts fts
        JOIN sub_genrez sub_genre ON fts.sub_genre_id = sub_genre.id
        LEFT JOIN genrez parent_genre ON sub_genre.parent_genre_id = parent_genre.id AND parent_genre.deleted_at IS NULL
        LEFT JOIN album_sub_genrez asg ON asg.sub_genre_id = sub_genre.id
        WHERE sub_genrez_fts MATCH ?
            AND sub_genre.deleted_at IS NULL
        GROUP BY sub_genre.id, sub_genre.name, parent_genre.name, fts.rank
        ORDER BY fts.rank DESC
        LIMIT 10
        "#,
        match_query
    )
    .fetch_all(pool)
    .await?;

    let suggestions = rows
        .into_iter()
        .map(|row| {
            let confidence =
                calculate_confidence(partial, &row.sub_genre_name, row.fts_rank as f32);
            let display = if let Some(parent) = &row.parent_genre_name {
                format!("{} ({})", row.sub_genre_name, parent)
            } else {
                row.sub_genre_name.clone()
            };
            let highlight = generate_highlight(&row.sub_genre_name, partial);

            Suggestion {
                value: row.sub_genre_name.clone(),
                display,
                highlight,
                count: row.song_count,
                suggestion_type: SuggestionType::SubGenre,
                confidence,
                metadata: Some(serde_json::json!({
                    "match_type": "name"
                })),
                entity_id: row.sub_genre_id,
            }
        })
        .collect();

    Ok(suggestions)
}

/// get playlist suggestions from FTS with privacy filtering
pub async fn get_playlist_suggestions(
    pool: &SqlitePool,
    partial: &str,
    user_id: Option<&str>,
) -> GrimoireResult<Vec<Suggestion>> {
    // query playlistz_fts with prefix match: `title:partial*`
    // filter by privacy: (is_public = 1 OR created_by = user_id)

    let match_query = format!("{}*", partial);
    let user_id_param = user_id.unwrap_or("");

    let rows = sqlx::query!(
        r#"
        SELECT
            playlist.id as "playlist_id!: String",
            playlist.title as "playlist_title!: String",
            playlist.thumbnail_blob_id as "thumbnail_blob_id: String",
            playlist.is_public as "is_public!: i64",
            playlist.created_by as "created_by!: String",
            fts.rank as "fts_rank!: f64",
            COUNT(DISTINCT ps.song_id) as "song_count!: i64"
        FROM playlistz_fts fts
        JOIN playlistz playlist ON fts.playlist_id = playlist.id
        LEFT JOIN playlist_songz ps ON ps.playlist_id = playlist.id
        WHERE playlistz_fts MATCH ?
            AND playlist.deleted_at IS NULL
            AND (playlist.is_public = 1 OR playlist.created_by = ?)
        GROUP BY playlist.id, playlist.title, playlist.thumbnail_blob_id, playlist.is_public, playlist.created_by, fts.rank
        ORDER BY fts.rank DESC
        LIMIT 10
        "#,
        match_query,
        user_id_param
    )
    .fetch_all(pool)
    .await?;

    let suggestions = rows
        .into_iter()
        .map(|row| {
            let confidence =
                calculate_confidence(partial, &row.playlist_title, row.fts_rank as f32);
            let highlight = generate_highlight(&row.playlist_title, partial);

            Suggestion {
                value: row.playlist_title.clone(),
                display: row.playlist_title.clone(),
                highlight,
                count: row.song_count,
                suggestion_type: SuggestionType::Playlist,
                confidence,
                metadata: Some(serde_json::json!({
                    "match_type": "title",
                    "is_public": row.is_public != 0,
                    "thumbnail_blob_id": row.thumbnail_blob_id
                })),
                entity_id: row.playlist_id,
            }
        })
        .collect();

    Ok(suggestions)
}
