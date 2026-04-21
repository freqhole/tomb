//! tauri commands for setup wizard and admin operations
//!
//! these commands are called from the JS side via invoke()
//! they provide access to grimoire functionality without going through HTTP
//!
//! config file always lives in app data dir (e.g. ~/Library/Application Support/...)
//! the config's data_dir field can point to a different location for the database/media

use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;

use crate::app_config::{get_server_config_path_resolved, save_admin_user, FreqholeAppConfig};
use crate::spume_bridge::{
    notify_config_changed, notify_scan_complete, notify_scan_progress, notify_server_image_updated,
};
use crate::ShutdownToken;

/// resolve a path to its canonical form, falling back to the original if resolution fails.
/// useful for resolving symlinks (e.g. /home -> /var/home on Fedora Silverblue).
fn canonicalize_or_original(path: &str) -> String {
    std::fs::canonicalize(path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.to_string())
}

/// ensure config is initialized, returns Ok if already initialized or successfully initialized
fn ensure_config_initialized(config_path: &PathBuf) -> Result<(), String> {
    if grimoire::is_config_initialized() {
        return Ok(());
    }
    if !config_path.exists() {
        return Err(format!("config file not found: {}", config_path.display()));
    }
    match grimoire::config::init_config(Some(config_path.clone())) {
        Ok(_) => Ok(()),
        Err(e) => {
            // race condition: another call initialized it first - that's fine
            if grimoire::is_config_initialized() {
                Ok(())
            } else {
                Err(e.to_string())
            }
        }
    }
}

/// ensure config and database are ready (call at start of commands that need them)
async fn ensure_initialized(app_handle: &tauri::AppHandle) -> Result<(), String> {
    ensure_initialized_inner(app_handle).await
}

/// public alias of `ensure_initialized` for use by sibling command modules
pub async fn ensure_initialized_pub(app_handle: &tauri::AppHandle) -> Result<(), String> {
    ensure_initialized_inner(app_handle).await
}

