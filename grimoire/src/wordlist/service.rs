//! Wordlist service for the client package
//!
//! This module provides high-level wordlist services that handle generation,
//! validation, and statistics for wordlists used in invite code generation.
//! #todo: yank all the emojiz from this file!

use rand::seq::SliceRandom;
use rand::thread_rng;
use std::collections::HashSet;
use std::fmt;
use std::path::Path;
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
        writeln!(f, "✅ Generated wordlist with {} words", self.actual_count)?;

        if self.actual_count < self.requested_count {
            writeln!(
                f,
                "⚠️  Warning: Only {} unique words available, requested {}",
                self.actual_count, self.requested_count
            )?;
        }

        writeln!(f, "   📝 Categories: {}", self.categories_used.join(", "))?;
        writeln!(f, "   🎯 Entropy: ~{:.1} bits per word", self.entropy_bits)?;
        writeln!(
            f,
            "   🔐 3-word codes: ~{:.0} combinations",
            (self.actual_count as f64).powi(3)
        )?;

        Ok(())
    }
}

/// Result of wordlist validation
#[derive(Debug, Clone)]
pub struct WordlistValidationResult {
    pub is_valid: bool,
    pub total_words: usize,
    pub unique_words: usize,
    pub issues: Vec<String>,
    pub entropy_bits: f64,
}

impl fmt::Display for WordlistValidationResult {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.is_valid {
            writeln!(f, "✅ Wordlist validation passed!")?;
            writeln!(
                f,
                "   📊 {} words, {} unique",
                self.total_words, self.unique_words
            )?;
            writeln!(f, "   🎯 Entropy: ~{:.1} bits per word", self.entropy_bits)?;
        } else {
            writeln!(f, "❌ Wordlist validation failed:")?;
            for issue in &self.issues {
                writeln!(f, "   • {}", issue)?;
            }
        }
        Ok(())
    }
}

/// Statistics about a wordlist
#[derive(Debug, Clone)]
pub struct WordlistStats {
    pub total_words: usize,
    pub unique_words: usize,
    pub average_length: f64,
    pub min_length: usize,
    pub max_length: usize,
    pub entropy_bits: f64,
    pub combinations_2_words: f64,
    pub combinations_3_words: f64,
    pub combinations_4_words: f64,
}

impl fmt::Display for WordlistStats {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "📊 Wordlist Statistics")?;
        writeln!(f, "  📝 Total words: {}", self.total_words)?;
        writeln!(f, "  🎯 Unique words: {}", self.unique_words)?;
        writeln!(
            f,
            "  📏 Average length: {:.1} characters",
            self.average_length
        )?;
        writeln!(
            f,
            "  📐 Length range: {} - {} characters",
            self.min_length, self.max_length
        )?;
        writeln!(f, "  🔐 Entropy per word: ~{:.1} bits", self.entropy_bits)?;
        writeln!(f)?;
        writeln!(f, "  Combination possibilities:")?;
        writeln!(f, "    2 words: ~{:.0}", self.combinations_2_words)?;
        writeln!(f, "    3 words: ~{:.0}", self.combinations_3_words)?;
        writeln!(f, "    4 words: ~{:.0}", self.combinations_4_words)?;
        Ok(())
    }
}

/// Wordlist service for high-level wordlist operations
pub struct WordlistService;

impl WordlistService {
    /// Create a new WordlistService
    pub fn new() -> Self {
        Self
    }

    /// Generate a wordlist based on configuration
    pub fn generate_wordlist(
        &self,
        config: WordlistConfig,
    ) -> Result<WordlistGenerationResult, WordlistError> {
        if config.count == 0 {
            return Err(WordlistError::InvalidWordCount {
                count: config.count,
                min: 1,
            });
        }

        let mut word_pool = Vec::new();
        let mut categories_used = Vec::new();

        // Determine which categories to use
        let use_all = (!config.include_silly && !config.include_animals && !config.include_food)
            || config.mixed;

        if config.include_silly || use_all {
            word_pool.extend_from_slice(&SILLY_WORDS);
            categories_used.push("silly/fun".to_string());
        }

        if config.include_animals || use_all {
            word_pool.extend_from_slice(&ANIMAL_WORDS);
            categories_used.push("animals".to_string());
        }

        if config.include_food || use_all {
            word_pool.extend_from_slice(&FOOD_WORDS);
            categories_used.push("food".to_string());
        }

        // Remove duplicates and shuffle
        let mut unique_words: Vec<_> = word_pool
            .into_iter()
            .collect::<HashSet<_>>()
            .into_iter()
            .map(|s| s.to_string())
            .collect();
        unique_words.shuffle(&mut thread_rng());

        // Take the requested number of words
        let selected_words: Vec<_> = unique_words.into_iter().take(config.count).collect();
        let actual_count = selected_words.len();
        let entropy_bits = (actual_count as f64).log2();

        Ok(WordlistGenerationResult {
            words: selected_words,
            requested_count: config.count,
            actual_count,
            categories_used,
            entropy_bits,
        })
    }

