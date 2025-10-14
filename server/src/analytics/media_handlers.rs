//! Media analytics HTTP handlers
//!
//! This module provides HTTP endpoints for recording and querying media events
//! for analytics purposes. Handles both individual events and batch submissions.

use axum::{
    extract::{Extension, Json, Path, Query},
    http::HeaderMap,
    response::IntoResponse,
};
use grimoire::analytics::{
    feed::{get_social_feed, FeedResponse},
    AnalyticsService, EventBatchResult, FailedEvent, MediaAnalyticsError, MediaEventBatchRequest,
    MediaEventRequest, MediaEventResponse, PlayAnalytics, ProcessedEvent,
};
use grimoire::DatabaseConnection;
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use time;
use tower_sessions::Session;
use uuid::Uuid;

use crate::auth::AuthenticatedUser;
use crate::error::AppError;

/// Record media events (single or batch)
pub async fn record_events(
    Extension(user): Extension<AuthenticatedUser>,
    Extension(database): Extension<DatabaseConnection>,
    session: Session,
    headers: HeaderMap,
    Json(payload): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, AppError> {
    let analytics_service = AnalyticsService::new_with_defaults(&database);

    // Extract request metadata
    let user_id = user.user().id;
    let session_id = session
        .id()
        .map(|id| Uuid::parse_str(&id.to_string()).ok())
        .flatten();
    let user_agent = headers
        .get("user-agent")
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string());

    // Handle both single event and batch requests
    if let Ok(single_request) = serde_json::from_value::<MediaEventRequest>(payload.clone()) {
        // Single event - process with resilient handling
        let result = record_events_resilient(
            vec![single_request],
            &analytics_service,
            Some(user_id),
            session_id,
            user_agent,
        )
        .await;

        if result.success_count > 0 {
            let event_response = ProcessedEvent {
                client_id: result
                    .processed
                    .first()
                    .map(|p| p.client_id.clone())
                    .unwrap_or_else(|| "unknown".to_string()),
                event_id: result
                    .processed
                    .first()
                    .map(|p| p.event_id)
                    .unwrap_or_else(|| Uuid::new_v4()),
            };
            let response = MediaEventResponse {
                id: event_response.event_id,
                created_at: time::OffsetDateTime::now_utc(),
                status: "recorded".to_string(),
            };
            Ok(Json(serde_json::to_value(response).unwrap()))
        } else if !result.failed.is_empty() {
            let error = &result.failed[0];
            Err(AppError::BadRequest(format!(
                "Failed to record event: {}",
                error.error
            )))
        } else {
            Err(AppError::BadRequest(
                "Unknown error processing event".to_string(),
            ))
        }
    } else if let Ok(batch_request) = serde_json::from_value::<MediaEventBatchRequest>(payload) {
        // Batch events - use new resilient processing
        let result = record_events_resilient(
            batch_request.events,
            &analytics_service,
            Some(user_id),
            session_id,
            user_agent,
        )
        .await;

        Ok(Json(serde_json::to_value(result).unwrap()))
    } else {
        Err(AppError::BadRequest(
            "Invalid request format. Expected single MediaEventRequest or MediaEventBatchRequest"
                .to_string(),
        ))
    }
}

/// Get play analytics for a specific song
pub async fn get_song_plays(
    Extension(database): Extension<DatabaseConnection>,
    Path(song_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let analytics_service = AnalyticsService::new_with_defaults(&database);

    match analytics_service.get_song_play_analytics(&song_id).await {
        Ok(analytics) => Ok(Json(analytics)),
        Err(MediaAnalyticsError::Database(sqlx::Error::RowNotFound)) => {
            // Return empty analytics if no data found
            let empty_analytics = PlayAnalytics {
                media_blob_id: song_id,
                total_plays: 0,
                complete_plays: 0,
                partial_plays: 0,
                unique_users: 0,
                unique_sessions: 0,
                avg_completion_rate: 0.0,
                total_play_time_seconds: 0,
                avg_play_time_seconds: 0.0,
                last_played_at: None,
                first_played_at: None,
                play_count_last_24h: 0,
                play_count_last_7d: 0,
                play_count_last_30d: 0,
            };
            Ok(Json(empty_analytics))
        }
        Err(e) => {
            tracing::warn!("Failed to get song play analytics: {}", e);
            Err(AppError::BadRequest(format!(
                "Failed to get analytics: {}",
                e
            )))
        }
    }
}

/// Resilient event batch processing with partial success handling
/// Processes each event individually to avoid all-or-nothing failures
async fn record_events_resilient(
    events: Vec<MediaEventRequest>,
    analytics_service: &AnalyticsService<'_>,
    user_id: Option<Uuid>,
    session_id: Option<Uuid>,
    user_agent: Option<String>,
) -> EventBatchResult {
    let mut processed = Vec::new();
    let mut failed = Vec::new();

    for event_request in events {
        // Generate client_id if not provided for correlation
        let client_id = event_request
            .client_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());

        // Create event from request
        let event = analytics_service.create_media_event_from_request(
            event_request,
            user_id,
            session_id,
            user_agent.clone(),
        );

        // Try to record this individual event
        match analytics_service.record_media_event(event.clone()).await {
            Ok(_) => {
                processed.push(ProcessedEvent {
                    client_id,
                    event_id: event.id,
                });
                tracing::debug!("Successfully recorded event {}", event.id);
            }
            Err(e) => {
                let error_code = classify_error(&e);
                failed.push(FailedEvent {
                    client_id,
                    error: e.to_string(),
                    error_code,
                });
                tracing::warn!("Failed to record event: {}", e);
            }
        }
    }

    let total_count = processed.len() + failed.len();
    let success_count = processed.len();

    if failed.len() > 0 {
        tracing::info!(
            "Batch processing completed: {}/{} events successful",
            success_count,
            total_count
        );
    }

    EventBatchResult {
        processed,
        failed,
        total_count,
        success_count,
    }
}

