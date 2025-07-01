//! CLI commands for thumbnail tool validation and management

use clap::{Args, Subcommand};
use grimoire::{config::ConfigService, AppConfig, ThumbnailService};
use std::path::PathBuf;
use uuid::Uuid;

/// Thumbnail-related commands
#[derive(Debug, Clone, Subcommand)]
pub enum ThumbnailCommands {
    /// Validate thumbnail generation tools (ImageMagick, FFmpeg)
    ValidateTools(ValidateToolsArgs),
    /// Test thumbnail generation with a sample file
    Test(TestArgs),
    /// Show thumbnail job queue status and metrics
    Status(StatusArgs),
    /// List thumbnail jobs with optional filtering
    List(ListJobsArgs),
    /// Retry failed thumbnail jobs
    Retry(RetryArgs),
    /// Clean up old completed jobs and orphaned files
    Cleanup(CleanupArgs),
    /// Generate thumbnails for specific media blobs
    Generate(GenerateArgs),
    /// Run maintenance tasks
    Maintenance(MaintenanceArgs),
    /// Debug thumbnail job database issues
    Debug(DebugArgs),
    /// Bulk generate thumbnails for existing media blobs
    BulkGenerate(BulkGenerateArgs),
    /// Check system health and get recommendations
    Health(HealthArgs),
    /// Clean up duplicate thumbnails
    CleanupDuplicates(CleanupDuplicatesArgs),
}

/// Arguments for validating thumbnail tools
#[derive(Debug, Clone, Args)]
pub struct ValidateToolsArgs {
    /// Configuration file path
    #[arg(short, long, default_value = "assets/config/config.jsonc")]
    pub config: PathBuf,

    /// Show detailed tool information
    #[arg(short, long)]
    pub verbose: bool,
}

/// Arguments for testing thumbnail generation
#[derive(Debug, Clone, Args)]
pub struct TestArgs {
    /// Configuration file path
    #[arg(short, long, default_value = "assets/config/config.jsonc")]
    pub config: PathBuf,

    /// Input media file to test with
    #[arg(short, long)]
    pub input: PathBuf,

    /// Output directory for generated thumbnails
    #[arg(short, long, default_value = "/tmp/thumbnail_test")]
    pub output: PathBuf,
}

/// Arguments for checking thumbnail status
#[derive(Debug, Clone, Args)]
pub struct StatusArgs {
    /// Configuration file path
    #[arg(short, long, default_value = "assets/config/config.jsonc")]
    pub config: PathBuf,

    /// Show detailed metrics
    #[arg(short, long)]
    pub verbose: bool,
}

/// Arguments for listing thumbnail jobs
#[derive(Debug, Clone, Args)]
pub struct ListJobsArgs {
    /// Configuration file path
    #[arg(short, long, default_value = "assets/config/config.jsonc")]
    pub config: PathBuf,

    /// Filter by job status (pending, in_progress, completed, failed, failed_permanently, cancelled)
    #[arg(short, long)]
    pub status: Option<String>,

    /// Maximum number of jobs to show
    #[arg(short, long, default_value = "20")]
    pub limit: u32,

    /// Filter by media blob ID
    #[arg(short, long)]
    pub media_blob_id: Option<String>,
}

/// Arguments for retrying failed jobs
#[derive(Debug, Clone, Args)]
pub struct RetryArgs {
    /// Configuration file path
    #[arg(short, long, default_value = "assets/config/config.jsonc")]
    pub config: PathBuf,

    /// Specific job ID to retry (if not provided, retries all failed jobs)
    #[arg(long)]
    pub job_id: Option<Uuid>,

    /// Maximum number of jobs to retry
    #[arg(long, default_value = "100")]
    pub max_jobs: u32,
}

/// Arguments for cleanup operations
#[derive(Debug, Clone, Args)]
pub struct CleanupArgs {
    /// Configuration file path
    #[arg(short, long, default_value = "assets/config/config.jsonc")]
    pub config: PathBuf,

    /// Remove completed jobs older than this many days
    #[arg(long, default_value = "30")]
    pub days: u32,

    /// Remove orphaned thumbnail files (files without database records)
    #[arg(long)]
    pub orphaned_files: bool,

    /// Dry run - show what would be cleaned up without actually doing it
    #[arg(long)]
    pub dry_run: bool,
}

/// Arguments for manual thumbnail generation
#[derive(Debug, Clone, Args)]
pub struct GenerateArgs {
    /// Configuration file path
    #[arg(short, long, default_value = "assets/config/config.jsonc")]
    pub config: PathBuf,

    /// Media blob ID to generate thumbnails for
    #[arg(long)]
    pub media_blob_id: Uuid,

    /// Job type to generate (image_thumbnail, video_thumbnail, audio_waveform, video_preview)
    #[arg(long)]
    pub job_type: Option<String>,

    /// Job priority (low, normal, high, critical)
    #[arg(long, default_value = "normal")]
    pub priority: String,
}

/// Arguments for maintenance operations
#[derive(Debug, Clone, Args)]
pub struct MaintenanceArgs {
    /// Configuration file path
    #[arg(short, long, default_value = "assets/config/config.jsonc")]
    pub config: PathBuf,

    /// Run cleanup of old jobs
    #[arg(long)]
    pub cleanup_old_jobs: bool,

