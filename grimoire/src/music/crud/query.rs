//! Unified query system with shared filters for songs, albums, artists, genres

use sea_query::{Cond, Expr, Iden, Order, Query, SelectStatement, SqliteQueryBuilder};
use std::time::Instant;

use super::user_prefs;
use crate::database;

use crate::media_blobz::{BlobType, MediaBlob};
use crate::music::crud::models::{
    AlbumQueryResult, AlbumStatusCounts, ArtistQueryResult, EntityUrl, ImageMetadata, QueryParams,
    QueryResult, SongQueryResult,
};
use crate::music::entities::{albums::Album, albums::GenreRef, artists::Artist, songs::Song};
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
    #[iden = "song_play_count"]
    SongPlayCount,
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
    #[iden = "album_mb_lookup_status"]
    AlbumMbLookupStatus,
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
enum CommonColumns {
    #[iden = "artist_id"]
    ArtistId,
    #[iden = "artist_name"]
    ArtistName,
    #[iden = "album_id"]
    AlbumId,
    #[iden = "album_genres"]
    AlbumGenres,
    #[iden = "album_tags"]
    AlbumTags,
    #[iden = "album_taxons"]
    AlbumTaxons,
}

// Row structures
#[derive(sqlx::FromRow)]
pub struct SongViewRow {
    song_id: String,
    song_media_blob_id: String,
    // media blob fields for P2P verified streaming
    media_blob_sha256: Option<String>,
    media_blob_blake3: Option<String>,
    media_blob_mime: Option<String>,
    // size in bytes (used by clients to render accurate download progress)
    media_blob_size: Option<i64>,
    song_images: Option<String>, // JSON array from view
    song_urls: Option<String>,   // JSON array of entity URLs from view
    song_title: String,
    song_track_number: i64,
    song_disc_number: i64,
    song_duration: Option<i64>,
    song_bpm: Option<i64>,
    song_track_artist: Option<String>,
    song_metadata: Option<String>,
    song_lyrics: Option<String>,
    song_created_at: i64,
    song_updated_at: i64,
    song_deleted_at: Option<i64>,
    song_deleted_by: Option<String>,
    song_created_by: Option<String>,
    song_updated_by: Option<String>,
    song_created_by_username: Option<String>,
    song_updated_by_username: Option<String>,
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
    album_label: Option<String>,
    album_song_count: Option<i64>,
    album_total_duration: Option<i64>,
    album_created_at: Option<i64>,
    album_updated_at: Option<i64>,
    album_deleted_at: Option<i64>,
    album_deleted_by: Option<String>,
    album_created_by: Option<String>,
    album_updated_by: Option<String>,
    album_genres: Option<String>, // JSON array of {id, name} objects from view
    album_taxons: Option<String>, // JSON array of {id, kind_slug, label, ...} from view
    album_tags: Option<String>,   // JSON array of tag names from view
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
    // Aggregated play count from music_play_eventz (via view)
    song_play_count: Option<i64>,
}

