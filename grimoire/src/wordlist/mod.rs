//! Wordlist domain module
//!
//! This module contains all wordlist-related domain logic including
//! wordlist generation, validation, management, and utility functions.
//! Used for generating memorable invite codes and managing word collections.

pub mod management;
pub mod service;

// Re-export commonly used types
pub use management::{
    generate_word_code, initialize_wordlist, is_initialized, validate_wordlist,
    WordlistConfig as ManagementWordlistConfig, WordlistError as ManagementWordlistError,
    WordlistStats as ManagementWordlistStats,
};
pub use service::{
    WordlistConfig, WordlistError, WordlistGenerationResult, WordlistService, WordlistStats,
    WordlistValidationResult,
};

use serde::{Deserialize, Serialize};

/// Response for wordlist generation (CLI output)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WordlistGeneratedResponse {
    pub word_count: usize,
    pub config: WordlistConfigSummary,
    pub output_file: Option<String>,
}

/// Summary of wordlist configuration (CLI output)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WordlistConfigSummary {
    pub include_silly: bool,
    pub include_animals: bool,
    pub include_food: bool,
    pub mixed: bool,
}

/// Response for invite code generation (CLI output)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InviteCodesResponse {
    pub codes: Vec<String>,
    pub word_count: usize,
}