    /// Maximum age for cleanup in days
    #[arg(long, default_value = "30")]
    pub max_age_days: u32,

    /// Run orphaned file cleanup
    #[arg(long)]
    pub cleanup_orphaned_files: bool,

    /// Dry run - show what would be done without doing it
    #[arg(long)]
    pub dry_run: bool,

    /// Maximum number of items to process
    #[arg(long, default_value = "1000")]
    pub max_items: u32,
}

/// Arguments for debugging thumbnail jobs
#[derive(Debug, Clone, Args)]
pub struct DebugArgs {
    /// Configuration file path
    #[arg(short, long, default_value = "assets/config/config.jsonc")]
    pub config: PathBuf,

    /// Specific job ID to debug
    #[arg(long)]
    pub job_id: Option<String>,

    /// Show raw metadata
    #[arg(long)]
    pub raw: bool,
}

/// Arguments for health check
#[derive(Debug, Clone, Args)]
pub struct HealthArgs {
    /// Configuration file path
    #[arg(short, long, default_value = "assets/config/config.jsonc")]
    pub config: PathBuf,

    /// Cancel stuck jobs automatically
    #[arg(long)]
    pub fix_stuck: bool,

    /// Timeout in minutes for stuck job detection
    #[arg(long, default_value = "60")]
    pub stuck_timeout: i32,
}

#[derive(Debug, Clone, Args)]
pub struct BulkGenerateArgs {
    /// Configuration file path
    #[arg(short, long, default_value = "assets/config/config.jsonc")]
    pub config: PathBuf,

    /// Limit number of media blobs to process
    #[arg(long, default_value = "10")]
    pub limit: usize,

    /// Only process specific MIME types (comma-separated)
    #[arg(long)]
    pub mime_types: Option<String>,

    /// Dry run - don't actually create jobs
    #[arg(long)]
    pub dry_run: bool,
}

/// Arguments for cleaning up duplicate thumbnails
#[derive(Debug, Clone, Args)]
pub struct CleanupDuplicatesArgs {
    /// Configuration file path
    #[arg(short, long, default_value = "assets/config/config.jsonc")]
    pub config: PathBuf,

    /// Dry run - don't actually delete duplicates
    #[arg(long)]
    pub dry_run: bool,

    /// Keep strategy: 'first' (oldest) or 'last' (newest)
    #[arg(long, default_value = "first")]
    pub keep: String,

    /// Show detailed information about what will be deleted
    #[arg(short, long)]
    pub verbose: bool,
}

/// Execute thumbnail-related commands
pub async fn execute_thumbnail_command(
    command: ThumbnailCommands,
) -> Result<(), Box<dyn std::error::Error>> {
    match command {
        ThumbnailCommands::ValidateTools(args) => validate_tools(args).await,
        ThumbnailCommands::Test(args) => test_thumbnail_generation(args).await,
        ThumbnailCommands::Status(args) => show_status(args).await,
        ThumbnailCommands::List(args) => list_jobs(args).await,
        ThumbnailCommands::Retry(args) => retry_jobs(args).await,
        ThumbnailCommands::Cleanup(args) => cleanup_jobs(args).await,
        ThumbnailCommands::Generate(args) => generate_thumbnails(args).await,
        ThumbnailCommands::Maintenance(args) => run_maintenance(args).await,
        ThumbnailCommands::Debug(args) => debug_jobs(args).await,
        ThumbnailCommands::BulkGenerate(args) => bulk_generate_thumbnails(args).await,
        ThumbnailCommands::Health(args) => check_system_health(args).await,
        ThumbnailCommands::CleanupDuplicates(args) => cleanup_duplicate_thumbnails(args).await,
    }
}

