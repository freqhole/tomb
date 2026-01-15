//! full search query functions with filtering support

use crate::error::GrimoireResult;
use crate::search::models::*;
use sqlx::SqlitePool;

/// search songs with full details and filtering
pub async fn search_songs(
    pool: &SqlitePool,
    query: &str,
    user_id: Option<&str>,
    tag_filter: Option<&FilterSet>,
    limit: u32,
    offset: u32,
) -> GrimoireResult<Vec<SongSearchResult>> {
    // FTS search on songz_fts with user preferences
    // note: ordering is by relevance (fts rank * user prefs), NOT by disc/track number
    // disc/track ordering only matters for non-search contexts (album pages, etc.)

    #[derive(sqlx::FromRow)]
    struct SongRow {
        song_id: String,
        song_title: String,
        duration: Option<i64>,
        fts_rank: f64,
        user_rating: Option<i64>,
        is_favorite: i64,
        album_title: Option<String>,
        album_id: Option<String>,
        artist_names: Option<String>,
    }

    let user_id_param = user_id.unwrap_or("");

    // build tag filter conditions
    let has_tag_include = tag_filter
        .as_ref()
        .map(|f| !f.include.is_empty())
        .unwrap_or(false);
    let has_tag_exclude = tag_filter
        .as_ref()
        .map(|f| !f.exclude.is_empty())
        .unwrap_or(false);

    // serialize tag ids for json_each in sql
    let tag_include_json =
        serde_json::to_string(&tag_filter.as_ref().map(|f| &f.include).unwrap_or(&vec![])).unwrap();
    let tag_exclude_json =
        serde_json::to_string(&tag_filter.as_ref().map(|f| &f.exclude).unwrap_or(&vec![])).unwrap();

    let rows = sqlx::query_as!(
        SongRow,
        r#"
        SELECT
            song.id as "song_id!: String",
            song.title as "song_title!: String",
            song.duration as "duration: i64",
            fts.rank as "fts_rank!: f64",
            rating.rating as "user_rating: i64",
            CASE WHEN favorite.id IS NOT NULL THEN 1 ELSE 0 END as "is_favorite!: i64",
            (SELECT album.title
             FROM album_songz asong
             JOIN albumz album ON asong.album_id = album.id
             WHERE asong.song_id = song.id AND album.deleted_at IS NULL
             LIMIT 1
            ) as "album_title: String",
            (SELECT album.id
             FROM album_songz asong
             JOIN albumz album ON asong.album_id = album.id
             WHERE asong.song_id = song.id AND album.deleted_at IS NULL
             LIMIT 1
            ) as "album_id: String",
            (SELECT GROUP_CONCAT(name, ', ')
             FROM (SELECT DISTINCT artist.name as name
                   FROM artist_songz arsong
                   JOIN artistz artist ON arsong.artist_id = artist.id
                   WHERE arsong.song_id = song.id AND artist.deleted_at IS NULL)
            ) as "artist_names: String"
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
            -- tag include filter (OR logic - must have at least one of these tags)
            AND (NOT ? OR EXISTS (
                SELECT 1 FROM album_songz asong_filter
                JOIN album_tagz atag ON atag.album_id = asong_filter.album_id
                WHERE asong_filter.song_id = song.id
                AND atag.tag_id IN (SELECT value FROM json_each(?))
            ))
            -- tag exclude filter (AND NOT logic - must not have any of these tags)
            AND (NOT ? OR NOT EXISTS (
                SELECT 1 FROM album_songz asong_filter
                JOIN album_tagz atag ON atag.album_id = asong_filter.album_id
                WHERE asong_filter.song_id = song.id
                AND atag.tag_id IN (SELECT value FROM json_each(?))
            ))
        ORDER BY fts.rank DESC
        LIMIT ? OFFSET ?
        "#,
        user_id_param,
        user_id_param,
        query,
        has_tag_include,
        tag_include_json,
        has_tag_exclude,
        tag_exclude_json,
        limit,
        offset
    )
    .fetch_all(pool)
    .await?;

    let results = rows
        .into_iter()
        .map(|row| {
            let artist_names = row
                .artist_names
                .map(|a| {
                    a.split(", ")
                        .map(|s| s.to_string())
                        .collect::<Vec<String>>()
                })
                .unwrap_or_else(Vec::new);

            SongSearchResult {
                id: row.song_id,
                title: row.song_title,
                artist_names,
                album_title: row.album_title,
                album_id: row.album_id,
                duration: row.duration,
                thumbnail_url: None,
                user_rating: row.user_rating.map(|r| r as i32),
                is_favorite: row.is_favorite != 0,
                search_rank: row.fts_rank as f32,
                match_type: "title".to_string(),
                highlight: None,
            }
        })
        .collect();

    Ok(results)
}

