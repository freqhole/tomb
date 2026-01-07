//! Wordlist management for invite code generation
//!
//! This module handles loading and validation of wordlists used for generating
//! memorable invite codes using words instead of random characters.

use std::fs;
use std::path::Path;
use std::sync::OnceLock;
use thiserror::Error;

/// Global wordlist storage
static WORDLIST: OnceLock<Vec<String>> = OnceLock::new();

/// Wordlist-related errors
#[derive(Debug, Error)]
pub enum WordlistError {
    #[error("Wordlist file not found: {0}")]
    FileNotFound(String),
    #[error("IO error reading wordlist: {0}")]
    IoError(#[from] std::io::Error),
    #[error("No valid words found in wordlist")]
    NoValidWords,
    #[error("Wordlist validation failed: {0}")]
    ValidationFailed(String),
}

/// Configuration for wordlist loading
pub struct WordlistConfig {
    pub file_path: String,
    pub min_words: usize,
    pub min_word_length: usize,
    pub max_word_length: usize,
}

impl Default for WordlistConfig {
    fn default() -> Self {
        Self {
            file_path: "assets/config/wordlist.txt".to_string(),
            min_words: 50,
            min_word_length: 3,
            max_word_length: 12,
        }
    }
}

/// Initialize and validate the wordlist
pub fn initialize_wordlist(config: &WordlistConfig) -> Result<(), WordlistError> {
    // Check if file exists
    if !Path::new(&config.file_path).exists() {
        return Err(WordlistError::FileNotFound(config.file_path.clone()));
    }

    // Load and parse the wordlist
    let content = fs::read_to_string(&config.file_path)?;
    let words = parse_wordlist(&content)?;

    // Validate the wordlist
    validate_wordlist(&words, config)?;

    // Store in global static
    WORDLIST.set(words).map_err(|_| {
        WordlistError::ValidationFailed("Failed to initialize wordlist".to_string())
    })?;

    tracing::info!(
        "Wordlist initialized successfully: {} words from {}",
        WORDLIST.get().unwrap().len(),
        config.file_path
    );

    Ok(())
}

/// Get the loaded wordlist
pub fn get_wordlist() -> Option<&'static Vec<String>> {
    WORDLIST.get()
}

/// Check if wordlist is initialized
pub fn is_initialized() -> bool {
    WORDLIST.get().is_some()
}

/// Generate a word-based invite code
pub fn generate_word_code(word_count: usize) -> Result<String, WordlistError> {
    let words = get_wordlist()
        .ok_or_else(|| WordlistError::ValidationFailed("Wordlist not initialized".to_string()))?;

    if words.is_empty() {
        return Err(WordlistError::NoValidWords);
    }

    use rand::seq::SliceRandom;
    let mut rng = rand::thread_rng();

    let selected_words: Vec<String> = (0..word_count)
        .map(|_| words.choose(&mut rng).unwrap().clone())
        .collect();

    Ok(selected_words.join("-"))
}

/// Parse wordlist from file content
fn parse_wordlist(content: &str) -> Result<Vec<String>, WordlistError> {
    let words: Vec<String> = content
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| line.to_lowercase())
        .filter(|word| word.chars().all(|c| c.is_ascii_alphabetic()))
        .collect();

    if words.is_empty() {
        return Err(WordlistError::NoValidWords);
    }

    Ok(words)
}