/// Validate external tools for thumbnail generation
async fn validate_tools(args: ValidateToolsArgs) -> Result<(), Box<dyn std::error::Error>> {
    println!("Loading configuration from: {}", args.config.display());

    let config = AppConfig::from_file(&args.config)?;

    if !config.media.thumbnails.enabled {
        println!("⚠️  Thumbnail generation is disabled in configuration");
        println!("To enable thumbnails, set media.thumbnails.enabled = true in your config");
        return Ok(());
    }

    println!("Validating thumbnail generation tools...");

    let config_service = ConfigService::new();
    let thumbnail_config = config_service.to_thumbnail_config(&config);

    if args.verbose {
        println!("\nThumbnail Configuration:");
        println!("  Enabled: {}", thumbnail_config.enabled);
        println!(
            "  Max concurrent jobs: {}",
            thumbnail_config.max_concurrent_jobs
        );
        println!("  Storage path: {}", thumbnail_config.storage_path);
        println!("  Quality: {}%", thumbnail_config.quality);
        println!(
            "  Default dimensions: {}x{}",
            thumbnail_config.default_dimensions.width, thumbnail_config.default_dimensions.height
        );
        println!("  Image format: {}", thumbnail_config.formats.image_format);
        println!("  Video format: {}", thumbnail_config.formats.video_format);
        println!(
            "  Waveform format: {}",
            thumbnail_config.formats.waveform_format
        );
        println!();
    }

    match config_service
        .validate_thumbnail_tools(&thumbnail_config)
        .await
    {
        Ok(_) => {
            println!("✅ All thumbnail tools are available:");

            // Test ImageMagick
            let imagemagick_path = thumbnail_config
                .imagemagick_path
                .as_deref()
                .unwrap_or("convert");
            println!("  🖼️  ImageMagick: {}", imagemagick_path);

            if args.verbose {
                if let Ok(output) = tokio::process::Command::new(imagemagick_path)
                    .arg("--version")
                    .output()
                    .await
                {
                    if let Ok(version) = String::from_utf8(output.stdout) {
                        let first_line = version.lines().next().unwrap_or("Unknown version");
                        println!("      Version: {}", first_line);
                    }
                }
            }

            // Test FFmpeg
            let ffmpeg_path = thumbnail_config.ffmpeg_path.as_deref().unwrap_or("ffmpeg");
            println!("  🎬 FFmpeg: {}", ffmpeg_path);

            if args.verbose {
                if let Ok(output) = tokio::process::Command::new(ffmpeg_path)
                    .arg("-version")
                    .output()
                    .await
                {
                    if let Ok(version) = String::from_utf8(output.stdout) {
                        let first_line = version.lines().next().unwrap_or("Unknown version");
                        println!("      Version: {}", first_line);
                    }
                }
            }

            println!("\n🚀 Thumbnail generation is ready to use!");
            Ok(())
        }
        Err(e) => {
            eprintln!("❌ Thumbnail tool validation failed: {}", e);
            eprintln!("\n🔧 To fix this:");
            eprintln!("  1. Install ImageMagick:");
            eprintln!("     • macOS: brew install imagemagick");
            eprintln!("     • Ubuntu: sudo apt-get install imagemagick");
            eprintln!("     • Windows: https://imagemagick.org/script/download.php");
            eprintln!("  2. Install FFmpeg:");
            eprintln!("     • macOS: brew install ffmpeg");
            eprintln!("     • Ubuntu: sudo apt-get install ffmpeg");
            eprintln!("     • Windows: https://ffmpeg.org/download.html");
            eprintln!("  3. Or set custom paths in your configuration:");
            eprintln!("     {{");
            eprintln!("       \"media\": {{");
            eprintln!("         \"thumbnails\": {{");
            eprintln!("           \"imagemagick_path\": \"/custom/path/to/convert\",");
            eprintln!("           \"ffmpeg_path\": \"/custom/path/to/ffmpeg\"");
            eprintln!("         }}");
            eprintln!("       }}");
            eprintln!("     }}");
            Err(e.into())
        }
    }
}

/// Test thumbnail generation with a sample file
async fn test_thumbnail_generation(args: TestArgs) -> Result<(), Box<dyn std::error::Error>> {
    println!("Loading configuration from: {}", args.config.display());

    let config = AppConfig::from_file(&args.config)?;

    if !config.media.thumbnails.enabled {
        return Err("Thumbnail generation is disabled in configuration".into());
    }

    if !args.input.exists() {
        return Err(format!("Input file does not exist: {}", args.input.display()).into());
    }

    println!("Testing thumbnail generation...");
    println!("  Input file: {}", args.input.display());
    println!("  Output directory: {}", args.output.display());

    // Create output directory
    tokio::fs::create_dir_all(&args.output).await?;

    println!("📝 Note: Full thumbnail generation testing requires database connection.");
    println!("         This command validates tools and configuration only.");
    println!("         Use the server's auto-enqueue functionality for full testing.");

    // Validate tools first
    let config_service = ConfigService::new();
    let thumbnail_config = config_service.to_thumbnail_config(&config);

    config_service
        .validate_thumbnail_tools(&thumbnail_config)
        .await?;

    println!("✅ Tools validated successfully!");
    println!("💡 To test full thumbnail generation:");
    println!("   1. Start the server with: cargo run --bin server");
    println!("   2. Upload a file through the API");
    println!("   3. Check the thumbnail workers in the server logs");

    Ok(())
}

/// Show thumbnail system status and metrics
async fn show_status(args: StatusArgs) -> Result<(), Box<dyn std::error::Error>> {
    println!("Loading configuration from: {}", args.config.display());

    let config = AppConfig::from_file(&args.config)?;

    if !config.media.thumbnails.enabled {
        println!("⚠️  Thumbnail generation is disabled in configuration");
        return Ok(());
    }

    // Connect to database
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = grimoire::DatabaseConnection::new(pool);

    // Create thumbnail service and get metrics
    let service = grimoire::ThumbnailService::new_with_defaults(&db);

    println!("📊 Thumbnail System Status");
    println!("{}", "=".repeat(50));

    // Get job counts by status
    let pending_jobs = service.get_pending_jobs(1000).await?;
    let completed_jobs = service
        .get_jobs_by_status(grimoire::thumbnails::ThumbnailJobStatus::Completed, 1000)
        .await?;
    let failed_jobs = service
        .get_jobs_by_status(grimoire::thumbnails::ThumbnailJobStatus::Failed, 1000)
        .await?;
    let failed_permanently_jobs = service
        .get_jobs_by_status(
            grimoire::thumbnails::ThumbnailJobStatus::FailedPermanently,
            1000,
        )
        .await?;

    println!("Job Counts:");
    println!("  ⏳ Pending: {}", pending_jobs.len());
    println!("  ✅ Completed: {}", completed_jobs.len());
    println!("  ❌ Failed: {}", failed_jobs.len());
    println!("  💀 Failed Permanently: {}", failed_permanently_jobs.len());

    let total_jobs = pending_jobs.len()
        + completed_jobs.len()
        + failed_jobs.len()
        + failed_permanently_jobs.len();
    println!("  📈 Total: {}", total_jobs);

    if total_jobs > 0 {
        let success_rate = (completed_jobs.len() as f64 / total_jobs as f64) * 100.0;
        println!("  📊 Success Rate: {:.1}%", success_rate);
    }

    if args.verbose {
        println!("\nConfiguration:");
        println!(
            "  Max concurrent jobs: {}",
            config.media.thumbnails.max_concurrent_jobs
        );
        println!("  Storage path: {}", config.media.thumbnails.storage_path);
        println!("  Quality: {}%", config.media.thumbnails.quality);

        if !pending_jobs.is_empty() {
            println!("\nNext {} pending jobs:", pending_jobs.len().min(5));
            for job in pending_jobs.iter().take(5) {
                println!("  • {} - {} ({:?})", job.id, job.job_type, job.priority);
            }
        }

        if !failed_jobs.is_empty() {
            println!("\nRecent failed jobs:");
            for job in failed_jobs.iter().take(3) {
                println!(
                    "  • {} - {}",
                    job.id,
                    job.error_message.as_deref().unwrap_or("Unknown error")
                );
            }
        }
    }

    Ok(())
}