/// search artists with aggregates and tag filtering
pub async fn search_artists(
    pool: &SqlitePool,
    query: &str,
    user_id: Option<&str>,
    tag_filter: Option<&FilterSet>,
    limit: u32,
    offset: u32,
) -> GrimoireResult<Vec<ArtistSearchResult>> {
    // FTS search on artistz_fts with user preferences and aggregates
    // tag filtering: only show artists who have albums with matching tags

    #[derive(sqlx::FromRow)]
    struct ArtistRow {
        artist_id: String,
        artist_name: String,
        fts_rank: f64,
        song_count: i64,
        album_count: i64,
        user_rating: Option<i64>,
        is_favorite: i64,
        genres: Option<String>,
    }

    let user_id_param = user_id.unwrap_or("");

    // build tag filter conditions
    let has_tag_include = tag_filter
        .as_ref()
        .map(|f| !f.include.is_empty())
        .unwrap_or(false);
    let has_tag_exclude = tag_filter
        .as_ref()
        .map(|f| !f.exclude.is_empty())
        .unwrap_or(false);

    // serialize tag ids for json_each in sql
    let tag_include_json =
        serde_json::to_string(&tag_filter.as_ref().map(|f| &f.include).unwrap_or(&vec![])).unwrap();
    let tag_exclude_json =
        serde_json::to_string(&tag_filter.as_ref().map(|f| &f.exclude).unwrap_or(&vec![])).unwrap();

    let rows = sqlx::query_as!(
        ArtistRow,
        r#"
        SELECT
            artist.id as "artist_id!: String",
            artist.name as "artist_name!: String",
            fts.rank as "fts_rank!: f64",
            (SELECT COUNT(DISTINCT asong2.song_id) FROM artist_songz asong2 WHERE asong2.artist_id = artist.id) as "song_count!: i64",
            (SELECT COUNT(DISTINCT alsong.album_id) FROM artist_songz asong3 JOIN album_songz alsong ON asong3.song_id = alsong.song_id WHERE asong3.artist_id = artist.id) as "album_count!: i64",
            rating.rating as "user_rating: i64",
            CASE WHEN favorite.id IS NOT NULL THEN 1 ELSE 0 END as "is_favorite!: i64",
            (SELECT GROUP_CONCAT(name, ', ')
             FROM (SELECT DISTINCT genre.name as name
                   FROM artist_songz asong2
                   JOIN album_songz alsong ON asong2.song_id = alsong.song_id
                   JOIN albumz alb ON alsong.album_id = alb.id
                   JOIN genrez genre ON alb.genre_id = genre.id
                   WHERE asong2.artist_id = artist.id
                     AND genre.deleted_at IS NULL
                     AND alb.deleted_at IS NULL)
            ) as "genres: String"
        FROM artistz_fts fts
        JOIN artistz artist ON fts.artist_id = artist.id

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
            -- tag include filter (OR logic - artist must have at least one album with these tags)
            AND (NOT ? OR EXISTS (
                SELECT 1 FROM artist_songz asong_filter
                JOIN album_songz alsong_filter ON asong_filter.song_id = alsong_filter.song_id
                JOIN album_tagz atag ON atag.album_id = alsong_filter.album_id
                WHERE asong_filter.artist_id = artist.id
                AND atag.tag_id IN (SELECT value FROM json_each(?))
            ))
            -- tag exclude filter (AND NOT logic - artist must not have any albums with these tags)
            AND (NOT ? OR NOT EXISTS (
                SELECT 1 FROM artist_songz asong_filter
                JOIN album_songz alsong_filter ON asong_filter.song_id = alsong_filter.song_id
                JOIN album_tagz atag ON atag.album_id = alsong_filter.album_id
                WHERE asong_filter.artist_id = artist.id
                AND atag.tag_id IN (SELECT value FROM json_each(?))
            ))
        GROUP BY artist.id, artist.name, fts.rank, rating.rating, favorite.id
        ORDER BY fts.rank DESC
        LIMIT ? OFFSET ?
        "#,
        user_id_param,
        user_id_param,
        query,
        has_tag_include,
        tag_include_json,
        has_tag_exclude,
        tag_exclude_json,
        limit,
        offset
    )
    .fetch_all(pool)
    .await?;

    let results = rows
        .into_iter()
        .map(|row| {
            let genres = row
                .genres
                .map(|g| {
                    g.split(", ")
                        .map(|s| s.to_string())
                        .collect::<Vec<String>>()
                })
                .unwrap_or_else(Vec::new);

            ArtistSearchResult {
                id: row.artist_id,
                name: row.artist_name,
                song_count: row.song_count,
                album_count: row.album_count,
                genres,
                user_rating: row.user_rating.map(|r| r as i32),
                is_favorite: row.is_favorite != 0,
                search_rank: row.fts_rank as f32,
                highlight: None,
            }
        })
        .collect();

    Ok(results)
}

