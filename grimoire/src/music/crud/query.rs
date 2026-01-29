//! Unified query system with shared filters for songs, albums, artists, genres

use sea_query::{Cond, Expr, Iden, Order, Query, SelectStatement, SqliteQueryBuilder};
use std::time::Instant;

use crate::database;

use crate::music::crud::models::{
    AlbumQueryResult, ArtistQueryResult, GenreQueryResult, ImageMetadata, QueryParams, QueryResult,
    SongQueryResult,
};
use crate::music::entities::{albums::Album, artists::Artist, genres::Genre, songs::Song};
use crate::response::GrimoireResponse;

// Table identifiers for type-safe queries
#[derive(Iden)]
enum SongView {
    #[iden = "song_query_view"]
    Table,
    #[iden = "song_id"]
    SongId,
    #[iden = "song_title"]
    SongTitle,
    #[iden = "artist_name"]
    ArtistName,
    #[iden = "album_title"]
    AlbumTitle,
    #[iden = "album_genre_name"]
    AlbumGenreName,
    #[iden = "album_release_date"]
    AlbumReleaseDate,
    #[iden = "album_created_at"]
    AlbumCreatedAt,
    #[iden = "album_total_duration"]
    AlbumTotalDuration,
    #[iden = "album_song_count"]
    AlbumSongCount,
    #[iden = "artist_total_song_count"]
    ArtistTotalSongCount,
    #[iden = "artist_total_duration"]
    ArtistTotalDuration,
    #[iden = "song_disc_number"]
    SongDiscNumber,
    #[iden = "song_track_number"]
    SongTrackNumber,
    #[iden = "song_duration"]
    SongDuration,
    #[iden = "favorite_user_id"]
    FavoriteUserId,
    #[iden = "rating_user_id"]
    RatingUserId,
    #[iden = "user_rating"]
    UserRating,
}

#[derive(Iden)]
enum AlbumView {
    #[iden = "album_query_view"]
    Table,
    #[iden = "album_title"]
    AlbumTitle,
    #[iden = "artist_name"]
    ArtistName,
    #[iden = "album_created_at"]
    AlbumCreatedAt,
    #[iden = "album_release_date"]
    AlbumReleaseDate,
    #[iden = "album_total_duration"]
    AlbumTotalDuration,
    #[iden = "album_song_count"]
    AlbumSongCount,
}

#[derive(Iden)]
enum ArtistView {
    #[iden = "artist_query_view"]
    Table,
    #[iden = "artist_id"]
    ArtistId,
    #[iden = "artist_name"]
    ArtistName,
    #[iden = "artist_bio"]
    ArtistBio,
    #[iden = "artist_created_at"]
    ArtistCreatedAt,
    #[iden = "song_count"]
    SongCount,
    #[iden = "album_count"]
    AlbumCount,
    #[iden = "total_duration"]
    TotalDuration,
}

#[derive(Iden)]
enum GenreView {
    #[iden = "genre_query_view"]
    Table,
    #[iden = "genre_name"]
    GenreName,
    #[iden = "genre_created_at"]
    GenreCreatedAt,
}

#[derive(Iden)]
enum CommonColumns {
    #[iden = "artist_id"]
    ArtistId,
    #[iden = "album_id"]
    AlbumId,
    #[iden = "album_genre_id"]
    AlbumGenreId,
    #[iden = "album_tags"]
    AlbumTags,
}

// Row structures
#[derive(sqlx::FromRow)]
pub struct SongViewRow {
    song_id: String,
    song_media_blob_id: String,
    song_images: Option<String>, // JSON array from view
    song_title: String,
    song_track_number: i64,
    song_disc_number: i64,
    song_duration: Option<i64>,
    song_year: Option<i64>,
    song_bpm: Option<i64>,
    song_key_signature: Option<String>,
    song_metadata: Option<String>,
    song_lyrics: Option<String>,
    song_processing_status: Option<String>,
    song_processing_notes: Option<String>,
    song_created_at: i64,
    song_updated_at: i64,
    song_deleted_at: Option<i64>,
    song_deleted_by: Option<String>,
    song_created_by: Option<String>,
    song_updated_by: Option<String>,
    artist_id: Option<String>,
    artist_name: Option<String>,
    artist_created_at: Option<i64>,
    artist_updated_at: Option<i64>,
    artist_deleted_at: Option<i64>,
    artist_deleted_by: Option<String>,
    artist_created_by: Option<String>,
    artist_updated_by: Option<String>,
    artist_images: Option<String>, // JSON array from view
    artist_total_song_count: Option<i64>,
    artist_total_album_count: Option<i64>,
    artist_total_duration: Option<i64>,
    album_id: Option<String>,
    album_title: Option<String>,
    album_album_type: Option<String>,
    album_release_date: Option<String>,
    album_release_date_precision: Option<String>,
    album_label: Option<String>,
    album_genre_id: Option<String>,
    album_song_count: Option<i64>,
    album_total_duration: Option<i64>,
    album_created_at: Option<i64>,
    album_updated_at: Option<i64>,
    album_deleted_at: Option<i64>,
    album_deleted_by: Option<String>,
    album_created_by: Option<String>,
    album_updated_by: Option<String>,
    album_genre_name: Option<String>,
    album_sub_genres: Option<String>, // JSON array from view
    album_tags: Option<String>, // JSON array of tag names from view
    album_images: Option<String>, // JSON array from album_imagez
    // User context fields from view joins
    favorite_user_id: Option<String>,
    favorited_at: Option<i64>,
    rating_user_id: Option<String>,
    user_rating: Option<i32>,
    rating_created_at: Option<i64>,
    // Album favorite fields
    album_favorite_user_id: Option<String>,
    #[allow(dead_code)] // used by sqlx for deserialization
    album_favorited_at: Option<i64>,
    // Album rating fields
    album_rating_user_id: Option<String>,
    album_user_rating: Option<i32>,
    #[allow(dead_code)] // used by sqlx for deserialization
    album_rating_created_at: Option<i64>,
}

