//! Shared utilities for CLI commands
//!
//! Provides consistent output formatting and utility functions for grimoire CLI commands:
//! - Default: Human-readable message + TSV table
//! - JSON: Structured JSON with success, message, data, errors (RFC 9457 style)
//!
//! Design: Handlers return `CommandOutput<T>` with structured data.
//! Top-level command router applies formatting based on --json flag.

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use time::OffsetDateTime;

// Re-export ErrorDetail for CLI code compatibility
pub use grimoire::error::{ErrorDetail, GrimoireResult};

// ============================================================================
// Time Formatting
// ============================================================================

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

// ============================================================================
// Input Resolution
// ============================================================================

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
            serde_json::from_str(&json).map_err(|e| grimoire::error::GrimoireError::Validation {
                field: "json_input".to_string(),
                message: format!("Invalid JSON: {}", e),
            })
        }
        None => Ok(request),
    }
}

// ============================================================================
// Error Formatting
// ============================================================================

// ErrorDetail is now defined in grimoire::error and re-exported from crate root

// ============================================================================
// Output Formatting
// ============================================================================

/// Output format for CLI commands
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputFormat {
    /// Default: Human-readable message followed by TSV table
    Default,
    /// JSON: Everything in structured JSON
    Json,
}

impl OutputFormat {
    /// Parse from CLI flag
    pub fn from_json_flag(json: bool) -> Self {
        if json {
            Self::Json
        } else {
            Self::Default
        }
    }
}

/// Command output - what handlers return
///
/// Contains success status, message, data, and errors.
/// Formatting is applied at top level, handlers just return data.
#[derive(Debug, Clone, Serialize)]
pub struct CommandOutput<T> {
    /// Operation success status
    pub success: bool,
    /// Human-readable message
    pub message: String,
    /// Structured data
    pub data: T,
    /// Error details (empty if success) - RFC 9457 style
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub errors: Vec<ErrorDetail>,
}

impl<T> CommandOutput<T> {
    // All helper methods removed - unused in current codebase
    // CommandOutput instances are created directly in handler functions
}

impl CommandOutput<serde_json::Value> {
    /// Create successful output with automatically serialized data
    /// This is the standard way to create CommandOutput in CLI handlers
    pub fn success<T: Serialize>(message: impl Into<String>, data: T) -> Self {
        Self {
            success: true,
            message: message.into(),
            data: serde_json::to_value(data).unwrap_or(serde_json::Value::Null),
            errors: vec![],
        }
    }

    /// Create failed output with automatically serialized data
    /// This is the standard way to create failed CommandOutput in CLI handlers
    pub fn failure<T: Serialize>(
        message: impl Into<String>,
        errors: Vec<ErrorDetail>,
        data: T,
    ) -> Self {
        Self {
            success: false,
            message: message.into(),
            data: serde_json::to_value(data).unwrap_or(serde_json::Value::Null),
            errors,
        }
    }
}

impl<T: Serialize> CommandOutput<T> {
    /// Format output according to the specified format
    pub fn format(&self, format: OutputFormat) -> String {
        match format {
            OutputFormat::Default => {
                let mut output = String::new();

                // Print message
                output.push_str(&self.message);
                output.push('\n');

                // Print errors if any
                if !self.errors.is_empty() {
                    output.push_str("\nErrors:\n");
                    for err in &self.errors {
                        output.push_str(&format!(
                            "  - [{}] {}: {}\n",
                            err.error_type, err.title, err.detail
                        ));
                    }
                }

                // Try to format data as TSV table if it's an array, otherwise print as JSON
                if let Ok(json_value) = serde_json::to_value(&self.data) {
                    let mut printed_table = false;

                    // If data is an array, try to format as TSV table
                    if let Some(array) = json_value.as_array() {
                        if !array.is_empty() {
                            output.push('\n');
                            if let Ok(items) = serde_json::from_value::<Vec<serde_json::Value>>(
                                serde_json::Value::Array(array.clone()),
                            ) {
                                let table = format_as_table(&items);
                                if !table.is_empty() {
                                    output.push_str(&table);
                                    printed_table = true;
                                }
                            }
                        }
                    }

                    // Fallback: print any non-array data as pretty JSON
                    if !printed_table && !matches!(json_value, serde_json::Value::Null) {
                        output.push('\n');
                        if let Ok(pretty) = serde_json::to_string_pretty(&json_value) {
                            output.push_str(&pretty);
                            output.push('\n');
                        }
                    }
                }

                output
            }
            OutputFormat::Json => serde_json::to_string_pretty(&self).unwrap(),
        }
    }
}

/// Format a JSON value as a simple string
fn format_json_value(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        Value::Array(_) => "[...]".to_string(),
        Value::Object(_) => "{...}".to_string(),
    }
}

/// Auto-generate table from any Serialize type
fn format_as_table<T: Serialize>(items: &[T]) -> String {
    if items.is_empty() {
        return String::new();
    }

    // Serialize all items to JSON
    let json_items: Vec<Value> = items
        .iter()
        .filter_map(|item| serde_json::to_value(item).ok())
        .collect();

    if json_items.is_empty() {
        return String::new();
    }

    // Get keys from first item
    if let Some(first) = json_items.first() {
        if let Some(obj) = first.as_object() {
            let keys: Vec<&String> = obj.keys().collect();

            if keys.is_empty() {
                return String::new();
            }

            // Print header
            let header = keys
                .iter()
                .map(|s| s.as_str())
                .collect::<Vec<_>>()
                .join("\t");

            // Print rows
            let rows: Vec<String> = json_items
                .iter()
                .filter_map(|item| {
                    if let Some(obj) = item.as_object() {
                        let values: Vec<String> = keys
                            .iter()
                            .map(|k| obj.get(*k).map(format_json_value).unwrap_or_default())
                            .collect();
                        Some(values.join("\t"))
                    } else {
                        None
                    }
                })
                .collect();

            return format!("{}\n{}", header, rows.join("\n"));
        }
    }

    String::new()
}

// ============================================================================
// Output Handling
// ============================================================================

/// Print CommandOutput and exit with appropriate code
///
/// This is the centralized output handler for all CLI commands:
/// - All output goes to stdout (for consistent piping/parsing)
/// - Exit code indicates success (0) or failure (1)
///
/// Use this at the top level of command dispatching to avoid repetitive
/// error handling in every command handler.
pub fn print_and_exit<T: Serialize>(output: CommandOutput<T>, format: OutputFormat) -> ! {
    let formatted = output.format(format);

    println!("{}", formatted);
    std::process::exit(if output.success { 0 } else { 1 });
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_output_format_from_flag() {
        assert_eq!(OutputFormat::from_json_flag(false), OutputFormat::Default);
        assert_eq!(OutputFormat::from_json_flag(true), OutputFormat::Json);
    }
}
