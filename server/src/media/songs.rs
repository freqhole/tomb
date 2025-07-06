//! Song and playlist HTTP API handlers
//!
//! This module provides REST API endpoints for managing songs and playlists.

use axum::{
    extract::{Extension, Path, Query},
    http::StatusCode,
    response::Json,
    routing::{delete, get, post, put},
    Router,
};
use grimoire::music::{
    AlbumSummary, AlbumTrack, CreatePlaylist, MusicRepository, Playlist, PlaylistQuery,
    PlaylistService, PlaylistSummary, PlaylistWithCount, Song, SongQuery, UpdatePlaylist,
};
use grimoire::DatabaseConnection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::error::WebauthnError;

/// Song list response
#[derive(Debug, Serialize)]
pub struct SongListResponse {
    pub songs: Vec<SongResponse>,
    pub total: usize,
}

/// Song response for API
#[derive(Debug, Serialize)]
pub struct SongResponse {
    pub id: Uuid,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    pub duration_seconds: Option<i64>,
    pub genre: Option<String>,
    pub year: Option<i32>,
    pub bpm: Option<i32>,
    pub key_signature: Option<String>,
    pub rating: Option<i32>,
    pub is_favorite: bool,
    pub tags: Vec<String>,
    pub display_title: String,
    pub detailed_display_title: String,
    pub created_at: String,
    pub media_blob_id: String,
    pub thumbnail_blob_id: Option<String>,
    pub waveform_blob_id: Option<String>,
    pub thumbnail_blob_ids: Vec<String>,
}

impl From<Song> for SongResponse {
    fn from(song: Song) -> Self {
        let duration_seconds = song.duration.map(|d| d.microseconds / 1_000_000);
        let display_title = song.display_title();
        let detailed_display_title = song.detailed_display_title();

        Self {
            id: song.id,
            title: song.title,
            artist: song.artist,
            album: song.album,
            album_artist: song.album_artist,
            track_number: song.track_number,
            disc_number: song.disc_number,
            duration_seconds,
            genre: song.genre,
            year: song.year,
            bpm: song.bpm,
            key_signature: song.key_signature,
            rating: song.rating,
            is_favorite: song.is_favorite,
            tags: song.tags,
            display_title,
            detailed_display_title,
            created_at: song
                .created_at
                .format(&Rfc3339)
                .unwrap_or_else(|_| song.created_at.to_string()),
            media_blob_id: song.media_blob_id,
            thumbnail_blob_id: song.thumbnail_blob_id,
            waveform_blob_id: song.waveform_blob_id,
            thumbnail_blob_ids: song.thumbnail_blob_ids.unwrap_or_default(),
        }
    }
}

/// Playlist response for API
#[derive(Debug, Serialize)]
pub struct PlaylistResponse {
    pub id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub is_public: bool,
    pub is_collaborative: bool,
    pub song_count: Option<i64>,
    pub visibility: String,
    pub created_at: String,
}

impl From<Playlist> for PlaylistResponse {
    fn from(playlist: Playlist) -> Self {
        let visibility = playlist.visibility_string().to_string();
        Self {
            id: playlist.id,
            title: playlist.title,
            description: playlist.description,
            is_public: playlist.is_public,
            is_collaborative: playlist.is_collaborative,
            song_count: None,
            visibility,
            created_at: playlist.created_at.to_string(),
        }
    }
}

impl From<PlaylistWithCount> for PlaylistResponse {
    fn from(playlist_with_count: PlaylistWithCount) -> Self {
        let mut response = PlaylistResponse::from(playlist_with_count.playlist);
        response.song_count = Some(playlist_with_count.song_count);
        response
    }
}

/// Playlist list response
#[derive(Debug, Serialize)]
pub struct PlaylistListResponse {
    pub playlists: Vec<PlaylistResponse>,
    pub total: usize,
}

/// Song query parameters for API
#[derive(Debug, Deserialize)]
pub struct SongQueryParams {
    pub favorites: Option<bool>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub year: Option<i32>,
    pub rating_min: Option<i32>,
    pub title_search: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub media_blob_id: Option<String>,
}