impl SongViewRow {
    pub fn to_song_query_result(self, user_id: Option<&str>) -> SongQueryResult {
        // parse images JSON array
        let images = self
            .song_images
            .and_then(|json_str| serde_json::from_str::<Vec<ImageMetadata>>(&json_str).ok())
            .or(Some(vec![])); // default to empty vec if None or parse fails

        // parse album tags JSON array
        let album_tags = self
            .album_tags
            .and_then(|json_str| serde_json::from_str::<Vec<String>>(&json_str).ok())
            .or(Some(vec![])); // default to empty vec

        // parse album sub_genres JSON array
        let album_sub_genres = self
            .album_sub_genres
            .and_then(|json_str| serde_json::from_str::<Vec<String>>(&json_str).ok())
            .map(crate::JsonVec);

        // parse album images JSON array
        let album_images = self
            .album_images
            .and_then(|json_str| serde_json::from_str::<Vec<ImageMetadata>>(&json_str).ok())
            .map(crate::JsonVec);

        // parse artist images JSON array
        let artist_images = self
            .artist_images
            .and_then(|json_str| serde_json::from_str::<Vec<ImageMetadata>>(&json_str).ok())
            .map(crate::JsonVec);

        let song = Song {
            id: self.song_id,
            media_blob_id: self.song_media_blob_id,
            images: images.clone().map(crate::JsonVec),
            title: self.song_title,
            track_number: self.song_track_number,
            disc_number: self.song_disc_number,
            duration: self.song_duration,
            year: self.song_year,
            bpm: self.song_bpm,
            key_signature: self.song_key_signature,
            metadata: self.song_metadata,
            lyrics: self.song_lyrics,
            processing_status: self.song_processing_status,
            processing_notes: self.song_processing_notes,
            created_at: self.song_created_at,
            updated_at: self.song_updated_at,
            deleted_at: self.song_deleted_at,
            deleted_by: self.song_deleted_by,
            created_by: self.song_created_by,
            updated_by: self.song_updated_by,
        };

        let artist = if self.artist_id.is_some() {
            Some(Artist {
                id: self.artist_id.unwrap_or_default(),
                name: self.artist_name.unwrap_or_default(),
                bio: None,
                created_at: self.artist_created_at.unwrap_or(0),
                updated_at: self.artist_updated_at.unwrap_or(0),
                deleted_at: self.artist_deleted_at,
                deleted_by: self.artist_deleted_by,
                created_by: self.artist_created_by,
                updated_by: self.artist_updated_by,
                images: artist_images,
            })
        } else {
            None
        };

        let album = if self.album_id.is_some() {
            Some(Album {
                id: self.album_id.unwrap_or_default(),
                title: self.album_title.unwrap_or_default(),
                album_type: self.album_album_type.unwrap_or_else(|| "album".to_string()),
                release_date: self.album_release_date,
                release_date_precision: self.album_release_date_precision,
                label: self.album_label,
                genre_id: self.album_genre_id,
                genre: self.album_genre_name,
                sub_genres: album_sub_genres,
                images: album_images,
                song_count: self.album_song_count.unwrap_or(0),
                total_duration: self.album_total_duration.unwrap_or(0),
                created_at: self.album_created_at.unwrap_or(0),
                updated_at: self.album_updated_at.unwrap_or(0),
                deleted_at: self.album_deleted_at,
                deleted_by: self.album_deleted_by,
                created_by: self.album_created_by,
                updated_by: self.album_updated_by,
            })
        } else {
            None
        };

        // Determine user context fields based on user_id match
        let (is_favorite, rating, favorited_at, rating_created_at) = if let Some(uid) = user_id {
            let is_fav = self.favorite_user_id.as_ref() == Some(&uid.to_string());
            let fav_at = if is_fav { self.favorited_at } else { None };
            let user_rating = if self.rating_user_id.as_ref() == Some(&uid.to_string()) {
                self.user_rating
            } else {
                None
            };
            let rating_at = if user_rating.is_some() {
                self.rating_created_at
            } else {
                None
            };
            (Some(is_fav), user_rating, fav_at, rating_at)
        } else {
            (None, None, None, None)
        };

        // Determine album favorite status based on user_id match
        let album_is_favorite = if let Some(uid) = user_id {
            Some(self.album_favorite_user_id.as_ref() == Some(&uid.to_string()))
        } else {
            None
        };

        // Determine album rating based on user_id match
        let album_rating = if let Some(uid) = user_id {
            if self.album_rating_user_id.as_ref() == Some(&uid.to_string()) {
                self.album_user_rating
            } else {
                None
            }
        } else {
            None
        };

        SongQueryResult {
            song,
            artist,
            album,
            genre: None,
            media_blob: None,
            images,
            relevance_score: None,
            snippet: None,
            is_favorite,
            rating,
            favorited_at,
            rating_created_at,
            artist_total_song_count: self.artist_total_song_count,
            artist_total_album_count: self.artist_total_album_count,
            artist_total_duration: self.artist_total_duration,
            album_is_favorite,
            album_rating,
            album_tags,
        }
    }
}

