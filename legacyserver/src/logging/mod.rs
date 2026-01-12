//! Logging module for HTTP access logs and other logging functionality
//!
//! This module provides utilities for logging HTTP requests in standard formats
//! like Common Log Format (CLF) and Combined Log Format, as well as custom
//! logging configurations.

pub mod access_log;

// Re-export commonly used types
pub use access_log::{
    access_log_middleware, access_log_middleware_with_logger, AccessLogConfig, AccessLogFormat,
    AccessLogger,
};