async fn ensure_initialized_inner(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let config_path = get_server_config_path_resolved(app_handle)
        .ok_or_else(|| "server config not found - run setup first".to_string())?;

    ensure_config_initialized(&config_path)?;

    grimoire::database::initialize()
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// result of checking if setup is needed
#[derive(Debug, Serialize)]
pub struct SetupStatus {
    pub needs_setup: bool,
    pub config_exists: bool,
    pub has_root_user: bool,
    pub config_path: Option<String>,
    pub data_dir: Option<String>,
}

/// result of checking external dependencies (ffmpeg, yt-dlp)
#[derive(Debug, Serialize)]
pub struct DependencyCheckResult {
    pub ffmpeg_path: Option<String>,
    pub ffmpeg_installed: bool,
    pub ffprobe_path: Option<String>,
    pub ffprobe_installed: bool,
    pub ytdlp_path: Option<String>,
    pub ytdlp_installed: bool,
    pub can_proceed: bool,
}

/// check for required external dependencies (ffmpeg, yt-dlp)
#[tauri::command]
pub async fn check_dependencies() -> DependencyCheckResult {
    let status = grimoire::setup::check_dependencies();
    DependencyCheckResult {
        ffmpeg_path: status.ffmpeg_path.as_ref().map(|p| p.display().to_string()),
        ffmpeg_installed: status.has_ffmpeg(),
        ffprobe_path: status
            .ffprobe_path
            .as_ref()
            .map(|p| p.display().to_string()),
        ffprobe_installed: status.has_ffprobe(),
        ytdlp_path: status.ytdlp_path.as_ref().map(|p| p.display().to_string()),
        ytdlp_installed: status.has_ytdlp(),
        can_proceed: status.can_proceed(),
    }
}

/// get platform-appropriate defaults for setup wizard
#[tauri::command]
pub async fn get_setup_defaults() -> grimoire::setup::SetupDefaults {
    grimoire::setup::get_defaults()
}

/// run core setup - creates config, database, and root user (no admin)
///
/// this handles the infrastructure setup without creating an admin user.
/// use create_admin_user after this to create the admin user with API key.
#[tauri::command]
pub async fn run_setup_core(
    config_path: String,
    data_dir: String,
    server_name: String,
    server_port: u16,
    image_path: Option<String>,
    fetch_music_dir: Option<String>,
    federation_enabled: Option<bool>,
    knocking_enabled: Option<bool>,
) -> grimoire::setup::SetupResult {
    // resolve paths to canonical form (safety net for Flatpak portal paths / symlinks)
    let data_dir = canonicalize_or_original(&data_dir);
    let config_path = canonicalize_or_original(&config_path);
    let fetch_music_dir = fetch_music_dir.map(|p| canonicalize_or_original(&p));
    let image_path = image_path.map(|p| canonicalize_or_original(&p));

    let deps = grimoire::setup::check_dependencies();

    // set allowed origins based on build type
    // dev builds use http://localhost:1420 (vite dev server for tauri UI)
    // release builds use tauri://localhost (tauri's internal protocol)
    #[cfg(debug_assertions)]
    let allowed_origins = vec!["http://localhost:1420".to_string()];
    #[cfg(not(debug_assertions))]
    let allowed_origins = vec!["tauri://localhost".to_string()];

    // if image_path provided, copy to data_dir as freqhole-icon with original extension
    let final_image_path = if let Some(src_path) = image_path {
        let src = std::path::Path::new(&src_path);
        if src.exists() {
            let extension = src.extension().and_then(|e| e.to_str()).unwrap_or("png");
            let dest_filename = format!("freqhole-icon.{}", extension);
            let dest = PathBuf::from(&data_dir).join(&dest_filename);

            // ensure data_dir exists before copying
            let _ = std::fs::create_dir_all(&data_dir);

            match std::fs::copy(&src_path, &dest) {
                Ok(_) => Some(dest.to_string_lossy().to_string()),
                Err(e) => {
                    tracing::error!(error = %e, "failed to copy icon");
                    None
                }
            }
        } else {
            None
        }
    } else {
        None
    };

    let setup_config = grimoire::setup::SetupConfig {
        config_path: PathBuf::from(&config_path),
        data_dir: PathBuf::from(&data_dir),
        server_name,
        server_port,
        image_path: final_image_path,
        admin_username: None,        // no admin user in core setup
        generate_api_key: false,     // no API key without admin user
        generate_invite_code: false, // tauri doesn't need this
        ytdlp_available: deps.has_ytdlp(),
        fetch_music_dir: fetch_music_dir.map(PathBuf::from),
        initial_scan_dirs: Vec::new(), // handled by music step in UI
        allowed_origins: Some(allowed_origins),
        ffmpeg_path: deps.ffmpeg_path.clone(),
        ffprobe_path: deps.ffprobe_path.clone(),
        ytdlp_path: deps.ytdlp_path.clone(),
        server_enabled: Some(false), // HTTP server disabled in charnel (tauri) mode
        federation_enabled,          // passed from UI (default: false)
        knocking_enabled,            // passed from UI (default: false)
    };

    let service = grimoire::setup::SetupService::new();
    let result = service.run_setup(setup_config).await;

    result
}

/// result of creating an admin user
#[derive(Debug, Clone, serde::Serialize)]
pub struct CreateAdminResult {
    pub success: bool,
    pub user_id: Option<String>,
    pub username: Option<String>,
    pub error: Option<String>,
}

/// create admin user (call after run_setup_core)
#[tauri::command]
pub async fn create_admin_user(app: tauri::AppHandle, username: String) -> CreateAdminResult {
    let service = grimoire::users::UserService::new();

    // create admin user
    let request = grimoire::users::CreateUserRequest {
        username: username.clone(),
        role: Some(grimoire::users::UserRole::Admin),
        invite_code: None,
    };

    let response = service.register_user(&request).await;

    match response.data {
        Some(user) => {
            // save admin user info to app config
            if let Err(e) = save_admin_user(&app, &user.id, &user.username) {
                tracing::error!(error = %e, "failed to save admin user to app config");
            }

            CreateAdminResult {
                success: true,
                user_id: Some(user.id),
                username: Some(user.username),
                error: None,
            }
        }
        None => {
            let error = response
                .errors
                .first()
                .map(|e| e.detail.clone())
                .unwrap_or_else(|| "unknown error".to_string());
            CreateAdminResult {
                success: false,
                user_id: None,
                username: None,
                error: Some(error),
            }
        }
    }
}

/// check if setup wizard needs to run
#[tauri::command]
pub async fn check_setup_status(app_handle: tauri::AppHandle) -> SetupStatus {
    // first check if we have a saved config path (from previous setup)
    let config_path = match get_server_config_path_resolved(&app_handle) {
        Some(path) => path,
        None => {
            // no saved config path found
            return SetupStatus {
                needs_setup: true,
                config_exists: false,
                has_root_user: false,
                config_path: None,
                data_dir: None,
            };
        }
    };
    let config_exists = config_path.exists();

    if !config_exists {
        return SetupStatus {
            needs_setup: true,
            config_exists: false,
            has_root_user: false,
            config_path: None,
            data_dir: None,
        };
    }

    // try to load config if not already initialized
    if !grimoire::is_config_initialized() {
        if let Err(_) = grimoire::config::init_config(Some(config_path.clone())) {
            return SetupStatus {
                needs_setup: true,
                config_exists: true,
                has_root_user: false,
                config_path: Some(config_path.display().to_string()),
                data_dir: None,
            };
        }
    }

    let config = grimoire::config::get_config();

    // check if we can connect to db and find a root user
    let has_root = match check_has_root_user().await {
        Ok(has) => has,
        Err(_) => false,
    };

    SetupStatus {
        needs_setup: !has_root,
        config_exists: true,
        has_root_user: has_root,
        config_path: Some(config_path.display().to_string()),
        data_dir: Some(config.data_dir.display().to_string()),
    }
}

/// check if a root user exists in the database
async fn check_has_root_user() -> Result<bool, String> {
    grimoire::database::initialize()
        .await
        .map_err(|e| e.to_string())?;

    let service = grimoire::users::UserService::new();
    let result = service.get_first_root_user().await;
    Ok(result.is_success())
}

/// resolve a file path to its canonical form (resolves symlinks, etc.)
#[tauri::command]
pub fn resolve_path(path: String) -> Result<String, String> {
    std::fs::canonicalize(&path)
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| format!("failed to resolve path '{}': {}", path, e))
}

/// get the default app data directory path
#[tauri::command]
pub fn get_default_data_dir(app_handle: tauri::AppHandle) -> Option<String> {
    app_handle
        .path()
        .app_data_dir()
        .ok()
        .map(|p: PathBuf| p.display().to_string())
}

/// get the OS username for default user creation
#[tauri::command]
pub fn get_os_username() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "freqroot".to_string())
}

/// get the app version
#[tauri::command]
pub fn get_app_version() -> String {
    crate::app_config::get_binary_version().to_string()
}

/// get the config file path (from app config or legacy location)
#[tauri::command]
pub fn get_config_path(app_handle: tauri::AppHandle) -> Option<String> {
    get_server_config_path_resolved(&app_handle).map(|p| p.display().to_string())
}

/// get the data directory from loaded config
#[tauri::command]
pub fn get_data_dir(app_handle: tauri::AppHandle) -> Option<String> {
    let config_path = get_server_config_path_resolved(&app_handle)?;

    if config_path.exists() {
        // use existing config if initialized, otherwise try to init
        if grimoire::is_config_initialized() {
            let config = grimoire::config::get_config();
            return Some(config.data_dir.display().to_string());
        } else if grimoire::config::init_config(Some(config_path)).is_ok() {
            let config = grimoire::config::get_config();
            return Some(config.data_dir.display().to_string());
        }
    }

    // fall back to app data dir
    app_handle
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.display().to_string())
}

/// freqhole config info for the bridge (exposed to frontend via CustomEvent)
#[derive(Debug, Clone, Serialize)]
pub struct FreqholeConfig {
    /// server display name
    pub server_name: String,
    /// server URL (e.g. http://localhost:8686)
    pub server_url: String,
    /// server image file path (absolute path for convertFileSrc)
    pub server_image_path: Option<String>,
    /// disable backdrop-filter blur effects (for linux/webkitgtk compatibility)
    pub disable_backdrop_blur: bool,
    /// sync queue songs from remotes to local library (default: true)
    pub sync_queue_to_local: bool,
}

