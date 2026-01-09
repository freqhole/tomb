//! Wordlist operations CLI commands

use crate::cli::output::{CommandOutput, OutputFormat};
use crate::error::{GrimoireError, GrimoireResult};
use crate::wordlist::{
    generate_word_code, initialize_wordlist, is_initialized, ManagementWordlistConfig,
    WordlistConfig, WordlistService,
};
use clap::Subcommand;
use serde::Serialize;

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

#[derive(Debug, Clone, Serialize)]
pub struct WordlistGenerated {
    pub word_count: usize,
    pub config: WordlistConfigSummary,
    pub output_file: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WordlistConfigSummary {
    pub include_silly: bool,
    pub include_animals: bool,
    pub include_food: bool,
    pub mixed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct InviteCodes {
    pub codes: Vec<String>,
    pub word_count: usize,
}

/// Handle wordlist commands
pub async fn handle_command(action: WordlistAction, format: OutputFormat) -> GrimoireResult<()> {
    match action {
        WordlistAction::Generate {
            count,
            include_silly,
            include_animals,
            include_food,
            mixed,
            output,
        } => {
            let config = WordlistConfig {
                count,
                include_silly,
                include_animals,
                include_food,
                mixed,
            };

            let service = WordlistService::new();
            let _result = service.generate_wordlist(&config).map_err(|e| {
                GrimoireError::ProcessingFailed {
                    message: format!("Failed to generate wordlist: {}", e),
                }
            })?;

            let content = service.generate_wordlist_content(&config).map_err(|e| {
                GrimoireError::ProcessingFailed {
                    message: format!("Failed to generate wordlist content: {}", e),
                }
            })?;

            if let Some(output_path) = &output {
                std::fs::write(output_path, &content).map_err(|e| {
                    GrimoireError::ProcessingFailed {
                        message: format!("Failed to write wordlist to {}: {}", output_path, e),
                    }
                })?;
            }

            let data = WordlistGenerated {
                word_count: count,
                config: WordlistConfigSummary {
                    include_silly,
                    include_animals,
                    include_food,
                    mixed,
                },
                output_file: output,
            };

            let message = format!("Generated wordlist with {} words", count);
            let output = CommandOutput::success(message, data);
            print!("{}", output.format(format));
        }

        WordlistAction::Validate { file_path } => {
            let service = WordlistService::new();
            let validation = service.validate_wordlist_file(&file_path).map_err(|e| {
                GrimoireError::ProcessingFailed {
                    message: format!("Failed to validate wordlist: {}", e),
                }
            })?;

            let is_valid = validation.is_valid;
            let message = if is_valid {
                format!("Wordlist is valid: {}", file_path)
            } else {
                format!("Wordlist validation failed: {}", file_path)
            };

            let output = CommandOutput::success(message, validation);
            print!("{}", output.format(format));

            if !is_valid {
                std::process::exit(1);
            }
        }

        WordlistAction::Stats { file_path } => {
            let service = WordlistService::new();
            let stats = service.get_wordlist_stats_file(&file_path).map_err(|e| {
                GrimoireError::ProcessingFailed {
                    message: format!("Failed to get wordlist stats: {}", e),
                }
            })?;

            let message = format!("Wordlist statistics for: {}", file_path);
            let output = CommandOutput::success(message, stats);
            print!("{}", output.format(format));
        }

        WordlistAction::GenerateCode {
            word_count,
            count,
            wordlist_file,
        } => {
            if let Some(file_path) = wordlist_file {
                let config = ManagementWordlistConfig {
                    file_path,
                    ..Default::default()
                };

                initialize_wordlist(&config).map_err(|e| GrimoireError::ProcessingFailed {
                    message: format!("Failed to initialize wordlist: {}", e),
                })?;
            } else if !is_initialized() {
                return Err(GrimoireError::ProcessingFailed {
                    message:
                        "No wordlist initialized and no file provided. Use --wordlist-file or initialize a wordlist first"
                            .to_string(),
                });
            }

            let mut codes = Vec::new();
            for _ in 0..count {
                let code = generate_word_code(word_count).map_err(|e| {
                    GrimoireError::ProcessingFailed {
                        message: format!("Failed to generate code: {}", e),
                    }
                })?;
                codes.push(code);
            }

            let data = InviteCodes { codes, word_count };
            let message = format!(
                "Generated {} invite code{} with {} words each",
                count,
                if count == 1 { "" } else { "s" },
                word_count
            );
            let output = CommandOutput::success(message, data);
            print!("{}", output.format(format));
        }
    }

    Ok(())
}
