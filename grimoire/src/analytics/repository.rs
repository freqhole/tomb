use super::media_events::{
    GenreListeningPattern, ListeningTimePeriod, MediaAnalyticsError, MediaEvent, MediaEventType,
    PlayAnalytics, PopularSong, TrendingSong, UserListeningHistory, UserListeningStreaks,
};
use super::models::{
    AnalyticsError, PathMetric, RequestAnalytics, RequestMetrics, TimeSeriesPoint,
};
use crate::DatabaseConnection;
use num_traits::ToPrimitive;
use time::OffsetDateTime;
use uuid::Uuid;

/// Repository for analytics-related database operations
pub struct AnalyticsRepository<'a> {
    db: &'a DatabaseConnection,
}

impl<'a> AnalyticsRepository<'a> {
    /// Create a new AnalyticsRepository
    pub fn new(db: &'a DatabaseConnection) -> Self {
        Self { db }
    }

    /// Record a new request analytics entry
    pub async fn record_request(&self, analytics: &RequestAnalytics) -> Result<(), AnalyticsError> {
        sqlx::query!(
            r#"
            INSERT INTO request_analytics (
                request_id, timestamp, user_id, method, path, status_code,
                duration_ms, user_agent, ip_address, request_data, response_size,
                error_message, trace_id, span_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            "#,
            analytics.request_id,
            analytics.timestamp,
            analytics.user_id,
            analytics.method,
            analytics.path,
            analytics.status_code,
            analytics.duration_ms,
            analytics.user_agent,
            analytics.ip_address,
            analytics.request_data,
            analytics.response_size,
            analytics.error_message,
            analytics.trace_id,
            analytics.span_id
        )
        .execute(self.db.pool())
        .await?;

        Ok(())
    }

    /// Get request analytics for a specific time range
    pub async fn get_requests_in_range(
        &self,
        from: OffsetDateTime,
        to: OffsetDateTime,
    ) -> Result<Vec<RequestAnalytics>, AnalyticsError> {
        let rows = sqlx::query!(
            r#"
            SELECT id, request_id, timestamp, user_id, method, path, status_code,
                   duration_ms, user_agent, ip_address, request_data, response_size,
                   error_message, trace_id, span_id
            FROM request_analytics
            WHERE timestamp >= $1 AND timestamp <= $2
            ORDER BY timestamp DESC
            "#,
            from,
            to
        )
        .fetch_all(self.db.pool())
        .await?;

        Ok(rows
            .into_iter()
            .map(|r| RequestAnalytics {
                id: r.id,
                request_id: r.request_id,
                timestamp: r.timestamp,
                user_id: r.user_id,
                method: r.method,
                path: r.path,
                status_code: r.status_code,
                duration_ms: r.duration_ms,
                user_agent: r.user_agent,
                ip_address: r.ip_address,
                request_data: r.request_data,
                response_size: r.response_size,
                error_message: r.error_message,
                trace_id: r.trace_id,
                span_id: r.span_id,
            })
            .collect())
    }

    /// Get request analytics for a specific user
    pub async fn get_user_requests(
        &self,
        user_id: Uuid,
        from: OffsetDateTime,
        to: OffsetDateTime,
    ) -> Result<Vec<RequestAnalytics>, AnalyticsError> {
        let rows = sqlx::query!(
            r#"
            SELECT id, request_id, timestamp, user_id, method, path, status_code,
                   duration_ms, user_agent, ip_address, request_data, response_size,
                   error_message, trace_id, span_id
            FROM request_analytics
            WHERE user_id = $1 AND timestamp >= $2 AND timestamp <= $3
            ORDER BY timestamp DESC
            "#,
            user_id,
            from,
            to
        )
        .fetch_all(self.db.pool())
        .await?;

        Ok(rows
            .into_iter()
            .map(|r| RequestAnalytics {
                id: r.id,
                request_id: r.request_id,
                timestamp: r.timestamp,
                user_id: r.user_id,
                method: r.method,
                path: r.path,
                status_code: r.status_code,
                duration_ms: r.duration_ms,
                user_agent: r.user_agent,
                ip_address: r.ip_address,
                request_data: r.request_data,
                response_size: r.response_size,
                error_message: r.error_message,
                trace_id: r.trace_id,
                span_id: r.span_id,
            })
            .collect())
    }

    /// Get aggregated request metrics for a time range
    pub async fn get_request_metrics(
        &self,
        from: OffsetDateTime,
        to: OffsetDateTime,
    ) -> Result<RequestMetrics, AnalyticsError> {
        // Get total requests and unique users
        let summary_row = sqlx::query!(
            r#"
            SELECT
                COUNT(*) as total_requests,
                COUNT(DISTINCT user_id) as unique_users,
                AVG(duration_ms) as avg_response_time,
                COUNT(CASE WHEN status_code >= 400 THEN 1 END)::FLOAT / COUNT(*)::FLOAT as error_rate
            FROM request_analytics
            WHERE timestamp >= $1 AND timestamp <= $2
            "#,
            from,
            to
        )
        .fetch_one(self.db.pool())
        .await?;

        // Get most active paths
        let path_rows = sqlx::query!(
            r#"
            SELECT
                path,
                COUNT(*) as request_count,
                AVG(duration_ms) as avg_response_time,
                COUNT(CASE WHEN status_code >= 400 THEN 1 END) as error_count
            FROM request_analytics
            WHERE timestamp >= $1 AND timestamp <= $2
            GROUP BY path
            ORDER BY request_count DESC
            LIMIT 10
            "#,
            from,
            to
        )
        .fetch_all(self.db.pool())
        .await?;

        let most_active_paths = path_rows
            .into_iter()
            .map(|r| PathMetric {
                path: r.path,
                request_count: r.request_count.unwrap_or(0),
                average_response_time: r.avg_response_time.and_then(|d| d.to_f64()).unwrap_or(0.0),
                error_count: r.error_count.unwrap_or(0),
            })
            .collect();

        Ok(RequestMetrics {
            total_requests: summary_row.total_requests.unwrap_or(0),
            unique_users: summary_row.unique_users.unwrap_or(0),
            average_response_time: summary_row
                .avg_response_time
                .and_then(|d| d.to_f64())
                .unwrap_or(0.0),
            error_rate: summary_row.error_rate.unwrap_or(0.0),
            most_active_paths,
        })
    }

    /// Get time-series data for request volume
    pub async fn get_request_volume_timeseries(
        &self,
        from: OffsetDateTime,
        to: OffsetDateTime,
        interval_minutes: i32,
    ) -> Result<Vec<TimeSeriesPoint>, AnalyticsError> {
        let rows = sqlx::query!(
            r#"
            SELECT
                DATE_TRUNC('minute', timestamp) +
                (EXTRACT(MINUTE FROM timestamp)::INTEGER / $3) * INTERVAL '1 minute' * $3 as time_bucket,
                COUNT(*) as request_count
            FROM request_analytics
            WHERE timestamp >= $1 AND timestamp <= $2
            GROUP BY time_bucket
            ORDER BY time_bucket
            "#,
            from,
            to,
            interval_minutes
        )
        .fetch_all(self.db.pool())
        .await?;

        Ok(rows
            .into_iter()
            .map(|r| TimeSeriesPoint {
                timestamp: r.time_bucket.unwrap(),
                value: r.request_count.unwrap_or(0) as f64,
                label: None,
            })
            .collect())
    }

    /// Get error rate time-series data
    pub async fn get_error_rate_timeseries(
        &self,
        from: OffsetDateTime,
        to: OffsetDateTime,
        interval_minutes: i32,
    ) -> Result<Vec<TimeSeriesPoint>, AnalyticsError> {
        let rows = sqlx::query!(
            r#"
            SELECT
                DATE_TRUNC('minute', timestamp) +
                (EXTRACT(MINUTE FROM timestamp)::INTEGER / $3) * INTERVAL '1 minute' * $3 as time_bucket,
                COUNT(CASE WHEN status_code >= 400 THEN 1 END)::FLOAT / COUNT(*)::FLOAT as error_rate
            FROM request_analytics
            WHERE timestamp >= $1 AND timestamp <= $2
            GROUP BY time_bucket
            ORDER BY time_bucket
            "#,
            from,
            to,
            interval_minutes
        )
        .fetch_all(self.db.pool())
        .await?;

        Ok(rows
            .into_iter()
            .map(|r| TimeSeriesPoint {
                timestamp: r.time_bucket.unwrap(),
                value: r.error_rate.unwrap_or(0.0),
                label: None,
            })
            .collect())
    }

    /// Clean up old analytics data
    pub async fn cleanup_old_data(
        &self,
        older_than: OffsetDateTime,
    ) -> Result<u64, AnalyticsError> {
        let result = sqlx::query!(
            r#"
            DELETE FROM request_analytics
            WHERE timestamp < $1
            "#,
            older_than
        )
        .execute(self.db.pool())
        .await?;

        Ok(result.rows_affected())
    }

    /// Record a media event
    pub async fn record_media_event(&self, event: &MediaEvent) -> Result<(), MediaAnalyticsError> {
        // Convert event_data to JSON
        let event_data_json = serde_json::to_value(&event.event_data)
            .map_err(|e| MediaAnalyticsError::Serialization(e))?;

        sqlx::query!(
            r#"
            INSERT INTO media_events (
                id, media_blob_id, user_id, event_type, event_data,
                session_id, user_agent, client_id,
                domain_type, domain_id, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            "#,
            event.id,
            event.media_blob_id,
            event.user_id,
            event.event_type.to_string(),
            event_data_json,
            event.session_id,
            event.user_agent,
            event.client_id,
            event.domain_type.as_ref().map(|d| d.to_string()),
            event.domain_id,
            event.created_at
        )
        .execute(self.db.pool())
        .await?;

        Ok(())
    }

    /// Record multiple media events in a batch
    pub async fn record_media_events_batch(
        &self,
        events: &[MediaEvent],
    ) -> Result<usize, MediaAnalyticsError> {
        if events.is_empty() {
            return Ok(0);
        }

        let mut tx = self.db.pool().begin().await?;
        let mut processed = 0;

        for event in events {
            let event_data_json = serde_json::to_value(&event.event_data)
                .map_err(|e| MediaAnalyticsError::Serialization(e))?;

            let result = sqlx::query!(
                r#"
                INSERT INTO media_events (
                    id, media_blob_id, user_id, event_type, event_data,
                    session_id, user_agent, client_id,
                    domain_type, domain_id, created_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                "#,
                event.id,
                event.media_blob_id,
                event.user_id,
                event.event_type.to_string(),
                event_data_json,
                event.session_id,
                event.user_agent,
                event.client_id,
                event.domain_type.as_ref().map(|d| d.to_string()),
                event.domain_id,
                event.created_at
            )
            .execute(&mut *tx)
            .await;

            match result {
                Ok(_) => processed += 1,
                Err(e) => {
                    tracing::warn!("Failed to insert media event {}: {}", event.id, e);
                    // Continue processing other events
                }
            }
        }

        tx.commit().await?;
        Ok(processed)
    }

    /// Get media events for a specific session
    pub async fn get_media_events_for_session(
        &self,
        session_id: Uuid,
    ) -> Result<Vec<MediaEvent>, MediaAnalyticsError> {
        let rows = sqlx::query!(
            r#"
            SELECT id, media_blob_id, user_id, event_type, event_data,
                   session_id, user_agent, client_id,
                   domain_type, domain_id, created_at
            FROM media_events
            WHERE session_id = $1
            ORDER BY created_at ASC
            "#,
            session_id
        )
        .fetch_all(self.db.pool())
        .await?;

        let mut events = Vec::new();
        for row in rows {
            let event_type = MediaEventType::try_from(row.event_type.as_str())
                .map_err(|_| MediaAnalyticsError::InvalidEventType(row.event_type.clone()))?;

            let event_data = serde_json::from_value(row.event_data.unwrap_or_default())
                .map_err(|e| MediaAnalyticsError::Serialization(e))?;

            let domain_type = row
                .domain_type
                .map(|dt| serde_json::from_str(&format!("\"{}\"", dt)))
                .transpose()
                .map_err(|e| MediaAnalyticsError::Serialization(e))?;

            events.push(MediaEvent {
                id: row.id,
                media_blob_id: row.media_blob_id,
                user_id: row.user_id,
                event_type,
                event_data,
                session_id: row.session_id,
                user_agent: row.user_agent,
                client_id: row.client_id,
                domain_type: domain_type.flatten(),
                domain_id: row.domain_id,
                created_at: row.created_at,
            });
        }

        Ok(events)
    }

    /// Get play analytics for a specific media blob
    pub async fn get_song_play_analytics(
        &self,
        media_blob_id: &str,
    ) -> Result<PlayAnalytics, MediaAnalyticsError> {
        let row = sqlx::query!(
            r#"
            SELECT * FROM get_song_play_analytics($1)
            "#,
            media_blob_id
        )
        .fetch_one(self.db.pool())
        .await?;

        Ok(PlayAnalytics {
            media_blob_id: row
                .media_blob_id
                .unwrap_or_else(|| media_blob_id.to_string()),
            total_plays: row.total_plays.unwrap_or(0),
            complete_plays: row.complete_plays.unwrap_or(0),
            partial_plays: row.partial_plays.unwrap_or(0),
            unique_users: row.unique_users.unwrap_or(0),
            unique_sessions: row.unique_sessions.unwrap_or(0),
            avg_completion_rate: row
                .avg_completion_rate
                .and_then(|d| d.to_f64())
                .unwrap_or(0.0),
            total_play_time_seconds: row.total_play_time_seconds.unwrap_or(0),
            avg_play_time_seconds: row
                .avg_play_time_seconds
                .and_then(|d| d.to_f64())
                .unwrap_or(0.0),
            last_played_at: row.last_played_at,
            first_played_at: row.first_played_at,
            play_count_last_24h: row.play_count_last_24h.unwrap_or(0),
            play_count_last_7d: row.play_count_last_7d.unwrap_or(0),
            play_count_last_30d: row.play_count_last_30d.unwrap_or(0),
        })
    }

    /// Get trending songs based on play velocity and momentum
    pub async fn get_trending_songs(
        &self,
        time_period_hours: i32,
        limit_count: i32,
        domain_filter: Option<&str>,
    ) -> Result<Vec<TrendingSong>, MediaAnalyticsError> {
        let rows = sqlx::query!(
            r#"
            SELECT * FROM get_trending_songs($1, $2, $3)
            "#,
            time_period_hours,
            limit_count,
            domain_filter
        )
        .fetch_all(self.db.pool())
        .await?;

        let trending_songs = rows
            .into_iter()
            .map(|row| TrendingSong {
                media_blob_id: row.media_blob_id.unwrap_or_default(),
                domain_id: row.domain_id,
                current_period_plays: row.current_period_plays.unwrap_or(0),
                previous_period_plays: row.previous_period_plays.unwrap_or(0),
                trend_score: row.trend_score.and_then(|d| d.to_f64()).unwrap_or(0.0),
                velocity_score: row.velocity_score.and_then(|d| d.to_f64()).unwrap_or(0.0),
                unique_users: row.unique_users.unwrap_or(0),
                completion_rate: row.completion_rate.and_then(|d| d.to_f64()).unwrap_or(0.0),
            })
            .collect();

        Ok(trending_songs)
    }

    /// Get user listening streaks and engagement patterns
    pub async fn get_user_listening_streaks(
        &self,
        user_id: Uuid,
    ) -> Result<Option<UserListeningStreaks>, MediaAnalyticsError> {
        let row = sqlx::query!(
            r#"
            SELECT * FROM get_user_listening_streaks($1)
            "#,
            user_id
        )
        .fetch_optional(self.db.pool())
        .await?;

        if let Some(row) = row {
            Ok(Some(UserListeningStreaks {
                user_id: row.user_id.unwrap_or(user_id),
                current_streak_days: row.current_streak_days.unwrap_or(0),
                longest_streak_days: row.longest_streak_days.unwrap_or(0),
                total_listening_days: row.total_listening_days.unwrap_or(0),
                avg_daily_plays: row.avg_daily_plays.and_then(|d| d.to_f64()).unwrap_or(0.0),
                favorite_listening_hour: row.favorite_listening_hour.unwrap_or(0),
                most_played_day_of_week: row.most_played_day_of_week.unwrap_or(0),
                total_unique_songs: row.total_unique_songs.unwrap_or(0),
                completion_rate: row.completion_rate.and_then(|d| d.to_f64()).unwrap_or(0.0),
            }))
        } else {
            Ok(None)
        }
    }

    /// Get genre listening patterns for music taste analysis
    pub async fn get_genre_listening_patterns(
        &self,
        days_back: i32,
        min_plays: i32,
    ) -> Result<Vec<GenreListeningPattern>, MediaAnalyticsError> {
        let rows = sqlx::query!(
            r#"
            SELECT * FROM get_genre_listening_patterns($1, $2)
            "#,
            days_back,
            min_plays
        )
        .fetch_all(self.db.pool())
        .await?;

        let patterns = rows
            .into_iter()
            .map(|row| GenreListeningPattern {
                genre: row.genre.unwrap_or_else(|| "unknown".to_string()),
                total_plays: row.total_plays.unwrap_or(0),
                unique_users: row.unique_users.unwrap_or(0),
                unique_songs: row.unique_songs.unwrap_or(0),
                avg_completion_rate: row
                    .avg_completion_rate
                    .and_then(|d| d.to_f64())
                    .unwrap_or(0.0),
                trend_direction: row.trend_direction.unwrap_or_else(|| "stable".to_string()),
                popularity_rank: row.popularity_rank.unwrap_or(0),
            })
            .collect();

        Ok(patterns)
    }

    /// Calculate listening time by time period for user analytics
    pub async fn calculate_listening_time_by_period(
        &self,
        user_id: Uuid,
        period_type: &str,
    ) -> Result<Vec<ListeningTimePeriod>, MediaAnalyticsError> {
        let rows = sqlx::query!(
            r#"
            SELECT * FROM calculate_listening_time_by_period($1, $2)
            "#,
            user_id,
            period_type
        )
        .fetch_all(self.db.pool())
        .await?;

        let periods = rows
            .into_iter()
            .map(|row| ListeningTimePeriod {
                period_start: row
                    .period_start
                    .unwrap_or_else(|| OffsetDateTime::now_utc()),
                period_end: row.period_end.unwrap_or_else(|| OffsetDateTime::now_utc()),
                total_listening_seconds: row.total_listening_seconds.unwrap_or(0),
                unique_songs_played: row.unique_songs_played.unwrap_or(0),
                total_play_events: row.total_play_events.unwrap_or(0),
                avg_session_length_minutes: row
                    .avg_session_length_minutes
                    .and_then(|d| d.to_f64())
                    .unwrap_or(0.0),
            })
            .collect();

        Ok(periods)
    }

    /// Get popular songs by time period with momentum calculation
    pub async fn get_popular_songs_by_period(
        &self,
        period_hours: i32,
        limit_count: i32,
        min_plays: i32,
    ) -> Result<Vec<PopularSong>, MediaAnalyticsError> {
        let rows = sqlx::query!(
            r#"
            SELECT * FROM get_popular_songs_by_period($1, $2, $3)
            "#,
            period_hours,
            limit_count,
            min_plays
        )
        .fetch_all(self.db.pool())
        .await?;

        let popular_songs = rows
            .into_iter()
            .map(|row| PopularSong {
                media_blob_id: row.media_blob_id.unwrap_or_default(),
                domain_id: row.domain_id,
                play_count: row.play_count.unwrap_or(0),
                unique_users: row.unique_users.unwrap_or(0),
                completion_rate: row.completion_rate.and_then(|d| d.to_f64()).unwrap_or(0.0),
                momentum_score: row.momentum_score.and_then(|d| d.to_f64()).unwrap_or(0.0),
                first_play_at: row
                    .first_play_at
                    .unwrap_or_else(|| OffsetDateTime::now_utc()),
                latest_play_at: row
                    .latest_play_at
                    .unwrap_or_else(|| OffsetDateTime::now_utc()),
            })
            .collect();

        Ok(popular_songs)
    }

    /// Get overview analytics statistics
    pub async fn get_overview_analytics(
        &self,
    ) -> Result<(i64, i64, i64, i64), MediaAnalyticsError> {
        let row = sqlx::query!(
            r#"
            SELECT
                COUNT(*) as total_events,
                COUNT(*) FILTER (WHERE event_type = 'play') as total_plays,
                COUNT(DISTINCT user_id) as unique_users,
                COUNT(DISTINCT session_id) FILTER (WHERE created_at >= NOW() - INTERVAL '1 hour') as active_sessions
            FROM media_events
            "#
        )
        .fetch_one(self.db.pool())
        .await?;

        Ok((
            row.total_events.unwrap_or(0),
            row.total_plays.unwrap_or(0),
            row.unique_users.unwrap_or(0),
            row.active_sessions.unwrap_or(0),
        ))
    }

    /// Refresh all analytics materialized views
    pub async fn refresh_analytics_materialized_views(
        &self,
    ) -> Result<Vec<(String, String)>, MediaAnalyticsError> {
        let _result = sqlx::query!(
            r#"
            SELECT refresh_all_analytics_views()
            "#
        )
        .fetch_one(self.db.pool())
        .await?;

        // Return success indicators
        Ok(vec![
            ("song_play_summary".to_string(), "refreshed".to_string()),
            (
                "user_listening_summary".to_string(),
                "refreshed".to_string(),
            ),
            ("trending_analysis".to_string(), "refreshed".to_string()),
        ])
    }

    /// Get user listening history
    pub async fn get_user_listening_history(
        &self,
        user_id: Uuid,
        limit: Option<i32>,
        offset: Option<i32>,
    ) -> Result<Vec<UserListeningHistory>, MediaAnalyticsError> {
        let limit = limit.unwrap_or(50);
        let offset = offset.unwrap_or(0);

        let rows = sqlx::query!(
            r#"
            SELECT media_blob_id, event_type, event_data, domain_type,
                   domain_id, session_id, created_at
            FROM media_events
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
            "#,
            user_id,
            limit as i64,
            offset as i64
        )
        .fetch_all(self.db.pool())
        .await?;

        let mut history = Vec::new();
        for row in rows {
            let event_type = MediaEventType::try_from(row.event_type.as_str())
                .map_err(|_| MediaAnalyticsError::InvalidEventType(row.event_type.clone()))?;

            let event_data = serde_json::from_value(row.event_data.unwrap_or_default())
                .map_err(|e| MediaAnalyticsError::Serialization(e))?;

            let domain_type = row
                .domain_type
                .map(|dt| serde_json::from_str(&format!("\"{}\"", dt)))
                .transpose()
                .map_err(|e| MediaAnalyticsError::Serialization(e))?;

            history.push(UserListeningHistory {
                media_blob_id: row.media_blob_id,
                event_type,
                event_data,
                domain_type: domain_type.flatten(),
                domain_id: row.domain_id,
                session_id: row.session_id,
                created_at: row.created_at,
            });
        }

        Ok(history)
    }
}
