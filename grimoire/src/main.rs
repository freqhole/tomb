//! Simple main.rs for testing the Grimoire CLI
//! Temporary implementation for development and testing

use grimoire::{cli, config::AppConfig, init, GrimoireResult};

#[tokio::main]
async fn main() -> GrimoireResult<()> {
    // Initialize logging
    tracing_subscriber::fmt::init();

    // Load config
    let config = AppConfig::default();

    // Initialize grimoire (ensure database exists)
    init(&config).await?;

    // Run CLI
    cli::run_cli().await?;

    Ok(())
}