/// get freqhole server config (for bridge communication with spume)
///
/// returns server_name, server_url from the loaded config
/// reads fresh from disk each time to get latest values (e.g. after name change in settings)
#[tauri::command]
pub fn get_freqhole_config(app_handle: tauri::AppHandle) -> Option<FreqholeConfig> {
    tracing::debug!("get_freqhole_config called");
    let config_path = get_server_config_path_resolved(&app_handle)?;
    tracing::debug!(config_path = %config_path.display(), "resolved config path");

    if !config_path.exists() {
        tracing::debug!("config file does not exist");
        return None;
    }

    // read fresh from disk to get latest values (don't use cached grimoire singleton)
    let config = grimoire::read_config_from_file(&config_path).ok()?;
    let server = config.server.as_ref()?;

    // get app config for display settings
    let app_config = FreqholeAppConfig::load(&app_handle);
    let disable_backdrop_blur = app_config
        .as_ref()
        .map(|c| c.disable_backdrop_blur)
        .unwrap_or(false);
    let sync_queue_to_local = app_config
        .as_ref()
        .map(|c| c.sync_queue_to_local)
        .unwrap_or(true);

    tracing::debug!(
        server_name = %server.name,
        server_image_path = ?server.image_path,
        "returning freqhole config"
    );

    Some(FreqholeConfig {
        server_name: server.name.clone(),
        // always use localhost for the client URL (not the bind address like 0.0.0.0)
        server_url: format!("http://localhost:{}", server.port),
        server_image_path: server.image_path.as_ref().map(|p| p.display().to_string()),
        disable_backdrop_blur,
        sync_queue_to_local,
    })
}

/// open the data directory in Finder
#[tauri::command]
pub fn open_config_dir(app_handle: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let dir =
        get_data_dir(app_handle.clone()).ok_or_else(|| "no data directory found".to_string())?;

    let path = PathBuf::from(&dir);
    if !path.exists() {
        return Err(format!("directory does not exist: {}", dir));
    }

    app_handle
        .opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| format!("failed to open directory: {}", e))
}

/// scan result
#[derive(Debug, Serialize)]
pub struct ScanResult {
    pub success: bool,
    pub jobs_created: u32,
    pub message: String,
}

/// scan a directory for music files (creates import jobs)
#[tauri::command]
pub async fn scan_directory(
    app_handle: tauri::AppHandle,
    path: String,
    tags: Vec<String>,
) -> ScanResult {
    // ensure config and database are initialized
    if let Err(e) = ensure_initialized(&app_handle).await {
        return ScanResult {
            success: false,
            jobs_created: 0,
            message: format!("initialization failed: {}", e),
        };
    }

    // resolve to canonical path (safety net for Flatpak portal paths / symlinks)
    let path = canonicalize_or_original(&path);

    // check if path exists
    if !std::path::Path::new(&path).exists() {
        return ScanResult {
            success: false,
            jobs_created: 0,
            message: format!("directory does not exist: {}", path),
        };
    }

    // set up directory tag rules if tags were specified
    if !tags.is_empty() {
        let tag_response =
            grimoire::jobs::add_directory_tags(&path, tags.clone(), Some("tauri-scan".to_string()))
                .await;
        if !tag_response.success {
            tracing::warn!(error = %tag_response.message, "failed to set up directory tags");
        }
    }

    // create a job session first (required for foreign key constraint)
    let session_request = grimoire::jobs::CreateJobSessionRequest {
        job_type: grimoire::jobs::JobType::ProcessFile,
        batch_size: None,
        created_by: Some("tauri-scan".to_string()),
    };
    let session_response = grimoire::jobs::create_job_session(session_request).await;
    if !session_response.success {
        return ScanResult {
            success: false,
            jobs_created: 0,
            message: format!("failed to create job session: {}", session_response.message),
        };
    }
    let session = session_response.data.unwrap();
    let session_id = &session.id;

    let result = grimoire::music::scanner::scan_directory(
        &path, session_id, true,  // recursive
        None,  // no max depth
        None,  // default extensions
        false, // don't skip tracked subdirs
    )
    .await;

    match result.data {
        Some(count) => {
            // record the scanned directory in the database
            let _ = grimoire::jobs::record_scanned_directory(&path, count as i64, None).await;

            if count > 0 {
                // start background polling for job completion
                let app_handle_clone = app_handle.clone();
                let session_id_clone = session_id.clone();
                let shutdown_token = app_handle.state::<ShutdownToken>().inner().clone();
                tauri::async_runtime::spawn(async move {
                    poll_scan_jobs_until_complete(
                        app_handle_clone,
                        session_id_clone,
                        shutdown_token,
                    )
                    .await;
                });
            }

            ScanResult {
                success: true,
                jobs_created: count as u32,
                message: format!("created {} import jobs", count),
            }
        }
        None => ScanResult {
            success: false,
            jobs_created: 0,
            message: result.message,
        },
    }
}

/// rescan all tracked directories and detect orphaned files (deleted from disk)
///
/// unlike scan_directory which only finds new files, this creates a RescanDirectories
/// job that has two phases:
/// 1. scan all tracked directories for new files
/// 2. orphan detection: check all blobs, soft delete if file missing from disk
#[tauri::command]
pub async fn rescan_directories(app_handle: tauri::AppHandle) -> ScanResult {
    use grimoire::jobs::{create_job, CreateJobRequest, JobType};

    // ensure config and database are initialized
    if let Err(e) = ensure_initialized(&app_handle).await {
        return ScanResult {
            success: false,
            jobs_created: 0,
            message: format!("initialization failed: {}", e),
        };
    }

    // create a RescanDirectories job
    let job_request = CreateJobRequest {
        job_type: JobType::RescanDirectories,
        session_id: None,
        parameters: serde_json::json!({}),
        max_retries: Some(0), // no retries for rescan
        scheduled_at: None,   // immediate
        created_by: Some("tauri-wizard".to_string()),
    };

    let response = create_job(job_request).await;

    if !response.success {
        return ScanResult {
            success: false,
            jobs_created: 0,
            message: format!("failed to create rescan job: {}", response.message),
        };
    }

    let job = response.data.unwrap();

    // start background polling for job completion
    let app_handle_clone = app_handle.clone();
    let job_id = job.id.clone();
    let shutdown_token = app_handle.state::<ShutdownToken>().inner().clone();
    tauri::async_runtime::spawn(async move {
        poll_rescan_job_until_complete(app_handle_clone, job_id, shutdown_token).await;
    });

    ScanResult {
        success: true,
        jobs_created: 1,
        message: format!("rescan job created: {}", job.id),
    }
}

