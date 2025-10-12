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
    AnalyticsService, MediaAnalyticsError, MediaEventBatchRequest, MediaEventBatchResponse,
    MediaEventRequest, MediaEventResponse, PlayAnalytics,
};
use grimoire::DatabaseConnection;
use serde::Deserialize;
use serde_json::json;
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
        // Single event
        let event = analytics_service.create_media_event_from_request(
            single_request,
            Some(user_id),
            session_id,
            user_agent,
        );

        match analytics_service.record_media_event(event.clone()).await {
            Ok(_) => {
                let response = MediaEventResponse {
                    id: event.id,
                    created_at: event.created_at,
                    status: "recorded".to_string(),
                };
                Ok(Json(serde_json::to_value(response).unwrap()))
            }
            Err(e) => {
                tracing::warn!("Failed to record media event: {}", e);
                Err(AppError::BadRequest(format!(
                    "Failed to record event: {}",
                    e
                )))
            }
        }
    } else if let Ok(batch_request) = serde_json::from_value::<MediaEventBatchRequest>(payload) {
        // Batch events
        let mut events = Vec::new();
        let mut responses = Vec::new();
        let mut errors = Vec::new();

        for request in batch_request.events {
            let event = analytics_service.create_media_event_from_request(
                request,
                Some(user_id),
                session_id,
                user_agent.clone(),
            );

            responses.push(MediaEventResponse {
                id: event.id,
                created_at: event.created_at,
                status: "pending".to_string(),
            });

            events.push(event);
        }

        match analytics_service.record_media_events_batch(events).await {
            Ok(processed) => {
                let failed = responses.len() - processed;

                // Update response statuses
                for (i, response) in responses.iter_mut().enumerate() {
                    if i < processed {
                        response.status = "recorded".to_string();
                    } else {
                        response.status = "failed".to_string();
                        errors.push(format!("Event {} failed to record", response.id));
                    }
                }

                let batch_response = MediaEventBatchResponse {
                    processed,
                    failed,
                    events: responses,
                    errors,
                };

                Ok(Json(serde_json::to_value(batch_response).unwrap()))
            }
            Err(e) => {
                tracing::warn!("Failed to record media events batch: {}", e);
                Err(AppError::BadRequest(format!(
                    "Failed to record batch: {}",
                    e
                )))
            }
        }
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
        _ => Err(AppError::BadRequest(format!(
            "Unknown query type: {}",
            query.query_type
        ))),
    }
}

async fn handle_overview_query(
    _analytics_service: &AnalyticsService<'_>,
    _params: serde_json::Value,
) -> Result<Json<serde_json::Value>, AppError> {
    // TODO: Implement overview analytics
    let overview = json!({
        "total_events": 0,
        "total_plays": 0,
        "unique_users": 0,
        "active_sessions": 0,
        "note": "Overview analytics not yet implemented"
    });

    Ok(Json(overview))
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

#[cfg(test)]
mod tests {
    use super::*;
    use grimoire::analytics::{DomainType, MediaEventData, MediaEventType};

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
        assert_eq!(request.domain_type, Some(DomainType::Song));
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
