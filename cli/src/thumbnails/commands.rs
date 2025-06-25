//! CLI commands for thumbnail tool validation and management

use clap::{Args, Subcommand};
use grimoire::{config::ConfigService, AppConfig};
use std::path::PathBuf;

/// Thumbnail-related commands
#[derive(Debug, Clone, Subcommand)]
pub enum ThumbnailCommands {
    /// Validate external tools for thumbnail generation
    ValidateTools(ValidateToolsArgs),
    /// Test thumbnail generation with a sample file
    Test(TestArgs),
}

/// Arguments for validating thumbnail tools
#[derive(Debug, Clone, Args)]
pub struct ValidateToolsArgs {
    /// Configuration file path
    #[arg(short, long, default_value = "config.jsonc")]
    pub config: PathBuf,

    /// Show detailed tool information
    #[arg(short, long)]
    pub verbose: bool,
}

/// Arguments for testing thumbnail generation
#[derive(Debug, Clone, Args)]
pub struct TestArgs {
    /// Configuration file path
    #[arg(short, long, default_value = "config.jsonc")]
    pub config: PathBuf,

    /// Input media file to test with
    #[arg(short, long)]
    pub input: PathBuf,

    /// Output directory for generated thumbnails
    #[arg(short, long, default_value = "/tmp/thumbnail_test")]
    pub output: PathBuf,
}

/// Execute thumbnail-related commands
pub async fn execute_thumbnail_command(
    cmd: ThumbnailCommands,
) -> Result<(), Box<dyn std::error::Error>> {
    match cmd {
        ThumbnailCommands::ValidateTools(args) => validate_tools(args).await,
        ThumbnailCommands::Test(args) => test_thumbnail_generation(args).await,
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

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
}