    /// Generate wordlist content with header
    pub fn generate_wordlist_content(
        &self,
        config: WordlistConfig,
    ) -> Result<String, WordlistError> {
        let result = self.generate_wordlist(config)?;

        let mut content = String::new();
        content.push_str("# Generated Wordlist for Invite Code Generation\n");
        content.push_str("# This file contains silly, fun, and memorable words\n");
        content.push_str("# for generating human-readable invite codes\n");
        content.push_str("# One word per line, automatically generated\n\n");

        for word in &result.words {
            content.push_str(word);
            content.push('\n');
        }

        Ok(content)
    }

    /// Validate a wordlist from file content
    pub fn validate_wordlist_content(
        &self,
        content: &str,
    ) -> Result<WordlistValidationResult, WordlistError> {
        let words = self.parse_wordlist_content(content)?;

        let mut issues = Vec::new();

        // Check minimum word count
        if words.len() < 50 {
            issues.push(format!(
                "Too few words: {} (recommended: at least 50)",
                words.len()
            ));
        }

        // Check for duplicates
        let unique_words: HashSet<_> = words.iter().collect();
        if unique_words.len() != words.len() {
            issues.push(format!(
                "Duplicate words found: {} total, {} unique",
                words.len(),
                unique_words.len()
            ));
        }

        // Check word lengths
        let too_short: Vec<_> = words.iter().filter(|w| w.len() < 3).collect();
        let too_long: Vec<_> = words.iter().filter(|w| w.len() > 12).collect();

        if !too_short.is_empty() {
            issues.push(format!("Words too short (< 3 chars): {:?}", too_short));
        }

        if !too_long.is_empty() {
            issues.push(format!("Words too long (> 12 chars): {:?}", too_long));
        }

        // Check for invalid characters
        let invalid_chars: Vec<_> = words
            .iter()
            .filter(|w| !w.chars().all(|c| c.is_ascii_alphabetic()))
            .collect();

        if !invalid_chars.is_empty() {
            issues.push(format!(
                "Words with invalid characters: {:?}",
                invalid_chars
            ));
        }

        let entropy_bits = (words.len() as f64).log2();

        Ok(WordlistValidationResult {
            is_valid: issues.is_empty(),
            total_words: words.len(),
            unique_words: unique_words.len(),
            issues,
            entropy_bits,
        })
    }

    /// Validate a wordlist from file
    pub fn validate_wordlist_file(
        &self,
        file_path: &str,
    ) -> Result<WordlistValidationResult, WordlistError> {
        if !Path::new(file_path).exists() {
            return Err(WordlistError::FileNotFound {
                path: file_path.to_string(),
            });
        }

        let content = std::fs::read_to_string(file_path)?;
        self.validate_wordlist_content(&content)
    }

    /// Get statistics for a wordlist from content
    pub fn get_wordlist_stats_content(
        &self,
        content: &str,
    ) -> Result<WordlistStats, WordlistError> {
        let words = self.parse_wordlist_content(content)?;

        let unique_words: HashSet<_> = words.iter().collect();
        let average_length =
            words.iter().map(|w| w.len()).sum::<usize>() as f64 / words.len() as f64;
        let min_length = words.iter().map(|w| w.len()).min().unwrap_or(0);
        let max_length = words.iter().map(|w| w.len()).max().unwrap_or(0);
        let entropy_bits = (words.len() as f64).log2();

        Ok(WordlistStats {
            total_words: words.len(),
            unique_words: unique_words.len(),
            average_length,
            min_length,
            max_length,
            entropy_bits,
            combinations_2_words: (words.len() as f64).powi(2),
            combinations_3_words: (words.len() as f64).powi(3),
            combinations_4_words: (words.len() as f64).powi(4),
        })
    }

    /// Get statistics for a wordlist from file
    pub fn get_wordlist_stats_file(&self, file_path: &str) -> Result<WordlistStats, WordlistError> {
        if !Path::new(file_path).exists() {
            return Err(WordlistError::FileNotFound {
                path: file_path.to_string(),
            });
        }

        let content = std::fs::read_to_string(file_path)?;
        self.get_wordlist_stats_content(&content)
    }

