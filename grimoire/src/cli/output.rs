//! CLI output formatting utilities
//!
//! Provides consistent output formatting for grimoire CLI commands:
//! - Default: Human-readable message
//! - JSON: Structured JSON with success, message, data, errors (RFC 9457 style)
//!
//! Design: Handlers return `CommandOutput<T>` with structured data.
//! Top-level command router applies formatting based on --json flag.

use serde::Serialize;

/// RFC 9457-style error object
#[derive(Debug, Clone, Serialize)]
pub struct ErrorDetail {
    /// Error type identifier (e.g., "validation_error", "not_found")
    #[serde(rename = "type")]
    pub error_type: String,
    /// Short, human-readable summary
    pub title: String,
    /// Specific explanation of this error occurrence
    pub detail: String,
}

impl ErrorDetail {
    /// Create a new error detail
    pub fn new(
        error_type: impl Into<String>,
        title: impl Into<String>,
        detail: impl Into<String>,
    ) -> Self {
        Self {
            error_type: error_type.into(),
            title: title.into(),
            detail: detail.into(),
        }
    }
}

impl From<&crate::error::GrimoireError> for ErrorDetail {
    fn from(err: &crate::error::GrimoireError) -> Self {
        let error_type = err.error_type();
        let title = error_type_to_title(&error_type);
        let detail = err.to_string();

        Self {
            error_type,
            title,
            detail,
        }
    }
}

impl From<crate::error::GrimoireError> for ErrorDetail {
    fn from(err: crate::error::GrimoireError) -> Self {
        Self::from(&err)
    }
}

/// Convert error_type (snake_case) to Title Case
/// Example: "database_not_found" -> "Database Not Found"
fn error_type_to_title(error_type: &str) -> String {
    error_type
        .split('_')
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

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
    /// Create new successful output with message and data
    pub fn success(message: impl Into<String>, data: T) -> Self {
        Self {
            success: true,
            message: message.into(),
            data,
            errors: vec![],
        }
    }

    /// Create new output with message and data (alias for success)
    pub fn new(message: impl Into<String>, data: T) -> Self {
        Self::success(message, data)
    }

    /// Create new failed output with message and errors
    pub fn failure(message: impl Into<String>, errors: Vec<ErrorDetail>, data: T) -> Self {
        Self {
            success: false,
            message: message.into(),
            data,
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

                output
            }
            OutputFormat::Json => serde_json::to_string_pretty(&self).unwrap(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_output_format_from_flag() {
        assert_eq!(OutputFormat::from_json_flag(false), OutputFormat::Default);
        assert_eq!(OutputFormat::from_json_flag(true), OutputFormat::Json);
    }
}