/// Classify errors for retry logic
/// Returns error codes that clients can use to determine retry behavior
fn classify_error(error: &MediaAnalyticsError) -> String {
    match error {
        MediaAnalyticsError::Serialization(_) => "schema_error".to_string(),
        MediaAnalyticsError::Database(_) => "database_error".to_string(),
        _ => "unknown_error".to_string(),
    }
}

/// Get current user's listening history
#[derive(Deserialize)]
pub struct HistoryQuery {
    limit: Option<i32>,
    offset: Option<i32>,
}

pub async fn get_user_history(
    Extension(user): Extension<AuthenticatedUser>,
    Extension(database): Extension<DatabaseConnection>,
    Query(query): Query<HistoryQuery>,
) -> Result<impl IntoResponse, AppError> {
    let analytics_service = AnalyticsService::new_with_defaults(&database);
    let user_id = user.user().id;

    match analytics_service
        .get_user_listening_history(user_id, query.limit, query.offset)
        .await
    {
        Ok(history) => Ok(Json(history)),
        Err(e) => {
            tracing::warn!("Failed to get user listening history: {}", e);
            Err(AppError::BadRequest(format!(
                "Failed to get history: {}",
                e
            )))
        }
    }
}

/// Admin analytics query handler - flexible endpoint for all admin analytics
#[derive(Deserialize)]
pub struct AdminAnalyticsQuery {
    query_type: String,
    params: serde_json::Value,
}

pub async fn admin_analytics_query(
    Extension(_user): Extension<AuthenticatedUser>,
    Extension(database): Extension<DatabaseConnection>,
    Json(query): Json<AdminAnalyticsQuery>,
) -> Result<impl IntoResponse, AppError> {
    let analytics_service = AnalyticsService::new_with_defaults(&database);

    match query.query_type.as_str() {
        "overview" => handle_overview_query(&analytics_service, query.params).await,
        "top_songs" => handle_top_songs_query(&analytics_service, query.params).await,
        "user_history" => handle_admin_user_history_query(&analytics_service, query.params).await,
        "trends" => handle_trends_query(&analytics_service, query.params).await,
        "song_analytics" => handle_song_analytics_query(&analytics_service, query.params).await,
        "trending_songs" => handle_trending_songs_query(&analytics_service, query.params).await,
        "user_streaks" => handle_user_streaks_query(&analytics_service, query.params).await,
        "genre_patterns" => handle_genre_patterns_query(&analytics_service, query.params).await,
        "listening_time" => handle_listening_time_query(&analytics_service, query.params).await,
        "popular_songs" => handle_popular_songs_query(&analytics_service, query.params).await,
        "top_collections" => handle_top_collections_query(&analytics_service, query.params).await,
        "collection_overview" => {
            handle_collection_overview_query(&analytics_service, query.params).await
        }
        _ => Err(AppError::BadRequest(format!(
            "Unknown query type: {}",
            query.query_type
        ))),
    }
}

async fn handle_overview_query(
    analytics_service: &AnalyticsService<'_>,
    _params: serde_json::Value,
) -> Result<Json<serde_json::Value>, AppError> {
    match analytics_service.get_overview_analytics().await {
        Ok((total_events, total_plays, unique_users, active_sessions)) => {
            let overview = json!({
                "total_events": total_events,
                "total_plays": total_plays,
                "unique_users": unique_users,
                "active_sessions": active_sessions
            });
            Ok(Json(overview))
        }
        Err(e) => {
            tracing::warn!("Failed to get overview analytics: {}", e);
            Err(AppError::BadRequest(format!(
                "Failed to get overview analytics: {}",
                e
            )))
        }
    }
}