impl From<SongQueryParams> for SongQuery {
    fn from(params: SongQueryParams) -> Self {
        Self {
            // Basic filters
            artist: params.artist,
            album: params.album,
            album_artist: None,
            genre: params.genre,
            title_search: params.title_search,

            // Numeric filters
            year: params.year,
            rating_min: params.rating_min,
            rating_max: None,
            bpm_min: None,
            bpm_max: None,

            // Duration filters
            duration_min: None,
            duration_max: None,

            // Boolean filters
            favorites_only: params.favorites,
            has_thumbnail: None,
            has_waveform: None,

            // Array filters
            tags: None,

            // Date filters
            created_after: None,
            updated_after: None,

            // JSONB filters
            metadata_filter: None,

            // Musical filters
            key_signature: None,

            // Media blob filter
            media_blob_id: params.media_blob_id,

            // Pagination
            limit: params.limit,
            offset: params.offset,

            // Ordering
            order_by: None,
            order_direction: None,
        }
    }
}

/// Playlist query parameters for API
#[derive(Debug, Deserialize)]
pub struct PlaylistQueryParams {
    pub public_only: Option<bool>,
    pub title_search: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

impl From<PlaylistQueryParams> for PlaylistQuery {
    fn from(params: PlaylistQueryParams) -> Self {
        Self {
            public_only: params.public_only,
            client_id: None,
            title_search: params.title_search,
            limit: params.limit,
            offset: params.offset,
            ..Default::default()
        }
    }
}

/// Create playlist request
#[derive(Debug, Clone, Deserialize)]
pub struct CreatePlaylistRequest {
    pub title: String,
    pub description: Option<String>,
    pub is_public: Option<bool>,
    pub is_collaborative: Option<bool>,
    pub song_ids: Option<Vec<Uuid>>,
}

impl From<CreatePlaylistRequest> for CreatePlaylist {
    fn from(req: CreatePlaylistRequest) -> Self {
        Self {
            title: req.title,
            description: req.description,
            client_id: Some("web".to_string()),
            is_public: req.is_public,
            is_collaborative: req.is_collaborative,
            metadata: None,
        }
    }
}

/// Update playlist request
#[derive(Debug, Deserialize)]
pub struct UpdatePlaylistRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub is_public: Option<bool>,
    pub is_collaborative: Option<bool>,
}

impl From<UpdatePlaylistRequest> for UpdatePlaylist {
    fn from(req: UpdatePlaylistRequest) -> Self {
        Self {
            title: req.title,
            description: req.description,
            is_public: req.is_public,
            is_collaborative: req.is_collaborative,
            metadata: None,
        }
    }
}

/// Add songs to playlist request
#[derive(Debug, Deserialize)]
pub struct AddSongsRequest {
    pub song_ids: Vec<Uuid>,
}

/// Move song in playlist request
#[derive(Debug, Deserialize)]
pub struct MoveSongRequest {
    pub song_id: Uuid,
    pub to_position: i32,
}

/// Reorder playlist request
#[derive(Debug, Deserialize)]
pub struct ReorderPlaylistRequest {
    pub song_ids: Vec<Uuid>,
}

/// Create playlist from album request
#[derive(Debug, Deserialize)]
pub struct CreatePlaylistFromAlbumRequest {
    pub title: Option<String>,
    pub is_public: Option<bool>,
}

/// Album summary response
#[derive(Debug, Serialize)]
pub struct AlbumSummaryResponse {
    pub album: Option<String>,
    pub artist: Option<String>,
    pub year: Option<i32>,
    pub track_count: i64,
    pub disc_count: i64,
    pub total_duration: Option<String>,
    pub genres: Option<String>,
    pub avg_rating: Option<f64>,
    pub favorite_count: i64,
    pub album_thumbnail_id: Option<String>,
}

impl From<AlbumSummary> for AlbumSummaryResponse {
    fn from(album: AlbumSummary) -> Self {
        let formatted_duration = album.formatted_total_duration();
        let primary_artist = album.primary_artist().cloned();
        Self {
            album: album.album,
            artist: primary_artist,
            year: album.year,
            track_count: album.track_count,
            disc_count: album.disc_count,
            total_duration: formatted_duration,
            genres: album.genres,
            avg_rating: album.avg_rating,
            favorite_count: album.favorite_count,
            album_thumbnail_id: album.album_thumbnail_id,
        }
    }
}