// Row structures for other views
#[derive(sqlx::FromRow)]
pub struct ArtistViewRow {
    artist_id: String,
    artist_name: String,
    artist_bio: Option<String>,
    artist_created_at: i64,
    artist_updated_at: i64,
    artist_deleted_at: Option<i64>,
    artist_deleted_by: Option<String>,
    artist_created_by: Option<String>,
    artist_updated_by: Option<String>,
    artist_images: Option<String>, // JSON array from view
    song_count: i64,
    album_count: i64,
    total_duration: i64,
    // User context fields from view joins
    favorite_user_id: Option<String>,
    favorited_at: Option<i64>,
    rating_user_id: Option<String>,
    user_rating: Option<i32>,
    rating_created_at: Option<i64>,
}

impl ArtistViewRow {
    pub fn to_artist_query_result(self, user_id: Option<&str>) -> ArtistQueryResult {
        // parse images JSON array
        let images = self
            .artist_images
            .and_then(|json_str| serde_json::from_str::<Vec<ImageMetadata>>(&json_str).ok())
            .or(Some(vec![])); // default to empty vec

        let artist = Artist {
            id: self.artist_id,
            name: self.artist_name,
            bio: self.artist_bio,
            created_at: self.artist_created_at,
            updated_at: self.artist_updated_at,
            deleted_at: self.artist_deleted_at,
            deleted_by: self.artist_deleted_by,
            created_by: self.artist_created_by,
            updated_by: self.artist_updated_by,
            images: images.clone().map(crate::JsonVec),
        };

        // Determine user context fields based on user_id match
        let (is_favorite, rating, favorited_at, rating_created_at) = if let Some(uid) = user_id {
            let is_fav = self.favorite_user_id.as_ref() == Some(&uid.to_string());
            let fav_at = if is_fav { self.favorited_at } else { None };
            let user_rating = if self.rating_user_id.as_ref() == Some(&uid.to_string()) {
                self.user_rating
            } else {
                None
            };
            let rating_at = if user_rating.is_some() {
                self.rating_created_at
            } else {
                None
            };
            (Some(is_fav), user_rating, fav_at, rating_at)
        } else {
            (None, None, None, None)
        };

        ArtistQueryResult {
            artist,
            images,
            song_count: self.song_count,
            album_count: self.album_count,
            total_duration: Some(self.total_duration),
            is_favorite,
            rating,
            favorited_at,
            rating_created_at,
        }
    }
}

#[derive(sqlx::FromRow)]
pub struct AlbumViewRow {
    album_id: String,
    album_title: String,
    album_album_type: Option<String>,
    album_release_date: Option<String>,
    album_release_date_precision: Option<String>,
    album_label: Option<String>,
    album_genre_id: Option<String>,
    album_song_count: Option<i64>,
    album_total_duration: Option<i64>,
    album_created_at: i64,
    album_updated_at: i64,
    album_deleted_at: Option<i64>,
    album_deleted_by: Option<String>,
    album_created_by: Option<String>,
    album_updated_by: Option<String>,
    album_genre_name: Option<String>,
    album_sub_genres: Option<String>, // JSON array from view
    album_images: Option<String>, // JSON array from view
    album_tags: Option<String>,   // JSON array of tag names from view
    artist_id: Option<String>,
    artist_name: Option<String>,
    artist_images: Option<String>, // JSON array from view
    artist_created_at: Option<i64>,
    artist_updated_at: Option<i64>,
    // User context fields from view joins
    #[allow(dead_code)]
    favorite_id: Option<String>,
    favorite_user_id: Option<String>,
    favorited_at: Option<i64>,
    rating_user_id: Option<String>,
    user_rating: Option<i32>,
    rating_created_at: Option<i64>,
}

