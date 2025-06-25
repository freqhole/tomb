//! Wordlist domain module
//!
//! This module contains all wordlist-related domain logic including
//! wordlist generation, validation, management, and utility functions.

pub mod management;
pub mod service;

// Re-export commonly used types
pub use management::{
    generate_word_code, initialize_wordlist, is_initialized, validate_wordlist,
    WordlistConfig as ManagementWordlistConfig, WordlistError as ManagementWordlistError,
};
pub use service::{
    WordlistConfig, WordlistError, WordlistGenerationResult, WordlistService, WordlistStats,
    WordlistValidationResult,
};