/// List thumbnail jobs with filtering
async fn list_jobs(args: ListJobsArgs) -> Result<(), Box<dyn std::error::Error>> {
    let config = AppConfig::from_file(&args.config)?;

    if !config.media.thumbnails.enabled {
        return Err("Thumbnail generation is disabled in configuration".into());
    }

    // Connect to database
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = grimoire::DatabaseConnection::new(pool);

    let service = grimoire::ThumbnailService::new_with_defaults(&db);

    // Parse filter criteria
    let jobs = if let Some(status_str) = &args.status {
        let status = match status_str.as_str() {
            "pending" => grimoire::thumbnails::ThumbnailJobStatus::Pending,
            "in_progress" => grimoire::thumbnails::ThumbnailJobStatus::InProgress,
            "completed" => grimoire::thumbnails::ThumbnailJobStatus::Completed,
            "failed" => grimoire::thumbnails::ThumbnailJobStatus::Failed,
            "failed_permanently" => grimoire::thumbnails::ThumbnailJobStatus::FailedPermanently,
            "cancelled" => grimoire::thumbnails::ThumbnailJobStatus::Cancelled,
            _ => return Err(format!("Invalid status: {}", status_str).into()),
        };
        service
            .get_jobs_by_status(status, args.limit as i32)
            .await?
    } else {
        service.get_pending_jobs(args.limit as i32).await?
    };

    // Filter by media blob ID if provided
    let filtered_jobs: Vec<_> = if let Some(media_blob_id_str) = &args.media_blob_id {
        jobs.into_iter()
            .filter(|job| job.media_blob_id == *media_blob_id_str)
            .collect()
    } else {
        jobs
    };

    println!("📋 Thumbnail Jobs");
    println!("{}", "=".repeat(80));

    if filtered_jobs.is_empty() {
        println!("No jobs found matching the criteria.");
        return Ok(());
    }

    for job in filtered_jobs {
        println!("ID: {}", job.id);
        println!("  Media Blob: {}", job.media_blob_id);
        println!("  Type: {}", job.job_type);
        println!("  Status: {}", job.status);
        println!("  Priority: {:?}", job.priority);
        println!(
            "  Created: {}",
            job.created_at
                .format(&time::format_description::well_known::Rfc3339)?
        );
        println!("  Retries: {}/{}", job.retry_count, job.max_retries);
        if let Some(error) = &job.error_message {
            println!("  Error: {}", error);
        }
        if let Some(worker) = &job.worker_id {
            println!("  Worker: {}", worker);
        }
        println!();
    }

    Ok(())
}

/// Retry failed thumbnail jobs
async fn retry_jobs(args: RetryArgs) -> Result<(), Box<dyn std::error::Error>> {
    let config = AppConfig::from_file(&args.config)?;

    if !config.media.thumbnails.enabled {
        return Err("Thumbnail generation is disabled in configuration".into());
    }

    // Connect to database
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = grimoire::DatabaseConnection::new(pool);

    let service = ThumbnailService::new_with_defaults(&db);

    if let Some(job_id) = &args.job_id {
        // Retry specific job
        println!("Retrying specific job: {}", job_id);
        println!("💡 Use the HTTP API endpoint POST /api/thumbnails/retry for retry functionality");
        println!("   Or restart failed jobs by re-enqueueing them");
    } else {
        // Get failed jobs count
        let failed_jobs = service
            .get_jobs_by_status(
                grimoire::thumbnails::ThumbnailJobStatus::Failed,
                args.max_jobs as i32,
            )
            .await?;

        println!("Found {} failed jobs", failed_jobs.len());
        println!("💡 Use the HTTP API endpoint POST /api/thumbnails/retry to retry failed jobs");
        println!("   Or use the server's job queue retry functionality");
    }

    Ok(())
}

