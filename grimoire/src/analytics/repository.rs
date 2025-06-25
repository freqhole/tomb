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
}
