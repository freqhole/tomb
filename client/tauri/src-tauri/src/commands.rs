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
use crate::spume_bridge::{notify_config_changed, notify_scan_complete, notify_scan_progress};
use crate::PendingInviteCode;
use crate::ShutdownToken;

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
    let config_path = get_server_config_path_resolved(app_handle)
        .ok_or_else(|| "server config not found - run setup first".to_string())?;

    ensure_config_initialized(&config_path)?;

    grimoire::database::initialize()
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// ensure wordlist is initialized (only needed for invite code generation)
fn ensure_wordlist() -> Result<(), String> {
    if grimoire::wordlist::is_initialized() {
        return Ok(());
    }
    let wordlist_config = grimoire::wordlist::ManagementWordlistConfig::default();
    let result = grimoire::wordlist::initialize_wordlist(&wordlist_config);
    if result.is_success() {
        Ok(())
    } else {
        Err(format!("failed to initialize wordlist: {}", result.message))
    }
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
) -> grimoire::setup::SetupResult {
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
                    eprintln!("failed to copy icon: {}", e);
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
    };

    let service = grimoire::setup::SetupService::new();
    let mut result = service.run_setup(setup_config).await;

    // extract embedded spume client if available and setup was successful
    if result.success && grimoire::setup::has_embedded_spume() {
        let spume_dir = PathBuf::from(&data_dir).join("spume");
        let config_path = PathBuf::from(&config_path);

        match grimoire::setup::extract_spume_to(&spume_dir) {
            Ok(extract_result) => {
                eprintln!(
                    "extracted spume client: {} files to {}",
                    extract_result.files_extracted,
                    spume_dir.display()
                );
                // update config to enable static file serving
                if let Err(e) = grimoire::set_config_values(
                    &config_path,
                    &[
                        ("server.static_files.enabled", true.into()),
                        (
                            "server.static_files.directory",
                            spume_dir.display().to_string().into(),
                        ),
                    ],
                ) {
                    result
                        .errors
                        .push(format!("failed to update static_files config: {}", e));
                }
            }
            Err(e) => {
                result
                    .errors
                    .push(format!("failed to extract spume client: {}", e));
            }
        }
    }

    result
}

/// result of creating an admin user
#[derive(Debug, Clone, serde::Serialize)]
pub struct CreateAdminResult {
    pub success: bool,
    pub user_id: Option<String>,
    pub username: Option<String>,
    pub invite_code: Option<String>,
    pub error: Option<String>,
}

/// create admin user with account-link invite code (call after run_setup_core)
///
/// the invite code can be used to authenticate the main window by calling
/// the /api/auth/invite endpoint
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
            // save admin user info to app config for future invite code generation
            if let Err(e) = save_admin_user(&app, &user.id, &user.username) {
                eprintln!(
                    "[create_admin_user] failed to save admin user to app config: {}",
                    e
                );
            }

            // generate account-link invite code for the new user
            let invite_response = service.create_account_link_code_internal(&user.id).await;
            let invite_code = invite_response.data.map(|c| c.code);

            CreateAdminResult {
                success: true,
                user_id: Some(user.id),
                username: Some(user.username),
                invite_code,
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
                invite_code: None,
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
    /// invite code for authentication (if available, used for initial login)
    pub invite_code: Option<String>,
    /// admin username (used with invite code for authentication)
    pub admin_username: Option<String>,
    /// disable backdrop-filter blur effects (for linux/webkitgtk compatibility)
    #[serde(default)]
    pub disable_backdrop_blur: bool,
}

/// store invite code in memory (used during setup to pass to main window)
pub fn store_invite_code(app_handle: &tauri::AppHandle, invite_code: &str) {
    let state = app_handle.state::<PendingInviteCode>();
    state.set(invite_code.to_string());
    eprintln!("[store_invite_code] stored invite code in memory");
}