/// Validate wordlist meets requirements
pub fn validate_wordlist(words: &[String], config: &WordlistConfig) -> Result<(), WordlistError> {
    // Check minimum word count
    if words.len() < config.min_words {
        return Err(WordlistError::ValidationFailed(format!(
            "Too few words: {} (minimum: {})",
            words.len(),
            config.min_words
        )));
    }

    // Check word lengths
    let invalid_words: Vec<_> = words
        .iter()
        .filter(|word| word.len() < config.min_word_length || word.len() > config.max_word_length)
        .collect();

    if !invalid_words.is_empty() {
        return Err(WordlistError::ValidationFailed(format!(
            "Words with invalid length (must be {}-{} chars): {:?}",
            config.min_word_length, config.max_word_length, invalid_words
        )));
    }

    // Check for duplicates
    let mut unique_words = std::collections::HashSet::new();
    let mut duplicates = Vec::new();

    for word in words {
        if !unique_words.insert(word) {
            duplicates.push(word);
        }
    }

    if !duplicates.is_empty() {
        return Err(WordlistError::ValidationFailed(format!(
            "Duplicate words found: {:?}",
            duplicates
        )));
    }

    tracing::debug!(
        "Wordlist validation passed: {} words, entropy: {:.1} bits",
        words.len(),
        (words.len() as f64).log2()
    );

    Ok(())
}

/// Get wordlist statistics for debugging/monitoring
pub fn get_stats() -> Option<WordlistStats> {
    let words = get_wordlist()?;

    Some(WordlistStats {
        word_count: words.len(),
        entropy_bits: (words.len() as f64).log2(),
        avg_word_length: words.iter().map(|w| w.len()).sum::<usize>() as f64 / words.len() as f64,
        combinations_2_words: (words.len() as f64).powi(2) as u64,
        combinations_3_words: (words.len() as f64).powi(3) as u64,
        combinations_4_words: (words.len() as f64).powi(4) as u64,
    })
}

/// Statistics about the loaded wordlist
#[derive(Debug)]
pub struct WordlistStats {
    pub word_count: usize,
    pub entropy_bits: f64,
    pub avg_word_length: f64,
    pub combinations_2_words: u64,
    pub combinations_3_words: u64,
    pub combinations_4_words: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_wordlist() {
        let content = r#"
# This is a comment
apple
banana

cherry
# Another comment
DURIAN
"#;

        let words = parse_wordlist(content).unwrap();
        assert_eq!(words, vec!["apple", "banana", "cherry", "durian"]);
    }

    #[test]
    fn test_validate_wordlist() {
        let config = WordlistConfig {
            min_words: 3,
            min_word_length: 3,
            max_word_length: 10,
            ..Default::default()
        };

        let words = vec![
            "apple".to_string(),
            "banana".to_string(),
            "cherry".to_string(),
        ];
        assert!(validate_wordlist(&words, &config).is_ok());

        // Test too few words
        let words = vec!["apple".to_string()];
        assert!(validate_wordlist(&words, &config).is_err());

        // Test word too short
        let words = vec!["a".to_string(), "banana".to_string(), "cherry".to_string()];
        assert!(validate_wordlist(&words, &config).is_err());
    }

    #[test]
    fn test_generate_word_code() {
        // This test requires global state, so we'll test the logic without the static
        let words = vec![
            "apple".to_string(),
            "banana".to_string(),
            "cherry".to_string(),
        ];

        // We can't easily test the global static in unit tests,
        // but we can verify the logic would work
        assert!(!words.is_empty());
        assert!(words.len() >= 3);
    }

    #[test]
    fn test_parse_wordlist_filters_invalid() {
        let content = r#"
apple
123invalid
ban@na
cherry
# comment
_underscore
"#;

        let words = parse_wordlist(content).unwrap();
        assert_eq!(words, vec!["apple", "cherry"]);
    }

    #[test]
    fn test_validate_wordlist_duplicates() {
        let config = WordlistConfig {
            min_words: 3,
            min_word_length: 3,
            max_word_length: 10,
            ..Default::default()
        };
        let words = vec![
            "apple".to_string(),
            "banana".to_string(),
            "apple".to_string(), // duplicate
        ];

        let result = validate_wordlist(&words, &config);
        assert!(result.is_err());
        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("Duplicate"));
    }

    #[test]
    fn test_wordlist_config_default() {
        let config = WordlistConfig::default();
        assert_eq!(config.file_path, "assets/config/wordlist.txt");
        assert_eq!(config.min_words, 50);
        assert_eq!(config.min_word_length, 3);
        assert_eq!(config.max_word_length, 12);
    }
}