/// poll for rescan job completion and notify spume with progress updates
async fn poll_rescan_job_until_complete(
    app_handle: tauri::AppHandle,
    job_id: String,
    shutdown_token: ShutdownToken,
) {
    use grimoire::jobs::{list_jobs, JobStatus};
    use grimoire::music::analytics::admin::get_overview_stats;
    use std::time::Duration;

    // get baseline counts before job is processed
    let baseline = match get_overview_stats().await.data {
        Some(stats) => (stats.total_songs, stats.total_albums, stats.total_artists),
        None => {
            tracing::warn!("rescan-poll: failed to get baseline stats");
            (0, 0, 0)
        }
    };

    let poll_interval = Duration::from_secs(3);
    let max_polls = 1200; // 60 minutes max (1200 * 3s) - rescan can take longer
    let mut last_songs = 0i64;

    for _ in 0..max_polls {
        // wait for poll interval or shutdown
        tokio::select! {
            _ = tokio::time::sleep(poll_interval) => {}
            _ = shutdown_token.cancelled() => {
                tracing::info!("rescan-poll: shutdown requested, stopping poll");
                return;
            }
        }

        // check all jobs status (rescan creates sub-jobs)
        let jobs_response = list_jobs(None, None, Some(1000), None).await;

        match jobs_response.data {
            Some(jobs) => {
                let jobs_total = jobs.len() as u32;
                let pending = jobs
                    .iter()
                    .filter(|j| {
                        j.status()
                            .map(|s| s == JobStatus::Pending || s == JobStatus::Running)
                            .unwrap_or(false)
                    })
                    .count() as u32;

                // get current stats to track progress
                let current_stats = get_overview_stats().await.data;
                let (songs_added, albums_added, artists_added) = match &current_stats {
                    Some(stats) => (
                        (stats.total_songs - baseline.0).max(0) as u32,
                        (stats.total_albums - baseline.1).max(0) as u32,
                        (stats.total_artists - baseline.2).max(0) as u32,
                    ),
                    None => (0, 0, 0),
                };

                // send progress update if songs changed
                let current_songs = current_stats.as_ref().map(|s| s.total_songs).unwrap_or(0);
                if current_songs != last_songs {
                    last_songs = current_songs;
                    if let Err(e) = notify_scan_progress(
                        &app_handle,
                        songs_added,
                        albums_added,
                        artists_added,
                        pending,
                        jobs_total,
                    ) {
                        tracing::error!(error = %e, "rescan-poll: failed to send progress");
                    }
                }

                if pending == 0 && !jobs.is_empty() {
                    // all jobs complete - send final notification
                    if let Err(e) =
                        notify_scan_complete(&app_handle, songs_added, albums_added, artists_added)
                    {
                        tracing::error!(error = %e, "rescan-poll: failed to notify spume");
                    }

                    tracing::info!(
                        songs = songs_added,
                        albums = albums_added,
                        artists = artists_added,
                        "rescan-poll: complete"
                    );
                    return;
                }
            }
            None => {
                tracing::warn!(job_id = %job_id, "rescan-poll: failed to get job list");
            }
        }
    }

    tracing::warn!("rescan-poll: polling timed out after 60 minutes");
}

/// poll for scan job completion and notify spume with progress updates
///
/// this runs in the background after scan_directory creates jobs.
/// polls every 3 seconds and sends progress updates on each poll.
/// exits early if shutdown_token is cancelled.
async fn poll_scan_jobs_until_complete(
    app_handle: tauri::AppHandle,
    session_id: String,
    shutdown_token: ShutdownToken,
) {
    use grimoire::jobs::{list_jobs, JobStatus};
    use grimoire::music::analytics::admin::get_overview_stats;
    use std::time::Duration;

    // get baseline counts before jobs are processed
    let baseline = match get_overview_stats().await.data {
        Some(stats) => (stats.total_songs, stats.total_albums, stats.total_artists),
        None => {
            tracing::warn!("scan-poll: failed to get baseline stats");
            (0, 0, 0)
        }
    };

    let poll_interval = Duration::from_secs(3);
    let max_polls = 600; // 30 minutes max (600 * 3s)
    let mut last_songs = 0i64;

    for _ in 0..max_polls {
        // wait for poll interval or shutdown
        tokio::select! {
            _ = tokio::time::sleep(poll_interval) => {}
            _ = shutdown_token.cancelled() => {
                tracing::info!("scan-poll: shutdown requested, stopping poll");
                return;
            }
        }

        // check job status for this session
        let jobs_response = list_jobs(Some(&session_id), None, Some(1000), None).await;

        match jobs_response.data {
            Some(jobs) => {
                let jobs_total = jobs.len() as u32;
                let pending = jobs
                    .iter()
                    .filter(|j| {
                        j.status()
                            .map(|s| s == JobStatus::Pending || s == JobStatus::Running)
                            .unwrap_or(false)
                    })
                    .count() as u32;

                // get current stats to track progress
                let current_stats = get_overview_stats().await.data;
                let (songs_added, albums_added, artists_added) = match &current_stats {
                    Some(stats) => (
                        (stats.total_songs - baseline.0).max(0) as u32,
                        (stats.total_albums - baseline.1).max(0) as u32,
                        (stats.total_artists - baseline.2).max(0) as u32,
                    ),
                    None => (0, 0, 0),
                };

                // send progress update if songs changed
                let current_songs = current_stats.as_ref().map(|s| s.total_songs).unwrap_or(0);
                if current_songs != last_songs {
                    last_songs = current_songs;
                    if let Err(e) = notify_scan_progress(
                        &app_handle,
                        songs_added,
                        albums_added,
                        artists_added,
                        pending,
                        jobs_total,
                    ) {
                        tracing::error!(error = %e, "scan-poll: failed to send progress");
                    }
                }

                if pending == 0 && !jobs.is_empty() {
                    // all jobs complete - send final notification
                    if let Err(e) =
                        notify_scan_complete(&app_handle, songs_added, albums_added, artists_added)
                    {
                        tracing::error!(error = %e, "scan-poll: failed to notify spume");
                    }

                    tracing::info!(
                        songs = songs_added,
                        albums = albums_added,
                        artists = artists_added,
                        "scan-poll: complete"
                    );
                    return;
                }
            }
            None => {
                tracing::warn!(session_id = %session_id, "scan-poll: failed to get job list");
            }
        }
    }

    tracing::warn!("scan-poll: polling timed out after 30 minutes");
}