/// get freqhole server config (for bridge communication with spume)
///
/// returns server_name, server_url from the loaded config
/// returns None if config is not initialized
#[tauri::command]
pub fn get_freqhole_config(app_handle: tauri::AppHandle) -> Option<FreqholeConfig> {
    eprintln!("[get_freqhole_config] called");
    let config_path = get_server_config_path_resolved(&app_handle)?;
    eprintln!(
        "[get_freqhole_config] config_path={}",
        config_path.display()
    );

    // try to initialize config if needed
    if !grimoire::is_config_initialized() {
        eprintln!("[get_freqhole_config] config not initialized, initializing...");
        if !config_path.exists() {
            eprintln!("[get_freqhole_config] config file does not exist");
            return None;
        }
        if grimoire::config::init_config(Some(config_path)).is_err() {
            eprintln!("[get_freqhole_config] failed to init config");
            return None;
        }
    }

    let config = grimoire::config::get_config();
    let server = config.server.as_ref()?;

    // take the invite code from state (one-time use, clears after reading)
    let state = app_handle.state::<PendingInviteCode>();
    let invite_code = state.take();
    eprintln!(
        "[get_freqhole_config] invite code from state: {}",
        if invite_code.is_some() {
            "found"
        } else {
            "none"
        }
    );

    // get app config for username and display settings
    let app_config = FreqholeAppConfig::load(&app_handle);
    let admin_username = app_config
        .as_ref()
        .and_then(|c| c.admin_user.username.clone());
    let disable_backdrop_blur = app_config.map(|c| c.disable_backdrop_blur).unwrap_or(false);

    eprintln!(
        "[get_freqhole_config] returning: server_name={}, has_invite_code={}, has_admin_username={}",
        server.name,
        invite_code.is_some(),
        admin_username.is_some()
    );

    Some(FreqholeConfig {
        server_name: server.name.clone(),
        // always use localhost for the client URL (not the bind address like 0.0.0.0)
        server_url: format!("http://localhost:{}", server.port),
        invite_code,
        admin_username,
        disable_backdrop_blur,
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

/// read the config file content
#[tauri::command]
pub fn read_config_file(app_handle: tauri::AppHandle) -> Result<String, String> {
    let config_path = get_server_config_path_resolved(&app_handle)
        .ok_or_else(|| "config file not found - run setup first".to_string())?;

    if !config_path.exists() {
        return Err("config file does not exist".to_string());
    }

    std::fs::read_to_string(&config_path).map_err(|e| format!("failed to read config file: {}", e))
}

/// result of saving config file
#[derive(Debug, Serialize)]
pub struct SaveConfigResult {
    pub success: bool,
    pub message: String,
    pub validation_errors: Vec<String>,
}

/// validate and save the config file content
#[tauri::command]
pub fn save_config_file(app_handle: tauri::AppHandle, content: String) -> SaveConfigResult {
    let config_path = match get_server_config_path_resolved(&app_handle) {
        Some(path) => path,
        None => {
            return SaveConfigResult {
                success: false,
                message: "config file not found - run setup first".to_string(),
                validation_errors: vec![],
            }
        }
    };

    // first, try to parse the TOML to check syntax
    let parsed: Result<grimoire::config::GrimoireConfig, _> = toml::from_str(&content);
    if let Err(e) = parsed {
        return SaveConfigResult {
            success: false,
            message: "invalid TOML syntax".to_string(),
            validation_errors: vec![e.to_string()],
        };
    }

    // write to a temp file first
    let temp_path = config_path.with_extension("toml.tmp");
    if let Err(e) = std::fs::write(&temp_path, &content) {
        return SaveConfigResult {
            success: false,
            message: format!("failed to write temp file: {}", e),
            validation_errors: vec![],
        };
    }

    // validate the config using grimoire's validation
    match grimoire::config::GrimoireConfig::load(&temp_path) {
        Ok(_) => {
            // validation passed, move temp file to actual config
            if let Err(e) = std::fs::rename(&temp_path, &config_path) {
                let _ = std::fs::remove_file(&temp_path);
                return SaveConfigResult {
                    success: false,
                    message: format!("failed to save config file: {}", e),
                    validation_errors: vec![],
                };
            }

            // note: don't notify here - caller (SettingsView) will restart server
            // which sends its own notification

            SaveConfigResult {
                success: true,
                message: "config saved successfully".to_string(),
                validation_errors: vec![],
            }
        }
        Err(e) => {
            let _ = std::fs::remove_file(&temp_path);
            SaveConfigResult {
                success: false,
                message: "config validation failed".to_string(),
                validation_errors: vec![e.to_string()],
            }
        }
    }
}

/// result of updating spume static files
#[derive(Debug, Serialize)]
pub struct UpdateSpumeResult {
    pub success: bool,
    pub message: String,
    pub files_cleaned: usize,
    pub files_extracted: usize,
}

/// update embedded spume web client files
///
/// safely cleans old files and extracts new ones from the embedded assets.
/// performs safety checks to prevent accidental deletion of wrong directories.
#[tauri::command]
pub fn update_spume(app_handle: tauri::AppHandle) -> UpdateSpumeResult {
    // check if we have embedded assets
    if !grimoire::setup::has_embedded_spume() {
        return UpdateSpumeResult {
            success: false,
            message: "no embedded spume assets available in this build".to_string(),
            files_cleaned: 0,
            files_extracted: 0,
        };
    }

    // get data directory
    let data_dir = match get_data_dir(app_handle) {
        Some(dir) => PathBuf::from(dir),
        None => {
            return UpdateSpumeResult {
                success: false,
                message: "data directory not configured - run setup first".to_string(),
                files_cleaned: 0,
                files_extracted: 0,
            }
        }
    };

    let spume_dir = data_dir.join("spume");

    match grimoire::setup::update_spume_to(&spume_dir) {
        Ok(result) => {
            eprintln!(
                "updated spume: cleaned {} items, extracted {} files to {}",
                result.files_cleaned, result.files_extracted, result.destination
            );
            UpdateSpumeResult {
                success: true,
                message: format!("web client updated ({} files)", result.files_extracted),
                files_cleaned: result.files_cleaned,
                files_extracted: result.files_extracted,
            }
        }
        Err(e) => UpdateSpumeResult {
            success: false,
            message: format!("failed to update spume: {}", e),
            files_cleaned: 0,
            files_extracted: 0,
        },
    }
}

/// user info for listing
#[derive(Debug, Serialize)]
pub struct UserInfo {
    pub id: String,
    pub username: String,
    pub role: String,
    pub has_api_key: bool,
    pub created_at: i64,
}

/// get the first root user for Tauri admin operations
async fn get_root_user() -> Result<grimoire::users::User, String> {
    let service = grimoire::users::UserService::new();
    let response = service.get_first_root_user().await;
    response
        .data
        .ok_or_else(|| "no root user found - run setup first".to_string())
}

/// list all users
#[tauri::command]
pub async fn list_users(app_handle: tauri::AppHandle) -> Result<Vec<UserInfo>, String> {
    ensure_initialized(&app_handle).await?;
    let service = grimoire::users::UserService::new();
    let root_user = get_root_user().await?;

    let result = service
        .list_users(
            &grimoire::users::UserQueryParams {
                include_deleted: Some(false),
                ..Default::default()
            },
            &root_user,
        )
        .await;

    match result.data {
        Some(users) => Ok(users
            .into_iter()
            .map(|u| UserInfo {
                id: u.id,
                username: u.username,
                role: format!("{:?}", u.role).to_lowercase(),
                has_api_key: u.api_key.is_some(),
                created_at: u.created_at,
            })
            .collect()),
        None => Err(result.message),
    }
}

/// update a user's role
#[tauri::command]
pub async fn update_user_role(
    app_handle: tauri::AppHandle,
    user_id: String,
    role: String,
) -> Result<(), String> {
    ensure_initialized(&app_handle).await?;
    let service = grimoire::users::UserService::new();

    // prevent setting role to root via UI
    let user_role = match role.to_lowercase().as_str() {
        "root" => return Err("cannot set user role to root".to_string()),
        "admin" => grimoire::users::UserRole::Admin,
        "viewer" => grimoire::users::UserRole::Viewer,
        _ => grimoire::users::UserRole::Member,
    };

    let update_request = grimoire::users::UpdateUserRequest {
        role: Some(user_role),
    };

    let root_user = get_root_user().await?;
    let result = service
        .update_user(&user_id, &update_request, &root_user)
        .await;

    if result.is_success() {
        Ok(())
    } else {
        Err(result.message)
    }
}

/// delete a user (soft delete)
#[tauri::command]
pub async fn delete_user(app_handle: tauri::AppHandle, user_id: String) -> Result<(), String> {
    ensure_initialized(&app_handle).await?;
    let service = grimoire::users::UserService::new();
    let root_user = get_root_user().await?;
    let result = service.delete_user(&user_id, &root_user).await;

    if result.is_success() {
        Ok(())
    } else {
        Err(result.message)
    }
}

/// invite code info for listing
#[derive(Debug, Serialize)]
pub struct InviteInfo {
    pub code: String,
    pub code_type: String,
    pub grants_role: String,
    pub created_at: i64,
    pub expires_at: Option<i64>,
    pub used_at: Option<i64>,
    pub used_by: Option<String>,
    pub used_by_username: Option<String>,
    pub link_for_user_id: Option<String>,
    pub link_for_username: Option<String>,
    pub is_active: bool,
}

/// list invite codes
#[tauri::command]
pub async fn list_invites(
    app_handle: tauri::AppHandle,
    active_only: bool,
) -> Result<Vec<InviteInfo>, String> {
    ensure_initialized(&app_handle).await?;
    let service = grimoire::users::UserService::new();
    let root_user = get_root_user().await?;

    let result = service.list_invite_codes(active_only, &root_user).await;

    match result.data {
        Some(codes) => {
            // collect all user ids that we need to look up (used_by and link_for)
            let user_ids: Vec<&str> = codes
                .iter()
                .flat_map(|c| {
                    vec![c.used_by_id.as_deref(), c.link_for_user_id.as_deref()]
                        .into_iter()
                        .flatten()
                })
                .collect();

            // look up usernames for used_by_id
            let mut username_map = std::collections::HashMap::new();
            if !user_ids.is_empty() {
                let users_result = service
                    .list_users(
                        &grimoire::users::UserQueryParams {
                            include_deleted: Some(true),
                            ..Default::default()
                        },
                        &root_user,
                    )
                    .await;
                if let Some(users) = users_result.data {
                    for user in users {
                        username_map.insert(user.id.clone(), user.username);
                    }
                }
            }

            Ok(codes
                .into_iter()
                .map(|c| {
                    let used_by_username = c
                        .used_by_id
                        .as_ref()
                        .and_then(|id| username_map.get(id).cloned());
                    let link_for_username = c
                        .link_for_user_id
                        .as_ref()
                        .and_then(|id| username_map.get(id).cloned());
                    InviteInfo {
                        code: c.code,
                        code_type: format!("{:?}", c.code_type).to_lowercase(),
                        grants_role: c.grants_role.to_string(),
                        created_at: c.created_at,
                        expires_at: c.link_expires_at,
                        used_at: c.used_at,
                        used_by: c.used_by_id,
                        used_by_username,
                        link_for_user_id: c.link_for_user_id,
                        link_for_username,
                        is_active: c.is_active,
                    }
                })
                .collect())
        }
        None => Err(result.message),
    }
}

/// generate invite codes
#[tauri::command]
pub async fn generate_invites(
    app_handle: tauri::AppHandle,
    count: u32,
    role: Option<String>,
) -> Result<Vec<String>, String> {
    ensure_initialized(&app_handle).await?;
    ensure_wordlist()?;

    // prevent granting root role via invites
    let grants_role = match role.as_deref().map(|r| r.to_lowercase()).as_deref() {
        Some("root") => return Err("cannot create invite codes that grant root role".to_string()),
        Some("admin") => Some(grimoire::users::UserRole::Admin),
        Some("viewer") => Some(grimoire::users::UserRole::Viewer),
        Some("member") | None => Some(grimoire::users::UserRole::Member),
        Some(_) => Some(grimoire::users::UserRole::Member),
    };

    let service = grimoire::users::UserService::new();

    let request = grimoire::users::CreateInviteCodeRequest {
        code_type: None,
        link_for_user_id: None,
        expires_hours: None,
        grants_role,
    };

    let root_user = get_root_user().await?;
    let result = service
        .generate_invite_codes(&request, count, 3, &root_user)
        .await;

    match result.data {
        Some(codes) => Ok(codes.into_iter().map(|c| c.code).collect()),
        None => Err(result.message),
    }
}

/// deactivate an invite code
#[tauri::command]
pub async fn deactivate_invite(app_handle: tauri::AppHandle, code: String) -> Result<(), String> {
    ensure_initialized(&app_handle).await?;
    let service = grimoire::users::UserService::new();
    let root_user = get_root_user().await?;
    let result = service.deactivate_invite_code(&code, &root_user).await;

    if result.is_success() {
        Ok(())
    } else {
        Err(result.message)
    }
}

/// deactivate all active invite codes
#[tauri::command]
pub async fn deactivate_all_invites(app_handle: tauri::AppHandle) -> Result<u64, String> {
    ensure_initialized(&app_handle).await?;
    let service = grimoire::users::UserService::new();
    let root_user = get_root_user().await?;
    let result = service.deactivate_all_active_invites(&root_user).await;

    match result.data {
        Some(count) => Ok(count),
        None => Err(result.message),
    }
}

/// update the role granted by an invite code
#[tauri::command]
pub async fn update_invite_role(
    app_handle: tauri::AppHandle,
    code: String,
    role: String,
) -> Result<(), String> {
    ensure_initialized(&app_handle).await?;
    let service = grimoire::users::UserService::new();
    let root_user = get_root_user().await?;

    let role: grimoire::users::models::UserRole = role.as_str().into();
    if role == grimoire::users::models::UserRole::Root {
        return Err("cannot set invite to grant root role".to_string());
    }

    let result = service.update_invite_role(&code, role, &root_user).await;

    if result.is_success() {
        Ok(())
    } else {
        Err(result.message)
    }
}

/// generate an account-link code for an existing user
/// this allows the user to add a new passkey to their account
#[tauri::command]
pub async fn generate_account_link_code(
    app_handle: tauri::AppHandle,
    user_id: String,
) -> Result<String, String> {
    ensure_initialized(&app_handle).await?;
    ensure_wordlist()?;

    let service = grimoire::users::UserService::new();
    let root_user = get_root_user().await?;

    // check if target user is root - can't create account-link codes for root
    let user_result = service.get_user(&user_id).await;
    match &user_result.data {
        Some(user) if user.role == grimoire::users::UserRole::Root => {
            return Err("cannot create account-link codes for root user".to_string());
        }
        None => {
            return Err("user not found".to_string());
        }
        _ => {}
    }

    let request = grimoire::users::CreateInviteCodeRequest {
        code_type: Some(grimoire::users::InviteCodeType::AccountLink),
        link_for_user_id: Some(user_id),
        expires_hours: Some(24), // account-link codes expire after 24 hours
        grants_role: None,       // not used for account-link codes
    };

    let result = service
        .generate_invite_codes(&request, 1, 4, &root_user)
        .await;

    match result.data {
        Some(codes) if !codes.is_empty() => Ok(codes[0].code.clone()),
        _ => Err(result.message),
    }
}

/// generate an invite code for auto-auth using the stored admin user
///
/// this is used by the spume client in tauri mode to automatically re-authenticate
/// when a 401 error is received, without requiring user interaction.
#[tauri::command]
pub async fn generate_auto_auth_invite(app_handle: tauri::AppHandle) -> Result<String, String> {
    eprintln!("[generate_auto_auth_invite] called");
    ensure_initialized(&app_handle).await?;
    eprintln!("[generate_auto_auth_invite] ensure_initialized passed");
    ensure_wordlist()?;
    eprintln!("[generate_auto_auth_invite] ensure_wordlist passed");

    // load app config to get stored admin user id
    let app_config =
        FreqholeAppConfig::load(&app_handle).ok_or_else(|| "app config not found".to_string())?;
    eprintln!("[generate_auto_auth_invite] app config loaded");

    let admin_user_id = app_config
        .admin_user
        .user_id
        .ok_or_else(|| "admin user not configured".to_string())?;
    eprintln!(
        "[generate_auto_auth_invite] admin_user_id={}",
        admin_user_id
    );

    let service = grimoire::users::UserService::new();

    // use internal method that bypasses admin role check (we're the app itself)
    let result = service
        .create_account_link_code_internal(&admin_user_id)
        .await;

    match result.data {
        Some(code) => {
            eprintln!("[generate_auto_auth_invite] success, code generated");
            Ok(code.code)
        }
        None => {
            eprintln!("[generate_auto_auth_invite] failed: {}", result.message);
            Err(result.message)
        }
    }
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
            eprintln!(
                "[scan] warning: failed to set up directory tags: {}",
                tag_response.message
            );
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
            eprintln!("[rescan-poll] failed to get baseline stats");
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
                eprintln!("[rescan-poll] shutdown requested, stopping poll");
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
                        eprintln!("[rescan-poll] failed to send progress: {}", e);
                    }
                }

                if pending == 0 && !jobs.is_empty() {
                    // all jobs complete - send final notification
                    if let Err(e) =
                        notify_scan_complete(&app_handle, songs_added, albums_added, artists_added)
                    {
                        eprintln!("[rescan-poll] failed to notify spume: {}", e);
                    }

                    eprintln!(
                        "[rescan-poll] complete: {} songs, {} albums, {} artists added",
                        songs_added, albums_added, artists_added
                    );
                    return;
                }
            }
            None => {
                eprintln!(
                    "[rescan-poll] failed to get job list for rescan job {}",
                    job_id
                );
            }
        }
    }

    eprintln!("[rescan-poll] polling timed out after 60 minutes");
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
            eprintln!("[scan-poll] failed to get baseline stats");
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
                eprintln!("[scan-poll] shutdown requested, stopping poll");
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
                        eprintln!("[scan-poll] failed to send progress: {}", e);
                    }
                }

                if pending == 0 && !jobs.is_empty() {
                    // all jobs complete - send final notification
                    if let Err(e) =
                        notify_scan_complete(&app_handle, songs_added, albums_added, artists_added)
                    {
                        eprintln!("[scan-poll] failed to notify spume: {}", e);
                    }

                    eprintln!(
                        "[scan-poll] complete: {} songs, {} albums, {} artists added",
                        songs_added, albums_added, artists_added
                    );
                    return;
                }
            }
            None => {
                eprintln!(
                    "[scan-poll] failed to get job list for session {}",
                    session_id
                );
            }
        }
    }

    eprintln!("[scan-poll] polling timed out after 30 minutes");
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
        eprintln!("[scan-poll] no pending jobs on startup");
        return;
    }

    eprintln!("[scan-poll] found pending jobs on startup, resuming polling...");

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
                eprintln!("[scan-poll] shutdown requested during resume poll");
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
                    eprintln!(
                        "[scan-poll] resume complete: {} songs, {} albums, {} artists",
                        songs_added, albums_added, artists_added
                    );
                    return;
                }
            }
            None => {}
        }
    }

    eprintln!("[scan-poll] resume polling timed out");
}