impl SongViewRow {
    pub fn to_song_query_result(self, user_id: Option<&str>) -> SongQueryResult {
        // parse images JSON array
        let images = self
            .song_images
            .and_then(|json_str| serde_json::from_str::<Vec<ImageMetadata>>(&json_str).ok())
            .or(Some(vec![])); // default to empty vec if None or parse fails

        // parse song URLs JSON array
        let song_urls = self
            .song_urls
            .and_then(|json_str| serde_json::from_str::<Vec<EntityUrl>>(&json_str).ok())
            .map(crate::JsonVec);

        // parse album tags JSON array
        let album_tags = self
            .album_tags
            .and_then(|json_str| serde_json::from_str::<Vec<String>>(&json_str).ok())
            .or(Some(vec![])); // default to empty vec

        // parse album genres JSON array (now array of {id, name} objects)
        let album_genres = self
            .album_genres
            .and_then(|json_str| serde_json::from_str::<Vec<GenreRef>>(&json_str).ok())
            .map(crate::JsonVec);

        // parse album taxons JSON array (cross-kind labels)
        let album_taxons = self
            .album_taxons
            .and_then(|json_str| {
                serde_json::from_str::<Vec<crate::music::entities::taxonomy::TaxonRef>>(&json_str)
                    .ok()
            })
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

        // clone media_blob_id before it's moved into song
        let media_blob_id = self.song_media_blob_id.clone();

        let song = Song {
            id: self.song_id,
            media_blob_id: self.song_media_blob_id,
            images: images.clone().map(crate::JsonVec),
            urls: song_urls,
            title: self.song_title,
            track_number: self.song_track_number,
            disc_number: self.song_disc_number,
            duration: self.song_duration,
            bpm: self.song_bpm,
            track_artist: self.song_track_artist,
            metadata: self.song_metadata,
            lyrics: self.song_lyrics,
            created_at: self.song_created_at,
            updated_at: self.song_updated_at,
            deleted_at: self.song_deleted_at,
            deleted_by: self.song_deleted_by,
            created_by: self.song_created_by,
            updated_by: self.song_updated_by,
            created_by_username: self.song_created_by_username,
            updated_by_username: self.song_updated_by_username,
            play_count: self.song_play_count,
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
                urls: None,
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
                label: self.album_label,
                genres: album_genres,
                taxons: album_taxons,
                images: album_images,
                urls: None,
                song_count: self.album_song_count.unwrap_or(0),
                total_duration: self.album_total_duration.unwrap_or(0),
                created_at: self.album_created_at.unwrap_or(0),
                updated_at: self.album_updated_at.unwrap_or(0),
                deleted_at: self.album_deleted_at,
                deleted_by: self.album_deleted_by,
                created_by: self.album_created_by,
                updated_by: self.album_updated_by,
                created_by_username: None,
                updated_by_username: None,
                metadata: None,
                mb_lookup_status: None,
                mb_lookup_at: None,
                mb_lookup_by: None,
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

        // construct media_blob from view fields (for P2P verified streaming)
        let media_blob = self.media_blob_sha256.map(|sha256| MediaBlob {
            id: media_blob_id.clone(),
            sha256,
            size: self.media_blob_size,
            mime: self.media_blob_mime,
            source_client_id: None,
            local_path: None,
            filename: None,
            parent_blob_id: None,
            blob_type: BlobType::Original,
            metadata: serde_json::Value::Null,
            created_at: 0,
            updated_at: 0,
            deleted_at: None,
            deleted_by: None,
            created_by: None,
            updated_by: None,
            width: None,
            height: None,
            blake3: self.media_blob_blake3,
        });

        SongQueryResult {
            song,
            artist,
            album,
            genre: None,
            media_blob,
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
    artist_urls: Option<String>,   // JSON array of entity URLs from view
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

        // parse URLs JSON array
        let urls = self
            .artist_urls
            .and_then(|json_str| serde_json::from_str::<Vec<EntityUrl>>(&json_str).ok())
            .map(crate::JsonVec);

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
            urls,
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
    album_label: Option<String>,
    album_song_count: Option<i64>,
    album_total_duration: Option<i64>,
    album_created_at: i64,
    album_updated_at: i64,
    album_deleted_at: Option<i64>,
    album_deleted_by: Option<String>,
    album_created_by: Option<String>,
    album_updated_by: Option<String>,
    album_created_by_username: Option<String>,
    album_updated_by_username: Option<String>,
    album_genres: Option<String>, // JSON array of {id, name} objects from view
    album_taxons: Option<String>, // JSON array of {id, kind_slug, label, ...} from view
    album_images: Option<String>, // JSON array from view
    album_tags: Option<String>,   // JSON array of tag names from view
    album_urls: Option<String>,   // JSON array of entity URLs from view
    album_metadata: Option<String>, // raw json blob (parse via albums::metadata)
    album_mb_lookup_status: Option<String>,
    album_mb_lookup_at: Option<i64>,
    album_mb_lookup_by: Option<String>,
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
        let images = self
            .album_images
            .and_then(|json_str| {
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
        let album_tags = self
            .album_tags
            .and_then(
                |json_str| match serde_json::from_str::<Vec<String>>(&json_str) {
                    Ok(tags) => Some(tags),
                    Err(e) => {
                        tracing::warn!(
                            "failed to parse album tags JSON: {} - error: {}",
                            json_str,
                            e
                        );
                        None
                    }
                },
            )
            .or(Some(vec![])); // default to empty vec

        // parse album genres JSON array (now array of {id, name} objects)
        let album_genres = self.album_genres.and_then(|json_str| {
            match serde_json::from_str::<Vec<GenreRef>>(&json_str) {
                Ok(genres) => Some(crate::JsonVec(genres)),
                Err(e) => {
                    tracing::warn!(
                        "failed to parse album genres JSON: {} - error: {}",
                        json_str,
                        e
                    );
                    None
                }
            }
        });

        // parse album taxons JSON array (cross-kind labels)
        let album_taxons = self.album_taxons.and_then(|json_str| {
            match serde_json::from_str::<Vec<crate::music::entities::taxonomy::TaxonRef>>(&json_str)
            {
                Ok(taxons) => Some(crate::JsonVec(taxons)),
                Err(e) => {
                    tracing::warn!(
                        "failed to parse album taxons JSON: {} - error: {}",
                        json_str,
                        e
                    );
                    None
                }
            }
        });

        // parse artist images JSON array
        let artist_images = self
            .artist_images
            .and_then(|json_str| serde_json::from_str::<Vec<ImageMetadata>>(&json_str).ok())
            .map(crate::JsonVec);

        // parse album URLs JSON array
        let album_urls = self
            .album_urls
            .and_then(|json_str| serde_json::from_str::<Vec<EntityUrl>>(&json_str).ok())
            .map(crate::JsonVec);

        let album = Album {
            id: self.album_id,
            title: self.album_title,
            album_type: self.album_album_type.unwrap_or_default(),
            release_date: self.album_release_date,
            label: self.album_label,
            genres: album_genres,
            taxons: album_taxons,
            images: images.clone().map(crate::JsonVec),
            urls: album_urls,
            song_count: self.album_song_count.unwrap_or(0),
            total_duration: self.album_total_duration.unwrap_or(0),
            created_at: self.album_created_at,
            updated_at: self.album_updated_at,
            deleted_at: self.album_deleted_at,
            deleted_by: self.album_deleted_by,
            created_by: self.album_created_by,
            updated_by: self.album_updated_by,
            created_by_username: self.album_created_by_username,
            updated_by_username: self.album_updated_by_username,
            metadata: self.album_metadata,
            mb_lookup_status: self.album_mb_lookup_status,
            mb_lookup_at: self.album_mb_lookup_at,
            mb_lookup_by: self.album_mb_lookup_by,
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
                urls: None,
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

    // Batch variant of artist_id: artist_ids = [..]. used by the graph
    // viz artist-walk expansion to fetch albums for many related artists
    // in one request rather than N (phase 3, 2026-05-26). silently
    // ignores non-string entries; empty array is a no-op (no filter
    // added, matches existing artist_id behaviour when absent).
    if let Some(artist_ids) = params.filters.get("artist_ids").and_then(|v| v.as_array()) {
        let ids: Vec<String> = artist_ids
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
        if !ids.is_empty() {
            query.and_where(Expr::col(CommonColumns::ArtistId).is_in(ids));
        }
    }

    // Name-based batch filter for cross-remote lookups, where artist_ids
    // are remote-local and not shared. matches on `artist_name` from the
    // album view exactly (case-sensitive — clients should normalize
    // beforehand if they want a slug match). silently ignores
    // non-string entries; empty array is a no-op.
    if let Some(artist_names) = params
        .filters
        .get("artist_names")
        .and_then(|v| v.as_array())
    {
        let names: Vec<String> = artist_names
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
        if !names.is_empty() {
            query.and_where(Expr::col(CommonColumns::ArtistName).is_in(names));
        }
    }

    if let Some(album_id) = params.filters.get("album_id").and_then(|v| v.as_str()) {
        query.and_where(Expr::col(CommonColumns::AlbumId).eq(album_id));
    }

    if let Some(genre_name) = params.filters.get("genre").and_then(|v| v.as_str()) {
        // filter by genre name in the JSON array
        let json_pattern = format!("%\"{}\"%", genre_name);
        query.and_where(
            Expr::col(CommonColumns::AlbumGenres)
                .is_not_null()
                .and(Expr::col(CommonColumns::AlbumGenres).like(json_pattern)),
        );
    }

    if let Some(genre_id) = params.filters.get("genre_id").and_then(|v| v.as_str()) {
        // filter by genre ID in the album_genres JSON array of {id, name} objects
        // search for "id":"<genre_id>" pattern within the JSON
        let json_pattern = format!("%\"id\":\"{}\"%", genre_id);
        query.and_where(
            Expr::col(CommonColumns::AlbumGenres)
                .is_not_null()
                .and(Expr::col(CommonColumns::AlbumGenres).like(json_pattern)),
        );
    }

    // taxon_id: singular convenience — delegates to the array path.
    if let Some(tid) = params.filters.get("taxon_id").and_then(|v| v.as_str()) {
        let json_pattern = format!("%\"id\":\"{}\"%", tid);
        query.and_where(
            Expr::col(CommonColumns::AlbumTaxons)
                .is_not_null()
                .and(Expr::col(CommonColumns::AlbumTaxons).like(json_pattern)),
        );
    }

    // taxon_ids: album must have at least one matching taxon (OR logic).
    if let Some(taxon_ids) = params.filters.get("taxon_ids").and_then(|v| v.as_array()) {
        let ids: Vec<String> = taxon_ids
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
        if !ids.is_empty() {
            let mut cond = Cond::any();
            for id in ids {
                let json_pattern = format!("%\"id\":\"{}\"%", id);
                cond = cond.add(
                    Expr::col(CommonColumns::AlbumTaxons)
                        .is_not_null()
                        .and(Expr::col(CommonColumns::AlbumTaxons).like(json_pattern)),
                );
            }
            query.cond_where(cond);
        }
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
        Some("play_count") => {
            query.order_by(SongView::SongPlayCount, sort_direction);
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
    let mut songs: Vec<SongQueryResult> = rows
        .into_iter()
        .map(|r| r.to_song_query_result(user_id_ref))
        .collect();

    // apply user favorites and ratings if user_id provided
    if let Some(uid) = &params.user_id {
        user_prefs::apply_user_preferences_songs(&mut songs, uid).await;
    }

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

    // ── count query (same WHERE, no LIMIT/OFFSET) — gives real total_count ──
    let mut count_q = Query::select();
    count_q.expr(Expr::cust("COUNT(*)")).from(AlbumView::Table);
    add_global_filters(
        &mut count_q,
        &params,
        AlbumView::AlbumTitle,
        AlbumView::ArtistName,
        AlbumView::AlbumTitle,
    );
    if let Some(ref statuses) = params.mb_lookup_status {
        if !statuses.is_empty() {
            count_q.and_where(Expr::col(AlbumView::AlbumMbLookupStatus).is_in(statuses.clone()));
        }
    }
    let (count_sql, count_values) = count_q.build(SqliteQueryBuilder);
    let mut count_sqlx = sqlx::query_scalar::<_, i64>(&count_sql);
    for v in count_values.0 {
        match v {
            sea_query::Value::String(Some(s)) => {
                count_sqlx = count_sqlx.bind(s.as_ref().to_string());
            }
            sea_query::Value::BigInt(Some(i)) => {
                count_sqlx = count_sqlx.bind(i);
            }
            sea_query::Value::BigUnsigned(Some(i)) => {
                count_sqlx = count_sqlx.bind(i as i64);
            }
            _ => {}
        }
    }
    let total_count = count_sqlx.fetch_one(&pool).await.unwrap_or(0);

    // ── data query ————————————————————————————————————————————
    let mut query = Query::select();
    query.column(sea_query::Asterisk).from(AlbumView::Table);

    add_global_filters(
        &mut query,
        &params,
        AlbumView::AlbumTitle,
        AlbumView::ArtistName,
        AlbumView::AlbumTitle,
    );

    // server-side mb_lookup_status filter (replaces client-side filtering)
    if let Some(ref statuses) = params.mb_lookup_status {
        if !statuses.is_empty() {
            query.and_where(Expr::col(AlbumView::AlbumMbLookupStatus).is_in(statuses.clone()));
        }
    }

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
        Some("release_date") | Some("year") => {
            query.order_by(AlbumView::AlbumReleaseDate, sort_direction);
        }
        Some("duration") => {
            query.order_by(AlbumView::AlbumTotalDuration, sort_direction);
        }
        Some("song_count") => {
            query.order_by(AlbumView::AlbumSongCount, sort_direction);
        }
        _ => {
            // default ("added_at" or unknown) sorts by created_at and
            // honors sort_direction (defaults to desc upstream)
            let dir = match params.sort_direction.as_deref() {
                Some("asc") => Order::Asc,
                _ => Order::Desc,
            };
            query.order_by(AlbumView::AlbumCreatedAt, dir);
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
        Err(err) => {
            tracing::error!("query_albums fetch error: {}", err);
            return GrimoireResponse::failure("Failed to query albums", vec![err.into()]);
        }
    };

    let user_id_ref = params.user_id.as_ref().map(|uid| uid.as_str());
    let mut albums: Vec<AlbumQueryResult> = rows
        .into_iter()
        .map(|r| r.to_album_query_result(user_id_ref))
        .collect();

    // apply user favorites and ratings if user_id provided
    if let Some(uid) = &params.user_id {
        user_prefs::apply_user_preferences_albums(&mut albums, uid).await;
    }

    let album_count = albums.len();

    GrimoireResponse::success(
        format!("Found {} album(s)", album_count),
        QueryResult {
            items: albums,
            total_count,
            has_more: (offset as i64 + album_count as i64) < total_count,
            limit: limit as i64,
            offset: offset as i64,
            query_time_ms: Some(start_time.elapsed().as_millis() as u64),
        },
    )
}

/// returns per-status album counts for the current library/filter context.
/// intentionally does NOT apply the `mb_lookup_status` filter itself —
/// the counts tell the client how many albums each filter chip would return.
pub async fn query_album_status_counts(params: QueryParams) -> GrimoireResponse<AlbumStatusCounts> {
    let pool = match database::connect().await {
        Ok(pool) => pool,
        Err(err) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![err.into()])
        }
    };

    // build base WHERE (same global filters as query_albums, minus status filter)
    let mut base_q = Query::select();
    base_q
        .column(AlbumView::AlbumMbLookupStatus)
        .from(AlbumView::Table);
    add_global_filters(
        &mut base_q,
        &params,
        AlbumView::AlbumTitle,
        AlbumView::ArtistName,
        AlbumView::AlbumTitle,
    );
    let (base_sql, base_values) = base_q.build(SqliteQueryBuilder);

    // status counts: GROUP BY on the base subquery
    let counts_sql = format!(
        "SELECT COALESCE(album_mb_lookup_status, 'not_attempted') AS s, COUNT(*) AS n \
         FROM ({}) AS __t GROUP BY s",
        base_sql
    );
    let total_sql = format!("SELECT COUNT(*) FROM ({}) AS __t", base_sql);

    // helper: bind sea_query values to a generic sqlx query string
    // we need to bind the same values twice so clone the Vec
    let bind_vals: Vec<sea_query::Value> = base_values.0;

    // total count
    let mut total_q = sqlx::query_scalar::<_, i64>(&total_sql);
    for v in &bind_vals {
        match v {
            sea_query::Value::String(Some(s)) => {
                total_q = total_q.bind(s.as_ref().to_string());
            }
            sea_query::Value::BigInt(Some(i)) => {
                total_q = total_q.bind(*i);
            }
            sea_query::Value::BigUnsigned(Some(i)) => {
                total_q = total_q.bind(*i as i64);
            }
            _ => {}
        }
    }
    let total = total_q.fetch_one(&pool).await.unwrap_or(0);

    // per-status counts
    #[derive(sqlx::FromRow)]
    struct StatusCount {
        s: String,
        n: i64,
    }
    let mut counts_q = sqlx::query_as::<_, StatusCount>(&counts_sql);
    for v in &bind_vals {
        match v {
            sea_query::Value::String(Some(s)) => {
                counts_q = counts_q.bind(s.as_ref().to_string());
            }
            sea_query::Value::BigInt(Some(i)) => {
                counts_q = counts_q.bind(*i);
            }
            sea_query::Value::BigUnsigned(Some(i)) => {
                counts_q = counts_q.bind(*i as i64);
            }
            _ => {}
        }
    }
    let rows = counts_q.fetch_all(&pool).await.unwrap_or_default();
    let by_status: std::collections::HashMap<String, i64> =
        rows.into_iter().map(|r| (r.s, r.n)).collect();

    GrimoireResponse::success(
        "album status counts".to_string(),
        AlbumStatusCounts { total, by_status },
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

    // Batch variant: artist_ids = [..]. used by the graph viz
    // artist-walk expansion to load multiple artist payloads in one
    // request (phase 3, 2026-05-26).
    if let Some(artist_ids) = params.filters.get("artist_ids").and_then(|v| v.as_array()) {
        let ids: Vec<String> = artist_ids
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
        if !ids.is_empty() {
            query.and_where(Expr::col(ArtistView::ArtistId).is_in(ids));
        }
    }

    // Name-based batch filter for cross-remote lookups, where artist_ids
    // are remote-local and not shared. matches on artist_name exactly
    // (case-sensitive — clients should normalize beforehand if they
    // want a slug match). silently ignores non-string entries; empty
    // array is a no-op.
    if let Some(artist_names) = params
        .filters
        .get("artist_names")
        .and_then(|v| v.as_array())
    {
        let names: Vec<String> = artist_names
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
        if !names.is_empty() {
            query.and_where(Expr::col(ArtistView::ArtistName).is_in(names));
        }
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
    let mut artists: Vec<ArtistQueryResult> = rows
        .into_iter()
        .map(|r| r.to_artist_query_result(user_id_ref))
        .collect();

    // apply user favorites and ratings if user_id provided
    if let Some(uid) = &params.user_id {
        user_prefs::apply_user_preferences_artists(&mut artists, uid).await;
    }

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
        mb_lookup_status: None,
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
        mb_lookup_status: None,
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
        mb_lookup_status: None,
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
        mb_lookup_status: None,
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
        mb_lookup_status: None,
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
        mb_lookup_status: None,
    };
    query_albums(params).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_query::{Query, SqliteQueryBuilder};

    fn album_sql_with_filters(
        filters: std::collections::HashMap<String, serde_json::Value>,
    ) -> (String, sea_query::Values) {
        let params = crate::music::crud::models::QueryParams {
            q: None,
            search_fields: None,
            filters,
            sort_by: None,
            sort_direction: None,
            limit: None,
            offset: None,
            user_id: None,
            favorites_only: None,
            min_rating: None,
            mb_lookup_status: None,
        };
        let mut q = Query::select();
        q.column(sea_query::Asterisk).from(AlbumView::Table);
        add_global_filters(
            &mut q,
            &params,
            AlbumView::AlbumTitle,
            AlbumView::ArtistName,
            AlbumView::AlbumTitle,
        );
        q.build(SqliteQueryBuilder)
    }

    #[test]
    fn taxon_id_filter_targets_album_taxons_column() {
        let mut filters = std::collections::HashMap::new();
        filters.insert("taxon_id".to_string(), serde_json::json!("taxon-abc-123"));
        let (sql, values) = album_sql_with_filters(filters);
        assert!(
            sql.contains("album_taxons"),
            "expected album_taxons in sql, got: {sql}"
        );
        assert!(sql.contains("LIKE"), "expected LIKE in sql, got: {sql}");
        let found = values
            .0
            .iter()
            .any(|v| matches!(v, sea_query::Value::String(Some(s)) if s.contains("taxon-abc-123")));
        assert!(found, "expected taxon-abc-123 in bound params");
    }

    #[test]
    fn taxon_ids_filter_uses_or_for_multiple_ids() {
        let mut filters = std::collections::HashMap::new();
        filters.insert(
            "taxon_ids".to_string(),
            serde_json::json!(["taxon-a", "taxon-b"]),
        );
        let (sql, values) = album_sql_with_filters(filters);
        assert!(
            sql.contains("album_taxons"),
            "expected album_taxons in sql, got: {sql}"
        );
        assert!(sql.contains("LIKE"), "expected LIKE in sql, got: {sql}");
        let has_a = values
            .0
            .iter()
            .any(|v| matches!(v, sea_query::Value::String(Some(s)) if s.contains("taxon-a")));
        let has_b = values
            .0
            .iter()
            .any(|v| matches!(v, sea_query::Value::String(Some(s)) if s.contains("taxon-b")));
        assert!(has_a, "expected taxon-a in bound params");
        assert!(has_b, "expected taxon-b in bound params");
    }
}
