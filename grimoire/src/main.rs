//! Simple main.rs for testing the Grimoire CLI
//! Temporary implementation for development and testing

use clap::Parser;
use grimoire::cli::utils::ErrorDetail;
use grimoire::{cli, find_config, init, init_config, GrimoireConfig};
use std::process;

#[tokio::main]
async fn main() {
    // Run CLI and handle errors with proper exit codes
    if let Err(err) = run().await {
        // Convert error to ErrorDetail for consistent formatting
        let error_detail = ErrorDetail::from(&err);

        eprintln!(
            "Error: [{}] {}",
            error_detail.error_type, error_detail.title
        );
        eprintln!("{}", error_detail.detail);

        process::exit(1);
    }
}

async fn run() -> grimoire::GrimoireResult<()> {
    // Parse CLI args first to get config path
    let cli = cli::Cli::parse();

    // Initialize logging
    tracing_subscriber::fmt::init();

    // Find and load config (using explicit path if provided)
    let config_path = find_config(cli.config.clone())?;
    let config = GrimoireConfig::load(config_path)?;

    // Initialize grimoire config globally
    init_config(config)?;

    // Initialize grimoire (ensure database exists)
    init().await?;

    // Run CLI with the parsed cli struct
    cli::run_cli_with_args(cli).await?;

    Ok(())
}
