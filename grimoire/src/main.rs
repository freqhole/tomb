//! Simple main.rs for testing the Grimoire CLI
//! Temporary implementation for development and testing

use grimoire::{cli, find_config, init, init_config, GrimoireConfig, GrimoireResult};

#[tokio::main]
async fn main() -> GrimoireResult<()> {
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