impl AlbumViewRow {
    pub fn to_album_query_result(self, user_id: Option<&str>) -> AlbumQueryResult {
        // parse images JSON array
        let images = self.album_images.and_then(|json_str| {
            tracing::debug!("parsing album images JSON: {}", json_str);
            match serde_json::from_str::<Vec<ImageMetadata>>(&json_str) {
                Ok(imgs) => {
                    tracing::debug!("successfully parsed {} images", imgs.len());
                    Some(imgs)
                }
                Err(e) => {
                    tracing::warn!(
                        "failed to parse album images JSON: {} - error: {}",
                        json_str,
                        e
                    );
                    None
                }
            }
        })
        .or(Some(vec![])); // default to empty vec

        // parse album_tags JSON array
        let album_tags = self.album_tags.and_then(|json_str| {
            match serde_json::from_str::<Vec<String>>(&json_str) {
                Ok(tags) => Some(tags),
                Err(e) => {
                    tracing::warn!(
                        "failed to parse album tags JSON: {} - error: {}",
                        json_str,
                        e
                    );
                    None
                }
            }
        })
        .or(Some(vec![])); // default to empty vec

        // parse album sub_genres JSON array
        let album_sub_genres = self.album_sub_genres.and_then(|json_str| {
            match serde_json::from_str::<Vec<String>>(&json_str) {
                Ok(sub_genres) => Some(crate::JsonVec(sub_genres)),
                Err(e) => {
                    tracing::warn!(
                        "failed to parse album sub_genres JSON: {} - error: {}",
                        json_str,
                        e
                    );
                    None
                }
            }
        })
        .or(Some(crate::JsonVec(vec![]))); // default to empty vec

        // parse artist images JSON array
        let artist_images = self
            .artist_images
            .and_then(|json_str| serde_json::from_str::<Vec<ImageMetadata>>(&json_str).ok())
            .map(crate::JsonVec);

        let album = Album {
            id: self.album_id,
            title: self.album_title,
            album_type: self.album_album_type.unwrap_or_default(),
            release_date: self.album_release_date,
            release_date_precision: self.album_release_date_precision,
            label: self.album_label,
            genre_id: self.album_genre_id,
            genre: self.album_genre_name,
            sub_genres: album_sub_genres,
            images: images.clone().map(crate::JsonVec),
            song_count: self.album_song_count.unwrap_or(0),
            total_duration: self.album_total_duration.unwrap_or(0),
            created_at: self.album_created_at,
            updated_at: self.album_updated_at,
            deleted_at: self.album_deleted_at,
            deleted_by: self.album_deleted_by,
            created_by: self.album_created_by,
            updated_by: self.album_updated_by,
        };

        let artist = if self.artist_id.is_some() {
            Some(Artist {
                id: self.artist_id.unwrap_or_default(),
                name: self.artist_name.unwrap_or_default(),
                bio: None,
                created_at: self.artist_created_at.unwrap_or(0),
                updated_at: self.artist_updated_at.unwrap_or(0),
                deleted_at: None,
                deleted_by: None,
                created_by: None,
                updated_by: None,
                images: artist_images,
            })
        } else {
            None
        };

        // Determine user context fields based on user_id match
        let (is_favorite, rating, favorited_at, rating_created_at) = if let Some(uid) = user_id {
            let is_fav = self.favorite_user_id.as_ref() == Some(&uid.to_string());
            let fav_at = if is_fav { self.favorited_at } else { None };
            let user_rating = if self.rating_user_id.as_ref() == Some(&uid.to_string()) {
                self.user_rating
            } else {
                None
            };
            let rating_at = if user_rating.is_some() {
                self.rating_created_at
            } else {
                None
            };
            (Some(is_fav), user_rating, fav_at, rating_at)
        } else {
            (None, None, None, None)
        };

        AlbumQueryResult {
            album,
            artist,
            genre: None,
            images,
            album_tags,
            is_favorite,
            rating,
            favorited_at,
            rating_created_at,
        }
    }
}

#[derive(sqlx::FromRow)]
pub struct GenreViewRow {
    genre_id: String,
    genre_name: String,
    genre_created_at: i64,
    // aggregated stats
    song_count: i64,
    album_count: i64,
    // User context fields from view joins (no ratings for genres)
    #[allow(dead_code)]
    favorite_id: Option<String>,
    favorite_user_id: Option<String>,
    favorited_at: Option<i64>,
}

impl GenreViewRow {
    pub fn to_genre_query_result(self, user_id: Option<&str>) -> GenreQueryResult {
        let genre = Genre {
            id: self.genre_id,
            name: self.genre_name,
            created_at: self.genre_created_at,
        };

        // Determine favorite status based on user_id match
        let (is_favorite, favorited_at) = if let Some(uid) = user_id {
            let is_fav = self.favorite_user_id.as_ref() == Some(&uid.to_string());
            let fav_at = if is_fav { self.favorited_at } else { None };
            (Some(is_fav), fav_at)
        } else {
            (None, None)
        };

        GenreQueryResult {
            genre,
            song_count: Some(self.song_count),
            album_count: Some(self.album_count),
            is_favorite,
            favorited_at,
        }
    }
}

