//! Wordlist service for grimoire
//!
//! This module provides high-level wordlist services that handle generation,
//! validation, and statistics for wordlists used in invite code generation.

use rand::seq::SliceRandom;
use rand::thread_rng;
use std::collections::HashSet;
use std::fmt;
use thiserror::Error;

/// Errors that can occur in wordlist services
#[derive(Debug, Error)]
pub enum WordlistError {
    #[error("File not found: {path}")]
    FileNotFound { path: String },

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("No valid words found in wordlist")]
    NoValidWords,

    #[error("Wordlist validation failed: {0}")]
    ValidationFailed(String),

    #[error("Invalid word count: {count} (minimum: {min})")]
    InvalidWordCount { count: usize, min: usize },
}

/// Configuration for wordlist generation
#[derive(Debug, Clone)]
pub struct WordlistConfig {
    pub count: usize,
    pub include_silly: bool,
    pub include_animals: bool,
    pub include_food: bool,
    pub mixed: bool,
}

impl Default for WordlistConfig {
    fn default() -> Self {
        Self {
            count: 100,
            include_silly: true,
            include_animals: true,
            include_food: true,
            mixed: true,
        }
    }
}

/// Result of wordlist generation
#[derive(Debug, Clone)]
pub struct WordlistGenerationResult {
    pub words: Vec<String>,
    pub requested_count: usize,
    pub actual_count: usize,
    pub categories_used: Vec<String>,
    pub entropy_bits: f64,
}

impl fmt::Display for WordlistGenerationResult {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "Wordlist Generation Results:")?;
        writeln!(f, "  Requested: {} words", self.requested_count)?;
        writeln!(f, "  Generated: {} words", self.actual_count)?;
        writeln!(f, "  Categories: {}", self.categories_used.join(", "))?;
        writeln!(f, "  Entropy: {:.2} bits", self.entropy_bits)?;
        writeln!(f, "  Words: {}", self.words.join(", "))?;
        Ok(())
    }
}

/// Result of wordlist validation
#[derive(Debug, Clone, serde::Serialize)]
pub struct WordlistValidationResult {
    pub is_valid: bool,
    pub total_words: usize,
    pub unique_words: usize,
    pub issues: Vec<String>,
    pub entropy_bits: f64,
}

impl fmt::Display for WordlistValidationResult {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "Wordlist Validation Results:")?;
        writeln!(f, "  Valid: {}", self.is_valid)?;
        writeln!(f, "  Total words: {}", self.total_words)?;
        writeln!(f, "  Unique words: {}", self.unique_words)?;
        writeln!(f, "  Entropy: {:.2} bits", self.entropy_bits)?;
        if !self.issues.is_empty() {
            writeln!(f, "  Issues:")?;
            for issue in &self.issues {
                writeln!(f, "    - {}", issue)?;
            }
        }
        Ok(())
    }
}

/// Statistics about a wordlist
#[derive(Debug, Clone, serde::Serialize)]
pub struct WordlistStats {
    pub total_words: usize,
    pub unique_words: usize,
    pub average_length: f64,
    pub min_length: usize,
    pub max_length: usize,
    pub entropy_bits: f64,
    pub combinations_2_words: u64,
    pub combinations_3_words: u64,
    pub combinations_4_words: u64,
}

impl fmt::Display for WordlistStats {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "Wordlist Statistics:")?;
        writeln!(f, "  Total words: {}", self.total_words)?;
        writeln!(f, "  Unique words: {}", self.unique_words)?;
        writeln!(f, "  Average length: {:.1} characters", self.average_length)?;
        writeln!(
            f,
            "  Length range: {}-{} characters",
            self.min_length, self.max_length
        )?;
        writeln!(f, "  Entropy: {:.2} bits", self.entropy_bits)?;
        writeln!(f, "  2-word combinations: {}", self.combinations_2_words)?;
        writeln!(f, "  3-word combinations: {}", self.combinations_3_words)?;
        writeln!(f, "  4-word combinations: {}", self.combinations_4_words)?;
        Ok(())
    }
}

