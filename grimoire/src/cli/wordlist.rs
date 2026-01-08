//! Wordlist operations CLI commands

use crate::error::GrimoireResult;
use crate::wordlist::{
    generate_word_code, initialize_wordlist, is_initialized, ManagementWordlistConfig,
    WordlistConfig, WordlistService,
};
use clap::Subcommand;

#[derive(Subcommand)]
pub enum WordlistAction {
    /// Generate wordlist
    Generate {
        /// Number of words to generate
        #[arg(long, default_value = "10")]
        count: usize,
        /// Include silly words
        #[arg(long)]
        include_silly: bool,
        /// Include animal names
        #[arg(long)]
        include_animals: bool,
        /// Include food names
        #[arg(long)]
        include_food: bool,
        /// Mix different word types
        #[arg(long)]
        mixed: bool,
        /// Output file path (optional, defaults to stdout)
        #[arg(long)]
        output: Option<String>,
    },
    /// Validate a wordlist file
    Validate {
        /// Path to the wordlist file
        file_path: String,
    },
    /// Show statistics for a wordlist
    Stats {
        /// Path to the wordlist file
        file_path: String,
    },
    /// Generate invite codes from wordlist
    GenerateCode {
        /// Number of words per code
        #[arg(long, default_value = "3")]
        word_count: usize,
        /// Number of codes to generate
        #[arg(long, default_value = "1")]
        count: usize,
        /// Path to wordlist file (optional)
        #[arg(long)]
        wordlist_file: Option<String>,
    },
}

/// Handle wordlist commands
pub async fn handle_command(action: WordlistAction) -> GrimoireResult<()> {
    match action {
        WordlistAction::Generate {
            count,
            include_silly,
            include_animals,
            include_food,
            mixed,
            output,
        } => {
            println!("generating wordlist...");

            let config = WordlistConfig {
                count,
                include_silly,
                include_animals,
                include_food,
                mixed,
            };

            let service = WordlistService::new();
            match service.generate_wordlist(&config) {
                Ok(result) => {
                    let content = service.generate_wordlist_content(&config).map_err(|e| {
                        crate::error::GrimoireError::ProcessingFailed {
                            message: format!("Failed to generate wordlist content: {}", e),
                        }
                    })?;

                    if let Some(output_path) = output {
                        std::fs::write(&output_path, &content).map_err(|e| {
                            crate::error::GrimoireError::ProcessingFailed {
                                message: format!(
                                    "Failed to write wordlist to {}: {}",
                                    output_path, e
                                ),
                            }
                        })?;
                        println!("wordlist written to: {}", output_path);
                    } else {
                        println!("{}", content);
                    }

                    println!("generation result: {}", result);
                }
                Err(e) => {
                    eprintln!("failed to generate wordlist: {}", e);
                }
            }
        }
        WordlistAction::Validate { file_path } => {
            println!("validating wordlist: {}", file_path);

            let service = WordlistService::new();
            match service.validate_wordlist_file(&file_path) {
                Ok(result) => {
                    println!("{}", result);
                    if !result.is_valid {
                        std::process::exit(1);
                    }
                }
                Err(e) => {
                    eprintln!("failed to validate wordlist: {}", e);
                    std::process::exit(1);
                }
            }
        }
        WordlistAction::Stats { file_path } => {
            println!("analyzing wordlist: {}", file_path);

            let service = WordlistService::new();
            match service.get_wordlist_stats_file(&file_path) {
                Ok(stats) => {
                    println!("{}", stats);
                }
                Err(e) => {
                    eprintln!("failed to get wordlist stats: {}", e);
                    std::process::exit(1);
                }
            }
        }
        WordlistAction::GenerateCode {
            word_count,
            count,
            wordlist_file,
        } => {
            println!(
                "generating {} invite codes with {} words each...",
                count, word_count
            );

            if let Some(file_path) = wordlist_file {
                // Initialize wordlist from file
                let config = ManagementWordlistConfig {
                    file_path,
                    ..Default::default()
                };

                if let Err(e) = initialize_wordlist(&config) {
                    eprintln!("failed to initialize wordlist: {}", e);
                    std::process::exit(1);
                }
            } else if !is_initialized() {
                eprintln!("no wordlist initialized and no file provided");
                eprintln!("either provide --wordlist-file or initialize a wordlist first");
                std::process::exit(1);
            }

            for i in 1..=count {
                match generate_word_code(word_count) {
                    Ok(code) => {
                        if count > 1 {
                            println!("{}: {}", i, code);
                        } else {
                            println!("{}", code);
                        }
                    }
                    Err(e) => {
                        eprintln!("failed to generate code {}: {}", i, e);
                    }
                }
            }
        }
    }

    Ok(())
}
