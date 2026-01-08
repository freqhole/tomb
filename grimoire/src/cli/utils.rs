//! Shared utilities for CLI commands

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