/// search albums with filtering
pub async fn search_albums(
    pool: &SqlitePool,
    query: &str,
    user_id: Option<&str>,
    tag_filter: Option<&FilterSet>,
    limit: u32,
    offset: u32,
) -> GrimoireResult<Vec<AlbumSearchResult>> {
    // FTS search on albumz_fts with tag/genre/sub-genre filtering and user preferences

    #[derive(sqlx::FromRow)]
    struct AlbumRow {
        album_id: String,
        album_title: String,
        fts_rank: f64,
        song_count: i64,
        genre_name: Option<String>,
        user_rating: Option<i64>,
        is_favorite: i64,
        artist_names: Option<String>,
        sub_genre_names: Option<String>,
    }

    let user_id_param = user_id.unwrap_or("");

    // build tag filter conditions
    let has_tag_include = tag_filter
        .as_ref()
        .map(|f| !f.include.is_empty())
        .unwrap_or(false);
    let has_tag_exclude = tag_filter
        .as_ref()
        .map(|f| !f.exclude.is_empty())
        .unwrap_or(false);

    // serialize tag ids for json_each in sql
    let tag_include_json =
        serde_json::to_string(&tag_filter.as_ref().map(|f| &f.include).unwrap_or(&vec![])).unwrap();
    let tag_exclude_json =
        serde_json::to_string(&tag_filter.as_ref().map(|f| &f.exclude).unwrap_or(&vec![])).unwrap();

    // note: genre/sub-genre filtering deferred for now
    let rows = sqlx::query_as!(
        AlbumRow,
        r#"
        SELECT
            album.id as "album_id!: String",
            album.title as "album_title!: String",
            fts.rank as "fts_rank!: f64",
            (SELECT COUNT(DISTINCT asong2.song_id) FROM album_songz asong2 WHERE asong2.album_id = album.id) as "song_count!: i64",
            genre.name as "genre_name: String",
            rating.rating as "user_rating: i64",
            CASE WHEN favorite.id IS NOT NULL THEN 1 ELSE 0 END as "is_favorite!: i64",
            (SELECT GROUP_CONCAT(name, ', ')
             FROM (SELECT DISTINCT artist.name as name
                   FROM album_songz asong2
                   JOIN artist_songz arsong ON asong2.song_id = arsong.song_id
                   JOIN artistz artist ON arsong.artist_id = artist.id
                   WHERE asong2.album_id = album.id AND artist.deleted_at IS NULL)
            ) as "artist_names: String",
            (SELECT GROUP_CONCAT(name, ', ')
             FROM (SELECT DISTINCT sg.name as name
                   FROM album_sub_genrez asg
                   JOIN sub_genrez sg ON asg.sub_genre_id = sg.id
                   WHERE asg.album_id = album.id AND sg.deleted_at IS NULL)
            ) as "sub_genre_names: String"
        FROM albumz_fts fts
        JOIN albumz album ON fts.album_id = album.id

        LEFT JOIN genrez genre ON album.genre_id = genre.id AND genre.deleted_at IS NULL
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
            -- tag include filter (OR logic - must have at least one of these tags)
            AND (NOT ? OR EXISTS (
                SELECT 1 FROM album_tagz atag
                WHERE atag.album_id = album.id
                AND atag.tag_id IN (SELECT value FROM json_each(?))
            ))
            -- tag exclude filter (AND NOT logic - must not have any of these tags)
            AND (NOT ? OR NOT EXISTS (
                SELECT 1 FROM album_tagz atag
                WHERE atag.album_id = album.id
                AND atag.tag_id IN (SELECT value FROM json_each(?))
            ))
        ORDER BY fts.rank DESC
        LIMIT ? OFFSET ?
        "#,
        user_id_param,
        user_id_param,
        query,
        has_tag_include,
        tag_include_json,
        has_tag_exclude,
        tag_exclude_json,
        limit,
        offset
    )
    .fetch_all(pool)
    .await?;

    let results = rows
        .into_iter()
        .map(|row| {
            let artist_names = row
                .artist_names
                .map(|a| {
                    a.split(", ")
                        .map(|s| s.to_string())
                        .collect::<Vec<String>>()
                })
                .unwrap_or_else(Vec::new);

            let sub_genres = row
                .sub_genre_names
                .map(|sg| {
                    sg.split(", ")
                        .map(|s| s.to_string())
                        .collect::<Vec<String>>()
                })
                .unwrap_or_else(Vec::new);

            AlbumSearchResult {
                id: row.album_id,
                title: row.album_title,
                artist_names,
                genre: row.genre_name,
                sub_genres,
                song_count: row.song_count,
                thumbnail_url: None,
                user_rating: row.user_rating.map(|r| r as i32),
                is_favorite: row.is_favorite != 0,
                search_rank: row.fts_rank as f32,
                highlight: None,
            }
        })
        .collect();

    Ok(results)
}