/// check for pending jobs on startup and resume polling if needed
///
/// called when app starts to resume polling for any jobs that were
/// in progress when the app was previously closed.
pub async fn resume_pending_jobs_polling(
    app_handle: tauri::AppHandle,
    shutdown_token: ShutdownToken,
) {
    use grimoire::jobs::{list_jobs, JobStatus};
    use grimoire::music::analytics::admin::get_overview_stats;
    use std::time::Duration;

    // brief delay to let server fully start
    tokio::time::sleep(Duration::from_secs(2)).await;

    // check if there are any pending jobs (no session filter)
    let jobs_response = list_jobs(None, None, Some(100), None).await;
    let has_pending = match &jobs_response.data {
        Some(jobs) => jobs.iter().any(|j| {
            j.status()
                .map(|s| s == JobStatus::Pending || s == JobStatus::Running)
                .unwrap_or(false)
        }),
        None => false,
    };

    if !has_pending {
        tracing::debug!("scan-poll: no pending jobs on startup");
        return;
    }

    tracing::info!("scan-poll: found pending jobs on startup, resuming polling...");

    // get baseline counts
    let baseline = match get_overview_stats().await.data {
        Some(stats) => (stats.total_songs, stats.total_albums, stats.total_artists),
        None => (0, 0, 0),
    };

    let poll_interval = Duration::from_secs(3);
    let max_polls = 600;
    let mut last_songs = 0i64;

    for _ in 0..max_polls {
        tokio::select! {
            _ = tokio::time::sleep(poll_interval) => {}
            _ = shutdown_token.cancelled() => {
                tracing::info!("scan-poll: shutdown requested during resume poll");
                return;
            }
        }

        let jobs_response = list_jobs(None, None, Some(1000), None).await;

        match jobs_response.data {
            Some(jobs) => {
                let jobs_total = jobs.len() as u32;
                let pending = jobs
                    .iter()
                    .filter(|j| {
                        j.status()
                            .map(|s| s == JobStatus::Pending || s == JobStatus::Running)
                            .unwrap_or(false)
                    })
                    .count() as u32;

                let current_stats = get_overview_stats().await.data;
                let (songs_added, albums_added, artists_added) = match &current_stats {
                    Some(stats) => (
                        (stats.total_songs - baseline.0).max(0) as u32,
                        (stats.total_albums - baseline.1).max(0) as u32,
                        (stats.total_artists - baseline.2).max(0) as u32,
                    ),
                    None => (0, 0, 0),
                };

                let current_songs = current_stats.as_ref().map(|s| s.total_songs).unwrap_or(0);
                if current_songs != last_songs {
                    last_songs = current_songs;
                    let _ = notify_scan_progress(
                        &app_handle,
                        songs_added,
                        albums_added,
                        artists_added,
                        pending,
                        jobs_total,
                    );
                }

                if pending == 0 {
                    let _ =
                        notify_scan_complete(&app_handle, songs_added, albums_added, artists_added);
                    tracing::info!(
                        songs = songs_added,
                        albums = albums_added,
                        artists = artists_added,
                        "scan-poll: resume complete"
                    );
                    return;
                }
            }
            None => {}
        }
    }

    tracing::warn!("scan-poll: resume polling timed out");
}

// ============================================================================
// Federation Commands
// ============================================================================

/// federation configuration status
#[derive(Debug, Serialize)]
pub struct FederationConfigStatus {
    pub enabled: bool,
    pub haruspex_url: String,
    pub haruspex_anon_key: String,
    pub auto_create_users: bool,
    pub default_role: String,
}

/// federation credentials status
#[derive(Debug, Serialize)]
pub struct FederationCredentialsStatus {
    pub stored: bool,
    pub path: String,
    pub email: Option<String>,
    pub haruspex_user_id: Option<String>,
    pub created_at: Option<String>,
    pub last_refreshed_at: Option<String>,
    pub verified: Option<bool>,
    pub verification_error: Option<String>,
}

/// federation identity (keypair) status
#[derive(Debug, Serialize)]
pub struct FederationIdentityStatus {
    pub keypair_exists: bool,
    pub keypair_path: String,
    pub node_id: Option<String>,
}

/// complete federation status
#[derive(Debug, Serialize)]
pub struct FederationStatus {
    pub config: Option<FederationConfigStatus>,
    pub credentials: FederationCredentialsStatus,
    pub identity: FederationIdentityStatus,
}

/// get current federation status
#[tauri::command]
pub async fn get_federation_status(
    app_handle: tauri::AppHandle,
) -> Result<FederationStatus, String> {
    ensure_initialized(&app_handle).await?;

    // get setup status (includes credential verification)
    let setup_status = grimoire::federation::get_setup_status_verified().await;

    // read config directly from file (not from grimoire cache) so we see live changes
    let config_status = read_federation_config_from_file(&app_handle)?;

    // credentials status
    let credentials = FederationCredentialsStatus {
        stored: setup_status.credentials_exist,
        path: setup_status.credentials_path.display().to_string(),
        email: setup_status.email,
        haruspex_user_id: setup_status.haruspex_user_id,
        created_at: setup_status.created_at,
        last_refreshed_at: setup_status.last_refreshed_at,
        verified: setup_status.verified,
        verification_error: setup_status.verification_error,
    };

    // identity status
    let identity_info = grimoire::federation::get_identity_info();
    let identity = FederationIdentityStatus {
        keypair_exists: identity_info.keypair_exists,
        keypair_path: identity_info.keypair_path.display().to_string(),
        node_id: identity_info.node_id,
    };

    Ok(FederationStatus {
        config: config_status,
        credentials,
        identity,
    })
}