/// Album tracks response
#[derive(Debug, Serialize)]
pub struct AlbumTracksResponse {
    pub album: String,
    pub artist: Option<String>,
    pub tracks: Vec<AlbumTrackResponse>,
}

/// Album track response
#[derive(Debug, Serialize)]
pub struct AlbumTrackResponse {
    pub song_id: Uuid,
    pub title: String,
    pub artist: Option<String>,
    pub disc_number: Option<i32>,
    pub track_number: Option<i32>,
    pub duration: Option<String>,
    pub genre: Option<String>,
    pub year: Option<i32>,
    pub rating: Option<i32>,
    pub is_favorite: bool,
    pub track_display: String,
}

impl From<AlbumTrack> for AlbumTrackResponse {
    fn from(track: AlbumTrack) -> Self {
        let formatted_duration = track.formatted_duration();
        let track_display = track.track_display();
        Self {
            song_id: track.song_id,
            title: track.title.clone(),
            artist: track.artist,
            disc_number: track.disc_number,
            track_number: track.track_number,
            duration: formatted_duration,
            genre: track.genre,
            year: track.year,
            rating: track.rating,
            is_favorite: track.is_favorite,
            track_display,
        }
    }
}

/// Playlist summary response
#[derive(Debug, Serialize)]
pub struct PlaylistSummaryResponse {
    #[serde(flatten)]
    pub playlist: PlaylistResponse,
    pub song_count: i64,
    pub total_duration: Option<String>,
    pub song_preview: String,
}

impl From<PlaylistSummary> for PlaylistSummaryResponse {
    fn from(summary: PlaylistSummary) -> Self {
        Self {
            playlist: PlaylistResponse::from(summary.to_playlist()),
            song_count: summary.song_count,
            total_duration: summary.formatted_total_duration(),
            song_preview: summary.song_preview(),
        }
    }
}

/// Playlist songs response
#[derive(Debug, Serialize)]
pub struct PlaylistSongsResponse {
    pub playlist: PlaylistResponse,
    pub songs: Vec<PlaylistSongResponse>,
}

/// Playlist song response with position
#[derive(Debug, Serialize)]
pub struct PlaylistSongResponse {
    pub position: i32,
    pub song: SongResponse,
    pub added_at: String,
}

/// Update song request
#[derive(Debug, Deserialize)]
pub struct UpdateSongRequest {
    pub is_favorite: Option<bool>,
    pub rating: Option<i32>,
}

/// Song update response
#[derive(Debug, Serialize)]
pub struct SongUpdateResponse {
    pub message: String,
    pub song: SongResponse,
}

/// Artist summary response
#[derive(Debug, Serialize)]
pub struct ArtistSummary {
    pub artist: String,
    pub song_count: i64,
    pub album_count: i64,
    pub total_duration: i64,
    pub genres: Vec<String>,
    pub avg_rating: Option<f64>,
    pub favorite_count: i64,
}

/// Artists list response
#[derive(Debug, Serialize)]
pub struct ArtistsListResponse {
    pub artists: Vec<ArtistSummary>,
    pub total: usize,
}

// Route handlers

/// List songs
pub async fn list_songs(
    Extension(db): Extension<DatabaseConnection>,
    Query(params): Query<SongQueryParams>,
) -> Result<Json<SongListResponse>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let query = SongQuery::from(params);
    let songs = service
        .query_songs(query)
        .await
        .map_err(|_| WebauthnError::DatabaseError)?;

    let song_responses: Vec<SongResponse> = songs.into_iter().map(SongResponse::from).collect();
    let total = song_responses.len();

    Ok(Json(SongListResponse {
        songs: song_responses,
        total,
    }))
}

/// Get song by ID
pub async fn get_song(
    Extension(db): Extension<DatabaseConnection>,
    Path(song_id): Path<Uuid>,
) -> Result<Json<SongResponse>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let song = service
        .get_song(song_id)
        .await
        .map_err(|_| WebauthnError::UserNotFound)?;

    Ok(Json(SongResponse::from(song)))
}