/// Clean up old jobs and orphaned files
async fn cleanup_jobs(args: CleanupArgs) -> Result<(), Box<dyn std::error::Error>> {
    let config = AppConfig::from_file(&args.config)?;

    if !config.media.thumbnails.enabled {
        return Err("Thumbnail generation is disabled in configuration".into());
    }

    // Connect to database
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = grimoire::DatabaseConnection::new(pool);

    // Create thumbnail config for directory info
    let config_service = grimoire::config::ConfigService::new();
    let thumbnail_config = config_service.to_thumbnail_config(&config);

    println!("🧹 Cleaning up thumbnail data...");

    if args.dry_run {
        println!("🔍 DRY RUN - No changes will be made");
    }

    // Get old jobs for reporting
    let service = ThumbnailService::new_with_defaults(&db);
    let completed_jobs = service
        .get_jobs_by_status(grimoire::thumbnails::ThumbnailJobStatus::Completed, 1000)
        .await?;

    let cutoff_date = time::OffsetDateTime::now_utc() - time::Duration::days(args.days as i64);
    let old_jobs: Vec<_> = completed_jobs
        .into_iter()
        .filter(|job| job.updated_at < cutoff_date)
        .collect();

    println!(
        "Found {} completed jobs older than {} days",
        old_jobs.len(),
        args.days
    );

    if !args.dry_run {
        println!("💡 Use the HTTP API endpoint POST /api/thumbnails/cleanup?days={} for cleanup functionality", args.days);
        println!("   Or use direct database operations for cleanup");
    } else {
        println!(
            "🔍 Would clean up {} jobs older than {} days",
            old_jobs.len(),
            args.days
        );
    }

    // Clean up orphaned files if requested
    if args.orphaned_files {
        println!("Checking for orphaned thumbnail files...");

        let thumbnail_dir = std::path::Path::new(&thumbnail_config.storage_path);
        if thumbnail_dir.exists() {
            // This is a simplified check - in a real implementation,
            // you'd want to cross-reference with the database
            println!("📁 Thumbnail directory: {}", thumbnail_dir.display());

            if args.dry_run {
                println!(
                    "🔍 Would scan for orphaned files in {}",
                    thumbnail_dir.display()
                );
            } else {
                println!("💡 Orphaned file cleanup not yet implemented - use manual cleanup");
            }
        } else {
            println!(
                "⚠️  Thumbnail directory does not exist: {}",
                thumbnail_dir.display()
            );
        }
    }

    println!("✅ Cleanup analysis completed");
    Ok(())
}

/// Generate thumbnails for a specific media blob
async fn generate_thumbnails(args: GenerateArgs) -> Result<(), Box<dyn std::error::Error>> {
    let config = AppConfig::from_file(&args.config)?;

    if !config.media.thumbnails.enabled {
        return Err("Thumbnail generation is disabled in configuration".into());
    }

    // Parse arguments
    let media_blob_id = args.media_blob_id;

    let job_type = if let Some(type_str) = &args.job_type {
        Some(match type_str.as_str() {
            "image_thumbnail" => grimoire::thumbnails::ThumbnailJobType::ImageThumbnail,
            "video_thumbnail" => grimoire::thumbnails::ThumbnailJobType::VideoThumbnail,
            "audio_waveform" => grimoire::thumbnails::ThumbnailJobType::AudioWaveform,
            "video_preview" => grimoire::thumbnails::ThumbnailJobType::VideoPreview,
            _ => return Err(format!("Invalid job type: {}", type_str).into()),
        })
    } else {
        None
    };

    let priority = match args.priority.as_str() {
        "low" => grimoire::thumbnails::ThumbnailJobPriority::Low,
        "normal" => grimoire::thumbnails::ThumbnailJobPriority::Normal,
        "high" => grimoire::thumbnails::ThumbnailJobPriority::High,
        "critical" => grimoire::thumbnails::ThumbnailJobPriority::Critical,
        _ => return Err(format!("Invalid priority: {}", args.priority).into()),
    };

    // Connect to database
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = grimoire::DatabaseConnection::new(pool);

    let service = ThumbnailService::new_with_defaults(&db);

    println!("🎬 Generating thumbnails for media blob: {}", media_blob_id);

    if let Some(specific_type) = job_type {
        // Enqueue specific job type using service
        println!("  Job type: {:?}", specific_type);
        println!("  Priority: {:?}", priority);

        match service
            .enqueue_thumbnail_job(
                &media_blob_id.to_string(),
                specific_type,
                Some(priority),
                None,
            )
            .await
        {
            Ok(job_id) => {
                println!("✅ Enqueued job: {}", job_id);
            }
            Err(e) => return Err(format!("Failed to enqueue job: {}", e).into()),
        }
    } else {
        // Auto-enqueue appropriate jobs
        println!("  Auto-detecting job types...");

        match service
            .auto_enqueue_for_media_blob(&media_blob_id.to_string())
            .await
        {
            Ok(job_ids) => {
                if job_ids.is_empty() {
                    println!("ℹ️  No new thumbnail jobs needed (all thumbnails already exist)");
                } else {
                    println!("✅ Enqueued {} jobs:", job_ids.len());
                    for job_id in job_ids {
                        println!("  - {}", job_id);
                    }
                }
            }
            Err(e) => return Err(format!("Failed to auto-enqueue jobs: {}", e).into()),
        }
    }

    println!("💡 Use 'cli thumbnails status' to monitor progress");
    Ok(())
}