#[derive(Deserialize)]
struct TopSongsParams {
    period_hours: Option<i32>,
    limit: Option<i32>,
    min_plays: Option<i32>,
}

async fn handle_top_songs_query(
    analytics_service: &AnalyticsService<'_>,
    params: serde_json::Value,
) -> Result<Json<serde_json::Value>, AppError> {
    let params: TopSongsParams = serde_json::from_value(params)
        .map_err(|e| AppError::BadRequest(format!("Invalid params: {}", e)))?;

    let period_hours = params.period_hours.unwrap_or(24 * 7); // default to week
    let limit = params.limit.unwrap_or(20);
    let min_plays = params.min_plays.unwrap_or(3);

    match analytics_service
        .get_popular_songs_by_period(period_hours, limit, min_plays)
        .await
    {
        Ok(popular_songs) => Ok(Json(json!({
            "songs": popular_songs,
            "period_hours": period_hours,
            "limit": limit
        }))),
        Err(e) => {
            tracing::warn!("Failed to get top songs: {}", e);
            Err(AppError::BadRequest(format!(
                "Failed to get top songs: {}",
                e
            )))
        }
    }
}

#[derive(Deserialize)]
struct UserHistoryParams {
    user_id: Uuid,
    limit: Option<i32>,
    offset: Option<i32>,
}

async fn handle_admin_user_history_query(
    analytics_service: &AnalyticsService<'_>,
    params: serde_json::Value,
) -> Result<Json<serde_json::Value>, AppError> {
    let params: UserHistoryParams = serde_json::from_value(params)
        .map_err(|e| AppError::BadRequest(format!("Invalid params: {}", e)))?;

    match analytics_service
        .get_user_listening_history(params.user_id, params.limit, params.offset)
        .await
    {
        Ok(history) => Ok(Json(json!({
            "user_id": params.user_id,
            "history": history
        }))),
        Err(e) => {
            tracing::warn!("Failed to get user history for admin: {}", e);
            Err(AppError::BadRequest(format!(
                "Failed to get user history: {}",
                e
            )))
        }
    }
}

#[derive(Deserialize)]
struct TrendsParams {
    time_period_hours: Option<i32>,
    limit: Option<i32>,
}

async fn handle_trends_query(
    analytics_service: &AnalyticsService<'_>,
    params: serde_json::Value,
) -> Result<Json<serde_json::Value>, AppError> {
    let params: TrendsParams = serde_json::from_value(params)
        .map_err(|e| AppError::BadRequest(format!("Invalid params: {}", e)))?;

    let time_period_hours = params.time_period_hours.unwrap_or(24);
    let limit = params.limit.unwrap_or(50);

    match analytics_service
        .get_trending_songs(time_period_hours, limit, Some("song"))
        .await
    {
        Ok(trending_songs) => Ok(Json(json!({
            "trending_songs": trending_songs,
            "time_period_hours": time_period_hours,
            "limit": limit
        }))),
        Err(e) => {
            tracing::warn!("Failed to get trends: {}", e);
            Err(AppError::BadRequest(format!("Failed to get trends: {}", e)))
        }
    }
}

#[derive(Deserialize)]
struct TrendingSongsParams {
    time_period_hours: Option<i32>,
    limit: Option<i32>,
    domain_filter: Option<String>,
}

async fn handle_trending_songs_query(
    analytics_service: &AnalyticsService<'_>,
    params: serde_json::Value,
) -> Result<Json<serde_json::Value>, AppError> {
    let params: TrendingSongsParams = serde_json::from_value(params)
        .map_err(|e| AppError::BadRequest(format!("Invalid params: {}", e)))?;

    let time_period_hours = params.time_period_hours.unwrap_or(24);
    let limit = params.limit.unwrap_or(50);
    let domain_filter = params.domain_filter.as_deref();

    match analytics_service
        .get_trending_songs(time_period_hours, limit, domain_filter)
        .await
    {
        Ok(trending_songs) => Ok(Json(json!({
            "trending_songs": trending_songs,
            "time_period_hours": time_period_hours,
            "limit": limit
        }))),
        Err(e) => {
            tracing::warn!("Failed to get trending songs: {}", e);
            Err(AppError::BadRequest(format!(
                "Failed to get trending songs: {}",
                e
            )))
        }
    }
}