// Shared filter logic
fn add_global_filters(
    query: &mut SelectStatement,
    params: &QueryParams,
    song_col: impl Iden + 'static,
    artist_col: impl Iden + 'static,
    album_col: impl Iden + 'static,
) {
    // Search across multiple fields
    if let Some(search_term) = params.q.as_ref().filter(|s| !s.trim().is_empty()) {
        let pattern = format!("%{}%", search_term);
        query.cond_where(
            Cond::any()
                .add(Expr::col(song_col).like(pattern.clone()))
                .add(Expr::col(artist_col).like(pattern.clone()))
                .add(Expr::col(album_col).like(pattern)),
        );
    }

    // Handle ID filters (using proper column names from the view)
    if let Some(artist_id) = params.filters.get("artist_id").and_then(|v| v.as_str()) {
        query.and_where(Expr::col(CommonColumns::ArtistId).eq(artist_id));
    }

    if let Some(album_id) = params.filters.get("album_id").and_then(|v| v.as_str()) {
        query.and_where(Expr::col(CommonColumns::AlbumId).eq(album_id));
    }

    if let Some(genre_id) = params.filters.get("genre_id").and_then(|v| v.as_str()) {
        query.and_where(Expr::col(CommonColumns::AlbumGenreId).eq(genre_id));
    }

    // Handle tag filters (include_tags and exclude_tags)
    // include_tags: show only items that have ANY of these tags (OR logic)
    if let Some(include_tags) = params
        .filters
        .get("include_tags")
        .and_then(|v| v.as_array())
    {
        let tag_names: Vec<String> = include_tags
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();

        if !tag_names.is_empty() {
            // build OR condition - match if ANY tag is present
            let mut or_conditions = Vec::new();
            for tag_name in tag_names {
                let json_pattern = format!("%\"{}\"%", tag_name);
                or_conditions.push(
                    Expr::col(CommonColumns::AlbumTags)
                        .is_not_null()
                        .and(Expr::col(CommonColumns::AlbumTags).like(json_pattern)),
                );
            }
            if !or_conditions.is_empty() {
                let mut cond = Cond::any();
                for condition in or_conditions {
                    cond = cond.add(condition);
                }
                query.cond_where(cond);
            }
        }
    }

    // exclude_tags: show only items that have NONE of these tags (OR logic)
    if let Some(exclude_tags) = params
        .filters
        .get("exclude_tags")
        .and_then(|v| v.as_array())
    {
        let tag_names: Vec<String> = exclude_tags
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();

        if !tag_names.is_empty() {
            // build condition to exclude items with ANY of these tags
            let mut or_conditions = Vec::new();
            for tag_name in tag_names {
                let json_pattern = format!("%\"{}\"%", tag_name);
                or_conditions.push(Expr::col(CommonColumns::AlbumTags).like(json_pattern));
            }
            if !or_conditions.is_empty() {
                let mut has_any_tag = Cond::any();
                for condition in or_conditions {
                    has_any_tag = has_any_tag.add(condition);
                }
                // exclude items that have ANY of the tags: either no tags OR NOT (tagA OR tagB OR ...)
                query.cond_where(
                    Cond::any()
                        .add(Expr::col(CommonColumns::AlbumTags).is_null())
                        .add(Cond::all().add(has_any_tag).not()),
                );
            }
        }
    }
}

// Main query functions
pub async fn query_songs(params: QueryParams) -> GrimoireResponse<QueryResult<SongQueryResult>> {
    let start_time = Instant::now();
    let pool = match database::connect().await {
        Ok(pool) => pool,
        Err(err) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![err.into()])
        }
    };
    let limit = params.limit.unwrap_or(50).min(1000);
    let offset = params.offset.unwrap_or(0);

    let mut query = Query::select();
    query.from(SongView::Table);

    // All user fields are now included in the view, just select everything
    query.column(sea_query::Asterisk);

    // Apply user filters if user context provided
    if let Some(ref user_id) = params.user_id {
        if let Some(true) = params.favorites_only {
            query.and_where(Expr::col((SongView::Table, SongView::FavoriteUserId)).eq(user_id));
        }
        if let Some(min_rating) = params.min_rating {
            query
                .and_where(Expr::col((SongView::Table, SongView::RatingUserId)).eq(user_id))
                .and_where(Expr::col((SongView::Table, SongView::UserRating)).gte(min_rating));
        }
    }

    // Handle song_ids filter (song-specific, not in global filters)
    // supports array of song IDs (can be single or multiple)
    if let Some(song_ids) = params.filters.get("song_ids").and_then(|v| v.as_array()) {
        let ids: Vec<String> = song_ids
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
        if !ids.is_empty() {
            query.and_where(Expr::col(SongView::SongId).is_in(ids));
        }
    }

    add_global_filters(
        &mut query,
        &params,
        SongView::SongTitle,
        SongView::ArtistName,
        SongView::AlbumTitle,
    );

    // Song-specific ordering (always preserve album grouping)
    let sort_direction = match params.sort_direction.as_deref() {
        Some("desc") => Order::Desc,
        _ => Order::Asc,
    };

    match params.sort_by.as_deref() {
        Some("title") => {
            query.order_by(SongView::AlbumTitle, sort_direction);
        }
        Some("album") => {
            query.order_by(SongView::AlbumTitle, sort_direction);
        }
        Some("year") => {
            query.order_by(SongView::AlbumReleaseDate, sort_direction);
            query.order_by(SongView::AlbumTitle, Order::Asc);
        }
        Some("artist") => {
            query.order_by(SongView::ArtistName, sort_direction);
            query.order_by(SongView::AlbumTitle, Order::Asc);
        }
        Some("genre") => {
            query.order_by(SongView::AlbumGenreName, sort_direction);
            query.order_by(SongView::AlbumTitle, Order::Asc);
        }
        Some("duration") => {
            query.order_by(SongView::SongDuration, sort_direction);
            query.order_by(SongView::AlbumTitle, Order::Asc);
        }
        Some("song_id") => {
            query.order_by(SongView::SongId, sort_direction);
        }
        Some("album_duration") => {
            query.order_by(SongView::AlbumTotalDuration, sort_direction);
            query.order_by(SongView::AlbumTitle, Order::Asc);
        }
        Some("album_song_count") => {
            query.order_by(SongView::AlbumSongCount, sort_direction);
            query.order_by(SongView::AlbumTitle, Order::Asc);
        }
        Some("artist_song_count") => {
            query.order_by(SongView::ArtistTotalSongCount, sort_direction);
            query.order_by(SongView::ArtistName, Order::Asc);
        }
        Some("artist_duration") => {
            query.order_by(SongView::ArtistTotalDuration, sort_direction);
            query.order_by(SongView::ArtistName, Order::Asc);
        }
        _ => {
            query.order_by(SongView::AlbumCreatedAt, Order::Desc);
            query.order_by(SongView::AlbumTitle, Order::Asc);
        }
    }

    // Always preserve track order within albums
    query
        .order_by(SongView::SongDiscNumber, Order::Asc)
        .order_by(SongView::SongTrackNumber, Order::Asc);

    query.limit(limit as u64).offset(offset as u64);

    let (sql, values) = query.build(SqliteQueryBuilder);
    tracing::info!("query_songs SQL: {}", sql);
    tracing::debug!("query_songs values: {:?}", values);

    let mut sqlx_query = sqlx::query_as::<_, SongViewRow>(&sql);
    for value in values.0 {
        match value {
            sea_query::Value::String(Some(s)) => {
                sqlx_query = sqlx_query.bind(s.to_string());
            }
            sea_query::Value::Int(Some(i)) => {
                sqlx_query = sqlx_query.bind(i);
            }
            sea_query::Value::BigUnsigned(Some(u)) => {
                sqlx_query = sqlx_query.bind(u as i64);
            }
            _ => {
                return GrimoireResponse::failure(
                    "Unsupported parameter type in query",
                    vec![crate::error::GrimoireError::Database(sqlx::Error::Protocol(
                        "Unsupported parameter type in query".to_string(),
                    ))
                    .into()],
                );
            }
        }
    }

    let rows = match sqlx_query.fetch_all(&pool).await {
        Ok(rows) => rows,
        Err(err) => {
            tracing::error!("query_songs fetch error: {:?}", err);
            tracing::error!("query_songs SQL was: {}", sql);
            return GrimoireResponse::failure("Failed to query songs", vec![err.into()]);
        }
    };

    let user_id_ref = params.user_id.as_ref().map(|uid| uid.as_str());
    let songs: Vec<SongQueryResult> = rows
        .into_iter()
        .map(|r| r.to_song_query_result(user_id_ref))
        .collect();
    let song_count = songs.len();

    GrimoireResponse::success(
        format!("Found {} song(s)", song_count),
        QueryResult {
            items: songs,
            total_count: song_count as i64,
            has_more: song_count == limit as usize,
            limit: limit as i64,
            offset: offset as i64,
            query_time_ms: Some(start_time.elapsed().as_millis() as u64),
        },
    )
}

