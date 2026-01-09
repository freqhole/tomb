//! Shared utilities for CLI commands

use crate::error::GrimoireResult;
use serde::de::DeserializeOwned;
use time::OffsetDateTime;

/// Format a Unix timestamp as a human-readable string
pub fn format_timestamp(timestamp: i64) -> String {
    if let Ok(datetime) = OffsetDateTime::from_unix_timestamp(timestamp) {
        let format =
            time::format_description::parse("[year]-[month]-[day] [hour]:[minute]:[second] UTC")
                .unwrap();
        datetime
            .format(&format)
            .unwrap_or_else(|_| format!("Invalid timestamp: {}", timestamp))
    } else {
        format!("Invalid timestamp: {}", timestamp)
    }
}

/// Helper to handle json_input vs flattened request fields
///
/// This is the core pattern for CLI input handling:
/// - If json_input is provided, parse it and use that
/// - Otherwise, use the flattened request struct from CLI flags
///
/// This allows both ergonomic CLI flags AND scriptable JSON input
/// without polluting library request types with CLI concerns.
pub fn resolve_request<T: DeserializeOwned>(
    json_input: Option<String>,
    request: T,
) -> GrimoireResult<T> {
    match json_input {
        Some(json) => {
            serde_json::from_str(&json).map_err(|e| crate::error::GrimoireError::Validation {
                field: "json_input".to_string(),
                message: format!("Invalid JSON: {}", e),
            })
        }
        None => Ok(request),
    }
}
