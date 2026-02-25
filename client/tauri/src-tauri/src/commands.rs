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
    let config_path = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("freqhole-config.toml");

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

/// run the complete setup wizard using SetupService
///
/// this replaces the step-by-step flow (create_config → init_from_config → create_root_user)
/// with a single unified call that handles everything
#[tauri::command]
pub async fn run_full_setup(
    config_path: String,
    data_dir: String,
    server_name: String,
    server_port: u16,
    image_path: Option<String>,
    username: String,
) -> grimoire::setup::SetupResult {
    let deps = grimoire::setup::check_dependencies();

    let setup_config = grimoire::setup::SetupConfig {
        config_path: PathBuf::from(&config_path),
        data_dir: PathBuf::from(&data_dir),
        server_name,
        server_id: None, // derived from server_name
        server_port,
        image_path,
        username,
        generate_api_key: true,      // always generate for tauri
        generate_invite_code: false, // tauri doesn't need this
        ytdlp_available: deps.has_ytdlp(),
        initial_scan_dirs: Vec::new(), // handled by music step in UI
    };

    let service = grimoire::setup::SetupService::new();
    service.run_setup(setup_config).await
}

/// check if setup wizard needs to run
#[tauri::command]
pub async fn check_setup_status(app_data_dir: String) -> SetupStatus {
    let config_path = PathBuf::from(&app_data_dir).join("freqhole-config.toml");
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

/// get the config file path (always in app data dir)
#[tauri::command]
pub fn get_config_path(app_handle: tauri::AppHandle) -> Option<String> {
    app_handle
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("freqhole-config.toml").display().to_string())
}

/// get the data directory from loaded config
#[tauri::command]
pub fn get_data_dir(app_handle: tauri::AppHandle) -> Option<String> {
    let config_path = app_handle
        .path()
        .app_data_dir()
        .ok()?
        .join("freqhole-config.toml");

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
    let config_path = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("freqhole-config.toml");

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
    let config_path = match app_handle.path().app_data_dir() {
        Ok(dir) => dir.join("freqhole-config.toml"),
        Err(e) => {
            return SaveConfigResult {
                success: false,
                message: format!("failed to get app data dir: {}", e),
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
            // collect all user ids that we need to look up
            let user_ids: Vec<&str> = codes
                .iter()
                .filter_map(|c| c.used_by_id.as_deref())
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
                    InviteInfo {
                        code: c.code,
                        code_type: format!("{:?}", c.code_type).to_lowercase(),
                        grants_role: c.grants_role.to_string(),
                        created_at: c.created_at,
                        expires_at: c.link_expires_at,
                        used_at: c.used_at,
                        used_by: c.used_by_id,
                        used_by_username,
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

    // wordlist must be initialized by setup wizard
    if !grimoire::wordlist::is_initialized() {
        return Err("wordlist not initialized - please run setup wizard".to_string());
    }

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

    // TODO: pass tags to scanner when grimoire supports it
    let _ = tags;

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

/// scanned directory info for UI
#[derive(Debug, Serialize)]
pub struct ScannedDirInfo {
    pub id: String,
    pub path: String,
    pub file_count: i64,
    pub last_scanned_at: i64,
}

/// list all scanned directories
#[tauri::command]
pub async fn list_scanned_directories(
    app_handle: tauri::AppHandle,
) -> Result<Vec<ScannedDirInfo>, String> {
    ensure_initialized(&app_handle).await?;

    let result = grimoire::jobs::list_scanned_directories().await;

    match result.data {
        Some(dirs) => Ok(dirs
            .into_iter()
            .map(|d| ScannedDirInfo {
                id: d.id,
                path: d.path,
                file_count: d.file_count,
                last_scanned_at: d.last_scanned_at,
            })
            .collect()),
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
