//! Simple access logging example for Axum
//!
//! This example demonstrates how to set up HTTP access logging in standard formats
//! without the complexity of the full server setup.

use axum::{
    extract::Request,
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::Response,
    routing::get,
    Router,
};
use std::fs::OpenOptions;
use std::io::Write;
use std::time::Instant;
use time::{format_description, OffsetDateTime};
use tokio::net::TcpListener;
use tower::ServiceBuilder;
use tracing::{info, warn};

/// Simple access log entry
#[derive(Debug)]
struct AccessLogEntry {
    remote_addr: String,
    method: String,
    path: String,
    status: u16,
    response_size: Option<u64>,
    user_agent: String,
    timestamp: String,
    duration_ms: u128,
}

impl AccessLogEntry {
    /// Format as Common Log Format
    fn _to_common_log_format(&self) -> String {
        let size = self
            .response_size
            .map(|s| s.to_string())
            .unwrap_or_else(|| "-".to_string());

        format!(
            r#"{} - - [{}] "{} {} HTTP/1.1" {} {}"#,
            self.remote_addr, self.timestamp, self.method, self.path, self.status, size
        )
    }

    /// Format as Combined Log Format (CLF + referer + user-agent)
    fn to_combined_log_format(&self) -> String {
        let size = self
            .response_size
            .map(|s| s.to_string())
            .unwrap_or_else(|| "-".to_string());

        format!(
            r#"{} - - [{}] "{} {} HTTP/1.1" {} {} "-" "{}" {}ms"#,
            self.remote_addr,
            self.timestamp,
            self.method,
            self.path,
            self.status,
            size,
            self.user_agent,
            self.duration_ms
        )
    }
}

/// Extract client IP from headers (for reverse proxy setups)
fn extract_client_ip(headers: &HeaderMap) -> String {
    // Check X-Forwarded-For first
    if let Some(forwarded_for) = headers.get("x-forwarded-for") {
        if let Ok(value) = forwarded_for.to_str() {
            if let Some(first_ip) = value.split(',').next() {
                return first_ip.trim().to_string();
            }
        }
    }

    // Check X-Real-IP
    if let Some(real_ip) = headers.get("x-real-ip") {
        if let Ok(value) = real_ip.to_str() {
            return value.to_string();
        }
    }

    // Fallback to unknown (in a real app, you might get this from connection info)
    "unknown".to_string()
}

/// Format timestamp in Common Log Format: [10/Oct/2000:13:55:36 +0000]
fn format_timestamp() -> String {
    let now = OffsetDateTime::now_utc();
    let format =
        format_description::parse("[day]/[month repr:short]/[year]:[hour]:[minute]:[second] +0000")
            .unwrap();

    now.format(&format)
        .unwrap_or_else(|_| "unknown".to_string())
}

/// Write log entry to file
async fn write_log_entry(entry: &AccessLogEntry, log_file: &str) {
    let log_line = entry.to_combined_log_format();

    // Write to file (in production, you'd want better error handling and possibly async file I/O)
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_file) {
        if let Err(e) = writeln!(file, "{}", log_line) {
            warn!("Failed to write access log: {}", e);
        }
    }

    // Also log to console for demo
    info!("ACCESS: {}", log_line);
}

/// Access logging middleware
async fn access_log_middleware(request: Request, next: Next) -> Response {
    let start_time = Instant::now();

    // Extract request information
    let method = request.method().to_string();
    let path = request.uri().path().to_string();
    let headers = request.headers().clone();
    let user_agent = headers
        .get("user-agent")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("unknown")
        .to_string();
    let remote_addr = extract_client_ip(&headers);

    // Process the request
    let response = next.run(request).await;

    // Calculate duration and extract response info
    let duration = start_time.elapsed();
    let status = response.status().as_u16();
    let response_size = response
        .headers()
        .get("content-length")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok());

    // Create log entry
    let log_entry = AccessLogEntry {
        remote_addr,
        method,
        path,
        status,
        response_size,
        user_agent,
        timestamp: format_timestamp(),
        duration_ms: duration.as_millis(),
    };

    // Write log asynchronously (spawn task to not block response)
    let log_file = "access.log".to_string();
    tokio::spawn(async move {
        write_log_entry(&log_entry, &log_file).await;
    });

    response
}

