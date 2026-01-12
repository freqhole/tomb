//! Integration tests for access logging functionality

use axum::{
    extract::Request,
    http::{Method, StatusCode},
    middleware,
    routing::get,
    Router,
};
use server::logging::{AccessLogConfig, AccessLogFormat, AccessLogger};
use std::fs;
use std::path::Path;
use tower::ServiceExt;

async fn test_handler() -> &'static str {
    "Hello, World!"
}

async fn error_handler() -> StatusCode {
    StatusCode::INTERNAL_SERVER_ERROR
}

fn create_test_logger(log_file: &str, format: AccessLogFormat) -> AccessLogger {
    // Ensure test directory exists
    if let Some(parent) = Path::new(log_file).parent() {
        fs::create_dir_all(parent).unwrap();
    }

    // Remove existing log file
    let _ = fs::remove_file(log_file);

    AccessLogger::new(AccessLogConfig {
        file_path: log_file.to_string(),
        format,
        also_log_to_tracing: false,
    })
    .unwrap()
}

fn read_log_file(log_file: &str) -> String {
    fs::read_to_string(log_file).unwrap_or_default()
}

#[tokio::test]
async fn test_access_log_common_format() {
    let log_file = "target/test_logs/access_common.log";
    let logger = create_test_logger(log_file, AccessLogFormat::CommonLog);

    let app = Router::new()
        .route("/", get(test_handler))
        .layer(middleware::from_fn(
            server::logging::access_log_middleware_with_logger(logger),
        ));

    // Make a test request
    let request = Request::builder()
        .method(Method::GET)
        .uri("/")
        .header("user-agent", "test-agent/1.0")
        .body(axum::body::Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // Give a moment for the async log write to complete
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    // Check log file
    let log_content = read_log_file(log_file);
    assert!(!log_content.is_empty());

    // Should contain: IP - - [timestamp] "GET / HTTP/1.1" 200 size
    assert!(log_content.contains("GET / "));
    assert!(log_content.contains("200"));
    assert!(log_content.contains("unknown")); // IP address when not behind proxy
}

#[tokio::test]
async fn test_access_log_combined_format() {
    let log_file = "target/test_logs/access_combined.log";
    let logger = create_test_logger(log_file, AccessLogFormat::CombinedLog);

    let app = Router::new()
        .route("/test", get(test_handler))
        .layer(middleware::from_fn(
            server::logging::access_log_middleware_with_logger(logger),
        ));

    // Make a test request with headers
    let request = Request::builder()
        .method(Method::GET)
        .uri("/test")
        .header("user-agent", "Mozilla/5.0 (Test Browser)")
        .header("referer", "https://example.com")
        .body(axum::body::Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // Give a moment for the async log write to complete
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    // Check log file
    let log_content = read_log_file(log_file);
    assert!(!log_content.is_empty());

    // Should contain: IP - - [timestamp] "GET /test HTTP/1.1" 200 size "referer" "user-agent"
    assert!(log_content.contains("GET /test "));
    assert!(log_content.contains("200"));
    assert!(log_content.contains("https://example.com"));
    assert!(log_content.contains("Mozilla/5.0 (Test Browser)"));
}

#[tokio::test]
async fn test_access_log_custom_format() {
    let log_file = "target/test_logs/access_custom.log";
    let custom_template = "{method} {path} -> {status}";
    let logger = create_test_logger(
        log_file,
        AccessLogFormat::Custom(custom_template.to_string()),
    );

    let app = Router::new()
        .route("/custom", get(test_handler))
        .layer(middleware::from_fn(
            server::logging::access_log_middleware_with_logger(logger),
        ));

    // Make a test request
    let request = Request::builder()
        .method(Method::POST)
        .uri("/custom")
        .body(axum::body::Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // Give a moment for the async log write to complete
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    // Check log file
    let log_content = read_log_file(log_file);
    assert!(!log_content.is_empty());

    // Should contain: POST /custom -> 200
    assert!(log_content.contains("POST /custom -> 200"));
}

#[tokio::test]
async fn test_access_log_error_status() {
    let log_file = "target/test_logs/access_error.log";
    let logger = create_test_logger(log_file, AccessLogFormat::CommonLog);

    let app = Router::new()
        .route("/error", get(error_handler))
        .layer(middleware::from_fn(
            server::logging::access_log_middleware_with_logger(logger),
        ));

    // Make a test request
    let request = Request::builder()
        .method(Method::GET)
        .uri("/error")
        .body(axum::body::Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);

    // Give a moment for the async log write to complete
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    // Check log file
    let log_content = read_log_file(log_file);
    assert!(!log_content.is_empty());

    // Should log 500 error
    assert!(log_content.contains("500"));
    assert!(log_content.contains("GET /error "));
}

#[tokio::test]
async fn test_access_log_with_proxy_headers() {
    let log_file = "target/test_logs/access_proxy.log";
    let logger = create_test_logger(log_file, AccessLogFormat::CombinedLog);

    let app = Router::new()
        .route("/", get(test_handler))
        .layer(middleware::from_fn(
            server::logging::access_log_middleware_with_logger(logger),
        ));

    // Make a test request with proxy headers
    let request = Request::builder()
        .method(Method::GET)
        .uri("/")
        .header("x-forwarded-for", "192.168.1.100, 10.0.0.1")
        .header("x-real-ip", "192.168.1.100")
        .header("user-agent", "curl/7.68.0")
        .body(axum::body::Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // Give a moment for the async log write to complete
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    // Check log file
    let log_content = read_log_file(log_file);
    assert!(!log_content.is_empty());

    // Should extract the first IP from X-Forwarded-For
    assert!(log_content.contains("192.168.1.100"));
    assert!(log_content.contains("curl/7.68.0"));
}

#[tokio::test]
async fn test_access_log_multiple_requests() {
    let log_file = "target/test_logs/access_multiple.log";
    let logger = create_test_logger(log_file, AccessLogFormat::CommonLog);

    let app = Router::new()
        .route("/", get(test_handler))
        .route("/test", get(test_handler))
        .layer(middleware::from_fn(
            server::logging::access_log_middleware_with_logger(logger),
        ));

    // Make multiple requests
    for i in 0..3 {
        let path = if i == 0 { "/" } else { "/test" };
        let request = Request::builder()
            .method(Method::GET)
            .uri(path)
            .header("user-agent", format!("test-agent-{}", i))
            .body(axum::body::Body::empty())
            .unwrap();

        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    // Give a moment for all async log writes to complete
    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    // Check log file
    let log_content = read_log_file(log_file);
    assert!(!log_content.is_empty());

    // Should have multiple log lines
    let lines: Vec<&str> = log_content.trim().split('\n').collect();
    assert_eq!(lines.len(), 3);

    // Each line should contain the request info
    for line in lines {
        assert!(line.contains("200"));
        assert!(line.contains("GET"));
    }
}

#[tokio::test]
async fn test_access_log_different_methods() {
    let log_file = "target/test_logs/access_methods.log";
    let logger = create_test_logger(log_file, AccessLogFormat::CombinedLog);

    let app = Router::new()
        .route("/", get(test_handler).post(test_handler).put(test_handler))
        .layer(middleware::from_fn(
            server::logging::access_log_middleware_with_logger(logger),
        ));

    // Test different HTTP methods
    let methods = [Method::GET, Method::POST, Method::PUT];

    for method in methods {
        let request = Request::builder()
            .method(method.clone())
            .uri("/")
            .body(axum::body::Body::empty())
            .unwrap();

        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    // Give a moment for all async log writes to complete
    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    // Check log file
    let log_content = read_log_file(log_file);
    assert!(!log_content.is_empty());

    // Should log all methods
    assert!(log_content.contains("GET /"));
    assert!(log_content.contains("POST /"));
    assert!(log_content.contains("PUT /"));
}

// Cleanup function for tests
#[tokio::test]
async fn cleanup_test_logs() {
    let _ = fs::remove_dir_all("target/test_logs");
}