/// Update song (favorite status, rating)
pub async fn update_song(
    Extension(db): Extension<DatabaseConnection>,
    Path(song_id): Path<Uuid>,
    Json(req): Json<UpdateSongRequest>,
) -> Result<Json<SongUpdateResponse>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let mut updated_song = None;
    let mut actions: Vec<String> = Vec::new();

    if let Some(is_favorite) = req.is_favorite {
        let song = service
            .set_song_favorite(song_id, is_favorite)
            .await
            .map_err(|_| WebauthnError::DatabaseError)?;
        updated_song = Some(song);
        actions.push(if is_favorite {
            "favorited".to_string()
        } else {
            "unfavorited".to_string()
        });
    }

    if let Some(rating) = req.rating {
        let song = service
            .rate_song(song_id, Some(rating))
            .await
            .map_err(|_| WebauthnError::BadRequest)?;
        updated_song = Some(song);
        actions.push(format!("rated {}", rating));
    }

    let song = updated_song.ok_or(WebauthnError::BadRequest)?;
    let message = if actions.is_empty() {
        "No changes made".to_string()
    } else {
        format!("Song {}", actions.join(" and "))
    };

    Ok(Json(SongUpdateResponse {
        message,
        song: SongResponse::from(song),
    }))
}

/// List artists with summaries
pub async fn list_artists(
    Extension(db): Extension<DatabaseConnection>,
) -> Result<Json<ArtistsListResponse>, WebauthnError> {
    let _repository = MusicRepository::new(db.pool().clone());

    // Get all artists with their statistics
    let artists_data = sqlx::query!(
        r#"
        SELECT
            s.artist,
            COUNT(DISTINCT s.id) as song_count,
            COUNT(DISTINCT s.album) as album_count,
            COALESCE(SUM(EXTRACT(EPOCH FROM s.duration)), 0) as total_duration,
            AVG(s.rating) as avg_rating,
            COUNT(CASE WHEN s.is_favorite THEN 1 END) as favorite_count,
            ARRAY_AGG(DISTINCT s.genre) FILTER (WHERE s.genre IS NOT NULL) as genres
        FROM songs s
        WHERE s.artist IS NOT NULL
        GROUP BY s.artist
        ORDER BY s.artist ASC
        "#
    )
    .fetch_all(db.pool())
    .await
    .map_err(|e| WebauthnError::SqlxError(e))?;

    let artists: Vec<ArtistSummary> = artists_data
        .into_iter()
        .map(|row| ArtistSummary {
            artist: row.artist.unwrap_or_default(),
            song_count: row.song_count.unwrap_or(0),
            album_count: row.album_count.unwrap_or(0),
            total_duration: row
                .total_duration
                .map(|d| d.to_string().parse::<f64>().unwrap_or(0.0) as i64)
                .unwrap_or(0),
            genres: row.genres.unwrap_or_default(),
            avg_rating: row
                .avg_rating
                .map(|r| r.to_string().parse::<f64>().unwrap_or(0.0)),
            favorite_count: row.favorite_count.unwrap_or(0),
        })
        .collect();

    let total = artists.len();

    Ok(Json(ArtistsListResponse { artists, total }))
}

/// List playlists
pub async fn list_playlists(
    Extension(db): Extension<DatabaseConnection>,
    Query(params): Query<PlaylistQueryParams>,
) -> Result<Json<PlaylistListResponse>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let query = PlaylistQuery::from(params);
    let playlists = service
        .query_playlists(query)
        .await
        .map_err(|_| WebauthnError::DatabaseError)?;

    let playlist_responses: Vec<PlaylistResponse> =
        playlists.into_iter().map(PlaylistResponse::from).collect();
    let total = playlist_responses.len();

    Ok(Json(PlaylistListResponse {
        playlists: playlist_responses,
        total,
    }))
}

/// Get playlist by ID
pub async fn get_playlist(
    Extension(db): Extension<DatabaseConnection>,
    Path(playlist_id): Path<Uuid>,
) -> Result<Json<PlaylistResponse>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let playlist = service
        .get_playlist(playlist_id)
        .await
        .map_err(|_| WebauthnError::UserNotFound)?;

    let song_count = service
        .get_playlist_song_count(playlist_id)
        .await
        .map_err(|_| WebauthnError::DatabaseError)?;

    let mut response = PlaylistResponse::from(playlist);
    response.song_count = Some(song_count);

    Ok(Json(response))
}