/// Main wordlist service
pub struct WordlistService;

impl WordlistService {
    /// Create a new wordlist service
    pub fn new() -> Self {
        Self
    }

    /// Generate a wordlist based on configuration
    pub fn generate_wordlist(
        &self,
        config: &WordlistConfig,
    ) -> Result<WordlistGenerationResult, WordlistError> {
        if config.count == 0 {
            return Err(WordlistError::InvalidWordCount { count: 0, min: 1 });
        }

        let mut all_words = Vec::new();
        let mut categories_used = Vec::new();

        // Collect words from enabled categories
        if config.include_silly {
            all_words.extend(SILLY_WORDS.iter().map(|&s| s.to_string()));
            categories_used.push("silly".to_string());
        }

        if config.include_animals {
            all_words.extend(ANIMAL_WORDS.iter().map(|&s| s.to_string()));
            categories_used.push("animals".to_string());
        }

        if config.include_food {
            all_words.extend(FOOD_WORDS.iter().map(|&s| s.to_string()));
            categories_used.push("food".to_string());
        }

        if all_words.is_empty() {
            return Err(WordlistError::NoValidWords);
        }

        let words: Vec<String> = if config.mixed {
            // Random selection from all categories
            let mut rng = thread_rng();
            all_words.shuffle(&mut rng);
            all_words.into_iter().take(config.count).collect()
        } else {
            // Take from each category proportionally
            all_words.into_iter().take(config.count).collect()
        };

        let actual_count = words.len();
        let entropy_bits = (words.len() as f64).log2();

        Ok(WordlistGenerationResult {
            words,
            requested_count: config.count,
            actual_count,
            categories_used,
            entropy_bits,
        })
    }

    /// Generate wordlist content as a single string
    pub fn generate_wordlist_content(
        &self,
        config: &WordlistConfig,
    ) -> Result<String, WordlistError> {
        let result = self.generate_wordlist(config)?;

        let mut content = String::new();
        content.push_str("# Generated wordlist\n");
        content.push_str(&format!(
            "# Categories: {}\n",
            result.categories_used.join(", ")
        ));
        content.push_str(&format!("# Word count: {}\n", result.actual_count));
        content.push_str(&format!("# Entropy: {:.2} bits\n", result.entropy_bits));
        content.push_str("\n");

        for word in &result.words {
            content.push_str(word);
            content.push('\n');
        }

        Ok(content)
    }

    /// Validate wordlist content
    pub fn validate_wordlist_content(&self, content: &str) -> WordlistValidationResult {
        let words = self.parse_wordlist_content(content);
        let total_words = words.len();

        // Check for duplicates
        let unique_words: HashSet<_> = words.iter().collect();
        let unique_count = unique_words.len();

        let mut issues = Vec::new();

        if total_words == 0 {
            issues.push("No words found".to_string());
        }

        if unique_count < total_words {
            issues.push(format!(
                "Duplicate words found: {} duplicates",
                total_words - unique_count
            ));
        }

        // Check for empty or invalid words
        let invalid_words: Vec<_> = words
            .iter()
            .filter(|word| word.is_empty() || !word.chars().all(|c| c.is_ascii_alphabetic()))
            .collect();

        if !invalid_words.is_empty() {
            issues.push(format!("Invalid words found: {}", invalid_words.len()));
        }

        // Check word lengths
        let lengths: Vec<_> = words.iter().map(|w| w.len()).collect();
        let too_short = lengths.iter().filter(|&&len| len < 2).count();
        let too_long = lengths.iter().filter(|&&len| len > 20).count();

        if too_short > 0 {
            issues.push(format!("Words too short: {}", too_short));
        }

        if too_long > 0 {
            issues.push(format!("Words too long: {}", too_long));
        }

        let is_valid = issues.is_empty();
        let entropy_bits = if unique_count > 0 {
            (unique_count as f64).log2()
        } else {
            0.0
        };

        WordlistValidationResult {
            is_valid,
            total_words,
            unique_words: unique_count,
            issues,
            entropy_bits,
        }
    }