/// search genres with aggregates
/// search genres with song/artist counts and tag filtering
pub async fn search_genres(
    pool: &SqlitePool,
    query: &str,
    tag_filter: Option<&FilterSet>,
    limit: u32,
    offset: u32,
) -> GrimoireResult<Vec<GenreSearchResult>> {
    // FTS search on genrez_fts with aggregates
    // tag filtering: only show genres that appear on albums with matching tags
    // collect sub-genres, count songs/artists, get representative data

    #[derive(sqlx::FromRow)]
    struct GenreRow {
        genre_id: String,
        genre_name: String,
        fts_rank: f64,
        song_count: i64,
        artist_count: i64,
        sub_genre_names: Option<String>,
    }

    // build tag filter conditions
    let has_tag_include = tag_filter
        .as_ref()
        .map(|f| !f.include.is_empty())
        .unwrap_or(false);
    let has_tag_exclude = tag_filter
        .as_ref()
        .map(|f| !f.exclude.is_empty())
        .unwrap_or(false);

    // serialize tag ids for json_each in sql
    let tag_include_json =
        serde_json::to_string(&tag_filter.as_ref().map(|f| &f.include).unwrap_or(&vec![])).unwrap();
    let tag_exclude_json =
        serde_json::to_string(&tag_filter.as_ref().map(|f| &f.exclude).unwrap_or(&vec![])).unwrap();

    let rows = sqlx::query_as!(
        GenreRow,
        r#"
        SELECT
            genre.id as "genre_id!: String",
            genre.name as "genre_name!: String",
            fts.rank as "fts_rank!: f64",
            (SELECT COUNT(DISTINCT s.id) FROM albumz alb JOIN album_songz asong ON alb.id = asong.album_id JOIN songz s ON asong.song_id = s.id WHERE alb.genre_id = genre.id AND alb.deleted_at IS NULL AND s.deleted_at IS NULL) as "song_count!: i64",
            (SELECT COUNT(DISTINCT arsong.artist_id) FROM albumz alb JOIN album_songz asong ON alb.id = asong.album_id JOIN artist_songz arsong ON asong.song_id = arsong.song_id WHERE alb.genre_id = genre.id AND alb.deleted_at IS NULL) as "artist_count!: i64",
            (SELECT GROUP_CONCAT(sg.name, ', ')
             FROM sub_genrez sg
             WHERE sg.parent_genre_id = genre.id AND sg.deleted_at IS NULL
            ) as "sub_genre_names: String"
        FROM genrez_fts fts
        JOIN genrez genre ON fts.genre_id = genre.id
        WHERE genrez_fts MATCH ?
            AND genre.deleted_at IS NULL
            -- tag include filter (OR logic - genre must appear on at least one album with these tags)
            AND (NOT ? OR EXISTS (
                SELECT 1 FROM albumz album_filter
                JOIN album_tagz atag ON atag.album_id = album_filter.id
                WHERE album_filter.genre_id = genre.id
                AND atag.tag_id IN (SELECT value FROM json_each(?))
            ))
            -- tag exclude filter (AND NOT logic - genre must not appear on any albums with these tags)
            AND (NOT ? OR NOT EXISTS (
                SELECT 1 FROM albumz album_filter
                JOIN album_tagz atag ON atag.album_id = album_filter.id
                WHERE album_filter.genre_id = genre.id
                AND atag.tag_id IN (SELECT value FROM json_each(?))
            ))
        GROUP BY genre.id, genre.name, fts.rank
        ORDER BY fts.rank DESC
        LIMIT ? OFFSET ?
        "#,
        query,
        has_tag_include,
        tag_include_json,
        has_tag_exclude,
        tag_exclude_json,
        limit,
        offset
    )
    .fetch_all(pool)
    .await?;

    let results = rows
        .into_iter()
        .map(|row| {
            let sub_genres = row
                .sub_genre_names
                .map(|s| {
                    s.split(", ")
                        .map(|s| s.to_string())
                        .collect::<Vec<String>>()
                })
                .unwrap_or_else(Vec::new);

            GenreSearchResult {
                genre: row.genre_name,
                genre_id: row.genre_id,
                sub_genres,
                song_count: row.song_count,
                artist_count: row.artist_count,
                representative_song_id: None,
                representative_thumbnail: None,
                avg_rating: None,
                search_rank: row.fts_rank as f32,
            }
        })
        .collect();

    Ok(results)
}