/// Run maintenance tasks for the thumbnail system
async fn run_maintenance(args: MaintenanceArgs) -> Result<(), Box<dyn std::error::Error>> {
    let config = AppConfig::from_file(&args.config)?;

    if !config.media.thumbnails.enabled {
        return Err("Thumbnail generation is disabled in configuration".into());
    }

    println!("🧹 Running thumbnail maintenance tasks");
    if args.dry_run {
        println!("🔍 DRY RUN MODE - No changes will be made");
    }

    // Connect to database
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = grimoire::DatabaseConnection::new(pool);

    let service = ThumbnailService::new_with_defaults(&db);

    let mut _tasks_run = 0;

    // Run old job cleanup if requested
    if args.cleanup_old_jobs {
        println!(
            "📋 Cleaning up jobs older than {} days...",
            args.max_age_days
        );

        let completed_jobs = service
            .get_jobs_by_status(
                grimoire::thumbnails::ThumbnailJobStatus::Completed,
                args.max_items as i32,
            )
            .await?;

        let cutoff_date =
            time::OffsetDateTime::now_utc() - time::Duration::days(args.max_age_days as i64);
        let old_jobs: Vec<_> = completed_jobs
            .into_iter()
            .filter(|job| job.updated_at < cutoff_date)
            .collect();

        println!("Found {} old completed jobs", old_jobs.len());

        if args.dry_run {
            println!("🔍 Would clean up {} old jobs", old_jobs.len());
        } else {
            println!("💡 Use the HTTP API endpoint POST /api/thumbnails/cleanup?days={} for actual cleanup", args.max_age_days);
        }

        _tasks_run += 1;
    }

    Ok(())
}

/// Debug thumbnail job database issues
async fn debug_jobs(args: DebugArgs) -> Result<(), Box<dyn std::error::Error>> {
    let config = AppConfig::from_file(&args.config)?;

    // Connect to database
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = grimoire::DatabaseConnection::new(pool);

    println!("🔍 Debugging Thumbnail Jobs Database");
    println!("{}", "=".repeat(80));

    if let Some(job_id_str) = &args.job_id {
        let job_id = uuid::Uuid::parse_str(job_id_str)?;

        // Query raw database record
        let row = sqlx::query!(
                "SELECT id, media_blob_id, job_type, status, priority, worker_id, target_width, target_height, scheduled_at, started_at, completed_at, retry_count, max_retries, error_message, metadata, created_at, updated_at FROM thumbnail_jobs WHERE id = $1",
                job_id
            )
            .fetch_optional(db.pool())
            .await?;

        if let Some(row) = row {
            println!("Raw Database Record:");
            println!("  ID: {}", row.id);
            println!("  Media Blob ID: {}", row.media_blob_id);
            println!("  Job Type: {}", row.job_type);
            println!("  Status: {}", row.status);
            println!(
                "  Target Dimensions: {}x{}",
                row.target_width
                    .map(|w| w.to_string())
                    .unwrap_or("None".to_string()),
                row.target_height
                    .map(|h| h.to_string())
                    .unwrap_or("None".to_string())
            );
            println!("  Retry Count: {}/{}", row.retry_count, row.max_retries);
            println!(
                "  Worker ID: {}",
                row.worker_id.unwrap_or("None".to_string())
            );
            println!("  Created: {}", row.created_at);
            println!("  Updated: {}", row.updated_at);
            println!("  Scheduled: {}", row.scheduled_at);
            if let Some(started) = row.started_at {
                println!("  Started: {}", started);
            }
            if let Some(completed) = row.completed_at {
                println!("  Completed: {}", completed);
            }
            if let Some(error) = &row.error_message {
                println!("  Error: {}", error);
            }

            if args.raw {
                println!("  Metadata JSON:");
                println!("{}", serde_json::to_string_pretty(&row.metadata)?);
            } else {
                println!("  ✅ Successfully read job data from columns");
                if let Some(metadata_value) = &row.metadata {
                    if let Some(metadata_obj) = metadata_value.as_object() {
                        if !metadata_obj.is_empty() {
                            println!("  Additional metadata:");
                            println!("{}", serde_json::to_string_pretty(metadata_value)?);
                        }
                    }
                }
            }
        } else {
            println!("❌ Job with ID {} not found", job_id);
        }
    } else {
        // Show general database state
        let recent_jobs = sqlx::query!(
                "SELECT id, media_blob_id, status, job_type, retry_count, created_at FROM thumbnail_jobs ORDER BY created_at DESC LIMIT 10"
            )
            .fetch_all(db.pool())
            .await?;

        println!("Recent 10 Jobs:");
        for row in recent_jobs {
            println!(
                "  ID: {} | Status: {} | Type: {} | Media: {} | Retries: {} | Created: {}",
                &row.id.to_string()[0..8],
                row.status,
                row.job_type,
                &row.media_blob_id.to_string()[0..8],
                row.retry_count,
                row.created_at
            );
        }

        // Show database schema
        let schema = sqlx::query!(
                "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'thumbnail_jobs' ORDER BY ordinal_position"
            )
            .fetch_all(db.pool())
            .await?;

        println!("\nDatabase Schema:");
        for col in schema {
            println!(
                "  {}: {}",
                col.column_name.unwrap_or_else(|| "unknown".to_string()),
                col.data_type.unwrap_or_else(|| "unknown".to_string())
            );
        }
    }

    Ok(())
}