/// Simple handler for testing
async fn hello_handler() -> &'static str {
    "Hello, World!"
}

/// Handler that returns different status codes for testing
async fn status_handler() -> StatusCode {
    StatusCode::CREATED
}

/// Handler that simulates an error
async fn error_handler() -> StatusCode {
    StatusCode::INTERNAL_SERVER_ERROR
}

/// Handler with some content
async fn content_handler() -> String {
    "This is a longer response with some content to test response size logging.".to_string()
}

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::fmt::init();

    // Ensure logs directory exists
    std::fs::create_dir_all("logs").unwrap_or_default();

    // Build our router with access logging middleware
    let app = Router::new()
        .route("/", get(hello_handler))
        .route("/status", get(status_handler))
        .route("/error", get(error_handler))
        .route("/content", get(content_handler))
        // Add the access logging middleware to all routes
        .layer(ServiceBuilder::new().layer(middleware::from_fn(access_log_middleware)));

    info!("🚀 Starting simple access log example server");
    info!("📝 Access logs will be written to: access.log");
    info!("🌐 Server running on http://localhost:3000");
    info!("");
    info!("Try these endpoints:");
    info!("  curl http://localhost:3000/");
    info!("  curl http://localhost:3000/status");
    info!("  curl http://localhost:3000/error");
    info!("  curl http://localhost:3000/content");
    info!("  curl -H 'User-Agent: MyApp/1.0' http://localhost:3000/");
    info!("  curl -H 'X-Forwarded-For: 192.168.1.100' http://localhost:3000/");

    // Start the server
    let listener = TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_common_log_format() {
        let entry = AccessLogEntry {
            remote_addr: "192.168.1.1".to_string(),
            method: "GET".to_string(),
            path: "/test".to_string(),
            status: 200,
            response_size: Some(1234),
            user_agent: "Mozilla/5.0".to_string(),
            timestamp: "10/Oct/2000:13:55:36 +0000".to_string(),
            duration_ms: 42,
        };

        let log_line = entry.to_common_log_format();
        assert_eq!(
            log_line,
            r#"192.168.1.1 - - [10/Oct/2000:13:55:36 +0000] "GET /test HTTP/1.1" 200 1234"#
        );
    }

    #[test]
    fn test_combined_log_format() {
        let entry = AccessLogEntry {
            remote_addr: "192.168.1.1".to_string(),
            method: "POST".to_string(),
            path: "/api/data".to_string(),
            status: 201,
            response_size: None,
            user_agent: "curl/7.68.0".to_string(),
            timestamp: "10/Oct/2000:13:55:36 +0000".to_string(),
            duration_ms: 123,
        };

        let log_line = entry.to_combined_log_format();
        assert_eq!(
            log_line,
            r#"192.168.1.1 - - [10/Oct/2000:13:55:36 +0000] "POST /api/data HTTP/1.1" 201 - "-" "curl/7.68.0" 123ms"#
        );
    }

    #[test]
    fn test_extract_client_ip() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            "192.168.1.100, 10.0.0.1".parse().unwrap(),
        );

        let ip = extract_client_ip(&headers);
        assert_eq!(ip, "192.168.1.100");
    }

    #[test]
    fn test_extract_client_ip_real_ip() {
        let mut headers = HeaderMap::new();
        headers.insert("x-real-ip", "203.0.113.42".parse().unwrap());

        let ip = extract_client_ip(&headers);
        assert_eq!(ip, "203.0.113.42");
    }

    #[test]
    fn test_extract_client_ip_fallback() {
        let headers = HeaderMap::new();
        let ip = extract_client_ip(&headers);
        assert_eq!(ip, "unknown");
    }
}