/// result of federation setup
#[derive(Debug, Serialize)]
pub struct FederationSetupResult {
    pub haruspex_user_id: String,
    pub email: String,
    pub credentials_path: String,
}

/// set up federation by authenticating to haruspex
#[tauri::command]
pub async fn federation_setup(
    app_handle: tauri::AppHandle,
    email: String,
    password: String,
) -> Result<FederationSetupResult, String> {
    ensure_initialized(&app_handle).await?;

    // read config from file (not cache) so we see recent toggle changes
    let federation_config = get_federation_config_from_file(&app_handle)?;

    let result = grimoire::federation::setup_federation(&federation_config, &email, &password)
        .await
        .map_err(|e| format!("setup failed: {}", e))?;

    Ok(FederationSetupResult {
        haruspex_user_id: result.haruspex_user_id,
        email: result.email,
        credentials_path: result.credentials_path.display().to_string(),
    })
}

/// result of federation sync
#[derive(Debug, Serialize)]
pub struct FederationSyncResult {
    pub groups_found: usize,
    pub members_found: usize,
    pub users_created: usize,
    pub users_updated: usize,
    pub users_skipped: usize,
    pub peer_nodes_registered: usize,
    pub errors: Vec<String>,
}

/// sync users from haruspex
#[tauri::command]
pub async fn federation_sync(app_handle: tauri::AppHandle) -> Result<FederationSyncResult, String> {
    ensure_initialized(&app_handle).await?;

    // read config from file (not cache) so we see recent toggle changes
    let federation_config = get_federation_config_from_file(&app_handle)?;

    // sync requires stored credentials - use them automatically
    let result = grimoire::federation::sync_users_from_stored_credentials(&federation_config)
        .await
        .map_err(|e| format!("sync failed: {}", e))?;

    Ok(FederationSyncResult {
        groups_found: result.stats.groups_found,
        members_found: result.stats.members_found,
        users_created: result.stats.users_created,
        users_updated: result.stats.users_updated,
        users_skipped: result.stats.users_skipped,
        peer_nodes_registered: result.stats.peer_nodes_registered,
        errors: result.stats.errors,
    })
}

/// clear federation credentials (logout)
#[tauri::command]
pub async fn federation_logout(app_handle: tauri::AppHandle) -> Result<(), String> {
    ensure_initialized(&app_handle).await?;

    grimoire::federation::clear_credentials().map_err(|e| format!("logout failed: {}", e))
}

/// read federation config from file (bypasses cached CONFIG)
fn read_federation_config_from_file(
    app_handle: &tauri::AppHandle,
) -> Result<Option<FederationConfigStatus>, String> {
    let config_path = get_server_config_path_resolved(app_handle)
        .ok_or_else(|| "config file not found".to_string())?;

    let config = grimoire::read_config_from_file(&config_path)
        .map_err(|e| format!("failed to read config: {}", e))?;

    match config.federation {
        None => Ok(None),
        Some(f) if !f.enabled => Ok(Some(FederationConfigStatus {
            enabled: false,
            haruspex_url: String::new(),
            haruspex_anon_key: String::new(),
            auto_create_users: false,
            default_role: String::new(),
        })),
        Some(f) => Ok(Some(FederationConfigStatus {
            enabled: true,
            haruspex_url: f.haruspex_url.clone(),
            haruspex_anon_key: f.haruspex_anon_key.clone(),
            auto_create_users: f.auto_create_users,
            default_role: f.default_role,
        })),
    }
}

/// read full FederationConfig from file (for passing to grimoire functions)
fn get_federation_config_from_file(
    app_handle: &tauri::AppHandle,
) -> Result<grimoire::config::FederationConfig, String> {
    let config_path = get_server_config_path_resolved(app_handle)
        .ok_or_else(|| "config file not found".to_string())?;

    grimoire::read_config_from_file(&config_path)
        .map_err(|e| format!("failed to read config: {}", e))?
        .federation
        .filter(|f| f.enabled)
        .ok_or_else(|| "federation not enabled in config".to_string())
}

/// toggle federation enabled in config file (preserves comments)
/// also starts/stops the P2P endpoint accordingly
#[tauri::command]
pub async fn toggle_federation_enabled(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, std::sync::Arc<crate::p2p_state::P2pState>>,
) -> Result<bool, String> {
    let config_path = get_server_config_path_resolved(&app_handle)
        .ok_or_else(|| "config file not found".to_string())?;

    // read current state
    let current = grimoire::read_config_from_file(&config_path)
        .map_err(|e| format!("failed to read config: {}", e))?
        .federation
        .map(|f| f.enabled)
        .unwrap_or(false);

    // toggle
    let new_value = !current;
    grimoire::set_config_values(&config_path, &[("federation.enabled", new_value.into())])
        .map_err(|e| format!("failed to update config: {}", e))?;

    // reload grimoire config to pick up the change
    let _ = grimoire::config::init_config(Some(config_path.clone()));

    // start or stop P2P based on new value
    if new_value {
        // ensure config path is set (may not be if federation was disabled at startup)
        state.set_config_path(config_path);
        // start P2P
        if let Err(e) = state.start().await {
            tracing::error!(error = %e, "toggle_federation_enabled: failed to start P2P");
        }
    } else {
        // stop P2P
        state.stop().await;
    }

    // refresh the app menu to show/hide P2P controls
    #[cfg(desktop)]
    crate::menu::refresh_app_menu(&app_handle);

    // notify UI of the federation state change (uses same event as config save)
    let message = if new_value {
        "federation enabled"
    } else {
        "federation disabled"
    };
    let _ = notify_config_changed(&app_handle, message);

    Ok(new_value)
}

