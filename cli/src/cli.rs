//! Simplified CLI that delegates to domain-specific modules

use clap::{Parser, Subcommand};
use sqlx::PgPool;

use legacylib::{AppConfig, DatabaseConnection};

use crate::analytics::AnalyticsCommands;
use crate::config::ConfigCommands;
use crate::music::MusicCommands;
use crate::notifications::NotificationCommands;
use crate::photos::PhotoCommands;
use crate::thumbnails::ThumbnailCommands;
use crate::users::UserCommands;
use crate::videos::VideoCommands;
use crate::wordlist::WordlistCommands;

#[derive(Parser)]
#[command(name = "cli")]
#[command(about = "WebAuthn administration CLI")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,

    /// Path to configuration file
    #[arg(long, short, default_value = "assets/config/config.jsonc")]
    pub config: Option<String>,

    /// Path to secrets configuration file
    #[arg(long, default_value = "assets/config/config.secrets.jsonc")]
    pub secrets: Option<String>,

    /// Database URL (overrides config file)
    #[arg(long, env = "DATABASE_URL")]
    pub database_url: Option<String>,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Configuration management
    Config {
        #[command(subcommand)]
        command: ConfigCommands,
    },
    /// User and invite code management
    #[command(subcommand)]
    Users(UserCommands),
    /// Analytics and data management
    #[command(subcommand)]
    Analytics(AnalyticsCommands),
    /// Wordlist management for invite codes
    #[command(subcommand)]
    Wordlist(WordlistCommands),
    /// Thumbnail generation tools and testing
    #[command(subcommand)]
    Thumbnails(ThumbnailCommands),
    /// Notification system management
    #[command(subcommand)]
    Notifications(NotificationCommands),
    /// Music library management and scanning
    #[command(subcommand)]
    Music(MusicCommands),
    /// Photo library management and scanning
    #[command(subcommand)]
    Photos(PhotoCommands),
    /// Video library management and scanning
    #[command(subcommand)]
    Videos(VideoCommands),
    /// Unified media scanning across all domains
    Scan {
        /// Directory path to scan
        #[arg(value_name = "PATH")]
        path: std::path::PathBuf,

        /// Optional session name
        #[arg(long, short)]
        name: Option<String>,

        /// Maximum directory depth to scan
        #[arg(long, short, default_value = "10")]
        depth: Option<usize>,

        /// Batch size for processing
        #[arg(long, short, default_value = "50")]
        batch_size: usize,

        /// Maximum file size in MB
        #[arg(long, default_value = "500")]
        max_size_mb: Option<u64>,

        /// Media domains to scan (music,photos,videos or 'all')
        #[arg(long, default_value = "all")]
        domains: String,
    },
}

impl Cli {
    pub async fn run(self) -> Result<(), Box<dyn std::error::Error>> {
        match self.command {
            Commands::Config { command } => command.handle(self.config, self.secrets).await,
            Commands::Users(ref user_command) => {
                let (_config, db) = self.setup_database().await?;

                // Initialize wordlist if needed for invite code generation
                self.ensure_wordlist_initialized().await?;

                user_command
                    .handle(
                        &db, 5,  // default count
                        12, // default length - more reasonable than 32
                    )
                    .await
            }
            Commands::Analytics(ref analytics_command) => {
                let (_config, db) = self.setup_database().await?;
                analytics_command.handle(&db).await
            }
            Commands::Wordlist(ref wordlist_command) => wordlist_command.handle().await,
            Commands::Thumbnails(ref thumbnail_command) => {
                crate::thumbnails::execute_thumbnail_command(thumbnail_command.clone()).await
            }
            Commands::Notifications(ref notification_command) => {
                let (_config, db) = self.setup_database().await?;
                notification_command.handle(&db).await
            }
            Commands::Music(ref music_command) => {
                let (_config, db) = self.setup_database().await?;
                music_command.handle(&db).await
            }
            Commands::Photos(ref photo_command) => {
                let (_config, db) = self.setup_database().await?;
                photo_command.handle(&db).await
            }
            Commands::Videos(ref video_command) => {
                let (_config, db) = self.setup_database().await?;
                video_command.handle(&db).await
            }
            Commands::Scan {
                ref path,
                ref name,
                ref depth,
                ref batch_size,
                ref max_size_mb,
                ref domains,
            } => {
                self.handle_unified_scan(
                    path,
                    name.as_ref(),
                    depth,
                    batch_size,
                    max_size_mb,
                    domains,
                )
                .await
            }
        }
    }

    async fn setup_database(
        &self,
    ) -> Result<(AppConfig, DatabaseConnection), Box<dyn std::error::Error>> {
        // Load configuration
        let (config, _secrets) = self.load_config_with_secrets().await?;

        // Get database URL
        let database_url = self
            .database_url
            .clone()
            .unwrap_or_else(|| config.database_url());

        // Connect to database
        let pool = PgPool::connect(&database_url).await?;
        let db = DatabaseConnection::new(pool);

        // Run migrations
        db.migrate().await?;

        Ok((config, db))
    }

