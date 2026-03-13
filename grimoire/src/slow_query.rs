//! slow query logging module
//!
//! logs queries that exceed a configurable threshold to a file.
//! useful for debugging performance issues.
//!
//! usage:
//! ```
//! use grimoire::slow_query::log_slow_query;
//!
//! let start = std::time::Instant::now();
//! // ... execute query ...
//! let duration_ms = start.elapsed().as_millis() as u64;
//! log_slow_query("SELECT * FROM songs WHERE ...", duration_ms, None);
//! ```

use crate::config::{get_config, is_config_initialized};
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::OnceLock;
use std::time::SystemTime;
use tracing::warn;

/// cached flag for whether slow query logging is enabled
/// avoids repeated config lookups
static SLOW_QUERY_ENABLED: OnceLock<bool> = OnceLock::new();

/// check if slow query logging is enabled (cached)
fn is_slow_query_logging_enabled() -> bool {
    *SLOW_QUERY_ENABLED.get_or_init(|| {
        if !is_config_initialized() {
            return false;
        }
        get_config().logging.slow_query_enabled
    })
}

/// log a slow query to the configured file
///
/// # arguments
/// * `query` - the SQL query string (can be truncated for very long queries)
/// * `duration_ms` - how long the query took in milliseconds
/// * `context` - optional context info (e.g., function name, entity type)
///
/// only logs if:
/// - config is initialized
/// - slow query logging is enabled
/// - duration exceeds the configured threshold
pub fn log_slow_query(query: &str, duration_ms: u64, context: Option<&str>) {
    // early exit if not enabled
    if !is_slow_query_logging_enabled() {
        return;
    }

    let config = get_config();

    // check threshold
    if duration_ms < config.logging.slow_query_threshold_ms {
        return;
    }

    let log_path = config.slow_query_log_path();

    // format timestamp
    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let datetime = format_timestamp(timestamp);

    // truncate very long queries (keep first 500 chars + ellipsis)
    let query_display = if query.len() > 500 {
        format!("{}...", &query[..500])
    } else {
        query.to_string()
    };

    // format log entry
    let context_str = context.map(|c| format!(" [{}]", c)).unwrap_or_default();
    let log_entry = format!(
        "[{}] {}ms{} | {}\n",
        datetime, duration_ms, context_str, query_display
    );

    // append to file
    match OpenOptions::new().create(true).append(true).open(&log_path) {
        Ok(mut file) => {
            if let Err(e) = file.write_all(log_entry.as_bytes()) {
                warn!("failed to write slow query log: {}", e);
            }
        }
        Err(e) => {
            warn!("failed to open slow query log file {:?}: {}", log_path, e);
        }
    }
}

/// helper macro for timing a query and logging if slow
///
/// usage:
/// ```
/// let result = time_query!("get_all_songs", {
///     sqlx::query_as!(Song, "SELECT * FROM songz")
///         .fetch_all(&pool)
///         .await
/// });
/// ```
#[macro_export]
macro_rules! time_query {
    ($context:expr, $query_str:expr, $block:expr) => {{
        let _start = std::time::Instant::now();
        let result = $block;
        let _duration_ms = _start.elapsed().as_millis() as u64;
        $crate::slow_query::log_slow_query($query_str, _duration_ms, Some($context));
        result
    }};
    ($context:expr, $block:expr) => {{
        let _start = std::time::Instant::now();
        let result = $block;
        let _duration_ms = _start.elapsed().as_millis() as u64;
        $crate::slow_query::log_slow_query(
            "(query text not provided)",
            _duration_ms,
            Some($context),
        );
        result
    }};
}

/// format unix timestamp as ISO-8601 datetime string
fn format_timestamp(timestamp: u64) -> String {
    // convert to calendar time - naive implementation
    let secs_since_epoch = timestamp;
    let days = secs_since_epoch / 86400;
    let remaining_secs = secs_since_epoch % 86400;
    let hours = remaining_secs / 3600;
    let minutes = (remaining_secs % 3600) / 60;
    let seconds = remaining_secs % 60;

    // calculate year/month/day from days since epoch
    // this is a simplified calculation - good enough for logging
    let (year, month, day) = days_to_ymd(days);

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hours, minutes, seconds
    )
}

/// convert days since unix epoch to year/month/day
fn days_to_ymd(days: u64) -> (u64, u64, u64) {
    // days since 1970-01-01
    let mut remaining_days = days as i64;
    let mut year = 1970i64;

    // find the year
    loop {
        let days_in_year = if is_leap_year(year) { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        year += 1;
    }

    // find the month
    let months_days = if is_leap_year(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    let mut month = 1u64;
    for &days_in_month in &months_days {
        if remaining_days < days_in_month {
            break;
        }
        remaining_days -= days_in_month;
        month += 1;
    }

    let day = (remaining_days + 1) as u64;

    (year as u64, month, day)
}

fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

/// reset the enabled cache (useful for testing or config reload)
/// note: this doesn't actually reset OnceLock, just uses for internal testing
#[cfg(test)]
pub fn reset_slow_query_cache() {
    // OnceLock can't be reset, but tests can work around this
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_timestamp() {
        // 2024-01-15 12:30:45 UTC
        let timestamp = 1705322445;
        let formatted = format_timestamp(timestamp);
        assert!(formatted.starts_with("2024-01-15"));
        assert!(formatted.contains("T"));
        assert!(formatted.ends_with("Z"));
    }

    #[test]
    fn test_days_to_ymd() {
        // 1970-01-01
        assert_eq!(days_to_ymd(0), (1970, 1, 1));
        // 2024-01-01 (19724 days since epoch)
        assert_eq!(days_to_ymd(19724), (2024, 1, 1));
    }
}