/// Create playlist
pub async fn create_playlist(
    Extension(db): Extension<DatabaseConnection>,
    Json(req): Json<CreatePlaylistRequest>,
) -> Result<Json<PlaylistResponse>, WebauthnError> {
    tracing::debug!("Creating playlist with request: {:?}", req);

    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let song_ids = req.song_ids.clone().unwrap_or_default();
    let create_params = CreatePlaylist::from(req);

    tracing::debug!(
        "Creating playlist with params: {:?}, song_ids: {:?}",
        create_params,
        song_ids
    );

    let (playlist, _added_songs) = service
        .create_playlist_with_songs(create_params, Some(song_ids), Some("web".to_string()))
        .await
        .map_err(|e| {
            tracing::error!("Failed to create playlist: {:?}", e);
            WebauthnError::BadRequest
        })?;

    tracing::debug!("Successfully created playlist: {:?}", playlist);
    Ok(Json(PlaylistResponse::from(playlist)))
}

/// Update playlist
pub async fn update_playlist(
    Extension(db): Extension<DatabaseConnection>,
    Path(playlist_id): Path<Uuid>,
    Json(req): Json<UpdatePlaylistRequest>,
) -> Result<Json<PlaylistResponse>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let update_params = UpdatePlaylist::from(req);
    let playlist = service
        .update_playlist(playlist_id, update_params)
        .await
        .map_err(|_| WebauthnError::BadRequest)?;

    Ok(Json(PlaylistResponse::from(playlist)))
}

/// Delete playlist
pub async fn delete_playlist(
    Extension(db): Extension<DatabaseConnection>,
    Path(playlist_id): Path<Uuid>,
) -> Result<StatusCode, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let _deleted = service
        .delete_playlist(playlist_id, None)
        .await
        .map_err(|_| WebauthnError::UserNotFound)?;

    Ok(StatusCode::NO_CONTENT)
}

/// Get playlist songs
pub async fn get_playlist_songs(
    Extension(db): Extension<DatabaseConnection>,
    Path(playlist_id): Path<Uuid>,
) -> Result<Json<PlaylistSongsResponse>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let playlist = service
        .get_playlist(playlist_id)
        .await
        .map_err(|_| WebauthnError::UserNotFound)?;

    let playlist_songs = service
        .get_playlist_songs(playlist_id)
        .await
        .map_err(|_| WebauthnError::DatabaseError)?;

    let songs: Vec<PlaylistSongResponse> = playlist_songs
        .into_iter()
        .map(|ps| PlaylistSongResponse {
            position: ps.position,
            song: SongResponse::from(ps.song),
            added_at: ps.added_at.to_string(),
        })
        .collect();

    Ok(Json(PlaylistSongsResponse {
        playlist: PlaylistResponse::from(playlist),
        songs,
    }))
}

/// Add songs to playlist
pub async fn add_songs_to_playlist(
    Extension(db): Extension<DatabaseConnection>,
    Path(playlist_id): Path<Uuid>,
    Json(req): Json<AddSongsRequest>,
) -> Result<Json<HashMap<String, serde_json::Value>>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let (added, skipped) = service
        .add_songs_to_playlist(playlist_id, req.song_ids, Some("web".to_string()))
        .await
        .map_err(|_| WebauthnError::BadRequest)?;

    let mut response = HashMap::new();
    response.insert("added_songs".to_string(), serde_json::json!(added));
    response.insert("skipped_songs".to_string(), serde_json::json!(skipped));
    response.insert(
        "message".to_string(),
        serde_json::json!(format!(
            "Added {} songs, skipped {} songs",
            added.len(),
            skipped.len()
        )),
    );

    Ok(Json(response))
}

/// Remove songs from playlist
pub async fn remove_songs_from_playlist(
    Extension(db): Extension<DatabaseConnection>,
    Path(playlist_id): Path<Uuid>,
    Json(req): Json<AddSongsRequest>, // Reuse the same request structure
) -> Result<Json<HashMap<String, serde_json::Value>>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let (removed_count, not_found) = service
        .remove_songs_from_playlist(playlist_id, req.song_ids)
        .await
        .map_err(|_| WebauthnError::BadRequest)?;

    let mut response = HashMap::new();
    response.insert(
        "removed_count".to_string(),
        serde_json::json!(removed_count),
    );
    response.insert("not_found_songs".to_string(), serde_json::json!(not_found));
    response.insert(
        "message".to_string(),
        serde_json::json!(format!(
            "Removed {} songs, {} not found in playlist",
            removed_count,
            not_found.len()
        )),
    );

    Ok(Json(response))
}