    async fn load_config_with_secrets(
        &self,
    ) -> Result<(AppConfig, Option<()>), Box<dyn std::error::Error>> {
        let config_path = self
            .config
            .as_deref()
            .unwrap_or("assets/config/config.jsonc");
        let secrets_path = self
            .secrets
            .as_deref()
            .unwrap_or("assets/config/config.secrets.jsonc");

        let secrets_path_opt = if std::path::Path::new(secrets_path).exists() {
            Some(secrets_path)
        } else {
            None
        };

        match AppConfig::from_files(config_path, secrets_path_opt) {
            Ok((config, secrets)) => {
                let secrets_loaded = if secrets.is_some() { Some(()) } else { None };
                Ok((config, secrets_loaded))
            }
            Err(e) => {
                eprintln!("Failed to load configuration: {}", e);
                eprintln!("Using default configuration...");
                Ok((AppConfig::default(), None))
            }
        }
    }

    async fn ensure_wordlist_initialized(&self) -> Result<(), Box<dyn std::error::Error>> {
        use legacylib::wordlist::{initialize_wordlist, is_initialized, ManagementWordlistConfig};

        // Check if wordlist is already initialized
        if is_initialized() {
            return Ok(());
        }

        // Try to initialize from default wordlist file
        let wordlist_path = "assets/config/wordlist.txt";
        if !std::path::Path::new(wordlist_path).exists() {
            return Err(format!(
                "Wordlist file not found: {}. Run 'cargo run --bin cli wordlist generate' first.",
                wordlist_path
            )
            .into());
        }

        let config = ManagementWordlistConfig {
            file_path: wordlist_path.to_string(),
            ..Default::default()
        };

        initialize_wordlist(&config).map_err(|e| {
            format!("Failed to initialize wordlist: {}. Try regenerating with 'cargo run --bin cli wordlist generate'", e)
        })?;

        tracing::info!("Wordlist initialized successfully from {}", wordlist_path);
        Ok(())
    }

    async fn handle_unified_scan(
        &self,
        path: &std::path::PathBuf,
        name: Option<&String>,
        depth: &Option<usize>,
        batch_size: &usize,
        max_size_mb: &Option<u64>,
        domains: &String,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("🔍 Starting unified media scan...");
        println!("📁 Scanning directory: {}", path.display());

        // Parse domains
        let scan_domains: Vec<&str> = if domains == "all" {
            vec!["music", "photos", "videos"]
        } else {
            domains.split(',').map(|s| s.trim()).collect()
        };

        println!("🎯 Domains: {}", scan_domains.join(", "));

        // Configure scanner
        let scan_config = legacylib::media::ScanConfig {
            batch_size: *batch_size,
            max_depth: *depth,
            max_file_size: max_size_mb.map(|mb| mb * 1024 * 1024),
            ..Default::default()
        };

        // Build unified scanner with requested domains
        let mut builder = legacylib::media::UnifiedScannerBuilder::new().with_config(scan_config);

        for domain in &scan_domains {
            match *domain {
                "music" => {
                    // Would add music scanner here when available
                    println!("⚠️  Music scanner not yet integrated with unified scanner");
                }
                "photos" => {
                    let photo_scanner = legacylib::photos::PhotoScanner::new();
                    builder = builder.add_scanner(photo_scanner);
                    println!("📸 Added photo scanner");
                }
                "videos" => {
                    let video_scanner = legacylib::videos::VideoScanner::new();
                    builder = builder.add_scanner(video_scanner);
                    println!("🎬 Added video scanner");
                }
                _ => {
                    println!("⚠️  Unknown domain: {}", domain);
                }
            }
        }

        let scanner = builder.build();

        print!("🔍 Discovering media files...");
        std::io::Write::flush(&mut std::io::stdout())?;

        // Start scanning
        let results = scanner.scan_directory(path).await?;

        println!(" found {} files", results.len());

        if let Some(session_name) = name {
            println!("🏷️  Session: {}", session_name);
        }

        // Process and display results by domain
        let mut domain_stats = std::collections::HashMap::new();

        for result in &results {
            let entry = domain_stats
                .entry(result.media_type.clone())
                .or_insert((0, 0));
            if result.success {
                entry.0 += 1;
            } else {
                entry.1 += 1;
            }
        }

        println!("📊 Results by domain:");
        for (domain, (success, failed)) in domain_stats {
            println!("   {}: {} ✅ {} ❌", domain, success, failed);
        }

        let total_success = results.iter().filter(|r| r.success).count();
        let total_failed = results.len() - total_success;

        println!();
        println!("✅ Unified scan completed!");
        println!("📊 Summary:");
        println!("   📁 Files processed: {}", results.len());
        println!("   ✅ Successful: {}", total_success);
        println!("   ❌ Failed: {}", total_failed);

        if results.len() > 0 {
            let success_rate = (total_success as f64 / results.len() as f64) * 100.0;
            println!("   📈 Success rate: {:.1}%", success_rate);
        }

        Ok(())
    }
}