/// scanned directory info for UI
#[derive(Debug, Serialize)]
pub struct ScannedDirInfo {
    pub id: String,
    pub path: String,
    pub file_count: i64,
    pub last_scanned_at: i64,
    pub tags: Vec<String>,
}

/// list all scanned directories
#[tauri::command]
pub async fn list_scanned_directories(
    app_handle: tauri::AppHandle,
) -> Result<Vec<ScannedDirInfo>, String> {
    ensure_initialized(&app_handle).await?;

    let result = grimoire::jobs::list_scanned_directories().await;

    match result.data {
        Some(dirs) => {
            let mut dirs_with_tags = Vec::new();
            for d in dirs {
                // get tags for this directory
                let tags_result = grimoire::jobs::list_directory_tags(&d.path).await;
                let tags: Vec<String> = tags_result
                    .data
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|rule| rule.tag_name)
                    .collect();

                dirs_with_tags.push(ScannedDirInfo {
                    id: d.id,
                    path: d.path,
                    file_count: d.file_count,
                    last_scanned_at: d.last_scanned_at,
                    tags,
                });
            }
            Ok(dirs_with_tags)
        }
        None => Err(result.message),
    }
}

/// remove a scanned directory from tracking
#[tauri::command]
pub async fn remove_scanned_directory(path: String) -> Result<(), String> {
    let result = grimoire::jobs::remove_scanned_directory(&path).await;

    if result.success {
        Ok(())
    } else {
        Err(result.message)
    }
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
#[tauri::command]
pub fn toggle_federation_enabled(app_handle: tauri::AppHandle) -> Result<bool, String> {
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

    // notify that config changed (restart needed for full effect)
    let _ = notify_config_changed(
        &app_handle,
        &format!(
            "federation {} - restart server to apply",
            if new_value { "enabled" } else { "disabled" }
        ),
    );

    Ok(new_value)
}

/// result for allow_peer command
#[derive(Debug, Serialize)]
pub struct AllowPeerResult {
    pub user_id: String,
    pub username: String,
    pub node_id: String,
    pub created_user: bool,
}

/// allow a peer by node_id - creates/finds user and links node_id
#[tauri::command]
pub async fn allow_peer(
    app_handle: tauri::AppHandle,
    node_id: String,
    username: Option<String>,
    role: Option<String>,
) -> Result<AllowPeerResult, String> {
    ensure_initialized(&app_handle).await?;

    let service = grimoire::users::UserService::new();

    // validate node_id looks reasonable (64 hex chars)
    if node_id.len() != 64 || !node_id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("invalid node_id: expected 64 hex characters".to_string());
    }

    // parse role (default to viewer)
    let user_role = match role.as_deref().unwrap_or("viewer") {
        "admin" => grimoire::users::UserRole::Admin,
        "member" => grimoire::users::UserRole::Member,
        "viewer" => grimoire::users::UserRole::Viewer,
        other => {
            return Err(format!(
                "invalid role '{}': expected admin, member, or viewer",
                other
            ))
        }
    };

    // determine username - use provided or generate from node_id prefix
    let username = username.unwrap_or_else(|| format!("peer_{}", &node_id[..8]));

    // try to find existing user by username
    let (user, created_user) = {
        let find_result = service.get_user_by_username(&username).await;
        if let Some(existing) = find_result.data {
            (existing, false)
        } else {
            // create new user
            let request = grimoire::users::CreateUserRequest {
                username: username.clone(),
                role: Some(user_role),
                invite_code: None,
            };
            let create_result = service.register_user(&request).await;
            match create_result.data {
                Some(user) => (user, true),
                None => {
                    let err = create_result
                        .errors
                        .first()
                        .map(|e| e.detail.clone())
                        .unwrap_or_else(|| "failed to create user".to_string());
                    return Err(err);
                }
            }
        }
    };

    // link node_id to user
    let peer_result = service.upsert_peer_node(&user.id, &node_id, None).await;

    if peer_result.data.is_none() {
        let err = peer_result
            .errors
            .first()
            .map(|e| e.detail.clone())
            .unwrap_or_else(|| "failed to link peer node".to_string());
        return Err(err);
    }

    Ok(AllowPeerResult {
        user_id: user.id,
        username: user.username,
        node_id,
        created_user,
    })
}