/// reload config from disk and restart P2P endpoint if federation is enabled
///
/// this replaces the old server_restart command since there's no longer
/// a separate server process - instead we reload the RwLock config
/// and restart the P2P endpoint.
#[tauri::command]
pub async fn reload_config(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, std::sync::Arc<crate::p2p_state::P2pState>>,
) -> Result<(), String> {
    let config_path = get_server_config_path_resolved(&app_handle)
        .ok_or_else(|| "config file not found".to_string())?;

    // reload grimoire config from disk
    grimoire::config::init_config(Some(config_path.clone()))
        .map_err(|e| format!("failed to reload config: {}", e))?;

    // check if federation is enabled after reload
    let federation_enabled = grimoire::config::get_config()
        .federation
        .map(|f| f.enabled)
        .unwrap_or(false);

    // restart P2P endpoint if federation is enabled
    if federation_enabled {
        state.set_config_path(config_path);
        state.restart().await?;
    } else {
        // stop P2P if federation was disabled
        state.stop().await;
    }

    // refresh the app menu
    #[cfg(desktop)]
    crate::menu::refresh_app_menu(&app_handle);

    // notify that config was reloaded
    let _ = notify_config_changed(&app_handle, "config reloaded");

    Ok(())
}

// ============================================================================
// config upgrade commands
// ============================================================================

/// result of checking if config needs upgrade
#[derive(Debug, Serialize)]
pub struct ConfigUpgradeStatus {
    /// true if config version differs from binary version
    pub needs_upgrade: bool,
    /// version in app config file
    pub config_version: String,
    /// version of this binary
    pub binary_version: String,
}

/// check if config needs upgrade (version mismatch)
///
/// checks freqhole-config.toml (server config) for structural changes.
/// app config (freqhole-app-config.toml) is upgraded silently on startup.
#[tauri::command]
pub fn check_config_needs_upgrade(
    app_handle: tauri::AppHandle,
) -> Result<ConfigUpgradeStatus, String> {
    let config_path = get_server_config_path_resolved(&app_handle)
        .ok_or_else(|| "config file not found".to_string())?;

    let needs_upgrade =
        grimoire::config::config_needs_upgrade(&config_path).map_err(|e| e.to_string())?;

    // get versions for display
    let binary_version = grimoire::config::get_binary_version().to_string();
    let config_version = grimoire::config::GrimoireConfig::load(&config_path)
        .ok()
        .and_then(|c| c.server.map(|s| s.version))
        .unwrap_or_else(|| "unknown".to_string());

    Ok(ConfigUpgradeStatus {
        needs_upgrade,
        config_version,
        binary_version,
    })
}

/// result of config upgrade operation
#[derive(Debug, Serialize)]
pub struct ConfigUpgradeResult {
    /// path to backup of original server config
    pub backup_path: String,
    /// old version from server config
    pub old_version: String,
    /// new version written to config
    pub new_version: String,
}

/// upgrade server config to current version
///
/// creates backup first, then merges user values into fresh template.
/// app config (freqhole-app-config.toml) is upgraded silently on startup.
#[tauri::command]
pub fn upgrade_config(app_handle: tauri::AppHandle) -> Result<ConfigUpgradeResult, String> {
    let config_path = get_server_config_path_resolved(&app_handle)
        .ok_or_else(|| "config file not found".to_string())?;

    let result = grimoire::config::upgrade_config(&config_path).map_err(|e| e.to_string())?;

    Ok(ConfigUpgradeResult {
        backup_path: result.backup_path.display().to_string(),
        old_version: result.old_version,
        new_version: result.new_version,
    })
}

// =============================================================================
// app config settings
// =============================================================================

/// get the sync_queue_to_local setting (default: true)
#[tauri::command]
pub fn get_sync_queue_to_local(app_handle: tauri::AppHandle) -> bool {
    FreqholeAppConfig::load(&app_handle)
        .map(|c| c.sync_queue_to_local)
        .unwrap_or(true)
}

/// set the sync_queue_to_local setting
#[tauri::command]
pub fn set_sync_queue_to_local(app_handle: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut config = FreqholeAppConfig::load(&app_handle).unwrap_or_default();
    config.sync_queue_to_local = enabled;
    config.save(&app_handle)?;

    // emit config changed event so spume can update its state
    let _ = notify_config_changed(&app_handle, "sync_queue_to_local changed");

    Ok(())
}

// =============================================================================
// unified API dispatch (spike)
// =============================================================================

/// call grimoire API directly via dispatch
///
/// this bypasses HTTP entirely - tauri calls grimoire directly.
/// path: API path (e.g., "/api/music/playlists/list")
/// body: JSON request body (can be null/empty object)
///
/// returns the dispatch response as JSON string
#[tauri::command]
pub async fn api_call(
    app_handle: tauri::AppHandle,
    path: String,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    ensure_initialized(&app_handle).await?;

    // get caller from app config admin user
    let caller = get_caller_from_app_config(&app_handle)?;

    let response = grimoire::offal::dispatch(&path, &caller, body, None).await;

    // return the full response as JSON
    serde_json::to_value(&response).map_err(|e| e.to_string())
}

/// get caller identity from app config admin user
pub(crate) fn get_caller_from_app_config(
    app_handle: &tauri::AppHandle,
) -> Result<grimoire::offal::Caller, String> {
    let app_config = FreqholeAppConfig::load(app_handle)
        .ok_or_else(|| "app config not found - run setup first".to_string())?;

    let user_id = app_config
        .admin_user
        .user_id
        .ok_or_else(|| "admin user not configured - run setup first".to_string())?;

    let username = app_config
        .admin_user
        .username
        .ok_or_else(|| "admin username not configured - run setup first".to_string())?;

    Ok(grimoire::offal::Caller::new(
        user_id,
        username,
        grimoire::users::UserRole::Admin,
    ))
}

// ============================================================================
// server config / image management
// ============================================================================

/// result of updating server image
#[derive(Debug, Serialize)]
pub struct UpdateServerImageResult {
    pub success: bool,
    pub message: String,
    pub image_path: String,
    pub image_blob_id: String,
}

