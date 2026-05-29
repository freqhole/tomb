//! autocomplete suggestion functions for FTS search

use crate::error::GrimoireResult;
use crate::search::helpers::{
    apply_user_preference_multiplier, calculate_confidence, generate_highlight, sanitize_fts_query,
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
        images: Option<String>, // JSON array
        album_id: Option<String>,
        fts_rank: f64,
        user_rating: Option<i64>,
        is_favorite: i64,
    }

    let match_query = sanitize_fts_query(partial);
    let user_id_param = user_id.map(|s| s.to_string());

    let rows = sqlx::query_as!(
        SongSuggestionRow,
        r#"
        SELECT
            song.id as "song_id!: String",
            song.title as "song_title!: String",
            (SELECT json_group_array(json_object('media_blob_id', si.media_blob_id, 'is_primary', si.is_primary, 'blob_type', mb.blob_type))
             FROM song_imagez si
             JOIN media_blobz mb ON si.media_blob_id = mb.id
             WHERE si.song_id = song.id) as "images: String",
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
        LIMIT 100
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
                    "images": row.images,
                    "album_id": row.album_id
                })),
                entity_id: row.song_id,
                is_favorite: row.is_favorite != 0,
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
        images: Option<String>, // JSON array
        fts_rank: f64,
        song_count: i64,
        user_rating: Option<i64>,
        is_favorite: i64,
    }

    let match_query = sanitize_fts_query(partial);
    let user_id_param = user_id.map(|s| s.to_string());

    let rows = sqlx::query_as!(
        ArtistSuggestionRow,
        r#"
        SELECT
            artist.id as "artist_id!: String",
            artist.name as "artist_name!: String",
            (SELECT json_group_array(json_object('media_blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
             FROM artist_imagez ai
             JOIN media_blobz mb ON ai.media_blob_id = mb.id
             WHERE ai.artist_id = artist.id) as "images: String",
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
        LIMIT 100
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
                    "images": row.images
                })),
                entity_id: row.artist_id,
                is_favorite: row.is_favorite != 0,
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
        images: Option<String>, // JSON array
        fts_rank: f64,
        song_count: i64,
        user_rating: Option<i64>,
        is_favorite: i64,
    }

    let match_query = sanitize_fts_query(partial);
    let user_id_param = user_id.map(|s| s.to_string());

    let rows = sqlx::query_as!(
        AlbumSuggestionRow,
        r#"
        SELECT
            album.id as "album_id!: String",
            album.title as "album_title!: String",
            (SELECT json_group_array(json_object('media_blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
             FROM album_imagez ai
             JOIN media_blobz mb ON ai.media_blob_id = mb.id
             WHERE ai.album_id = album.id) as "images: String",
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
        LIMIT 100
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
                    "images": row.images
                })),
                entity_id: row.album_id,
                is_favorite: row.is_favorite != 0,
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
    // query taxonz_fts (filtered to kind='genre') with prefix match: `label:partial*`
    // join to taxonz for full details and count associated albums.
    // post-taxonomy refactor: genres are taxons under kind='genre',
    // and the dedicated `genrez_fts` was replaced by the cross-kind
    // `taxonz_fts(taxon_id, kind_slug, label)`.

    let match_query = sanitize_fts_query(partial);

    let rows = sqlx::query!(
        r#"
        SELECT
            taxon.id as "genre_id!: String",
            taxon.label as "genre_name!: String",
            fts.rank as "fts_rank!: f64",
            (SELECT COUNT(DISTINCT at.album_id)
                FROM album_taxonz at
                JOIN albumz a ON at.album_id = a.id
                WHERE at.taxon_id = taxon.id AND a.deleted_at IS NULL) as "song_count!: i64"
        FROM taxonz_fts fts
        JOIN taxonz taxon ON fts.taxon_id = taxon.id
        JOIN taxon_kindz kind ON kind.id = taxon.kind_id
        WHERE taxonz_fts MATCH ?
            AND kind.slug = 'genre'
            AND taxon.deleted_at IS NULL
        GROUP BY taxon.id, taxon.label, fts.rank
        ORDER BY fts.rank DESC
        LIMIT 100
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
                is_favorite: false,
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

    let match_query = sanitize_fts_query(partial);
    let user_id_param = user_id.map(|s| s.to_string());

    let rows = sqlx::query!(
        r#"
        SELECT
            playlist.id as "playlist_id!: String",
            playlist.title as "playlist_title!: String",
            (SELECT json_group_array(json_object('media_blob_id', pi.media_blob_id, 'is_primary', pi.is_primary, 'blob_type', mb.blob_type))
             FROM playlist_imagez pi
             JOIN media_blobz mb ON pi.media_blob_id = mb.id
             WHERE pi.playlist_id = playlist.id) as "images: String",
            playlist.is_public as "is_public!: i64",
            playlist.created_by as "created_by!: String",
            fts.rank as "fts_rank!: f64",
            COUNT(DISTINCT ps.song_id) as "song_count!: i64",
            CASE WHEN favorite.id IS NOT NULL THEN 1 ELSE 0 END as "is_favorite!: i64"
        FROM playlistz_fts fts
        JOIN playlistz playlist ON fts.playlist_id = playlist.id
        LEFT JOIN playlist_songz ps ON ps.playlist_id = playlist.id
        LEFT JOIN user_favoritez favorite
            ON favorite.target_id = playlist.id
            AND favorite.target_type = 'playlist'
            AND favorite.user_id = ?
        WHERE playlistz_fts MATCH ?
            AND playlist.deleted_at IS NULL
            AND (playlist.is_public = 1 OR playlist.created_by = ?)
        GROUP BY playlist.id, playlist.title, playlist.is_public, playlist.created_by, fts.rank, favorite.id
        ORDER BY fts.rank DESC
        LIMIT 100
        "#,
        user_id_param,
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
                    "images": row.images
                })),
                entity_id: row.playlist_id,
                is_favorite: row.is_favorite != 0,
            }
        })
        .collect();

    Ok(suggestions)
}