#[derive(Deserialize)]
struct UserStreaksParams {
    user_id: Uuid,
}

async fn handle_user_streaks_query(
    analytics_service: &AnalyticsService<'_>,
    params: serde_json::Value,
) -> Result<Json<serde_json::Value>, AppError> {
    let params: UserStreaksParams = serde_json::from_value(params)
        .map_err(|e| AppError::BadRequest(format!("Invalid params: {}", e)))?;

    match analytics_service
        .get_user_listening_streaks(params.user_id)
        .await
    {
        Ok(streaks) => Ok(Json(json!({
            "user_id": params.user_id,
            "streaks": streaks
        }))),
        Err(e) => {
            tracing::warn!("Failed to get user streaks: {}", e);
            Err(AppError::BadRequest(format!(
                "Failed to get user streaks: {}",
                e
            )))
        }
    }
}

#[derive(Deserialize)]
struct GenrePatternsParams {
    days_back: Option<i32>,
    min_plays: Option<i32>,
}

async fn handle_genre_patterns_query(
    analytics_service: &AnalyticsService<'_>,
    params: serde_json::Value,
) -> Result<Json<serde_json::Value>, AppError> {
    let params: GenrePatternsParams = serde_json::from_value(params)
        .map_err(|e| AppError::BadRequest(format!("Invalid params: {}", e)))?;

    let days_back = params.days_back.unwrap_or(30);
    let min_plays = params.min_plays.unwrap_or(5);

    match analytics_service
        .get_genre_listening_patterns(days_back, min_plays)
        .await
    {
        Ok(patterns) => Ok(Json(json!({
            "genre_patterns": patterns,
            "days_back": days_back,
            "min_plays": min_plays
        }))),
        Err(e) => {
            tracing::warn!("Failed to get genre patterns: {}", e);
            Err(AppError::BadRequest(format!(
                "Failed to get genre patterns: {}",
                e
            )))
        }
    }
}

#[derive(Deserialize)]
struct ListeningTimeParams {
    user_id: Uuid,
    period_type: Option<String>,
}

async fn handle_listening_time_query(
    analytics_service: &AnalyticsService<'_>,
    params: serde_json::Value,
) -> Result<Json<serde_json::Value>, AppError> {
    let params: ListeningTimeParams = serde_json::from_value(params)
        .map_err(|e| AppError::BadRequest(format!("Invalid params: {}", e)))?;

    let period_type = params.period_type.as_deref().unwrap_or("day");

    match analytics_service
        .calculate_listening_time_by_period(params.user_id, period_type)
        .await
    {
        Ok(periods) => Ok(Json(json!({
            "user_id": params.user_id,
            "period_type": period_type,
            "listening_periods": periods
        }))),
        Err(e) => {
            tracing::warn!("Failed to get listening time: {}", e);
            Err(AppError::BadRequest(format!(
                "Failed to get listening time: {}",
                e
            )))
        }
    }
}

#[derive(Deserialize)]
struct PopularSongsParams {
    period_hours: Option<i32>,
    limit: Option<i32>,
    min_plays: Option<i32>,
}

async fn handle_popular_songs_query(
    analytics_service: &AnalyticsService<'_>,
    params: serde_json::Value,
) -> Result<Json<serde_json::Value>, AppError> {
    let params: PopularSongsParams = serde_json::from_value(params)
        .map_err(|e| AppError::BadRequest(format!("Invalid params: {}", e)))?;

    let period_hours = params.period_hours.unwrap_or(24 * 7); // default to week
    let limit = params.limit.unwrap_or(20);
    let min_plays = params.min_plays.unwrap_or(3);

    match analytics_service
        .get_popular_songs_by_period(period_hours, limit, min_plays)
        .await
    {
        Ok(popular_songs) => Ok(Json(json!({
            "popular_songs": popular_songs,
            "period_hours": period_hours,
            "limit": limit,
            "min_plays": min_plays
        }))),
        Err(e) => {
            tracing::warn!("Failed to get popular songs: {}", e);
            Err(AppError::BadRequest(format!(
                "Failed to get popular songs: {}",
                e
            )))
        }
    }
}

#[derive(Deserialize)]
struct SongAnalyticsParams {
    media_blob_id: String,
}

async fn handle_song_analytics_query(
    analytics_service: &AnalyticsService<'_>,
    params: serde_json::Value,
) -> Result<Json<serde_json::Value>, AppError> {
    let params: SongAnalyticsParams = serde_json::from_value(params)
        .map_err(|e| AppError::BadRequest(format!("Invalid params: {}", e)))?;

    match analytics_service
        .get_song_play_analytics(&params.media_blob_id)
        .await
    {
        Ok(analytics) => Ok(Json(serde_json::to_value(analytics).unwrap())),
        Err(e) => {
            tracing::warn!("Failed to get song analytics: {}", e);
            Err(AppError::BadRequest(format!(
                "Failed to get song analytics: {}",
                e
            )))
        }
    }
}