pub async fn query_albums(params: QueryParams) -> GrimoireResponse<QueryResult<AlbumQueryResult>> {
    let start_time = Instant::now();
    let pool = match database::connect().await {
        Ok(pool) => pool,
        Err(err) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![err.into()])
        }
    };
    let limit = params.limit.unwrap_or(50).min(1000);
    let offset = params.offset.unwrap_or(0);

    let mut query = Query::select();
    query.column(sea_query::Asterisk).from(AlbumView::Table);

    add_global_filters(
        &mut query,
        &params,
        AlbumView::AlbumTitle,
        AlbumView::ArtistName,
        AlbumView::AlbumTitle,
    );

    let sort_direction = match params.sort_direction.as_deref() {
        Some("desc") => Order::Desc,
        _ => Order::Asc,
    };

    match params.sort_by.as_deref() {
        Some("title") => {
            query.order_by(AlbumView::AlbumTitle, sort_direction);
        }
        Some("artist") => {
            query.order_by(AlbumView::ArtistName, sort_direction);
        }
        Some("release_date") => {
            query.order_by(AlbumView::AlbumReleaseDate, sort_direction);
        }
        Some("duration") => {
            query.order_by(AlbumView::AlbumTotalDuration, sort_direction);
        }
        Some("song_count") => {
            query.order_by(AlbumView::AlbumSongCount, sort_direction);
        }
        _ => {
            query.order_by(AlbumView::AlbumCreatedAt, Order::Desc);
        }
    }

    query.limit(limit as u64).offset(offset as u64);

    let (sql, values) = query.build(SqliteQueryBuilder);

    let mut sqlx_query = sqlx::query_as::<_, AlbumViewRow>(&sql);
    for value in values.0 {
        match value {
            sea_query::Value::String(Some(s)) => {
                sqlx_query = sqlx_query.bind(s.as_ref().to_string());
            }
            sea_query::Value::BigInt(Some(i)) => {
                sqlx_query = sqlx_query.bind(i);
            }
            sea_query::Value::BigUnsigned(Some(i)) => {
                sqlx_query = sqlx_query.bind(i as i64);
            }
            _ => {}
        }
    }

    let rows = match sqlx_query.fetch_all(&pool).await {
        Ok(rows) => rows,
        Err(err) => return GrimoireResponse::failure("Failed to query albums", vec![err.into()]),
    };

    let user_id_ref = params.user_id.as_ref().map(|uid| uid.as_str());
    let albums: Vec<AlbumQueryResult> = rows
        .into_iter()
        .map(|r| r.to_album_query_result(user_id_ref))
        .collect();
    let album_count = albums.len();

    GrimoireResponse::success(
        format!("Found {} album(s)", album_count),
        QueryResult {
            items: albums,
            total_count: album_count as i64,
            has_more: album_count == limit as usize,
            limit: limit as i64,
            offset: offset as i64,
            query_time_ms: Some(start_time.elapsed().as_millis() as u64),
        },
    )
}