    /// Validate wordlist from file
    pub fn validate_wordlist_file<P: AsRef<std::path::Path>>(
        &self,
        path: P,
    ) -> Result<WordlistValidationResult, WordlistError> {
        let path_str = path.as_ref().to_string_lossy().to_string();

        if !path.as_ref().exists() {
            return Err(WordlistError::FileNotFound { path: path_str });
        }

        let content = std::fs::read_to_string(path)?;
        Ok(self.validate_wordlist_content(&content))
    }

    /// Get statistics for wordlist content
    pub fn get_wordlist_stats_content(&self, content: &str) -> WordlistStats {
        let words = self.parse_wordlist_content(content);
        let unique_words: HashSet<_> = words.iter().collect();
        let unique_count = unique_words.len();

        let lengths: Vec<_> = words.iter().map(|w| w.len()).collect();
        let total_length: usize = lengths.iter().sum();
        let min_length = lengths.iter().min().copied().unwrap_or(0);
        let max_length = lengths.iter().max().copied().unwrap_or(0);
        let average_length = if words.is_empty() {
            0.0
        } else {
            total_length as f64 / words.len() as f64
        };

        let entropy_bits = if unique_count > 0 {
            (unique_count as f64).log2()
        } else {
            0.0
        };

        WordlistStats {
            total_words: words.len(),
            unique_words: unique_count,
            average_length,
            min_length,
            max_length,
            entropy_bits,
            combinations_2_words: (unique_count as u64).pow(2),
            combinations_3_words: (unique_count as u64).pow(3),
            combinations_4_words: (unique_count as u64).pow(4),
        }
    }

    /// Get statistics for wordlist file
    pub fn get_wordlist_stats_file<P: AsRef<std::path::Path>>(
        &self,
        path: P,
    ) -> Result<WordlistStats, WordlistError> {
        let path_str = path.as_ref().to_string_lossy().to_string();

        if !path.as_ref().exists() {
            return Err(WordlistError::FileNotFound { path: path_str });
        }

        let content = std::fs::read_to_string(path)?;
        Ok(self.get_wordlist_stats_content(&content))
    }

    /// Parse wordlist content into a vector of words
    pub fn parse_wordlist_content(&self, content: &str) -> Vec<String> {
        content
            .lines()
            .map(|line| line.trim())
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .map(|line| line.to_lowercase())
            .collect()
    }
}

impl Default for WordlistService {
    fn default() -> Self {
        Self::new()
    }
}

// Silly words - fun and memorable
const SILLY_WORDS: &[&str] = &[
    "bacon", "banana", "burp", "cheese", "clown", "disco", "fart", "funky", "giggle", "jiggly",
    "kazoo", "noodle", "pickle", "rubber", "silly", "tickle", "wiggle", "yodel", "zoom", "boing",
    "splat", "whoosh", "bonk", "plop", "fizz", "buzz", "zap", "ping", "blob", "goofy", "quirky",
    "wacky", "zany", "nutty", "loopy", "dizzy", "fuzzy", "bubbly",
];

// Animal words - cute and memorable creatures
const ANIMAL_WORDS: &[&str] = &[
    "ant", "bat", "bee", "cat", "cow", "dog", "eel", "elk", "fox", "goat", "hen", "pig", "rat",
    "yak", "bear", "deer", "duck", "frog", "goose", "horse", "llama", "moose", "mouse", "otter",
    "panda", "sheep", "sloth", "snail", "snake", "tiger", "whale", "zebra", "bunny", "puppy",
    "kitten", "hamster", "ferret", "gecko", "iguana", "koala", "lemur", "meerkat", "octopus",
    "penguin", "quail", "rabbit", "turkey", "walrus", "wombat",
];