/// peer node with user info for listing
#[derive(Debug, Serialize)]
pub struct PeerNodeInfo {
    pub user_id: String,
    pub node_id: String,
    pub instance_name: Option<String>,
    pub created_at: i64,
    pub last_seen_at: Option<i64>,
    pub username: String,
    pub role: String,
}

/// list all peer nodes across all users
#[tauri::command]
pub async fn list_peer_nodes(app_handle: tauri::AppHandle) -> Result<Vec<PeerNodeInfo>, String> {
    ensure_initialized(&app_handle).await?;

    let service = grimoire::users::UserService::new();
    let result = service.get_all_peer_nodes().await;

    match result.data {
        Some(nodes) => Ok(nodes
            .into_iter()
            .map(|n| PeerNodeInfo {
                user_id: n.user_id,
                node_id: n.node_id,
                instance_name: n.instance_name,
                created_at: n.created_at,
                last_seen_at: n.last_seen_at,
                username: n.username,
                role: n.role,
            })
            .collect()),
        None => Err(result.message),
    }
}

/// remove a peer node by user_id and node_id
#[tauri::command]
pub async fn remove_peer_node(
    app_handle: tauri::AppHandle,
    user_id: String,
    node_id: String,
) -> Result<(), String> {
    ensure_initialized(&app_handle).await?;

    let service = grimoire::users::UserService::new();
    let result = service.remove_peer_node(&user_id, &node_id).await;

    if result.data.is_some() {
        Ok(())
    } else {
        Err(result.message)
    }
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
    /// whether spume web client was updated
    pub spume_updated: bool,
    /// number of spume files extracted (if updated)
    pub spume_files: usize,
}