pub async fn query_artists(
    params: QueryParams,
) -> GrimoireResponse<QueryResult<ArtistQueryResult>> {
    let start_time = Instant::now();
    let pool = match database::connect().await {
        Ok(pool) => pool,
        Err(err) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![err.into()])
        }
    };
    let limit = params.limit.unwrap_or(50).min(1000);
    let offset = params.offset.unwrap_or(0);

    let mut query = Query::select();
    query.column(sea_query::Asterisk).from(ArtistView::Table);

    // Artist-specific search filter (search name and bio)
    if let Some(search_term) = params.q.as_ref().filter(|s| !s.trim().is_empty()) {
        let pattern = format!("%{}%", search_term);
        query.cond_where(
            Cond::any()
                .add(Expr::col(ArtistView::ArtistName).like(pattern.clone()))
                .add(Expr::col(ArtistView::ArtistBio).like(pattern)),
        );
    }

    // Handle artist_id filter for querying specific artist
    if let Some(artist_id) = params.filters.get("artist_id").and_then(|v| v.as_str()) {
        query.and_where(Expr::col(ArtistView::ArtistId).eq(artist_id));
    }

    // Handle starts_with filter for artists
    if let Some(starts_with) = params.filters.get("starts_with").and_then(|v| v.as_str()) {
        if starts_with == "#" {
            // Non-alphabetic characters
            query.and_where(Expr::cust(
                "SUBSTR(UPPER(artist_name), 1, 1) NOT BETWEEN 'A' AND 'Z'",
            ));
        } else {
            // Artists starting with specific letter
            let starts_pattern = format!("{}%", starts_with.to_uppercase());
            query.and_where(Expr::col(ArtistView::ArtistName).like(starts_pattern));
        }
    }

    let sort_direction = match params.sort_direction.as_deref() {
        Some("desc") => Order::Desc,
        _ => Order::Asc,
    };

    match params.sort_by.as_deref() {
        Some("name") => {
            query.order_by(ArtistView::ArtistName, sort_direction);
        }
        Some("song_count") => {
            query.order_by(ArtistView::SongCount, sort_direction);
        }
        Some("album_count") => {
            query.order_by(ArtistView::AlbumCount, sort_direction);
        }
        Some("duration") => {
            query.order_by(ArtistView::TotalDuration, sort_direction);
        }
        Some("created_at") => {
            query.order_by(ArtistView::ArtistCreatedAt, sort_direction);
        }
        _ => {
            query.order_by(ArtistView::ArtistName, Order::Asc);
        }
    }

    query.limit(limit as u64).offset(offset as u64);

    let (sql, values) = query.build(SqliteQueryBuilder);
    tracing::info!("query_artists SQL: {}", sql);
    tracing::debug!("query_artists values: {:?}", values);

    let mut sqlx_query = sqlx::query_as::<_, ArtistViewRow>(&sql);
    for value in values.0 {
        match value {
            sea_query::Value::String(Some(s)) => {
                sqlx_query = sqlx_query.bind(s.as_ref().to_string());
            }
            sea_query::Value::BigInt(Some(i)) => {
                sqlx_query = sqlx_query.bind(i);
            }
            sea_query::Value::BigUnsigned(Some(i)) => {
                sqlx_query = sqlx_query.bind(i as i64);
            }
            _ => {}
        }
    }

    let rows = match sqlx_query.fetch_all(&pool).await {
        Ok(rows) => rows,
        Err(err) => {
            tracing::error!("query_artists fetch error: {:?}", err);
            tracing::error!("query_artists SQL was: {}", sql);
            return GrimoireResponse::failure("Failed to query artists", vec![err.into()]);
        }
    };

    let user_id_ref = params.user_id.as_ref().map(|uid| uid.as_str());
    let artists: Vec<ArtistQueryResult> = rows
        .into_iter()
        .map(|r| r.to_artist_query_result(user_id_ref))
        .collect();
    let artist_count = artists.len();

    GrimoireResponse::success(
        format!("Found {} artist(s)", artist_count),
        QueryResult {
            items: artists,
            total_count: artist_count as i64,
            has_more: artist_count == limit as usize,
            limit: limit as i64,
            offset: offset as i64,
            query_time_ms: Some(start_time.elapsed().as_millis() as u64),
        },
    )
}

