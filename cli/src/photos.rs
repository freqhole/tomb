//! Photo management CLI commands
//!
//! This module provides CLI commands for photo scanning, gallery management,
//! and photo organization following the patterns established in the music module.

use clap::Subcommand;
use grimoire::{
    media::{ConsoleScanProgress, MetadataExtractor, ScanConfig, UnifiedScannerBuilder},
    photos::{PhotoMetadataExtractor, PhotoScanConfig},
    DatabaseConnection,
};
use std::path::PathBuf;
use tracing::{error, info};

#[derive(Subcommand, Clone)]
pub enum PhotoCommands {
    /// Scan directories for photos
    Scan {
        /// Directory path to scan
        #[arg(value_name = "PATH")]
        path: PathBuf,

        /// Optional session name
        #[arg(long, short)]
        name: Option<String>,

        /// Maximum directory depth to scan
        #[arg(long, short, default_value = "10")]
        depth: Option<usize>,

        /// Batch size for processing
        #[arg(long, short, default_value = "50")]
        batch_size: usize,

        /// File extensions to include (comma-separated)
        #[arg(long, short)]
        extensions: Option<String>,

        /// Maximum file size in MB
        #[arg(long, default_value = "100")]
        max_size_mb: Option<u64>,

        /// Extract full EXIF data
        #[arg(long)]
        full_exif: bool,

        /// Extract GPS coordinates
        #[arg(long, default_value = "true")]
        extract_gps: bool,
    },

    /// Test photo metadata extraction
    Test {
        /// Photo file to test
        #[arg(value_name = "FILE")]
        file: PathBuf,

        /// Show full EXIF data
        #[arg(long)]
        full: bool,
    },

    /// List photos with optional filters
    List {
        /// Filter by favorite status
        #[arg(long)]
        favorites: bool,

        /// Filter by camera make
        #[arg(long)]
        camera: Option<String>,

        /// Filter by location
        #[arg(long)]
        location: Option<String>,

        /// Number of photos to display
        #[arg(long, short, default_value = "25")]
        limit: i64,

        /// Offset for pagination
        #[arg(long, short, default_value = "0")]
        offset: i64,
    },

    /// Show photo details
    Info {
        /// Photo ID
        #[arg(value_name = "ID")]
        id: String,

        /// Show technical details
        #[arg(long)]
        technical: bool,
    },

    /// Gallery management commands
    Galleries {
        #[command(subcommand)]
        command: GalleryCommands,
    },

    /// Generate thumbnails for photos
    Thumbnails {
        /// Number of photos to process
        #[arg(long, short, default_value = "10")]
        limit: i64,

        /// Force regeneration of existing thumbnails
        #[arg(long)]
        force: bool,
    },
}

#[derive(Subcommand, Clone)]
pub enum GalleryCommands {
    /// List all galleries
    List {
        /// Show only public galleries
        #[arg(long)]
        public: bool,

        /// Show gallery details
        #[arg(long, short)]
        verbose: bool,
    },

    /// Create a new gallery
    Create {
        /// Gallery title
        #[arg(value_name = "TITLE")]
        title: String,

        /// Gallery description
        #[arg(long, short)]
        description: Option<String>,

        /// Make gallery public
        #[arg(long)]
        public: bool,

        /// Make gallery collaborative
        #[arg(long)]
        collaborative: bool,
    },

    /// Show gallery details
    Show {
        /// Gallery ID or title
        #[arg(value_name = "GALLERY")]
        gallery: String,

        /// Show detailed information
        #[arg(long, short)]
        verbose: bool,
    },

    /// Add photos to a gallery
    Add {
        /// Gallery ID or title
        #[arg(value_name = "GALLERY")]
        gallery: String,

        /// Photo IDs to add
        #[arg(value_name = "PHOTO_IDS")]
        photos: Vec<String>,
    },

    /// Remove photos from a gallery
    Remove {
        /// Gallery ID or title
        #[arg(value_name = "GALLERY")]
        gallery: String,

        /// Photo IDs to remove
        #[arg(value_name = "PHOTO_IDS")]
        photos: Vec<String>,
    },

    /// Delete a gallery
    Delete {
        /// Gallery ID or title
        #[arg(value_name = "GALLERY")]
        gallery: String,

        /// Force deletion without confirmation
        #[arg(long)]
        force: bool,
    },
}

