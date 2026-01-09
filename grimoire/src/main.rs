//! Simple main.rs for testing the Grimoire CLI
//! Temporary implementation for development and testing

use grimoire::{cli, find_config, init, init_config, GrimoireConfig};
use std::process;

#[tokio::main]
async fn main() {
    // Run CLI and handle errors with proper exit codes
    if let Err(err) = run().await {
        // Convert error to ErrorDetail for consistent formatting
        let error_detail = grimoire::cli::output::ErrorDetail::from(&err);

        eprintln!(
            "Error: [{}] {}",
            error_detail.error_type, error_detail.title
        );
        eprintln!("{}", error_detail.detail);

        process::exit(1);
    }
}

async fn run() -> grimoire::GrimoireResult<()> {
    // Initialize logging
    tracing_subscriber::fmt::init();

    // Find and load config
    let config_path = find_config(None)?;
    let config = GrimoireConfig::load(config_path)?;

    // Initialize grimoire config globally
    init_config(config)?;

    // Initialize grimoire (ensure database exists)
    init().await?;

    // Run CLI
    cli::run_cli().await?;

    Ok(())
}
