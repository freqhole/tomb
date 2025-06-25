//! Thumbnails CLI module
//!
//! This module provides CLI commands for managing and testing thumbnail generation
//! functionality, including tool validation and configuration testing.

pub mod commands;

// Re-export main command types
pub use commands::{execute_thumbnail_command, ThumbnailCommands};