impl PhotoCommands {
    pub async fn handle(&self, db: &DatabaseConnection) -> Result<(), Box<dyn std::error::Error>> {
        match self {
            PhotoCommands::Scan {
                path,
                name,
                depth,
                batch_size,
                extensions,
                max_size_mb,
                full_exif,
                extract_gps,
            } => {
                self.handle_scan(
                    path,
                    name.clone(),
                    *depth,
                    *batch_size,
                    extensions.clone(),
                    *max_size_mb,
                    *full_exif,
                    *extract_gps,
                )
                .await
            }
            PhotoCommands::Test { file, full } => self.handle_test(file, *full).await,
            PhotoCommands::List {
                favorites,
                camera,
                location,
                limit,
                offset,
            } => {
                self.handle_list(
                    *favorites,
                    camera.clone(),
                    location.clone(),
                    *limit,
                    *offset,
                )
                .await
            }
            PhotoCommands::Info { id, technical } => self.handle_info(id, *technical).await,
            PhotoCommands::Galleries { command } => command.handle(db).await,
            PhotoCommands::Thumbnails { limit, force } => {
                self.handle_thumbnails(*limit, *force).await
            }
        }
    }

    async fn handle_scan(
        &self,
        path: &PathBuf,
        name: Option<String>,
        depth: Option<usize>,
        batch_size: usize,
        extensions: Option<String>,
        max_size_mb: Option<u64>,
        full_exif: bool,
        extract_gps: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("📸 Starting photo library scan...");
        println!("📁 Scanning directory: {}", path.display());

        // Configure scanner
        let mut scan_config = ScanConfig {
            batch_size,
            max_depth: depth,
            max_file_size: max_size_mb.map(|mb| mb * 1024 * 1024),
            ..Default::default()
        };

        // Parse extensions if provided
        if let Some(ext_str) = extensions {
            let exts: Vec<String> = ext_str
                .split(',')
                .map(|s| s.trim().to_lowercase())
                .collect();
            scan_config.include_extensions = exts;
        }

        // Create photo scanner with configuration
        let photo_config = PhotoScanConfig {
            extract_full_exif: full_exif,
            extract_gps,
            ..Default::default()
        };

        let photo_scanner = grimoire::photos::ConfigurablePhotoScanner::new(photo_config);

        // Build unified scanner
        let scanner = UnifiedScannerBuilder::new()
            .with_config(scan_config)
            .add_scanner(photo_scanner)
            .build();

        print!("🔍 Discovering photo files...");
        std::io::Write::flush(&mut std::io::stdout())?;

        // Start scanning
        let results = scanner.scan_directory(path).await?;

        println!(" found {} files", results.len());

        if let Some(session_name) = name {
            println!("🏷️  Session: {}", session_name);
        }

        // Process results
        let mut processed = 0;
        let mut succeeded = 0;
        let mut failed = 0;

        let _progress = ConsoleScanProgress::new(10);

        let total_files = results.len();
        for result in &results {
            processed += 1;

            if result.success {
                succeeded += 1;
                info!(
                    "Successfully processed: {} ({})",
                    result.file.path.display(),
                    result.media_type
                );

                // Extract some interesting metadata for display
                if let Some(camera) = result.metadata.get("camera_make") {
                    if let Some(model) = result.metadata.get("camera_model") {
                        println!(
                            "  📷 Camera: {} {}",
                            camera.as_str().unwrap_or("Unknown"),
                            model.as_str().unwrap_or("Unknown")
                        );
                    }
                }

                if let Some(has_gps) = result.metadata.get("has_gps") {
                    if has_gps.as_bool().unwrap_or(false) {
                        println!("  🌍 GPS coordinates available");
                    }
                }

                if let Some(dimensions) = result
                    .metadata
                    .get("width_px")
                    .zip(result.metadata.get("height_px"))
                {
                    if let (Some(w), Some(h)) = (dimensions.0.as_i64(), dimensions.1.as_i64()) {
                        println!("  📐 Dimensions: {}×{}", w, h);
                    }
                }
            } else {
                failed += 1;
                error!(
                    "Failed to process: {} - {}",
                    result.file.path.display(),
                    result
                        .error
                        .as_ref()
                        .unwrap_or(&"Unknown error".to_string())
                );
            }

            // Report progress every 10 files
            if processed % 10 == 0 {
                println!("📊 Progress: {}/{} files processed", processed, total_files);
            }
        }

        println!("✅ Scan completed!");
        println!("📊 Summary:");
        println!("   📁 Files processed: {}", processed);
        println!("   ✅ Successful: {}", succeeded);
        println!("   ❌ Failed: {}", failed);

        if succeeded > 0 {
            let success_rate = (succeeded as f64 / processed as f64) * 100.0;
            println!("   📈 Success rate: {:.1}%", success_rate);
        }

        Ok(())
    }