    /// Parse wordlist from file content, filtering comments and empty lines
    pub fn parse_wordlist_content(&self, content: &str) -> Result<Vec<String>, WordlistError> {
        let words: Vec<String> = content
            .lines()
            .map(|line| line.trim())
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .map(|line| line.to_lowercase())
            .collect();

        if words.is_empty() {
            return Err(WordlistError::NoValidWords);
        }

        Ok(words)
    }
}

impl Default for WordlistService {
    fn default() -> Self {
        Self::new()
    }
}

// Silly/Fun Words - entertaining and memorable
const SILLY_WORDS: &[&str] = &[
    "bacon", "banana", "burp", "cheese", "clown", "disco", "fart", "funky", "giggle", "jiggly",
    "kazoo", "noodle", "pickle", "rubber", "silly", "tickle", "wiggle", "yodel", "zoom", "boing",
    "splat", "whoosh", "bonk", "plop", "fizz", "buzz", "zap", "ping", "blob", "goofy", "quirky",
    "wacky", "zany", "nutty", "loopy", "dizzy", "fuzzy", "bubbly",
];

// Animal Words - cute and memorable creatures
const ANIMAL_WORDS: &[&str] = &[
    "ant", "bat", "bee", "cat", "cow", "dog", "eel", "elk", "fox", "goat", "hen", "pig", "rat",
    "yak", "bear", "deer", "duck", "frog", "goose", "horse", "llama", "moose", "mouse", "otter",
    "panda", "sheep", "sloth", "snail", "snake", "tiger", "whale", "zebra", "bunny", "puppy",
    "kitten", "hamster", "ferret", "gecko", "iguana", "koala", "lemur", "meerkat", "octopus",
    "penguin", "quail", "rabbit", "turkey", "walrus", "wombat",
];

// Food Words - tasty and fun
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
        let result = service.generate_wordlist(config).unwrap();

        assert!(!result.words.is_empty());
        assert_eq!(result.words.len(), result.actual_count);
        assert!(result.entropy_bits > 0.0);
        assert!(!result.categories_used.is_empty());
    }

    #[test]
    fn test_generate_wordlist_specific_categories() {
        let service = WordlistService::new();
        let config = WordlistConfig {
            count: 10,
            include_silly: true,
            include_animals: false,
            include_food: false,
            mixed: false,
        };

        let result = service.generate_wordlist(config).unwrap();
        assert_eq!(result.categories_used, vec!["silly/fun"]);
    }

    #[test]
    fn test_parse_wordlist_content() {
        let service = WordlistService::new();
        let content = "# Comment\nword1\nword2\n\n# Another comment\nword3";

        let words = service.parse_wordlist_content(content).unwrap();
        assert_eq!(words, vec!["word1", "word2", "word3"]);
    }

    #[test]
    fn test_validate_wordlist_content() {
        let service = WordlistService::new();
        let mut content = String::new();

        // Generate content with enough valid alphabetic words
        let words = [
            "apple",
            "banana",
            "cherry",
            "dragon",
            "elephant",
            "falcon",
            "guitar",
            "hello",
            "igloo",
            "jacket",
            "kitten",
            "lemon",
            "mango",
            "notebook",
            "orange",
            "piano",
            "queen",
            "rabbit",
            "sunset",
            "tiger",
            "umbrella",
            "violin",
            "walrus",
            "xylophone",
            "yellow",
            "zebra",
            "anchor",
            "bridge",
            "castle",
            "dolphin",
            "engine",
            "forest",
            "garden",
            "house",
            "island",
            "jungle",
            "kitchen",
            "library",
            "mountain",
            "nature",
            "ocean",
            "palace",
            "quartz",
            "river",
            "station",
            "temple",
            "universe",
            "village",
            "winter",
            "oxygen",
            "puzzle",
            "silver",
            "thunder",
            "velvet",
            "wisdom",
            "crystal",
            "melody",
            "harmony",
            "freedom",
            "journey",
            "miracle",
            "adventure",
        ];

        for word in &words {
            content.push_str(&format!("{}\n", word));
        }

        let result = service.validate_wordlist_content(&content).unwrap();
        assert!(result.is_valid);
        assert_eq!(result.total_words, words.len());
        assert!(result.issues.is_empty());
    }

    #[test]
    fn test_get_wordlist_stats() {
        let service = WordlistService::new();
        let content = "apple\nbanana\ncherry";

        let stats = service.get_wordlist_stats_content(content).unwrap();
        assert_eq!(stats.total_words, 3);
        assert_eq!(stats.unique_words, 3);
        assert_eq!(stats.combinations_3_words, 27.0);
    }
}
