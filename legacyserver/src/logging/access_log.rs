//! Access log middleware for standard HTTP access logging
//!
//! Provides middleware that writes access logs in standard formats like Common Log Format (CLF)
//! and Combined Log Format, similar to Apache/Nginx access logs.

use axum::{extract::Request, http::HeaderMap, middleware::Next, response::Response};
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;
use tracing::error;

/// Access log format options
#[derive(Debug, Clone)]
pub enum AccessLogFormat {
    /// Common Log Format: IP - - [timestamp] "METHOD path HTTP/version" status size
    CommonLog,
    /// Combined Log Format: CLF + "referer" "user-agent"
    CombinedLog,
    /// Custom format with configurable fields
    Custom(String),
}

/// Configuration for access logging
#[derive(Debug, Clone)]
pub struct AccessLogConfig {
    /// Log file path
    pub file_path: String,
    /// Log format to use
    pub format: AccessLogFormat,
    /// Whether to also log to stdout/tracing
    pub also_log_to_tracing: bool,
}

impl Default for AccessLogConfig {
    fn default() -> Self {
        Self {
            file_path: "logs/access.log".to_string(),
            format: AccessLogFormat::CombinedLog,
            also_log_to_tracing: false,
        }
    }
}

/// Access log writer that handles file operations
#[derive(Clone)]
pub struct AccessLogger {
    config: AccessLogConfig,
    file_handle: Arc<Mutex<std::fs::File>>,
}

impl AccessLogger {
    /// Create a new access logger with the given configuration
    pub fn new(config: AccessLogConfig) -> Result<Self, std::io::Error> {
        // Ensure the log directory exists
        if let Some(parent) = std::path::Path::new(&config.file_path).parent() {
            std::fs::create_dir_all(parent)?;
        }

        // Open file in append mode
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&config.file_path)?;

        Ok(Self {
            config,
            file_handle: Arc::new(Mutex::new(file)),
        })
    }

    /// Write a log entry
    async fn write_log(&self, log_line: String) {
        // Write to file
        if let Ok(mut file) = self.file_handle.try_lock() {
            if let Err(e) = writeln!(file, "{}", log_line) {
                error!("Failed to write to access log file: {}", e);
            } else {
                // Ensure it's flushed
                let _ = file.flush();
            }
        }

        // Also log to tracing if configured
        if self.config.also_log_to_tracing {
            tracing::info!(target: "access_log", "{}", log_line);
        }
    }

    /// Format a log entry based on the configured format
    fn format_log_entry(
        &self,
        remote_addr: String,
        method: &str,
        path: &str,
        version: &str,
        status: u16,
        response_size: Option<u64>,
        user_agent: Option<&str>,
        referer: Option<&str>,
        timestamp: String,
    ) -> String {
        match &self.config.format {
            AccessLogFormat::CommonLog => {
                let size = response_size
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "-".to_string());
                format!(
                    r#"{} - - [{}] "{} {} {}" {} {}"#,
                    remote_addr, timestamp, method, path, version, status, size
                )
            }
            AccessLogFormat::CombinedLog => {
                let size = response_size
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "-".to_string());
                let referer = referer.unwrap_or("-");
                let user_agent = user_agent.unwrap_or("-");
                format!(
                    r#"{} - - [{}] "{} {} {}" {} {} "{}" "{}""#,
                    remote_addr,
                    timestamp,
                    method,
                    path,
                    version,
                    status,
                    size,
                    referer,
                    user_agent
                )
            }
            AccessLogFormat::Custom(template) => {
                // Simple template substitution - in a real implementation you might want
                // a proper template engine
                template
                    .replace("{remote_addr}", &remote_addr)
                    .replace("{timestamp}", &timestamp)
                    .replace("{method}", method)
                    .replace("{path}", path)
                    .replace("{version}", version)
                    .replace("{status}", &status.to_string())
                    .replace(
                        "{size}",
                        &response_size
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| "-".to_string()),
                    )
                    .replace("{referer}", referer.unwrap_or("-"))
                    .replace("{user_agent}", user_agent.unwrap_or("-"))
            }
        }
    }
}

/// Middleware function for access logging
pub async fn access_log_middleware(request: Request, next: Next) -> Response {
    let _start_time = Instant::now();

    // Extract request information
    let method = request.method().to_string();
    let uri = request.uri().clone();
    let path = uri.path().to_string();
    let version = format!("{:?}", request.version());

    // Extract headers for referer and user-agent
    let headers = request.headers();
    let user_agent = extract_header_value(headers, "user-agent");
    let referer = extract_header_value(headers, "referer");

    // Get remote address - this is tricky with Axum as it depends on your deployment
    // You might need to configure this based on your setup (reverse proxy, etc.)
    let remote_addr =
        extract_remote_addr(&headers, &request).unwrap_or_else(|| "unknown".to_string());

    // Process the request
    let response = next.run(request).await;

    // Extract response info
    let status = response.status().as_u16();

    // Try to get response size from content-length header
    let response_size = response
        .headers()
        .get("content-length")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok());

    // Format timestamp in CLF format: [10/Oct/2000:13:55:36 -0700]
    let timestamp = format_timestamp();

    // Get logger from response extensions (we'll need to set this up)
    if let Some(logger) = response.extensions().get::<AccessLogger>() {
        let log_entry = logger.format_log_entry(
            remote_addr,
            &method,
            &path,
            &version,
            status,
            response_size,
            user_agent.as_deref(),
            referer.as_deref(),
            timestamp,
        );

        // Spawn task to write log without blocking response
        let logger_clone = logger.clone();
        tokio::spawn(async move {
            logger_clone.write_log(log_entry).await;
        });
    }

    response
}