/// Check system health and get recommendations
async fn check_system_health(args: HealthArgs) -> Result<(), Box<dyn std::error::Error>> {
    let config = AppConfig::from_file(&args.config)?;

    if !config.media.thumbnails.enabled {
        return Err("Thumbnail generation is disabled in configuration".into());
    }

    println!("🏥 Thumbnail System Health Check");
    println!("================================================================================");

    // Connect to database
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = grimoire::DatabaseConnection::new(pool);
    let service = ThumbnailService::new_with_defaults(&db);

    // Get health summary
    match service.get_system_health().await {
        Ok(health) => {
            // Print status with appropriate emoji
            let status_emoji = match health.status.as_str() {
                "healthy" => "✅",
                "degraded" => "⚠️",
                "overloaded" => "🔥",
                _ => "❓",
            };

            println!(
                "System Status: {} {}",
                status_emoji,
                health.status.to_uppercase()
            );
            println!();

            // Print metrics
            println!("📊 Current Metrics:");
            println!("  Pending Jobs: {}", health.pending_jobs_count);
            println!("  Stuck Jobs: {}", health.stuck_jobs_count);
            println!("  Recent Failures (24h): {}", health.recent_failures_count);
            println!(
                "  Avg Queue Time: {:.1} minutes",
                health.avg_queue_time_minutes
            );
            println!();

            // Print recommendations
            println!("💡 Recommendations:");
            for (i, rec) in health.recommendations.iter().enumerate() {
                println!("  {}. {}", i + 1, rec);
            }

            // Handle stuck jobs if requested
            if args.fix_stuck && health.stuck_jobs_count > 0 {
                println!();
                println!("🔧 Fixing stuck jobs...");

                match service.cancel_stale_jobs(args.stuck_timeout).await {
                    Ok(cancelled_count) => {
                        println!("✅ Cancelled {} stuck jobs", cancelled_count);
                    }
                    Err(e) => {
                        println!("❌ Failed to cancel stuck jobs: {}", e);
                    }
                }
            } else if health.stuck_jobs_count > 0 {
                println!();
                println!("💡 To fix stuck jobs automatically, run:");
                println!("   cargo run -p cli -- thumbnails health --fix-stuck");
            }
        }
        Err(e) => {
            println!("❌ Failed to get health status: {}", e);
            return Err(e.into());
        }
    }

    Ok(())
}

/// Bulk generate thumbnails for existing media blobs
async fn bulk_generate_thumbnails(
    args: BulkGenerateArgs,
) -> Result<(), Box<dyn std::error::Error>> {
    let config = AppConfig::from_file(&args.config)?;

    if !config.media.thumbnails.enabled {
        return Err("Thumbnail generation is disabled in configuration".into());
    }

    // Connect to database
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = grimoire::DatabaseConnection::new(pool);

    println!("🚀 Bulk Thumbnail Generation");
    println!("{}", "=".repeat(80));

    // Build MIME type filter
    let mime_filter = if let Some(mime_types_str) = &args.mime_types {
        mime_types_str
            .split(',')
            .map(|s| s.trim().to_string())
            .collect::<Vec<_>>()
    } else {
        vec!["image/%".to_string(), "video/%".to_string()]
    };

    println!("MIME type filter: {:?}", mime_filter);

    // Query media blobs that might need thumbnails
    let mut query = "SELECT id, mime, local_path FROM media_blobs WHERE deleted_at IS NULL AND blob_type = 'original'".to_string();

    if !mime_filter.is_empty() {
        let conditions: Vec<String> = mime_filter
            .iter()
            .map(|mime| format!("mime LIKE '{}'", mime))
            .collect();
        query.push_str(&format!(" AND ({})", conditions.join(" OR ")));
    }

    query.push_str(&format!(" ORDER BY created_at DESC LIMIT {}", args.limit));

    let media_blobs = sqlx::query_as::<_, (uuid::Uuid, Option<String>, Option<String>)>(&query)
        .fetch_all(db.pool())
        .await?;

    println!("Found {} media blobs to process", media_blobs.len());

    if args.dry_run {
        println!("🔍 DRY RUN - would process:");
        for (id, mime, path) in media_blobs {
            println!(
                "  {} | {} | {:?}",
                id,
                mime.unwrap_or("unknown".to_string()),
                path
            );
        }
        return Ok(());
    }

    let service = grimoire::ThumbnailService::new_with_defaults(&db);
    let mut successful = 0;
    let mut failed = 0;

    for (media_blob_id, _mime, _path) in media_blobs {
        print!("Processing {} ... ", media_blob_id);

        match service
            .auto_enqueue_for_media_blob(&media_blob_id.to_string())
            .await
        {
            Ok(job_ids) => {
                println!("✅ {} jobs enqueued: {:?}", job_ids.len(), job_ids);
                successful += 1;
            }
            Err(e) => {
                println!("❌ Failed: {}", e);
                failed += 1;
            }
        }
    }

    println!("\n📊 Summary:");
    println!("  ✅ Successful: {}", successful);
    println!("  ❌ Failed: {}", failed);
    println!("  📝 Total: {}", successful + failed);

    Ok(())
}