/// search playlists with privacy filtering and tag filtering
pub async fn search_playlists(
    pool: &SqlitePool,
    query: &str,
    user_id: Option<&str>,
    tag_filter: Option<&FilterSet>,
    limit: u32,
    offset: u32,
) -> GrimoireResult<Vec<PlaylistSearchResult>> {
    // FTS search on playlistz_fts with privacy filtering
    // tag filtering: only show playlists containing songs from albums with matching tags

    #[derive(sqlx::FromRow)]
    struct PlaylistRow {
        playlist_id: String,
        playlist_title: String,
        playlist_description: Option<String>,
        is_public: i64,
        created_by: String,
        fts_rank: f64,
        song_count: i64,
    }

    let user_id_param = user_id.unwrap_or("");

    // build tag filter conditions
    let has_tag_include = tag_filter
        .as_ref()
        .map(|f| !f.include.is_empty())
        .unwrap_or(false);
    let has_tag_exclude = tag_filter
        .as_ref()
        .map(|f| !f.exclude.is_empty())
        .unwrap_or(false);

    // serialize tag ids for json_each in sql
    let tag_include_json =
        serde_json::to_string(&tag_filter.as_ref().map(|f| &f.include).unwrap_or(&vec![])).unwrap();
    let tag_exclude_json =
        serde_json::to_string(&tag_filter.as_ref().map(|f| &f.exclude).unwrap_or(&vec![])).unwrap();

    let rows = sqlx::query_as!(
        PlaylistRow,
        r#"
        SELECT
            playlist.id as "playlist_id!: String",
            playlist.title as "playlist_title!: String",
            playlist.description as "playlist_description: String",
            playlist.is_public as "is_public!: i64",
            playlist.created_by as "created_by!: String",
            fts.rank as "fts_rank!: f64",
            (SELECT COUNT(DISTINCT ps2.song_id) FROM playlist_songz ps2 WHERE ps2.playlist_id = playlist.id) as "song_count!: i64"
        FROM playlistz_fts fts
        JOIN playlistz playlist ON fts.playlist_id = playlist.id

        WHERE playlistz_fts MATCH ?
            AND playlist.deleted_at IS NULL
            AND (playlist.is_public = 1 OR playlist.created_by = ?)
            -- tag include filter (OR logic - playlist must contain songs from albums with these tags)
            AND (NOT ? OR EXISTS (
                SELECT 1 FROM playlist_songz psong
                JOIN album_songz alsong ON psong.song_id = alsong.song_id
                JOIN album_tagz atag ON atag.album_id = alsong.album_id
                WHERE psong.playlist_id = playlist.id
                AND atag.tag_id IN (SELECT value FROM json_each(?))
            ))
            -- tag exclude filter (AND NOT logic - playlist must not contain songs from albums with these tags)
            AND (NOT ? OR NOT EXISTS (
                SELECT 1 FROM playlist_songz psong
                JOIN album_songz alsong ON psong.song_id = alsong.song_id
                JOIN album_tagz atag ON atag.album_id = alsong.album_id
                WHERE psong.playlist_id = playlist.id
                AND atag.tag_id IN (SELECT value FROM json_each(?))
            ))
        GROUP BY playlist.id, playlist.title, playlist.description, playlist.is_public, playlist.created_by, fts.rank
        ORDER BY fts.rank DESC
        LIMIT ? OFFSET ?
        "#,
        query,
        user_id_param,
        has_tag_include,
        tag_include_json,
        has_tag_exclude,
        tag_exclude_json,
        limit,
        offset
    )
    .fetch_all(pool)
    .await?;

    let results = rows
        .into_iter()
        .map(|row| PlaylistSearchResult {
            id: row.playlist_id,
            title: row.playlist_title,
            description: row.playlist_description,
            song_count: row.song_count,
            is_public: row.is_public != 0,
            created_by: row.created_by,
            thumbnail_url: None,
            search_rank: row.fts_rank as f32,
            highlight: None,
        })
        .collect();

    Ok(results)
}