async fn handle_top_collections_query(
    analytics_service: &AnalyticsService<'_>,
    params: serde_json::Value,
) -> Result<Json<serde_json::Value>, AppError> {
    let days_back = params.get("days").and_then(|v| v.as_i64()).unwrap_or(7) as i32;
    let limit = params.get("limit").and_then(|v| v.as_i64()).unwrap_or(10) as i32;
    let domain_type = params.get("domain_type").and_then(|v| v.as_str());

    match analytics_service
        .get_top_collections(days_back, limit, domain_type)
        .await
    {
        Ok(collections) => Ok(Json(json!({
            "collections": collections,
            "days_back": days_back,
            "limit": limit,
            "domain_type": domain_type
        }))),
        Err(e) => {
            tracing::error!("Failed to get top collections: {:?}", e);
            Err(AppError::InternalServerError(format!(
                "Failed to get top collections: {}",
                e
            )))
        }
    }
}

async fn handle_collection_overview_query(
    analytics_service: &AnalyticsService<'_>,
    params: serde_json::Value,
) -> Result<Json<serde_json::Value>, AppError> {
    let days_back = params.get("days").and_then(|v| v.as_i64()).unwrap_or(30) as i32;

    match analytics_service.get_collection_overview(days_back).await {
        Ok(overview) => Ok(Json(json!({
            "overview": overview,
            "days_back": days_back
        }))),
        Err(e) => {
            tracing::error!("Failed to get collection overview: {:?}", e);
            Err(AppError::InternalServerError(format!(
                "Failed to get collection overview: {}",
                e
            )))
        }
    }
}

/// Get social feed with recent content and user activity
pub async fn social_feed_handler(
    Query(params): Query<HashMap<String, String>>,
    Extension(database): Extension<DatabaseConnection>,
    _user: Extension<AuthenticatedUser>, // authentication required but feed shows all user activity
) -> Result<Json<FeedResponse>, AppError> {
    let limit = params
        .get("limit")
        .and_then(|s| s.parse().ok())
        .unwrap_or(20)
        .min(100); // max 100 items per request

    let offset = params
        .get("offset")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let days_back = params
        .get("days")
        .and_then(|s| s.parse().ok())
        .unwrap_or(7)
        .min(90); // max 90 days back

    match get_social_feed(database.pool(), limit, offset, days_back).await {
        Ok(response) => Ok(Json(response)),
        Err(e) => {
            tracing::error!("failed to get social feed: {}", e);
            Err(AppError::InternalServerError(format!(
                "failed to fetch social feed: {}",
                e
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use grimoire::analytics::{DomainType, MediaEventType};

    #[test]
    fn test_admin_analytics_query_deserialization() {
        let query_json = json!({
            "query_type": "user_history",
            "params": {
                "user_id": "550e8400-e29b-41d4-a716-446655440000",
                "limit": 50
            }
        });

        let query: AdminAnalyticsQuery = serde_json::from_value(query_json).unwrap();
        assert_eq!(query.query_type, "user_history");
        assert!(query.params["user_id"].is_string());
        assert_eq!(query.params["limit"], 50);
    }

    #[test]
    fn test_media_event_request_deserialization() {
        let request_json = json!({
            "media_blob_id": "test123",
            "event_type": "play",
            "event_data": {
                "position": "00:01:30",
                "progress": 0.25
            },
            "domain_type": "song"
        });

        let request: MediaEventRequest = serde_json::from_value(request_json).unwrap();
        assert_eq!(request.media_blob_id, "test123");
        assert_eq!(request.event_type, MediaEventType::Play);
        assert_eq!(request.domain_type, Some(DomainType::Song.to_string()));
    }

    #[test]
    fn test_batch_request_deserialization() {
        let batch_json = json!({
            "events": [
                {
                    "media_blob_id": "test123",
                    "event_type": "play",
                    "domain_type": "song"
                },
                {
                    "media_blob_id": "test456",
                    "event_type": "complete",
                    "domain_type": "song"
                }
            ]
        });

        let batch: MediaEventBatchRequest = serde_json::from_value(batch_json).unwrap();
        assert_eq!(batch.events.len(), 2);
        assert_eq!(batch.events[0].event_type, MediaEventType::Play);
        assert_eq!(batch.events[1].event_type, MediaEventType::Complete);
    }
}