// Food words - tasty and fun
const FOOD_WORDS: &[&str] = &[
    "apple",
    "bagel",
    "bread",
    "cake",
    "candy",
    "chip",
    "cookie",
    "cream",
    "donut",
    "egg",
    "fries",
    "grape",
    "honey",
    "jam",
    "kale",
    "lemon",
    "mango",
    "nuts",
    "olive",
    "pasta",
    "rice",
    "soup",
    "taco",
    "waffle",
    "pizza",
    "burger",
    "muffin",
    "pretzel",
    "salad",
    "sauce",
    "spice",
    "toast",
    "vanilla",
    "yogurt",
    "zucchini",
    "avocado",
    "broccoli",
    "carrot",
    "dumpling",
    "enchilada",
    "falafel",
    "gumbo",
    "hummus",
    "jerky",
    "kiwi",
    "lobster",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_wordlist_default() {
        let service = WordlistService::new();
        let config = WordlistConfig::default();
        let result = service.generate_wordlist(&config).unwrap();

        assert_eq!(result.requested_count, 100);
        assert!(result.actual_count > 0);
        assert!(result.categories_used.len() > 0);
        assert!(result.entropy_bits > 0.0);
    }

    #[test]
    fn test_generate_wordlist_specific_categories() {
        let service = WordlistService::new();
        let config = WordlistConfig {
            count: 10,
            include_silly: true,
            include_animals: false,
            include_food: false,
            mixed: true,
        };
        let result = service.generate_wordlist(&config).unwrap();

        assert_eq!(result.categories_used, vec!["silly"]);
        assert!(result.actual_count > 0);

        // Check that all words are from silly category
        for word in &result.words {
            assert!(SILLY_WORDS.contains(&word.as_str()));
        }
    }

    #[test]
    fn test_parse_wordlist_content() {
        let service = WordlistService::new();
        let content = "apple\nbanana\n# comment\n\ncherry\n";
        let words = service.parse_wordlist_content(content);
        assert_eq!(words, vec!["apple", "banana", "cherry"]);
    }

    #[test]
    fn test_validate_wordlist_content() {
        let service = WordlistService::new();

        // Valid wordlist
        let valid_content = "apple\nbanana\ncherry\n";
        let result = service.validate_wordlist_content(valid_content);
        assert!(result.is_valid);
        assert_eq!(result.total_words, 3);
        assert_eq!(result.unique_words, 3);
        assert!(result.issues.is_empty());

        // Invalid wordlist with duplicates
        let invalid_content = "apple\napple\nbanana\n";
        let result = service.validate_wordlist_content(invalid_content);
        assert!(!result.is_valid);
        assert_eq!(result.total_words, 3);
        assert_eq!(result.unique_words, 2);
        assert!(!result.issues.is_empty());

        // Empty wordlist
        let empty_content = "";
        let result = service.validate_wordlist_content(empty_content);
        assert!(!result.is_valid);
        assert_eq!(result.total_words, 0);
        assert!(result
            .issues
            .iter()
            .any(|issue| issue.contains("No words found")));

        // Wordlist with invalid characters
        let invalid_chars_content = "apple\nban@na\ncherry\n";
        let result = service.validate_wordlist_content(invalid_chars_content);
        assert!(!result.is_valid);
        assert!(result
            .issues
            .iter()
            .any(|issue| issue.contains("Invalid words")));

        // Wordlist with words that are too short or too long
        let length_issues_content = "a\napple\nsupercalifragilisticexpialidocious\n";
        let result = service.validate_wordlist_content(length_issues_content);
        assert!(!result.is_valid);
        assert!(result
            .issues
            .iter()
            .any(|issue| issue.contains("too short") || issue.contains("too long")));
    }

    #[test]
    fn test_get_wordlist_stats() {
        let service = WordlistService::new();
        let content = "apple\nbanana\ncherry\n";
        let stats = service.get_wordlist_stats_content(content);

        assert_eq!(stats.total_words, 3);
        assert_eq!(stats.unique_words, 3);
        assert_eq!(stats.min_length, 5); // apple
        assert_eq!(stats.max_length, 6); // banana, cherry
        assert!((stats.average_length - 5.67).abs() < 0.01);
        assert!(stats.entropy_bits > 0.0);
        assert_eq!(stats.combinations_2_words, 9);
        assert_eq!(stats.combinations_3_words, 27);
        assert_eq!(stats.combinations_4_words, 81);
    }
}
