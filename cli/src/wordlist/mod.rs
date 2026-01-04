//! Wordlist management module
//!
//! This module handles generation and validation of wordlists used for creating
//! memorable invite codes. It provides commands to generate wordlists from various
//! sources and validate existing wordlists.

use clap::Subcommand;
use legacylib::{WordlistConfig, WordlistService};
use std::fs;
use std::path::Path;

#[derive(Subcommand, Clone)]
pub enum WordlistCommands {
    /// Generate a new wordlist file
    Generate {
        /// Output file path (default: assets/config/wordlist.txt)
        #[arg(short, long, default_value = "assets/config/wordlist.txt")]
        output: String,
        /// Number of words to include
        #[arg(short, long, default_value = "100")]
        count: usize,
        /// Use built-in silly/fun words
        #[arg(long)]
        silly: bool,
        /// Use built-in animals
        #[arg(long)]
        animals: bool,
        /// Use built-in food words
        #[arg(long)]
        food: bool,
        /// Mix all categories (default)
        #[arg(long)]
        mixed: bool,
    },
    /// Validate an existing wordlist
    Validate {
        /// Wordlist file path (default: assets/config/wordlist.txt)
        #[arg(short, long, default_value = "assets/config/wordlist.txt")]
        file: String,
    },
    /// Show statistics about the wordlist
    Stats {
        /// Wordlist file path (default: assets/config/wordlist.txt)
        #[arg(short, long, default_value = "assets/config/wordlist.txt")]
        file: String,
    },
}

impl WordlistCommands {
    pub async fn handle(&self) -> Result<(), Box<dyn std::error::Error>> {
        match self {
            WordlistCommands::Generate {
                output,
                count,
                silly,
                animals,
                food,
                mixed,
            } => Self::generate_wordlist(output, *count, *silly, *animals, *food, *mixed).await,
            WordlistCommands::Validate { file } => Self::validate_wordlist(file).await,
            WordlistCommands::Stats { file } => Self::show_stats(file).await,
        }
    }

    async fn generate_wordlist(
        output: &str,
        count: usize,
        silly: bool,
        animals: bool,
        food: bool,
        mixed: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("🎲 Generating wordlist with {} words...", count);

        let wordlist_service = WordlistService::new();
        let config = WordlistConfig {
            count,
            include_silly: silly,
            include_animals: animals,
            include_food: food,
            mixed,
        };

        // Show which categories are being used
        let use_all = (!silly && !animals && !food) || mixed;
        if silly || use_all {
            println!("  📝 Added silly/fun words");
        }
        if animals || use_all {
            println!("  🐾 Added animal words");
        }
        if food || use_all {
            println!("  🍕 Added food words");
        }

        // Generate wordlist content
        let content = wordlist_service.generate_wordlist_content(config)?;

        // Create output directory if it doesn't exist
        if let Some(parent) = Path::new(output).parent() {
            fs::create_dir_all(parent)?;
        }

        // Write the file
        fs::write(output, content)?;

        // Generate result for display
        let result = wordlist_service.generate_wordlist(WordlistConfig {
            count,
            include_silly: silly,
            include_animals: animals,
            include_food: food,
            mixed,
        })?;

        println!("{}", result);
        println!("   📁 Saved to: {}", output);

        Ok(())
    }

    async fn validate_wordlist(file: &str) -> Result<(), Box<dyn std::error::Error>> {
        println!("🔍 Validating wordlist: {}", file);

        let wordlist_service = WordlistService::new();
        let result = wordlist_service.validate_wordlist_file(file)?;

        println!("{}", result);

        if !result.is_valid {
            return Err("Wordlist validation failed".into());
        }

        Ok(())
    }

    async fn show_stats(file: &str) -> Result<(), Box<dyn std::error::Error>> {
        println!("Wordlist file: {}", file);

        let wordlist_service = WordlistService::new();
        let stats = wordlist_service.get_wordlist_stats_file(file)?;

        println!("{}", stats);

        Ok(())
    }
}