    async fn handle_test(
        &self,
        file: &PathBuf,
        show_full: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("🧪 Testing photo metadata extraction...");
        println!("📁 File: {}", file.display());

        if !file.exists() {
            return Err(format!("File not found: {}", file.display()).into());
        }

        let extractor = PhotoMetadataExtractor::new();

        if !extractor.supports_file(file) {
            println!("⚠️  File type not supported for metadata extraction");
            return Ok(());
        }

        println!("🔍 Extracting metadata...");

        match extractor.extract_metadata(file).await {
            Ok(metadata) => {
                println!("✅ Metadata extraction successful!");
                println!();

                // Display camera information
                if metadata.has_camera_info() {
                    println!("📷 Camera Information:");
                    if let Some(make) = &metadata.camera_make {
                        println!("   Make: {}", make);
                    }
                    if let Some(model) = &metadata.camera_model {
                        println!("   Model: {}", model);
                    }
                    if let Some(lens) = &metadata.lens_info {
                        println!("   Lens: {}", lens);
                    }
                    println!();
                }

                // Display technical information
                if metadata.has_technical_info() {
                    println!("⚙️  Technical Information:");
                    if let Some(focal_length) = metadata.focal_length {
                        println!("   Focal Length: {}mm", focal_length);
                    }
                    if let Some(aperture) = &metadata.aperture {
                        println!("   Aperture: f/{}", aperture);
                    }
                    if let Some(shutter_speed) = &metadata.shutter_speed {
                        println!("   Shutter Speed: {}", shutter_speed);
                    }
                    if let Some(iso) = metadata.iso {
                        println!("   ISO: {}", iso);
                    }
                    if let Some(flash) = metadata.flash_used {
                        println!("   Flash: {}", if flash { "Used" } else { "Not used" });
                    }
                    println!();
                }

                // Display image properties
                if let (Some(width), Some(height)) = (metadata.width_px, metadata.height_px) {
                    println!("🖼️  Image Properties:");
                    println!("   Dimensions: {}×{} pixels", width, height);
                    let aspect_ratio = width as f64 / height as f64;
                    println!("   Aspect Ratio: {:.2}", aspect_ratio);
                    let orientation = if width > height {
                        "Landscape"
                    } else if height > width {
                        "Portrait"
                    } else {
                        "Square"
                    };
                    println!("   Orientation: {}", orientation);
                    println!();
                }

                // Display GPS information
                if metadata.has_gps() {
                    println!("🌍 GPS Information:");
                    if let Some(lat) = &metadata.latitude {
                        println!("   Latitude: {}", lat);
                    }
                    if let Some(lon) = &metadata.longitude {
                        println!("   Longitude: {}", lon);
                    }
                    println!();
                }

                // Display date information
                if let Some(taken_at) = metadata.taken_at {
                    println!("📅 Date Information:");
                    println!("   Taken: {}", taken_at);
                    println!();
                }

                // Display other properties
                if let Some(color_space) = &metadata.color_space {
                    println!("🎨 Color Space: {}", color_space);
                }
                if let Some(orientation) = metadata.orientation {
                    println!("🔄 EXIF Orientation: {}", orientation);
                }

                // Show full EXIF data if requested
                if show_full && !metadata.extended_exif.is_null() {
                    println!();
                    println!("📋 Full EXIF Data:");
                    println!("{}", serde_json::to_string_pretty(&metadata.extended_exif)?);
                }
            }
            Err(e) => {
                error!("❌ Failed to extract metadata: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }

    async fn handle_list(
        &self,
        favorites: bool,
        camera: Option<String>,
        location: Option<String>,
        limit: i64,
        offset: i64,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("📸 Listing photos...");

        // This would typically query the database for photos
        // For now, we'll show a placeholder implementation
        println!("🔍 Filters:");
        if favorites {
            println!("   ⭐ Favorites only");
        }
        if let Some(cam) = camera {
            println!("   📷 Camera: {}", cam);
        }
        if let Some(loc) = location {
            println!("   📍 Location: {}", loc);
        }
        println!("   📊 Limit: {}, Offset: {}", limit, offset);

        println!();
        println!("⚠️  Photo database operations not yet implemented");
        println!("💡 This would query the photos table and display results");

        Ok(())
    }

    async fn handle_info(
        &self,
        id: &str,
        show_technical: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("📸 Photo Information");
        println!("🆔 ID: {}", id);

        if show_technical {
            println!("⚙️  Technical details requested");
        }

        println!();
        println!("⚠️  Photo database operations not yet implemented");
        println!("💡 This would query the photos table for detailed information");

        Ok(())
    }

    async fn handle_thumbnails(
        &self,
        limit: i64,
        force: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("🖼️  Generating photo thumbnails...");
        println!("📊 Limit: {}", limit);

        if force {
            println!("🔄 Force regeneration enabled");
        }

        println!();
        println!("⚠️  Thumbnail generation not yet implemented");
        println!("💡 This would process photos and generate thumbnails");

        Ok(())
    }
}

impl GalleryCommands {
    pub async fn handle(&self, _db: &DatabaseConnection) -> Result<(), Box<dyn std::error::Error>> {
        match self {
            GalleryCommands::List { public, verbose } => self.handle_list(*public, *verbose).await,
            GalleryCommands::Create {
                title,
                description,
                public,
                collaborative,
            } => {
                self.handle_create(title, description.clone(), *public, *collaborative)
                    .await
            }
            GalleryCommands::Show { gallery, verbose } => self.handle_show(gallery, *verbose).await,
            GalleryCommands::Add { gallery, photos } => self.handle_add(gallery, photos).await,
            GalleryCommands::Remove { gallery, photos } => {
                self.handle_remove(gallery, photos).await
            }
            GalleryCommands::Delete { gallery, force } => self.handle_delete(gallery, *force).await,
        }
    }

    async fn handle_list(
        &self,
        public_only: bool,
        verbose: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("🖼️  Listing galleries...");

        if public_only {
            println!("🌍 Public galleries only");
        }

        if verbose {
            println!("📋 Verbose mode enabled");
        }

        println!();
        println!("⚠️  Gallery database operations not yet implemented");
        println!("💡 This would query the galleries table and display results");

        Ok(())
    }

    async fn handle_create(
        &self,
        title: &str,
        description: Option<String>,
        public: bool,
        collaborative: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("📁 Creating new gallery...");
        println!("🏷️  Title: {}", title);

        if let Some(desc) = description {
            println!("📝 Description: {}", desc);
        }

        if public {
            println!("🌍 Public gallery");
        }

        if collaborative {
            println!("👥 Collaborative gallery");
        }

        println!();
        println!("⚠️  Gallery creation not yet implemented");
        println!("💡 This would insert into the galleries table");

        Ok(())
    }

    async fn handle_show(
        &self,
        gallery: &str,
        verbose: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("🖼️  Gallery Details");
        println!("🆔 Gallery: {}", gallery);

        if verbose {
            println!("📋 Detailed information requested");
        }

        println!();
        println!("⚠️  Gallery query not yet implemented");
        println!("💡 This would show gallery details and associated photos");

        Ok(())
    }

    async fn handle_add(
        &self,
        gallery: &str,
        photos: &[String],
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("➕ Adding photos to gallery");
        println!("🖼️  Gallery: {}", gallery);
        println!("📸 Photos to add: {}", photos.len());

        for photo in photos {
            println!("   📸 {}", photo);
        }

        println!();
        println!("⚠️  Gallery photo management not yet implemented");
        println!("💡 This would insert into the photo_galleries table");

        Ok(())
    }

    async fn handle_remove(
        &self,
        gallery: &str,
        photos: &[String],
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("➖ Removing photos from gallery");
        println!("🖼️  Gallery: {}", gallery);
        println!("📸 Photos to remove: {}", photos.len());

        for photo in photos {
            println!("   📸 {}", photo);
        }

        println!();
        println!("⚠️  Gallery photo management not yet implemented");
        println!("💡 This would delete from the photo_galleries table");

        Ok(())
    }

    async fn handle_delete(
        &self,
        gallery: &str,
        force: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("🗑️  Deleting gallery");
        println!("🖼️  Gallery: {}", gallery);

        if !force {
            println!("⚠️  This would normally ask for confirmation");
            println!("💡 Use --force to skip confirmation");
        }

        println!();
        println!("⚠️  Gallery deletion not yet implemented");
        println!("💡 This would soft-delete from the galleries table");

        Ok(())
    }
}