/// update server image - resize to 200x200 square, convert to webp, save to app data dir, create blob, update config
#[tauri::command]
pub async fn update_server_image(
    app_handle: tauri::AppHandle,
    image_path: String,
) -> Result<UpdateServerImageResult, String> {
    // get config path and load config
    let config_path = get_server_config_path_resolved(&app_handle)
        .ok_or_else(|| "config file not found - run setup first".to_string())?;

    // get app data dir for saving the icon
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to get app data dir: {}", e))?;

    // ensure database is ready
    grimoire::database::initialize()
        .await
        .map_err(|e| format!("database error: {}", e))?;

    // read the source image
    let source_path = std::path::PathBuf::from(&image_path);
    if !source_path.exists() {
        return Err(format!("source file not found: {}", image_path));
    }

    let image_data =
        std::fs::read(&source_path).map_err(|e| format!("failed to read image: {}", e))?;

    // resize to 200x200 square webp using grimoire's thumbnail helper
    let webp_data = grimoire::blob_data::resize_to_square_webp(&image_data, 200)
        .map_err(|e| format!("failed to resize image: {}", e))?;

    // save as freqhole-icon.webp in app data dir (absolute path)
    let dest_path = app_data_dir.join("freqhole-icon.webp");
    std::fs::write(&dest_path, &webp_data).map_err(|e| format!("failed to write image: {}", e))?;

    let dest_path_str = dest_path.display().to_string();

    // update config with absolute image_path
    grimoire::set_config_values(
        &config_path,
        &[("server.image_path", dest_path_str.clone().into())],
    )
    .map_err(|e| format!("failed to update config: {}", e))?;

    // call ensure_server_image_blob to create blob and set image_blob_id
    let blob_id = grimoire::config::ensure_server_image_blob(&config_path)
        .await
        .map_err(|e| format!("failed to create image blob: {}", e))?;

    // notify spume to silently refresh server image
    let _ = notify_server_image_updated(&app_handle);

    Ok(UpdateServerImageResult {
        success: true,
        message: "server image updated".to_string(),
        image_path: dest_path_str,
        image_blob_id: blob_id,
    })
}

/// update server info (name and description)
#[tauri::command]
pub fn update_server_info(
    app_handle: tauri::AppHandle,
    name: Option<String>,
    description: Option<String>,
) -> Result<(), String> {
    let config_path = get_server_config_path_resolved(&app_handle)
        .ok_or_else(|| "config file not found - run setup first".to_string())?;

    // build updates based on what changed
    if let Some(n) = &name {
        grimoire::set_config_values(&config_path, &[("server.name", n.clone().into())])
            .map_err(|e| format!("failed to update server name: {}", e))?;
    }

    if let Some(d) = &description {
        grimoire::set_config_values(&config_path, &[("server.description", d.clone().into())])
            .map_err(|e| format!("failed to update server description: {}", e))?;
    }

    // notify spume to refresh server info
    let _ = notify_server_image_updated(&app_handle);

    Ok(())
}

// ---------------------------------------------------------------------------
// log management commands
// ---------------------------------------------------------------------------

/// a single log entry
#[derive(Debug, Clone, serde::Serialize)]
pub struct LogEntry {
    /// line content
    pub line: String,
    /// parsed timestamp (if available)
    pub timestamp: Option<String>,
    /// log level (INFO, WARN, ERROR, DEBUG, TRACE)
    pub level: Option<String>,
}

/// read logs from the charnel log file
#[tauri::command]
pub fn read_logs(app_handle: tauri::AppHandle, max_lines: Option<usize>) -> Vec<LogEntry> {
    use std::io::{BufRead, BufReader};

    let max = max_lines.unwrap_or(500);

    // get log file path from app data dir
    let log_path = match crate::app_config::get_log_file_path(&app_handle) {
        Some(p) => p,
        None => return vec![],
    };

    // read the file
    let file = match std::fs::File::open(&log_path) {
        Ok(f) => f,
        Err(_) => return vec![],
    };

    let reader = BufReader::new(file);
    let lines: Vec<String> = reader.lines().filter_map(|l| l.ok()).collect();

    // take at most max_lines from the end (newest)
    let start = if lines.len() > max {
        lines.len() - max
    } else {
        0
    };

    lines[start..]
        .iter()
        .map(|line| {
            // try to parse tracing format: "2026-03-23T10:15:30.123Z  INFO charnel: message"
            let (timestamp, level) = parse_log_line_metadata(line);
            LogEntry {
                line: line.clone(),
                timestamp,
                level,
            }
        })
        .collect()
}

/// parse timestamp and level from a tracing-formatted log line
fn parse_log_line_metadata(line: &str) -> (Option<String>, Option<String>) {
    // tracing-subscriber format: "2026-03-23T10:15:30.123456Z  INFO target: message"
    // or: "  2026-03-23T10:15:30.123456Z  INFO target: message" (with leading spaces)
    let line = line.trim_start();

    // check for ISO timestamp at start
    if line.len() < 20 {
        return (None, None);
    }

    // timestamp is roughly 27 chars (with microseconds and Z)
    let parts: Vec<&str> = line.splitn(3, ' ').collect();
    if parts.len() < 2 {
        return (None, None);
    }

    // first part should look like a timestamp
    let ts_candidate = parts[0];
    let is_timestamp = ts_candidate.len() >= 20
        && ts_candidate.chars().take(4).all(|c| c.is_ascii_digit())
        && ts_candidate.chars().nth(4) == Some('-');

    if !is_timestamp {
        return (None, None);
    }

    let timestamp = Some(ts_candidate.to_string());

    // second part might be empty (double space) or the level
    let level_candidate = parts.get(1).unwrap_or(&"").trim();
    let level = match level_candidate.to_uppercase().as_str() {
        "INFO" | "WARN" | "DEBUG" | "ERROR" | "TRACE" => Some(level_candidate.to_uppercase()),
        "" => {
            // try the third part after double space
            if let Some(third) = parts.get(2) {
                let third_parts: Vec<&str> = third.splitn(2, ' ').collect();
                let third_level = third_parts.first().unwrap_or(&"").trim().to_uppercase();
                match third_level.as_str() {
                    "INFO" | "WARN" | "DEBUG" | "ERROR" | "TRACE" => Some(third_level),
                    _ => None,
                }
            } else {
                None
            }
        }
        _ => None,
    };

    (timestamp, level)
}

/// get the log file path
#[tauri::command]
pub fn get_log_file_path(app_handle: tauri::AppHandle) -> Option<String> {
    crate::app_config::get_log_file_path(&app_handle).map(|p| p.display().to_string())
}
