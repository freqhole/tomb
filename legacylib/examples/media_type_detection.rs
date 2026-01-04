//! Example demonstrating media type detection utilities
//!
//! This example shows how to use the MediaTypeDetector to:
//! - Detect supported audio file formats
//! - Get MIME types for files
//! - Determine storage strategies based on file size and source
//!
//! Run with: cargo run --example media_type_detection

use legacylib::config::AppConfig;
use legacylib::media::MediaTypeDetector;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Load configuration
    let config = AppConfig::default();
    let detector = MediaTypeDetector::from_config(&config);

    println!("🎵 Media Type Detection Example");
    println!("===============================\n");

    // Show supported audio formats
    println!("📁 Supported audio formats:");
    for format in detector.supported_audio_formats() {
        println!("  - {}", format);
    }
    println!();

    // Test various file paths
    let test_files = vec![
        "music/song.mp3",
        "audio/track.flac",
        "sounds/effect.wav",
        "album/song.m4a",
        "podcast.ogg",
        "document.txt",
        "image.jpg",
        "video.mp4",
        "no_extension",
    ];

    println!("🔍 File type detection:");
    for file_path in &test_files {
        match detector.is_audio_file(file_path) {
            Ok(is_audio) => {
                let icon = if is_audio { "🎵" } else { "📄" };
                let type_str = if is_audio { "AUDIO" } else { "OTHER" };

                // Try to get MIME type
                let mime_info = match detector.get_mime_type(file_path) {
                    Ok(mime) => format!(" ({})", mime),
                    Err(_) => " (unknown MIME)".to_string(),
                };

                println!("  {} {:20} → {}{}", icon, file_path, type_str, mime_info);
            }
            Err(e) => {
                println!("  ❌ {:20} → ERROR: {}", file_path, e);
            }
        }
    }
    println!();

    // Demonstrate storage strategy decisions
    println!("💾 Storage strategy examples:");

    let test_scenarios = vec![
        (5_000_000, true, "5MB client upload"),      // 5MB from client
        (15_000_000, true, "15MB client upload"),    // 15MB from client
        (1_000_000, false, "1MB filesystem scan"),   // 1MB from filesystem
        (50_000_000, false, "50MB filesystem scan"), // 50MB from filesystem
    ];

    for (size, is_client_upload, description) in test_scenarios {
        let strategy = detector.get_storage_strategy(size, is_client_upload);
        let strategy_str = match strategy {
            legacylib::media::StorageStrategy::Bytea => "Database (bytea)",
            legacylib::media::StorageStrategy::Filesystem => "Filesystem (local_path)",
        };

        println!("  📦 {:25} → {}", description, strategy_str);
    }

    // Generated content always goes to bytea
    let _generated_strategy = detector.get_generated_content_strategy();
    println!("  🖼️  Generated thumbnails/waveforms → Database (bytea)");
    println!();

    // Show configuration limits
    println!("⚙️  Configuration:");
    println!(
        "  Max blob size: {} bytes ({:.1} MB)",
        detector.max_blob_file_size(),
        detector.max_blob_file_size() as f64 / 1_048_576.0
    );

    println!("\n✅ Example completed successfully!");

    Ok(())
}