/// upgrade server config to current version
///
/// creates backup first, then merges user values into fresh template.
/// also updates embedded spume web client if available.
/// app config (freqhole-app-config.toml) is upgraded silently on startup.
#[tauri::command]
pub fn upgrade_config(app_handle: tauri::AppHandle) -> Result<ConfigUpgradeResult, String> {
    let config_path = get_server_config_path_resolved(&app_handle)
        .ok_or_else(|| "config file not found".to_string())?;

    let result = grimoire::config::upgrade_config(&config_path).map_err(|e| e.to_string())?;

    // also update spume if embedded assets are available
    let (spume_updated, spume_files) = if grimoire::setup::has_embedded_spume() {
        // load updated config to get data_dir
        if let Ok(config) = grimoire::config::GrimoireConfig::load(&config_path) {
            let spume_dir = config.data_dir.join("spume");
            match grimoire::setup::update_spume_to(&spume_dir) {
                Ok(spume_result) => {
                    eprintln!(
                        "updated spume: cleaned {} items, extracted {} files",
                        spume_result.files_cleaned, spume_result.files_extracted
                    );
                    (true, spume_result.files_extracted)
                }
                Err(e) => {
                    eprintln!("failed to update spume (non-fatal): {}", e);
                    (false, 0)
                }
            }
        } else {
            (false, 0)
        }
    } else {
        (false, 0)
    };

    Ok(ConfigUpgradeResult {
        backup_path: result.backup_path.display().to_string(),
        old_version: result.old_version,
        new_version: result.new_version,
        spume_updated,
        spume_files,
    })
}