/// Move song in playlist
pub async fn move_song_in_playlist(
    Extension(db): Extension<DatabaseConnection>,
    Path(playlist_id): Path<Uuid>,
    Json(req): Json<MoveSongRequest>,
) -> Result<Json<HashMap<String, serde_json::Value>>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    service
        .move_playlist_song(playlist_id, req.song_id, req.to_position)
        .await
        .map_err(|_| WebauthnError::BadRequest)?;

    let mut response = HashMap::new();
    response.insert(
        "message".to_string(),
        serde_json::json!(format!(
            "Moved song {} to position {}",
            req.song_id, req.to_position
        )),
    );

    Ok(Json(response))
}

/// Reorder playlist
pub async fn reorder_playlist(
    Extension(db): Extension<DatabaseConnection>,
    Path(playlist_id): Path<Uuid>,
    Json(req): Json<ReorderPlaylistRequest>,
) -> Result<Json<HashMap<String, serde_json::Value>>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    service
        .reorder_playlist(playlist_id, &req.song_ids)
        .await
        .map_err(|_| WebauthnError::BadRequest)?;

    let mut response = HashMap::new();
    response.insert(
        "message".to_string(),
        serde_json::json!(format!("Reordered {} songs", req.song_ids.len())),
    );

    Ok(Json(response))
}

/// Get playlist summaries
pub async fn get_playlist_summaries(
    Extension(db): Extension<DatabaseConnection>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Vec<PlaylistSummaryResponse>>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let limit = params
        .get("limit")
        .and_then(|l| l.parse::<i64>().ok())
        .or(Some(20));

    let summaries = service
        .get_playlist_summaries(limit)
        .await
        .map_err(|_| WebauthnError::DatabaseError)?;

    let responses: Vec<PlaylistSummaryResponse> = summaries
        .into_iter()
        .map(PlaylistSummaryResponse::from)
        .collect();

    Ok(Json(responses))
}

/// Get album summaries
pub async fn get_album_summaries(
    Extension(db): Extension<DatabaseConnection>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Vec<AlbumSummaryResponse>>, WebauthnError> {
    tracing::debug!("get_album_summaries called with params: {:?}", params);

    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let limit = params
        .get("limit")
        .and_then(|l| l.parse::<i64>().ok())
        .or(Some(20));

    tracing::debug!("Using limit: {:?}", limit);

    let albums = service.get_album_summaries(limit).await.map_err(|e| {
        tracing::error!("Error getting album summaries: {:?}", e);
        WebauthnError::DatabaseError
    })?;

    tracing::debug!("Got {} albums from service", albums.len());

    let responses: Vec<AlbumSummaryResponse> =
        albums.into_iter().map(AlbumSummaryResponse::from).collect();

    tracing::debug!("Converted to {} responses", responses.len());

    Ok(Json(responses))
}

/// Get album tracks
pub async fn get_album_tracks(
    Extension(db): Extension<DatabaseConnection>,
    Path(album): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<AlbumTracksResponse>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let artist = params.get("artist").map(|s| s.as_str());

    let tracks = service
        .get_album_tracks(&album, artist)
        .await
        .map_err(|_| WebauthnError::DatabaseError)?;

    let track_responses: Vec<AlbumTrackResponse> =
        tracks.into_iter().map(AlbumTrackResponse::from).collect();

    Ok(Json(AlbumTracksResponse {
        album: album.clone(),
        artist: artist.map(|s| s.to_string()),
        tracks: track_responses,
    }))
}

/// Create playlist from album
pub async fn create_playlist_from_album(
    Extension(db): Extension<DatabaseConnection>,
    Path(album): Path<String>,
    Query(params): Query<HashMap<String, String>>,
    Json(req): Json<CreatePlaylistFromAlbumRequest>,
) -> Result<Json<PlaylistResponse>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let artist = params.get("artist").map(|s| s.as_str());
    let title = req.title.unwrap_or_else(|| match artist {
        Some(artist) => format!("{} - {}", artist, album),
        None => album.clone(),
    });

    let playlist = service
        .create_playlist_from_album(
            title,
            &album,
            artist,
            req.is_public,
            Some("web".to_string()),
        )
        .await
        .map_err(|_| WebauthnError::BadRequest)?;

    Ok(Json(PlaylistResponse::from(playlist)))
}

