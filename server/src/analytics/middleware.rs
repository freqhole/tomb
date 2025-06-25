use crate::error::WebauthnError;
use axum::{
    extract::{Extension, Request},
    http::HeaderMap,
    middleware::Next,
    response::Response,
};
use grimoire::analytics::{AnalyticsConfig, AnalyticsService, RequestAnalyticsBuilder};
use grimoire::DatabaseConnection;
use tower_sessions::Session;
use uuid::Uuid;

/// Analytics middleware that logs all requests to the database
pub async fn analytics_middleware(
    session: Session,
    Extension(analytics_config): Extension<AnalyticsConfig>,
    Extension(database): Extension<DatabaseConnection>,
    request: Request,
    next: Next,
) -> Result<Response, WebauthnError> {
    // Extract basic request information
    let method = request.method().to_string();
    let uri = request.uri().clone();
    let path = uri.path().to_string();
    let headers = request.headers().clone();

    // Generate a unique request ID
    let request_id = Uuid::new_v4().to_string();

    // Extract user agent
    let user_agent = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // Extract IP address (simplified - would need proper forwarded header handling in production)
    let ip_address = extract_client_ip(&headers);

    // Get user ID from session if available
    let user_id = session.get::<Uuid>("user_id").await.unwrap_or_default();

    // Record start time
    let start_time = std::time::Instant::now();

    // Process the request
    let response = next.run(request).await;

    // Calculate duration
    let duration_ms = start_time.elapsed().as_millis() as i32;
    let status_code = response.status().as_u16() as i32;

    // Build analytics record
    let analytics = RequestAnalyticsBuilder::new(request_id, method, path, status_code)
        .user_id(user_id)
        .duration_ms(duration_ms)
        .user_agent(user_agent)
        .ip_address(ip_address)
        .build();

    // Log the request (fire and forget - don't block response)
    let db_clone = database.clone();
    let config_clone = analytics_config.clone();
    tokio::spawn(async move {
        let analytics_service = AnalyticsService::new(&db_clone, config_clone);
        if let Err(e) = analytics_service.record_request(analytics).await {
            tracing::warn!("Failed to record analytics: {}", e);
        }
    });

    Ok(response)
}

/// Security logging middleware for authentication events
pub async fn security_logging(
    session: Session,
    request: Request,
    next: Next,
) -> Result<Response, WebauthnError> {
    let method = request.method().clone();
    let uri = request.uri().clone();
    let path = uri.path();

    // Log security-relevant paths
    if is_security_path(path) {
        let user_id = session.get::<Uuid>("user_id").await.unwrap_or_default();

        tracing::info!(
            method = %method,
            path = %path,
            user_id = ?user_id,
            "Security event"
        );
    }

    Ok(next.run(request).await)
}

/// Extract client IP address from headers
fn extract_client_ip(headers: &HeaderMap) -> Option<String> {
    // Check common forwarded headers
    headers
        .get("x-forwarded-for")
        .or_else(|| headers.get("x-real-ip"))
        .or_else(|| headers.get("cf-connecting-ip"))
        .and_then(|v| v.to_str().ok())
        .map(|s| {
            // Take the first IP if there are multiple (comma-separated)
            s.split(',').next().unwrap_or(s).trim().to_string()
        })
}

/// Check if a path is security-relevant
fn is_security_path(path: &str) -> bool {
    path.starts_with("/auth/")
        || path.starts_with("/webauthn/")
        || path.contains("login")
        || path.contains("register")
        || path.contains("logout")
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn test_extract_client_ip() {
        let mut headers = HeaderMap::new();

        // Test x-forwarded-for
        headers.insert(
            "x-forwarded-for",
            HeaderValue::from_static("192.168.1.1, 10.0.0.1"),
        );
        assert_eq!(extract_client_ip(&headers), Some("192.168.1.1".to_string()));

        // Test x-real-ip
        headers.clear();
        headers.insert("x-real-ip", HeaderValue::from_static("192.168.1.2"));
        assert_eq!(extract_client_ip(&headers), Some("192.168.1.2".to_string()));

        // Test no headers
        headers.clear();
        assert_eq!(extract_client_ip(&headers), None);
    }

    #[test]
    fn test_is_security_path() {
        assert!(is_security_path("/auth/login"));
        assert!(is_security_path("/webauthn/register"));
        assert!(is_security_path("/some/login/path"));
        assert!(!is_security_path("/api/users"));
        assert!(!is_security_path("/health"));
    }
}