// ============================================================================
// knock request commands
// ============================================================================

/// knock request info for UI display
#[derive(Debug, Serialize)]
pub struct KnockInfo {
    pub id: String,
    pub node_id: String,
    pub username: String,
    pub message: String,
    pub status: String,
    pub created_at: i64,
    pub processed_at: Option<i64>,
    pub processed_by: Option<String>,
}

/// list pending knock requests
#[tauri::command]
pub async fn list_knocks(
    app_handle: tauri::AppHandle,
    include_all: bool,
) -> Result<Vec<KnockInfo>, String> {
    ensure_initialized(&app_handle).await?;

    let result = grimoire::federation::knock::list_knocks(include_all).await;
    match result.data {
        Some(knocks) => Ok(knocks
            .into_iter()
            .map(|k| KnockInfo {
                id: k.id,
                node_id: k.node_id,
                username: k.username,
                message: k.message,
                status: k.status.to_string(),
                created_at: k.created_at,
                processed_at: k.processed_at,
                processed_by: k.processed_by,
            })
            .collect()),
        None => Err(result.message),
    }
}

/// result of accepting a knock request
#[derive(Debug, Serialize)]
pub struct AcceptKnockResult {
    pub user_id: String,
    pub username: String,
    pub node_id: String,
    pub role: String,
    pub created_user: bool,
}

