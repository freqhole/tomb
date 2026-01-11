//! Wordlist operations CLI commands

use crate::cli::utils::{CommandOutput, OutputFormat};
use crate::error::GrimoireError;
use crate::wordlist::{
    generate_word_code, initialize_wordlist, is_initialized, InviteCodesResponse,
    ManagementWordlistConfig, WordlistConfig, WordlistConfigSummary, WordlistGeneratedResponse,
    WordlistService,
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
pub async fn handle_command(action: WordlistAction, _format: OutputFormat) -> CommandOutput<()> {
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
            if let Err(e) = service.generate_wordlist(&config) {
                return CommandOutput::failure(
                    "Failed to generate wordlist",
                    vec![GrimoireError::ProcessingFailed {
                        message: e.to_string(),
                    }
                    .into()],
                    (),
                );
            }

            let content = match service.generate_wordlist_content(&config) {
                Ok(c) => c,
                Err(e) => {
                    return CommandOutput::failure(
                        "Failed to generate wordlist content",
                        vec![GrimoireError::ProcessingFailed {
                            message: e.to_string(),
                        }
                        .into()],
                        (),
                    )
                }
            };

            if let Some(output_path) = &output {
                if let Err(e) = std::fs::write(output_path, &content) {
                    return CommandOutput::failure(
                        format!("Failed to write wordlist to {}", output_path),
                        vec![GrimoireError::ProcessingFailed {
                            message: e.to_string(),
                        }
                        .into()],
                        (),
                    );
                }
            }

            let data = WordlistGeneratedResponse {
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
            CommandOutput::success(message, data).map_data(|_| ())
        }

        WordlistAction::Validate { file_path } => {
            let service = WordlistService::new();
            let validation = match service.validate_wordlist_file(&file_path) {
                Ok(v) => v,
                Err(e) => {
                    return CommandOutput::failure(
                        "Failed to validate wordlist",
                        vec![GrimoireError::ProcessingFailed {
                            message: e.to_string(),
                        }
                        .into()],
                        (),
                    )
                }
            };

            let is_valid = validation.is_valid;
            let message = if is_valid {
                format!("Wordlist is valid: {}", file_path)
            } else {
                format!("Wordlist validation failed: {}", file_path)
            };

            if is_valid {
                CommandOutput::success(message, validation).map_data(|_| ())
            } else {
                CommandOutput::failure(message, vec![], ()).map_data(|_| ())
            }
        }

        WordlistAction::Stats { file_path } => {
            let service = WordlistService::new();
            let stats = match service.get_wordlist_stats_file(&file_path) {
                Ok(s) => s,
                Err(e) => {
                    return CommandOutput::failure(
                        "Failed to get wordlist stats",
                        vec![GrimoireError::ProcessingFailed {
                            message: e.to_string(),
                        }
                        .into()],
                        (),
                    )
                }
            };

            let message = format!("Wordlist statistics for: {}", file_path);
            CommandOutput::success(message, stats).map_data(|_| ())
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

                let response = initialize_wordlist(&config);
                if !response.success {
                    return CommandOutput::failure(response.message, response.errors, ());
                }
            } else if !is_initialized() {
                return CommandOutput::failure(
                    "No wordlist initialized",
                    vec![GrimoireError::ProcessingFailed {
                        message: "No wordlist initialized and no file provided. Use --wordlist-file or initialize a wordlist first".to_string(),
                    }.into()],
                    (),
                );
            }

            let mut codes = Vec::new();
            for _ in 0..count {
                let response = generate_word_code(word_count);
                if !response.success {
                    return CommandOutput::failure(response.message, response.errors, ());
                }
                if let Some(code) = response.data {
                    codes.push(code);
                }
            }

            let data = InviteCodesResponse { codes, word_count };
            let message = format!(
                "Generated {} invite code{} with {} words each",
                count,
                if count == 1 { "" } else { "s" },
                word_count
            );
            CommandOutput::success(message, data).map_data(|_| ())
        }
    }
}
