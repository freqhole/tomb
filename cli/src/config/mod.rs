//! Config module
//!
//! This module handles all configuration-related CLI commands including:
//! - Configuration file generation and validation
//! - Secrets management
//! - Schema generation
//! - Environment file generation

use clap::Subcommand;
use grimoire::{ConfigDisplayFormat, ConfigGenerationOptions, ConfigService};
use std::path::PathBuf;

#[derive(Subcommand, Clone)]
pub enum ConfigCommands {
    /// Generate a default configuration file
    Init {
        /// Force overwrite existing config file
        #[arg(short, long)]
        force: bool,
        /// Also generate secrets file
        #[arg(long)]
        with_secrets: bool,
    },
    /// Validate the configuration file
    Validate {
        /// Path to configuration file to validate
        #[arg(short, long, default_value = "assets/config/config.jsonc")]
        config: PathBuf,
        /// Path to secrets file (optional)
        #[arg(short, long)]
        secrets: Option<PathBuf>,
    },
    /// Generate default secrets configuration
    InitSecrets {
        /// Force overwrite existing secrets file
        #[arg(short, long)]
        force: bool,
    },
    /// Generate JSON Schema for editor support
    Schema {
        /// Output path for schema file
        #[arg(short, long, default_value = ".zed/config.schema.json")]
        output: PathBuf,
    },
    /// Generate .env file from configuration
    GenerateEnv {
        /// Output path for .env file
        #[arg(short, long, default_value = ".env")]
        output: PathBuf,
        /// Include example values with comments
        #[arg(long)]
        with_examples: bool,
    },
    /// Show current configuration
    Show {
        /// Show configuration as JSON
        #[arg(long)]
        json: bool,
        /// Show only specific section
        #[arg(long)]
        section: Option<String>,
    },
}

impl ConfigCommands {
    pub async fn handle(
        &self,
        config_path: Option<String>,
        secrets_path: Option<String>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let config_service = ConfigService::new();
        let default_config_path =
            config_path.unwrap_or_else(|| "assets/config/config.jsonc".to_string());
        let default_secrets_path =
            secrets_path.unwrap_or_else(|| "assets/config/config.secrets.jsonc".to_string());

        match self {
            ConfigCommands::Init {
                force,
                with_secrets,
            } => {
                Self::init_config(&config_service, &default_config_path, *force, *with_secrets)
                    .await
            }
            ConfigCommands::Validate { config, secrets } => {
                Self::validate_config(
                    &config_service,
                    config.to_str().unwrap(),
                    secrets.as_ref().map(|s| s.to_str().unwrap()),
                )
                .await
            }
            ConfigCommands::InitSecrets { force } => {
                Self::init_secrets(&config_service, &default_secrets_path, *force).await
            }
            ConfigCommands::Schema { output } => {
                Self::generate_schema(&config_service, output).await
            }
            ConfigCommands::GenerateEnv {
                output,
                with_examples,
            } => {
                Self::generate_env_file(
                    &config_service,
                    &default_config_path,
                    Some(&default_secrets_path),
                    output,
                    *with_examples,
                )
                .await
            }
            ConfigCommands::Show { json, section } => {
                Self::show_config(
                    &config_service,
                    &default_config_path,
                    Some(&default_secrets_path),
                    *json,
                    section.as_deref(),
                )
                .await
            }
        }
    }

    async fn init_config(
        config_service: &ConfigService,
        config_path: &str,
        force: bool,
        with_secrets: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let secrets_path = config_path.replace("config.jsonc", "config.secrets.jsonc");

        let options = ConfigGenerationOptions {
            force_overwrite: force,
            with_secrets,
            with_examples: false,
        };

        match config_service.init_config(config_path, options) {
            Ok(created_files) => {
                for file in &created_files {
                    println!("✓ Generated file: {}", file);
                }

                println!();
                println!("📝 Next steps:");
                println!("  1. Edit {} to customize your configuration", config_path);
                if with_secrets {
                    println!("  2. Edit {} to set your secrets", secrets_path);
                } else {
                    println!("  2. Run 'cli config init-secrets' to generate secrets file");
                }
                println!("  3. Run 'cli config validate' to check your configuration");
            }
            Err(e) => {
                eprintln!("❌ Failed to initialize configuration: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }

    async fn init_secrets(
        config_service: &ConfigService,
        secrets_path: &str,
        force: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        match config_service.init_secrets(secrets_path, force) {
            Ok(()) => {
                println!("✓ Generated secrets file: {}", secrets_path);
                println!("⚠️  Remember to:");
                println!("  - Fill in your actual secrets");
                println!("  - Add {} to .gitignore", secrets_path);
                println!("  - Set appropriate file permissions (600)");
            }
            Err(e) => {
                eprintln!("❌ Failed to generate secrets file: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }

    async fn validate_config(
        config_service: &ConfigService,
        config_path: &str,
        secrets_path: Option<&str>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("🔍 Validating configuration...");
        println!("  Config file: {}", config_path);

        if let Some(secrets) = secrets_path {
            if std::path::Path::new(secrets).exists() {
                println!("  Secrets file: {}", secrets);
            } else {
                println!("  Secrets file: {} (not found, will use defaults)", secrets);
            }
        }

        match config_service.validate_config(config_path, secrets_path) {
            Ok(result) => {
                println!("{}", result);
                if !result.is_valid {
                    return Err("Configuration validation failed".into());
                }
            }
            Err(e) => {
                eprintln!("❌ Failed to validate configuration: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }

    async fn generate_schema(
        config_service: &ConfigService,
        output: &PathBuf,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("📄 Generating JSON schema...");

        match config_service.generate_schema() {
            Ok(schema_content) => {
                std::fs::write(output, schema_content)?;
                println!("✓ Generated JSON schema: {}", output.display());
                println!();
                println!("💡 Usage:");
                println!(
                    "  - Configure your editor to use this schema for assets/config/config.jsonc"
                );
                println!("  - This enables autocompletion and validation in your editor");
            }
            Err(e) => {
                eprintln!("❌ Failed to generate schema: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }

    async fn generate_env_file(
        config_service: &ConfigService,
        config_path: &str,
        secrets_path: Option<&str>,
        output: &PathBuf,
        with_examples: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("📄 Generating .env file...");

        match config_service.generate_env_file(config_path, secrets_path, with_examples) {
            Ok(content) => {
                std::fs::write(output, content)?;
                println!("✓ Generated .env file: {}", output.display());

                if with_examples {
                    println!("💡 Uncomment and modify the variables you want to override");
                }
            }
            Err(e) => {
                eprintln!("❌ Failed to generate .env file: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }

    async fn show_config(
        config_service: &ConfigService,
        config_path: &str,
        secrets_path: Option<&str>,
        json: bool,
        section: Option<&str>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let format = if json {
            ConfigDisplayFormat::Json
        } else {
            ConfigDisplayFormat::Debug
        };

        match config_service.format_config(config_path, secrets_path, format, section) {
            Ok(output) => {
                println!("{}", output);
            }
            Err(e) => {
                eprintln!("❌ Failed to show configuration: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }
}