/// accept a knock request - creates user and peer node mapping
#[tauri::command]
pub async fn accept_knock(
    app_handle: tauri::AppHandle,
    knock_id: String,
    username: Option<String>,
    role: String,
) -> Result<AcceptKnockResult, String> {
    ensure_initialized(&app_handle).await?;

    // get admin user id from app config
    let app_config = crate::app_config::FreqholeAppConfig::load(&app_handle)
        .ok_or_else(|| "app config not found".to_string())?;
    let admin_user_id = app_config
        .admin_user
        .user_id
        .ok_or_else(|| "admin user id not configured".to_string())?;

    let request = grimoire::federation::knock::ProcessKnockRequest {
        username,
        role: role.clone(),
    };

    let result =
        grimoire::federation::knock::accept_knock(&knock_id, request, &admin_user_id).await;

    match result {
        Ok(knock) => Ok(AcceptKnockResult {
            user_id: knock.processed_by.unwrap_or_default(),
            username: knock.username,
            node_id: knock.node_id,
            role,
            created_user: true,
        }),
        Err(e) => Err(format!("failed to accept knock: {}", e)),
    }
}

/// reject a knock request
#[tauri::command]
pub async fn reject_knock(app_handle: tauri::AppHandle, knock_id: String) -> Result<(), String> {
    ensure_initialized(&app_handle).await?;

    // get admin user id from app config
    let app_config = crate::app_config::FreqholeAppConfig::load(&app_handle)
        .ok_or_else(|| "app config not found".to_string())?;
    let admin_user_id = app_config
        .admin_user
        .user_id
        .ok_or_else(|| "admin user id not configured".to_string())?;

    grimoire::federation::knock::reject_knock(&knock_id, &admin_user_id)
        .await
        .map(|_| ())
        .map_err(|e| format!("failed to reject knock: {}", e))
}