pub async fn query_genres(params: QueryParams) -> GrimoireResponse<QueryResult<GenreQueryResult>> {
    let start_time = Instant::now();
    let pool = match database::connect().await {
        Ok(pool) => pool,
        Err(err) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![err.into()])
        }
    };
    let limit = params.limit.unwrap_or(50).min(1000);
    let offset = params.offset.unwrap_or(0);

    let mut query = Query::select();
    query.column(sea_query::Asterisk).from(GenreView::Table);

    // Genre-specific search filter
    if let Some(search_term) = params.q.as_ref().filter(|s| !s.trim().is_empty()) {
        let pattern = format!("%{}%", search_term);
        query.cond_where(Expr::col(GenreView::GenreName).like(pattern));
    }

    let sort_direction = match params.sort_direction.as_deref() {
        Some("desc") => Order::Desc,
        _ => Order::Asc,
    };

    match params.sort_by.as_deref() {
        Some("name") => {
            query.order_by(GenreView::GenreName, sort_direction);
        }
        Some("created_at") => {
            query.order_by(GenreView::GenreCreatedAt, sort_direction);
        }
        _ => {
            query.order_by(GenreView::GenreName, Order::Asc);
        }
    }

    query.limit(limit as u64).offset(offset as u64);

    let (sql, values) = query.build(SqliteQueryBuilder);

    let mut sqlx_query = sqlx::query_as::<_, GenreViewRow>(&sql);
    for value in values.0 {
        match value {
            sea_query::Value::String(Some(s)) => {
                sqlx_query = sqlx_query.bind(s.as_ref().to_string());
            }
            sea_query::Value::BigInt(Some(i)) => {
                sqlx_query = sqlx_query.bind(i);
            }
            sea_query::Value::BigUnsigned(Some(i)) => {
                sqlx_query = sqlx_query.bind(i as i64);
            }
            _ => {}
        }
    }

    let rows = match sqlx_query.fetch_all(&pool).await {
        Ok(rows) => rows,
        Err(err) => return GrimoireResponse::failure("Failed to query genres", vec![err.into()]),
    };

    let user_id_ref = params.user_id.as_ref().map(|uid| uid.as_str());
    let genres: Vec<GenreQueryResult> = rows
        .into_iter()
        .map(|r| r.to_genre_query_result(user_id_ref))
        .collect();
    let genre_count = genres.len();

    GrimoireResponse::success(
        format!("Found {} genre(s)", genre_count),
        QueryResult {
            items: genres,
            total_count: genre_count as i64,
            has_more: genre_count == limit as usize,
            limit: limit as i64,
            offset: offset as i64,
            query_time_ms: Some(start_time.elapsed().as_millis() as u64),
        },
    )
}

// Legacy compatibility functions (temporary)
pub async fn list_recent_songs(
    limit: Option<u32>,
) -> GrimoireResponse<QueryResult<SongQueryResult>> {
    let params = QueryParams {
        q: None,
        search_fields: None,
        filters: std::collections::HashMap::new(),
        sort_by: Some("created_at".to_string()),
        sort_direction: Some("desc".to_string()),
        limit,
        offset: Some(0),
        user_id: None,
        favorites_only: None,
        min_rating: None,
    };
    query_songs(params).await
}

pub async fn search_songs(
    q: &str,
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResponse<QueryResult<SongQueryResult>> {
    let params = QueryParams {
        q: Some(q.to_string()),
        search_fields: None,
        filters: std::collections::HashMap::new(),
        sort_by: Some("created_at".to_string()),
        sort_direction: Some("desc".to_string()),
        limit,
        offset,
        user_id: None,
        favorites_only: None,
        min_rating: None,
    };
    query_songs(params).await
}

pub async fn list_songs_by_artist(
    artist_id: &str,
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResponse<QueryResult<SongQueryResult>> {
    let mut filters = std::collections::HashMap::new();
    filters.insert(
        "artist_id".to_string(),
        serde_json::Value::String(artist_id.to_string()),
    );

    let params = QueryParams {
        q: None,
        search_fields: None,
        filters,
        sort_by: Some("album".to_string()),
        sort_direction: Some("asc".to_string()),
        limit,
        offset,
        user_id: None,
        favorites_only: None,
        min_rating: None,
    };
    query_songs(params).await
}

pub async fn list_songs_by_album(
    album_id: &str,
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResponse<QueryResult<SongQueryResult>> {
    let mut filters = std::collections::HashMap::new();
    filters.insert(
        "album_id".to_string(),
        serde_json::Value::String(album_id.to_string()),
    );

    let params = QueryParams {
        q: None,
        search_fields: None,
        filters,
        sort_by: Some("track_number".to_string()),
        sort_direction: Some("asc".to_string()),
        limit,
        offset,
        user_id: None,
        favorites_only: None,
        min_rating: None,
    };
    query_songs(params).await
}

pub async fn list_songs_by_genre(
    genre_id: &str,
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResponse<QueryResult<SongQueryResult>> {
    let mut filters = std::collections::HashMap::new();
    filters.insert(
        "genre_id".to_string(),
        serde_json::Value::String(genre_id.to_string()),
    );

    let params = QueryParams {
        q: None,
        search_fields: None,
        filters,
        sort_by: Some("album".to_string()),
        sort_direction: Some("asc".to_string()),
        limit,
        offset,
        user_id: None,
        favorites_only: None,
        min_rating: None,
    };
    query_songs(params).await
}

pub async fn list_albums_by_artist(
    artist_id: &str,
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResponse<QueryResult<AlbumQueryResult>> {
    let mut filters = std::collections::HashMap::new();
    filters.insert(
        "artist_id".to_string(),
        serde_json::Value::String(artist_id.to_string()),
    );

    let params = QueryParams {
        q: None,
        search_fields: None,
        filters,
        sort_by: Some("release_date".to_string()),
        sort_direction: Some("desc".to_string()),
        limit,
        offset,
        user_id: None,
        favorites_only: None,
        min_rating: None,
    };
    query_albums(params).await
}