/// Alternative middleware that takes logger as parameter
pub fn access_log_middleware_with_logger(
    logger: AccessLogger,
) -> impl Fn(Request, Next) -> std::pin::Pin<Box<dyn std::future::Future<Output = Response> + Send>>
       + Clone {
    move |request: Request, next: Next| {
        let logger = logger.clone();
        Box::pin(async move {
            // Extract request information
            let method = request.method().to_string();
            let uri = request.uri().clone();
            let path = uri.path().to_string();
            let version = format!("{:?}", request.version());

            // Extract headers
            let headers = request.headers();
            let user_agent = extract_header_value(headers, "user-agent");
            let referer = extract_header_value(headers, "referer");
            let remote_addr =
                extract_remote_addr(&headers, &request).unwrap_or_else(|| "unknown".to_string());

            // Process the request
            let response = next.run(request).await;

            // Extract response info
            let status = response.status().as_u16();
            let response_size = response
                .headers()
                .get("content-length")
                .and_then(|h| h.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok());

            let timestamp = format_timestamp();

            let log_entry = logger.format_log_entry(
                remote_addr,
                &method,
                &path,
                &version,
                status,
                response_size,
                user_agent.as_deref(),
                referer.as_deref(),
                timestamp,
            );

            // Write log asynchronously
            let logger_clone = logger.clone();
            tokio::spawn(async move {
                logger_clone.write_log(log_entry).await;
            });

            response
        })
    }
}

/// Extract header value as string
fn extract_header_value(headers: &HeaderMap, header_name: &str) -> Option<String> {
    headers
        .get(header_name)
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string())
}

/// Extract remote address from request
/// This is deployment-specific - you may need to check X-Forwarded-For, X-Real-IP, etc.
fn extract_remote_addr(headers: &HeaderMap, _request: &Request) -> Option<String> {
    // Check common proxy headers first
    if let Some(forwarded_for) = headers.get("x-forwarded-for") {
        if let Ok(value) = forwarded_for.to_str() {
            // Take the first IP in the chain
            if let Some(first_ip) = value.split(',').next() {
                return Some(first_ip.trim().to_string());
            }
        }
    }

    if let Some(real_ip) = headers.get("x-real-ip") {
        if let Ok(value) = real_ip.to_str() {
            return Some(value.to_string());
        }
    }

    // For direct connections, you might be able to get it from connection info
    // but this requires more complex setup with Axum
    None
}

/// Format timestamp in Common Log Format
fn format_timestamp() -> String {
    use time::{format_description, OffsetDateTime};

    let now = OffsetDateTime::now_utc();
    let format =
        format_description::parse("[day]/[month repr:short]/[year]:[hour]:[minute]:[second] +0000")
            .unwrap();

    now.format(&format)
        .unwrap_or_else(|_| "unknown".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_common_log_format() {
        let config = AccessLogConfig {
            file_path: "/tmp/test.log".to_string(),
            format: AccessLogFormat::CommonLog,
            also_log_to_tracing: false,
        };

        let logger = AccessLogger::new(config).unwrap();

        let log_entry = logger.format_log_entry(
            "192.168.1.1".to_string(),
            "GET",
            "/index.html",
            "HTTP/1.1",
            200,
            Some(1234),
            Some("Mozilla/5.0"),
            Some("https://example.com"),
            "10/Oct/2000:13:55:36 +0000".to_string(),
        );

        assert!(log_entry.contains("192.168.1.1"));
        assert!(log_entry.contains("GET /index.html HTTP/1.1"));
        assert!(log_entry.contains("200 1234"));
    }

    #[test]
    fn test_combined_log_format() {
        let config = AccessLogConfig {
            file_path: "/tmp/test.log".to_string(),
            format: AccessLogFormat::CombinedLog,
            also_log_to_tracing: false,
        };

        let logger = AccessLogger::new(config).unwrap();

        let log_entry = logger.format_log_entry(
            "192.168.1.1".to_string(),
            "GET",
            "/index.html",
            "HTTP/1.1",
            200,
            Some(1234),
            Some("Mozilla/5.0"),
            Some("https://example.com"),
            "10/Oct/2000:13:55:36 +0000".to_string(),
        );

        assert!(log_entry.contains(r#""Mozilla/5.0""#));
        assert!(log_entry.contains(r#""https://example.com""#));
    }
}