/// delete a knock request
#[tauri::command]
pub async fn delete_knock(app_handle: tauri::AppHandle, knock_id: String) -> Result<(), String> {
    ensure_initialized(&app_handle).await?;

    grimoire::federation::knock::delete_knock(&knock_id)
        .await
        .map_err(|e| format!("failed to delete knock: {}", e))
}

/// reject all pending knock requests
#[tauri::command]
pub async fn reject_all_knocks(app_handle: tauri::AppHandle) -> Result<u32, String> {
    ensure_initialized(&app_handle).await?;

    // get admin user id from app config
    let app_config = crate::app_config::FreqholeAppConfig::load(&app_handle)
        .ok_or_else(|| "app config not found".to_string())?;
    let admin_user_id = app_config
        .admin_user
        .user_id
        .ok_or_else(|| "admin user id not configured".to_string())?;

    // get all pending knocks and reject each
    let list_result = grimoire::federation::knock::list_knocks(false).await;
    let knocks = list_result.data.ok_or_else(|| list_result.message)?;

    let mut rejected = 0u32;
    for knock in knocks {
        if grimoire::federation::knock::reject_knock(&knock.id, &admin_user_id)
            .await
            .is_ok()
        {
            rejected += 1;
        }
    }

    Ok(rejected)
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

    let response = grimoire::offal::dispatch(&path, &caller, body).await;

    // return the full response as JSON
    serde_json::to_value(&response).map_err(|e| e.to_string())
}

/// get caller identity from app config admin user
fn get_caller_from_app_config(
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