/// count total song search results (for pagination)
pub async fn count_song_results(
    pool: &SqlitePool,
    query: &str,
    tag_filter: Option<&FilterSet>,
) -> GrimoireResult<i64> {
    // count with tag filtering matching search_songs logic

    // build tag filter conditions
    let has_tag_include = tag_filter
        .as_ref()
        .map(|f| !f.include.is_empty())
        .unwrap_or(false);
    let has_tag_exclude = tag_filter
        .as_ref()
        .map(|f| !f.exclude.is_empty())
        .unwrap_or(false);

    // serialize tag ids for json_each in sql
    let tag_include_json =
        serde_json::to_string(&tag_filter.as_ref().map(|f| &f.include).unwrap_or(&vec![])).unwrap();
    let tag_exclude_json =
        serde_json::to_string(&tag_filter.as_ref().map(|f| &f.exclude).unwrap_or(&vec![])).unwrap();

    let result = sqlx::query!(
        r#"
        SELECT COUNT(DISTINCT song.id) as "count!: i64"
        FROM songz_fts fts
        JOIN songz song ON fts.song_id = song.id
        WHERE songz_fts MATCH ?
            AND song.deleted_at IS NULL
            -- tag include filter (OR logic - must have at least one of these tags)
            AND (NOT ? OR EXISTS (
                SELECT 1 FROM album_songz asong_filter
                JOIN album_tagz atag ON atag.album_id = asong_filter.album_id
                WHERE asong_filter.song_id = song.id
                AND atag.tag_id IN (SELECT value FROM json_each(?))
            ))
            -- tag exclude filter (AND NOT logic - must not have any of these tags)
            AND (NOT ? OR NOT EXISTS (
                SELECT 1 FROM album_songz asong_filter
                JOIN album_tagz atag ON atag.album_id = asong_filter.album_id
                WHERE asong_filter.song_id = song.id
                AND atag.tag_id IN (SELECT value FROM json_each(?))
            ))
        "#,
        query,
        has_tag_include,
        tag_include_json,
        has_tag_exclude,
        tag_exclude_json
    )
    .fetch_one(pool)
    .await?;

    Ok(result.count)
}
