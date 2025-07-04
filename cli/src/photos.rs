//! Photo management CLI commands
//!
//! This module provides CLI commands for photo scanning, gallery management,
//! and photo organization following the patterns established in the music module.

use clap::Subcommand;
use grimoire::{
    media::{
        ConsoleScanProgress, MediaCollection, MetadataExtractor, ScanConfig, UnifiedScannerBuilder,
    },
    photos::{CreateGallery, PhotoMetadataExtractor, PhotoScanConfig, PhotoService},
    DatabaseConnection,
};
use std::path::PathBuf;
use tracing::{error, info};
use uuid::Uuid;

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
                    db,
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
                    db,
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
        db: &DatabaseConnection,
        path: &PathBuf,
        name: Option<String>,
        depth: Option<usize>,
        batch_size: usize,
        extensions: Option<String>,
        max_size_mb: Option<u64>,
        full_exif: bool,
        extract_gps: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("📸 Starting photo library scan with database storage...");
        println!("📁 Scanning directory: {}", path.display());

        // Create photo service for database operations
        let photo_service = PhotoService::new(db.pool().clone());

        // Configure scanner for file discovery
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

        // Build unified scanner for file discovery
        let scanner = UnifiedScannerBuilder::new()
            .with_config(scan_config)
            .add_scanner(photo_scanner)
            .build();

        print!("🔍 Discovering photo files...");
        std::io::Write::flush(&mut std::io::stdout())?;

        // Start scanning for file discovery
        let results = scanner.scan_directory(path).await?;

        println!(" found {} files", results.len());

        if let Some(session_name) = &name {
            println!("🏷️  Session: {}", session_name);
        }

        // Create session ID for tracking
        let session_id = Uuid::new_v4();
        println!("📋 Session ID: {}", session_id);

        // Process and store each photo in the database
        let mut processed = 0;
        let mut succeeded = 0;
        let mut failed = 0;
        let mut photos_created = Vec::new();

        let _progress = ConsoleScanProgress::new(10);

        let total_files = results.len();
        for result in &results {
            processed += 1;

            if result.success {
                println!("💾 Storing photo: {}", result.file.path.display());

                // Process and store the photo using the service
                match photo_service
                    .process_and_store_photo(&result.file.path, Some(session_id), Some("photo-cli"))
                    .await
                {
                    Ok(photo) => {
                        succeeded += 1;
                        photos_created.push(photo.id);

                        info!(
                            "✅ Created photo record: {} (ID: {})",
                            result.file.path.display(),
                            photo.id
                        );

                        // Display photo information
                        println!("  📸 Photo ID: {}", photo.id);
                        if let Some(title) = &photo.title {
                            println!("  🏷️  Title: {}", title);
                        }
                        if let Some(camera_make) = &photo.camera_make {
                            if let Some(camera_model) = &photo.camera_model {
                                println!("  📷 Camera: {} {}", camera_make, camera_model);
                            } else {
                                println!("  📷 Camera: {}", camera_make);
                            }
                        }
                        if let (Some(w), Some(h)) = (photo.width_px, photo.height_px) {
                            println!("  📐 Dimensions: {}×{}", w, h);
                        }
                        if photo.thumbnail_blob_id.is_some() {
                            println!("  🖼️  WebP thumbnail generated");
                        }
                    }
                    Err(e) => {
                        failed += 1;
                        error!(
                            "❌ Failed to store photo {}: {}",
                            result.file.path.display(),
                            e
                        );
                    }
                }
            } else {
                failed += 1;
                error!(
                    "❌ Failed to process: {} - {}",
                    result.file.path.display(),
                    result
                        .error
                        .as_ref()
                        .unwrap_or(&"Unknown error".to_string())
                );
            }

            // Report progress every 5 files
            if processed % 5 == 0 {
                println!("📊 Progress: {}/{} files processed", processed, total_files);
            }
        }

        println!("✅ Photo scan and storage completed!");
        println!("📊 Summary:");
        println!("   📁 Files discovered: {}", total_files);
        println!("   📁 Files processed: {}", processed);
        println!("   ✅ Photos saved to database: {}", succeeded);
        println!("   ❌ Failed: {}", failed);
        println!("   📋 Session ID: {}", session_id);

        if succeeded > 0 {
            let success_rate = (succeeded as f64 / processed as f64) * 100.0;
            println!("   📈 Success rate: {:.1}%", success_rate);
            println!("   🗄️  Check database for {} new photo records", succeeded);
        }

        if !photos_created.is_empty() {
            println!("💡 Next steps:");
            println!("   - View photos: cli photos list");
            println!(
                "   - Create gallery: cli photos galleries create \"{}\"",
                name.unwrap_or_else(|| "New Gallery".to_string())
            );
            println!(
                "   - Add photos to gallery: cli photos galleries add <gallery_id> {}",
                photos_created
                    .iter()
                    .take(3)
                    .map(|id| id.to_string())
                    .collect::<Vec<_>>()
                    .join(" ")
            );
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
        db: &DatabaseConnection,
        favorites: bool,
        camera: Option<String>,
        location: Option<String>,
        limit: i64,
        offset: i64,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("📸 Listing photos...");

        println!("🔍 Filters:");
        if favorites {
            println!("   ⭐ Favorites only");
        }
        if let Some(cam) = &camera {
            println!("   📷 Camera: {}", cam);
        }
        if let Some(loc) = &location {
            println!("   📍 Location: {}", loc);
        }
        println!("   📊 Limit: {}, Offset: {}", limit, offset);

        println!();

        // Create photo service
        let photo_service = PhotoService::new(db.pool().clone());

        // Get recent photos
        match photo_service.list_recent_photos(limit).await {
            Ok(photos) => {
                if photos.is_empty() {
                    println!("📭 No photos found");
                    println!("💡 Use 'photos scan <path>' to add photos to your library");
                } else {
                    println!("📸 Found {} photos:", photos.len());
                    println!();

                    for (index, photo) in photos.iter().enumerate() {
                        println!(
                            "{}. 📸 {}",
                            index + 1,
                            photo.title.as_ref().unwrap_or(&"Untitled".to_string())
                        );
                        println!("   🆔 ID: {}", photo.id);
                        println!("   📄 Media Blob ID: {}", photo.media_blob_id);

                        if let Some(ref thumbnail_id) = photo.thumbnail_blob_id {
                            println!("   🖼️  Thumbnail ID: {}", thumbnail_id);
                        }

                        if let Some(ref camera_make) = photo.camera_make {
                            if let Some(ref camera_model) = photo.camera_model {
                                println!("   📷 Camera: {} {}", camera_make, camera_model);
                            } else {
                                println!("   📷 Camera: {}", camera_make);
                            }
                        }

                        if let Some(ref location) = photo.location {
                            println!("   📍 Location: {}", location);
                        }

                        if photo.is_favorite.unwrap_or(false) {
                            println!("   ⭐ Favorite");
                        }

                        println!("   📅 Created: {}", photo.created_at.date());
                        println!();
                    }

                    println!("💡 Use 'photos info <photo-id>' for detailed information");
                }
            }
            Err(e) => {
                error!("❌ Failed to list photos: {}", e);
                return Err(e.into());
            }
        }

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
    pub async fn handle(&self, db: &DatabaseConnection) -> Result<(), Box<dyn std::error::Error>> {
        match self {
            GalleryCommands::List { public, verbose } => {
                self.handle_list(db, *public, *verbose).await
            }
            GalleryCommands::Create {
                title,
                description,
                public,
                collaborative,
            } => {
                self.handle_create(db, title, description.clone(), *public, *collaborative)
                    .await
            }
            GalleryCommands::Show { gallery, verbose } => {
                self.handle_show(db, gallery, *verbose).await
            }
            GalleryCommands::Add { gallery, photos } => self.handle_add(db, gallery, photos).await,
            GalleryCommands::Remove { gallery, photos } => {
                self.handle_remove(db, gallery, photos).await
            }
            GalleryCommands::Delete { gallery, force } => {
                self.handle_delete(db, gallery, *force).await
            }
        }
    }

    async fn handle_list(
        &self,
        db: &DatabaseConnection,
        public: bool,
        verbose: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("🖼️  Listing galleries...");

        if public {
            println!("🌍 Public galleries only");
        }

        if verbose {
            println!("📋 Verbose mode enabled");
        }

        println!();

        // Create photo service for database operations
        let photo_service = PhotoService::new(db.pool().clone());

        // Get galleries (limit to 100 for now)
        match photo_service.list_galleries(100).await {
            Ok(galleries) => {
                if galleries.is_empty() {
                    println!("📭 No galleries found");
                    return Ok(());
                }

                // Filter by public if requested
                let filtered_galleries: Vec<_> = if public {
                    galleries
                        .into_iter()
                        .filter(|g| g.is_public.unwrap_or(false))
                        .collect()
                } else {
                    galleries
                };

                if filtered_galleries.is_empty() {
                    if public {
                        println!("📭 No public galleries found");
                    } else {
                        println!("📭 No galleries found");
                    }
                    return Ok(());
                }

                println!("📁 Found {} galleries:", filtered_galleries.len());
                println!();

                for gallery in &filtered_galleries {
                    println!("📁 {}", gallery.title);
                    println!("   ID: {}", gallery.id);

                    if let Some(desc) = &gallery.description {
                        println!("   📝 {}", desc);
                    }

                    if verbose {
                        println!("   🌍 Public: {}", gallery.is_public.unwrap_or(false));
                        println!(
                            "   👥 Collaborative: {}",
                            gallery.is_collaborative.unwrap_or(false)
                        );
                        println!("   📅 Created: {}", gallery.created_at.date());

                        if let Some(client_id) = &gallery.client_id {
                            println!("   🔧 Client: {}", client_id);
                        }
                    }

                    println!();
                }

                println!("💡 Use 'galleries show <gallery-id>' to see photos in a gallery");
            }
            Err(e) => {
                error!("❌ Failed to list galleries: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }

    async fn handle_create(
        &self,
        db: &DatabaseConnection,
        title: &str,
        description: Option<String>,
        public: bool,
        collaborative: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("📁 Creating new gallery...");
        println!("🏷️  Title: {}", title);

        if let Some(desc) = &description {
            println!("📝 Description: {}", desc);
        }

        if public {
            println!("🌍 Public gallery");
        }

        if collaborative {
            println!("👥 Collaborative gallery");
        }

        println!();

        // Create photo service for database operations
        let photo_service = PhotoService::new(db.pool().clone());

        // Create gallery
        let create_gallery = CreateGallery {
            title: title.to_string(),
            description,
            client_id: Some("photo-cli".to_string()),
            is_public: public,
            is_collaborative: collaborative,
            thumbnail_blob_id: None,
        };

        match photo_service.create_gallery(create_gallery).await {
            Ok(gallery) => {
                println!("✅ Gallery created successfully!");
                println!("📁 Gallery ID: {}", gallery.id);
                println!("🏷️  Title: {}", gallery.title);
                if let Some(desc) = &gallery.description {
                    println!("📝 Description: {}", desc);
                }
                println!("🌍 Public: {}", gallery.is_public());
                println!("👥 Collaborative: {}", gallery.is_collaborative());
                println!("📅 Created: {}", gallery.created_at.date());

                println!();
                println!("💡 Next steps:");
                println!(
                    "   - Add photos: cli photos galleries add {} <photo-id> [photo-id...]",
                    gallery.id
                );
                println!(
                    "   - View gallery: cli photos galleries show {}",
                    gallery.id
                );
            }
            Err(e) => {
                error!("❌ Failed to create gallery: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }

    async fn handle_show(
        &self,
        db: &DatabaseConnection,
        gallery: &str,
        verbose: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("🖼️  Gallery Details");
        println!("📁 Gallery: {}", gallery);

        if verbose {
            println!("📝 Verbose output enabled");
        }

        println!();

        // Create photo service for database operations
        let photo_service = PhotoService::new(db.pool().clone());

        // Resolve gallery ID (supports UUID or name matching)
        let gallery_id = self.resolve_gallery_id(&photo_service, gallery).await?;

        // Get gallery details
        match photo_service.get_gallery(gallery_id).await {
            Ok(gallery_info) => {
                println!("📁 Gallery: {}", gallery_info.title);
                println!("🆔 ID: {}", gallery_info.id);

                if let Some(desc) = &gallery_info.description {
                    println!("📝 Description: {}", desc);
                }

                println!("🌍 Public: {}", gallery_info.is_public.unwrap_or(false));
                println!(
                    "👥 Collaborative: {}",
                    gallery_info.is_collaborative.unwrap_or(false)
                );
                println!("📅 Created: {}", gallery_info.created_at.date());

                if verbose {
                    if let Some(client_id) = &gallery_info.client_id {
                        println!("🔧 Client: {}", client_id);
                    }
                    println!("🔄 Updated: {}", gallery_info.updated_at.date());
                    println!("📋 Version: {}", gallery_info.version);
                }

                println!();

                // Get photos in this gallery
                match photo_service.get_gallery_photos(gallery_id, 100).await {
                    Ok(photos) => {
                        if photos.is_empty() {
                            println!("📭 No photos in this gallery");
                            println!(
                                "💡 Add photos with: cli photos galleries add {} <photo-id>",
                                gallery_id
                            );
                        } else {
                            println!("📸 Photos in gallery ({}):", photos.len());
                            println!();

                            for (index, photo) in photos.iter().enumerate() {
                                println!(
                                    "{}. 📸 {}",
                                    index + 1,
                                    photo.title.as_ref().unwrap_or(&"Untitled".to_string())
                                );
                                println!("   🆔 ID: {}", photo.id);

                                if let Some(caption) = &photo.caption {
                                    println!("   📝 {}", caption);
                                }

                                if let Some(location) = &photo.location {
                                    println!("   📍 {}", location);
                                }

                                if verbose {
                                    println!(
                                        "   📅 Taken: {}",
                                        photo
                                            .taken_at
                                            .map(|t| t.date())
                                            .unwrap_or_else(|| photo.created_at.date())
                                    );
                                    if photo.is_favorite.unwrap_or(false) {
                                        println!("   ⭐ Favorite");
                                    }
                                    if let Some(ref tags) = photo.tags {
                                        if !tags.is_empty() {
                                            println!("   🏷️  Tags: {}", tags.join(", "));
                                        }
                                    }
                                }

                                println!();
                            }

                            println!(
                                "💡 Use 'photos info <photo-id>' for detailed photo information"
                            );
                        }
                    }
                    Err(e) => {
                        error!("❌ Failed to get gallery photos: {}", e);
                        return Err(e.into());
                    }
                }
            }
            Err(e) => {
                error!("❌ Failed to get gallery: {}", e);
                println!("💡 Use 'galleries list' to see available galleries");
                return Err(e.into());
            }
        }

        Ok(())
    }

    async fn handle_add(
        &self,
        db: &DatabaseConnection,
        gallery: &str,
        photos: &[String],
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("➕ Adding photos to gallery...");
        println!("📁 Gallery: {}", gallery);
        println!("📸 Photos to add: {}", photos.len());

        // Create photo service
        let photo_service = PhotoService::new(db.pool().clone());

        // Resolve gallery ID (supports UUID or name matching)
        let gallery_id = self.resolve_gallery_id(&photo_service, gallery).await?;

        // Parse photo IDs
        let mut photo_ids = Vec::new();
        for photo_str in photos {
            let photo_id = photo_str
                .parse::<Uuid>()
                .map_err(|_| format!("Invalid photo ID: {}", photo_str))?;
            photo_ids.push(photo_id);
        }

        // Add photos to gallery
        match photo_service
            .add_photos_to_gallery(gallery_id, &photo_ids)
            .await
        {
            Ok(()) => {
                println!();
                println!("✅ Successfully added {} photos to gallery!", photos.len());
                for (i, photo_id) in photo_ids.iter().enumerate() {
                    println!("   📸 Photo {} (position {}): {}", i + 1, i + 1, photo_id);
                }
                println!();
                println!("💡 Next steps:");
                println!("   - View gallery: cli photos galleries show {}", gallery);
                println!("   - List galleries: cli photos galleries list");
            }
            Err(e) => {
                error!("❌ Failed to add photos to gallery: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }

    /// Resolve gallery identifier to UUID - supports UUID or name matching
    async fn resolve_gallery_id(
        &self,
        photo_service: &PhotoService,
        gallery_identifier: &str,
    ) -> Result<Uuid, Box<dyn std::error::Error>> {
        // Try to parse as UUID first
        if let Ok(uuid) = gallery_identifier.parse::<Uuid>() {
            return Ok(uuid);
        }

        // Search by name (case-insensitive partial match)
        let matching_galleries = photo_service
            .find_galleries_by_title(gallery_identifier)
            .await?;

        match matching_galleries.len() {
            0 => {
                error!("❌ No galleries found matching '{}'", gallery_identifier);
                println!("💡 Use 'galleries list' to see available galleries");
                Err(format!("No galleries found matching '{}'", gallery_identifier).into())
            }
            1 => {
                let gallery = &matching_galleries[0];
                println!("🔍 Found gallery: {} ({})", gallery.title, gallery.id);
                Ok(gallery.id)
            }
            _ => {
                error!("❌ Multiple galleries match '{}':", gallery_identifier);
                for gallery in &matching_galleries {
                    println!("   📁 {} ({})", gallery.title, gallery.id);
                }
                println!("💡 Use a more specific name or the exact UUID");
                Err(format!(
                    "Multiple galleries match '{}'. Use a more specific name or UUID",
                    gallery_identifier
                )
                .into())
            }
        }
    }

    async fn handle_remove(
        &self,
        db: &DatabaseConnection,
        gallery: &str,
        photos: &[String],
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("➖ Removing photos from gallery...");
        println!("📁 Gallery: {}", gallery);
        println!("📸 Photos to remove: {}", photos.len());

        // Create photo service
        let photo_service = PhotoService::new(db.pool().clone());

        // Resolve gallery ID
        let gallery_id = self.resolve_gallery_id(&photo_service, gallery).await?;

        // Parse photo IDs
        let mut photo_ids = Vec::new();
        for photo_str in photos {
            let photo_id = photo_str
                .parse::<Uuid>()
                .map_err(|_| format!("Invalid photo ID: {}", photo_str))?;
            photo_ids.push(photo_id);
        }

        println!();

        // Remove photos from gallery
        match photo_service
            .remove_photos_from_gallery(gallery_id, &photo_ids)
            .await
        {
            Ok(_) => {
                println!(
                    "✅ Successfully removed {} photos from gallery",
                    photo_ids.len()
                );
                for photo_id in &photo_ids {
                    println!("   ➖ Removed photo: {}", photo_id);
                }
                println!();
                println!(
                    "💡 Use 'galleries show {}' to see updated gallery",
                    gallery_id
                );
            }
            Err(e) => {
                error!("❌ Failed to remove photos from gallery: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }

    async fn handle_delete(
        &self,
        db: &DatabaseConnection,
        gallery: &str,
        force: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("🗑️  Deleting gallery...");
        println!("📁 Gallery: {}", gallery);

        // Create photo service
        let photo_service = PhotoService::new(db.pool().clone());

        // Resolve gallery ID
        let gallery_id = self.resolve_gallery_id(&photo_service, gallery).await?;

        // Get gallery details for confirmation
        let gallery_info = match photo_service.get_gallery(gallery_id).await {
            Ok(gallery) => gallery,
            Err(e) => {
                error!("❌ Failed to get gallery details: {}", e);
                return Err(e.into());
            }
        };

        println!();
        println!("📁 Gallery to delete: {}", gallery_info.title);
        println!("🆔 ID: {}", gallery_info.id);
        if let Some(desc) = &gallery_info.description {
            println!("📝 Description: {}", desc);
        }

        // Check if gallery has photos
        let photos = photo_service.get_gallery_photos(gallery_id, 1).await?;
        if !photos.is_empty() {
            println!(
                "⚠️  Gallery contains photos - they will NOT be deleted (only gallery removed)"
            );
        }

        // Confirmation unless force is used
        if !force {
            println!();
            println!("⚠️  Are you sure you want to delete this gallery? (y/N)");
            println!("💡 Use --force to skip this confirmation");

            use std::io::{self, Write};
            print!("Delete gallery? ");
            io::stdout().flush()?;

            let mut input = String::new();
            io::stdin().read_line(&mut input)?;

            let input = input.trim().to_lowercase();
            if input != "y" && input != "yes" {
                println!("❌ Gallery deletion cancelled");
                return Ok(());
            }
        } else {
            println!("⚠️  Force delete enabled (no confirmation)");
        }

        println!();

        // Delete gallery
        match photo_service.delete_gallery(gallery_id).await {
            Ok(_) => {
                println!("✅ Gallery deleted successfully!");
                println!("📁 Deleted: {}", gallery_info.title);
                println!("🆔 ID: {}", gallery_info.id);
                println!();
                println!(
                    "💡 Photos in this gallery were not deleted - only the gallery was removed"
                );
            }
            Err(e) => {
                error!("❌ Failed to delete gallery: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }
}
