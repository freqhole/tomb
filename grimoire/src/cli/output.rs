//! CLI output formatting utilities
//!
//! Provides consistent output formatting for grimoire CLI commands:
//! - Default: Human-readable context + TSV table
//! - JSON: Everything in JSON with message + data
//!
//! Design: Handlers return `CommandOutput<T>` with structured data.
//! Top-level command router applies formatting based on --json flag.
//!
//! TSV output is automatically generated from any type implementing Serialize
//! using the csv crate with tab delimiter.

use csv::WriterBuilder;
use serde::{Deserialize, Serialize};

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

/// Auto-generate TSV from any Serialize type
fn to_tsv<T: Serialize>(items: &[T]) -> Result<String, String> {
    if items.is_empty() {
        return Ok(String::new());
    }

    let mut wtr = WriterBuilder::new().delimiter(b'\t').from_writer(vec![]);

    for item in items {
        wtr.serialize(item)
            .map_err(|e| format!("Failed to serialize to TSV: {}", e))?;
    }

    String::from_utf8(wtr.into_inner().map_err(|e| e.to_string())?)
        .map_err(|e| format!("Failed to convert TSV to UTF-8: {}", e))
}

/// Command output - what handlers return
///
/// Contains messages (extensible array) and structured data.
/// Formatting is applied at top level, handlers just return data.
#[derive(Debug, Clone)]
pub struct CommandOutput<T> {
    /// Human-readable messages (extensible - can have multiple)
    pub messages: Vec<String>,
    /// Structured data
    pub data: T,
}

impl<T> CommandOutput<T> {
    /// Create new output with a single message and data
    pub fn new(message: impl Into<String>, data: T) -> Self {
        Self {
            messages: vec![message.into()],
            data,
        }
    }
}

/// Trait for formatting command output
pub trait FormatOutput {
    /// Format output according to the specified format
    fn format(&self, format: OutputFormat) -> String;
}

/// Format output for Vec<T> where T implements Serialize
impl<T: Serialize> FormatOutput for CommandOutput<Vec<T>> {
    fn format(&self, format: OutputFormat) -> String {
        match format {
            OutputFormat::Default => {
                let mut output = String::new();

                // Print messages
                for msg in &self.messages {
                    output.push_str(msg);
                    output.push('\n');
                }

                // Blank line separator if we have both messages and data
                if !self.messages.is_empty() && !self.data.is_empty() {
                    output.push('\n');
                }

                // Print TSV table (auto-generated from Serialize)
                if !self.data.is_empty() {
                    match to_tsv(&self.data) {
                        Ok(tsv) => output.push_str(&tsv),
                        Err(e) => output.push_str(&format!("Error formatting TSV: {}\n", e)),
                    }
                } else if self.messages.is_empty() {
                    output.push_str("(no results)\n");
                }

                output
            }
            OutputFormat::Json => {
                let result = OutputResult {
                    messages: self.messages.clone(),
                    data: &self.data,
                };

                serde_json::to_string_pretty(&result).unwrap()
            }
        }
    }
}

/// Result wrapper for CLI output
///
/// Includes both human-readable messages and structured data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputResult<T> {
    /// Human-readable messages (empty array if none)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub messages: Vec<String>,

    /// Structured data
    pub data: T,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Clone, Serialize)]
    struct TestItem {
        id: String,
        name: String,
    }

    #[test]
    fn test_output_format_from_flag() {
        assert_eq!(OutputFormat::from_json_flag(false), OutputFormat::Default);
        assert_eq!(OutputFormat::from_json_flag(true), OutputFormat::Json);
    }

    #[test]
    fn test_tsv_generation() {
        let items = vec![
            TestItem {
                id: "1".to_string(),
                name: "Alice".to_string(),
            },
            TestItem {
                id: "2".to_string(),
                name: "Bob".to_string(),
            },
        ];

        let tsv = to_tsv(&items).unwrap();
        assert!(tsv.contains("id\tname"));
        assert!(tsv.contains("1\tAlice"));
        assert!(tsv.contains("2\tBob"));
    }
}