/// Clean up duplicate thumbnails for media blobs
async fn cleanup_duplicate_thumbnails(
    args: CleanupDuplicatesArgs,
) -> Result<(), Box<dyn std::error::Error>> {
    let config = AppConfig::from_file(&args.config)?;

    // Connect to database
    let pool = sqlx::PgPool::connect(&config.database_url()).await?;
    let db = grimoire::DatabaseConnection::new(pool);

    println!("🧹 Thumbnail Duplicate Cleanup");
    println!("{}", "=".repeat(80));

    // Validate keep strategy
    let keep_strategy = match args.keep.as_str() {
        "first" | "oldest" => grimoire::thumbnails::KeepStrategy::First,
        "last" | "newest" => grimoire::thumbnails::KeepStrategy::Last,
        _ => return Err("Invalid keep strategy. Use 'first' or 'last'".into()),
    };

    println!(
        "Strategy: Keep {} thumbnail per blob type",
        match keep_strategy {
            grimoire::thumbnails::KeepStrategy::First => "first",
            grimoire::thumbnails::KeepStrategy::Last => "last",
        }
    );

    let service = grimoire::ThumbnailService::new_with_defaults(&db);

    // Find duplicate thumbnails
    // get_pending_jobs
    // service.get_pending_jobs(limit)
    let duplicate_groups = service.find_duplicate_thumbnails().await?;

    if duplicate_groups.is_empty() {
        println!("✅ No duplicate thumbnails found!");
        return Ok(());
    }

    println!(
        "Found {} groups with duplicate thumbnails:",
        duplicate_groups.len()
    );

    let mut total_to_delete = 0;

    for group in &duplicate_groups {
        println!(
            "  📁 Blob {} ({}): {} duplicates",
            group
                .parent_blob_id
                .to_string()
                .chars()
                .take(8)
                .collect::<String>(),
            group.blob_type,
            group.duplicate_count
        );

        if args.verbose {
            for id in &group.thumbnail_ids {
                println!("    - {}", id);
            }
        }

        // Calculate how many will be deleted based on strategy
        let will_delete = group.duplicate_count - 1; // Keep one, delete the rest
        total_to_delete += will_delete;

        if args.verbose {
            println!("    → Will delete {} thumbnails", will_delete);
        }
    }

    println!();
    println!("📊 Summary:");
    println!("  Total duplicate groups: {}", duplicate_groups.len());
    println!("  Total thumbnails to delete: {}", total_to_delete);

    if args.dry_run {
        println!("🔍 DRY RUN - No deletions performed");
        println!("Run without --dry-run to actually delete duplicates");
        return Ok(());
    }

    if total_to_delete == 0 {
        println!("✅ Nothing to delete!");
        return Ok(());
    }

    // Confirm deletion
    print!(
        "⚠️  Are you sure you want to delete {} thumbnails? (y/N): ",
        total_to_delete
    );
    use std::io::{self, Write};
    io::stdout().flush()?;

    let mut input = String::new();
    io::stdin().read_line(&mut input)?;

    if !input.trim().to_lowercase().starts_with('y') {
        println!("❌ Deletion cancelled");
        return Ok(());
    }

    // Perform cleanup using the service
    println!("🗑️  Deleting duplicate thumbnails...");
    let cleanup_result = service.cleanup_duplicate_thumbnails(keep_strategy).await?;

    println!();
    println!(
        "✅ Successfully processed {} groups and deleted {} duplicate thumbnails",
        cleanup_result.groups_processed, cleanup_result.thumbnails_deleted
    );

    // Verify cleanup was complete
    let remaining_duplicates = service.find_duplicate_thumbnails().await?;
    if remaining_duplicates.is_empty() {
        println!("🎉 All duplicate thumbnails cleaned up!");
    } else {
        println!("⚠️  {} duplicate groups remain", remaining_duplicates.len());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_tools_args() {
        // Test that the CLI args can be parsed
        let args = ValidateToolsArgs {
            config: PathBuf::from("test.jsonc"),
            verbose: true,
        };

        assert_eq!(args.config, PathBuf::from("test.jsonc"));
        assert!(args.verbose);
    }

    #[test]
    fn test_test_args() {
        let args = TestArgs {
            config: PathBuf::from("config.jsonc"),
            input: PathBuf::from("test.jpg"),
            output: PathBuf::from("/tmp/test"),
        };

        assert_eq!(args.config, PathBuf::from("config.jsonc"));
        assert_eq!(args.input, PathBuf::from("test.jpg"));
        assert_eq!(args.output, PathBuf::from("/tmp/test"));
    }

    #[test]
    fn test_status_args() {
        let args = StatusArgs {
            config: PathBuf::from("config.jsonc"),
            verbose: false,
        };

        assert_eq!(args.config, PathBuf::from("config.jsonc"));
        assert!(!args.verbose);
    }

    #[test]
    fn test_maintenance_args() {
        let args = MaintenanceArgs {
            config: PathBuf::from("config.jsonc"),
            cleanup_old_jobs: true,
            max_age_days: 30,
            cleanup_orphaned_files: false,
            dry_run: true,
            max_items: 1000,
        };

        assert_eq!(args.config, PathBuf::from("config.jsonc"));
        assert!(args.cleanup_old_jobs);
        assert_eq!(args.max_age_days, 30);
        assert!(!args.cleanup_orphaned_files);
        assert!(args.dry_run);
        assert_eq!(args.max_items, 1000);
    }
}