/// Get songs by artist
pub async fn get_artist_songs(
    Extension(db): Extension<DatabaseConnection>,
    Path(artist): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<SongListResponse>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let limit = params
        .get("limit")
        .and_then(|l| l.parse::<i64>().ok())
        .or(Some(1000));

    let query = SongQuery {
        artist: Some(artist),
        limit,
        ..Default::default()
    };

    // For now, we'll use a direct SQL query since query_songs doesn't work properly
    let songs = sqlx::query_as::<_, Song>(
        "SELECT * FROM songs WHERE artist = $1 AND deleted_at IS NULL ORDER BY album, track_number, title LIMIT $2"
    )
    .bind(&query.artist)
    .bind(limit.unwrap_or(1000))
    .fetch_all(db.pool())
    .await
    .map_err(|_| WebauthnError::DatabaseError)?;

    let song_responses: Vec<SongResponse> = songs.into_iter().map(SongResponse::from).collect();
    let total = song_responses.len();

    Ok(Json(SongListResponse {
        songs: song_responses,
        total,
    }))
}

/// Create the router for song and playlist routes
pub fn create_routes() -> Router {
    Router::new()
        // Song routes
        .route("/songs", get(list_songs))
        .route("/songs/{song_id}", get(get_song))
        .route("/songs/{song_id}", put(update_song))
        // Artist routes
        .route("/artists", get(list_artists))
        .route("/artists/{artist}/songs", get(get_artist_songs))
        // Playlist routes
        .route("/playlists", get(list_playlists))
        .route("/playlists", post(create_playlist))
        .route("/playlists/{playlist_id}", get(get_playlist))
        .route("/playlists/{playlist_id}", put(update_playlist))
        .route("/playlists/{playlist_id}", delete(delete_playlist))
        .route("/playlists/{playlist_id}/songs", get(get_playlist_songs))
        .route(
            "/playlists/{playlist_id}/songs",
            post(add_songs_to_playlist),
        )
        .route(
            "/playlists/{playlist_id}/songs",
            delete(remove_songs_from_playlist),
        )
        .route(
            "/playlists/{playlist_id}/songs/move",
            put(move_song_in_playlist),
        )
        .route("/playlists/{playlist_id}/reorder", put(reorder_playlist))
        // Enhanced views and summaries
        .route("/playlists/summaries", get(get_playlist_summaries))
        .route("/albums", get(get_album_summaries))
        .route("/albums/{album}/tracks", get(get_album_tracks))
        .route(
            "/albums/{album}/create-playlist",
            post(create_playlist_from_album),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_song_response_conversion() {
        use grimoire::music::Song;
        use time::OffsetDateTime;

        let song = Song {
            id: Uuid::new_v4(),
            media_blob_id: "abc1234".to_string(),
            thumbnail_blob_id: None,
            waveform_blob_id: None,
            thumbnail_blob_ids: None,
            title: "Test Song".to_string(),
            artist: Some("Test Artist".to_string()),
            album: Some("Test Album".to_string()),
            album_artist: None,
            track_number: Some(1),
            disc_number: Some(1),
            duration: None,
            genre: Some("Rock".to_string()),
            year: Some(2023),
            bpm: None,
            key_signature: None,
            rating: Some(5),
            is_favorite: true,
            tags: vec!["rock".to_string(), "classic".to_string()],
            metadata: serde_json::Value::Null,
            deleted_at: None,
            deleted_by: None,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
            version: 1,
        };

        let response = SongResponse::from(song.clone());
        assert_eq!(response.id, song.id);
        assert_eq!(response.title, song.title);
        assert_eq!(response.display_title, "Test Artist - Test Song");
        assert_eq!(
            response.detailed_display_title,
            "Test Artist - Test Song (Test Album)"
        );
    }
}
