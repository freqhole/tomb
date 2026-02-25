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
        .join("config.jsonc");

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

/// result of creating a config file
#[derive(Debug, Serialize)]
pub struct ConfigCreateResult {
    pub success: bool,
    pub path: String,
    pub error: Option<String>,
}

/// result of creating a user
#[derive(Debug, Serialize)]
pub struct UserCreateResult {
    pub success: bool,
    pub user_id: Option<String>,
    pub username: Option<String>,
    pub api_key: Option<String>,
    pub error: Option<String>,
}

/// check if setup wizard needs to run
#[tauri::command]
pub async fn check_setup_status(app_data_dir: String) -> SetupStatus {
    let config_path = PathBuf::from(&app_data_dir).join("config.jsonc");
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

    let result = service
        .list_users(
            &grimoire::users::UserQueryParams {
                role: Some(grimoire::users::UserRole::Root),
                include_deleted: Some(false),
                ..Default::default()
            },
            &grimoire::users::User {
                id: "setup".to_string(),
                username: "setup".to_string(),
                role: grimoire::users::UserRole::Root,
                api_key: None,
                created_at: 0,
                updated_at: 0,
                deleted_at: None,
            },
        )
        .await;

    match result.data {
        Some(users) => Ok(!users.is_empty()),
        None => Ok(false),
    }
}

/// create a new config file
#[tauri::command]
pub async fn create_config(
    output_path: String,
    data_dir: String,
    server_name: Option<String>,
    server_id: Option<String>,
    server_port: Option<u16>,
    image_path: Option<String>,
) -> ConfigCreateResult {
    let output = PathBuf::from(&output_path);
    let data = PathBuf::from(&data_dir);

    // create data directory if it doesn't exist
    if let Err(e) = std::fs::create_dir_all(&data) {
        return ConfigCreateResult {
            success: false,
            path: output_path,
            error: Some(format!("failed to create data directory: {}", e)),
        };
    }

    // check if yt-dlp is available
    let ytdlp_available = which::which("yt-dlp").is_ok();

    match grimoire::config::create_config_full(
        Some(output.clone()),
        Some(data),
        false,
        server_name,
        server_id,
        server_port,
        image_path,
        ytdlp_available,
    ) {
        Ok(path) => ConfigCreateResult {
            success: true,
            path: path.display().to_string(),
            error: None,
        },
        Err(e) => ConfigCreateResult {
            success: false,
            path: output_path,
            error: Some(e.to_string()),
        },
    }
}

/// generate default wordlist content using grimoire's wordlist service
fn generate_default_wordlist_content() -> String {
    let service = grimoire::wordlist::WordlistService::new();
    let config = grimoire::wordlist::WordlistConfig::default();
    match service.generate_wordlist(&config) {
        Ok(result) => result.words.join("\n") + "\n",
        Err(_) => panic!("failed to generate default wordlist"),
    }
}

/// initialize config and database from an existing config file
#[tauri::command]
pub async fn init_from_config(config_path: String) -> Result<(), String> {
    let path = PathBuf::from(&config_path);

    // only init config if not already initialized
    if !grimoire::is_config_initialized() {
        grimoire::config::init_config(Some(path)).map_err(|e| e.to_string())?;
    }

    let config = grimoire::config::get_config();

    // create wordlist file if it doesn't exist
    let wordlist_path = config.wordlist_path();
    if !wordlist_path.exists() {
        std::fs::write(&wordlist_path, generate_default_wordlist_content())
            .map_err(|e| format!("failed to create wordlist file: {}", e))?;
    }

    // create database file if it doesn't exist (for fresh installs)
    let db_path = config.database_path();
    if !db_path.exists() {
        std::fs::File::create(&db_path)
            .map_err(|e| format!("failed to create database file: {}", e))?;
    }

    // initialize database connection (does NOT run migrations since auto_run_migrations is false)
    grimoire::database::initialize()
        .await
        .map_err(|e| e.to_string())?;

    // explicitly run migrations during setup wizard
    grimoire::database::run_migrations()
        .await
        .map_err(|e| format!("failed to run migrations: {}", e))?;

    // initialize the wordlist after database is ready
    let wordlist_config = grimoire::wordlist::ManagementWordlistConfig {
        file_path: wordlist_path.to_string_lossy().to_string(),
        ..Default::default()
    };
    let _ = grimoire::wordlist::initialize_wordlist(&wordlist_config);

    Ok(())
}

/// create a root user with an API key
#[tauri::command]
pub async fn create_root_user(username: String) -> UserCreateResult {
    let service = grimoire::users::UserService::new();

    // create the user
    let create_request = grimoire::users::CreateUserRequest {
        username: username.clone(),
        role: Some(grimoire::users::UserRole::Root),
        invite_code: None,
    };

    let user_response = service.register_user(&create_request).await;

    if !user_response.is_success() {
        return UserCreateResult {
            success: false,
            user_id: None,
            username: None,
            api_key: None,
            error: Some(
                user_response
                    .errors
                    .first()
                    .map(|e| e.detail.clone())
                    .unwrap_or_else(|| "unknown error".to_string()),
            ),
        };
    }

    let user = match user_response.data {
        Some(u) => u,
        None => {
            return UserCreateResult {
                success: false,
                user_id: None,
                username: None,
                api_key: None,
                error: Some("no user data returned".to_string()),
            }
        }
    };

    // generate API key
    let api_key_response = service.generate_api_key(&user.id).await;

    if !api_key_response.is_success() {
        return UserCreateResult {
            success: true,
            user_id: Some(user.id),
            username: Some(user.username),
            api_key: None,
            error: Some("user created but failed to generate API key".to_string()),
        };
    }

    let api_key = api_key_response.data.and_then(|u| u.api_key);

    UserCreateResult {
        success: true,
        user_id: Some(user.id),
        username: Some(user.username),
        api_key,
        error: None,
    }
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
        .map(|p| p.join("config.jsonc").display().to_string())
}

/// get the data directory from loaded config
#[tauri::command]
pub fn get_data_dir(app_handle: tauri::AppHandle) -> Option<String> {
    let config_path = app_handle.path().app_data_dir().ok()?.join("config.jsonc");

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

/// user info for listing
#[derive(Debug, Serialize)]
pub struct UserInfo {
    pub id: String,
    pub username: String,
    pub role: String,
    pub has_api_key: bool,
    pub created_at: i64,
}

/// create a fake root user for authorization (admin app has full access)
fn admin_user() -> grimoire::users::User {
    grimoire::users::User {
        id: "freqroot".to_string(),
        username: "freqroot".to_string(),
        role: grimoire::users::UserRole::Root,
        api_key: None,
        created_at: 0,
        updated_at: 0,
        deleted_at: None,
    }
}

/// list all users
#[tauri::command]
pub async fn list_users(app_handle: tauri::AppHandle) -> Result<Vec<UserInfo>, String> {
    ensure_initialized(&app_handle).await?;
    let service = grimoire::users::UserService::new();

    let result = service
        .list_users(
            &grimoire::users::UserQueryParams {
                include_deleted: Some(false),
                ..Default::default()
            },
            &admin_user(),
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

    let user_role = match role.to_lowercase().as_str() {
        "root" => grimoire::users::UserRole::Root,
        "admin" => grimoire::users::UserRole::Admin,
        "viewer" => grimoire::users::UserRole::Viewer,
        _ => grimoire::users::UserRole::Member,
    };

    let update_request = grimoire::users::UpdateUserRequest {
        role: Some(user_role),
    };

    let result = service
        .update_user(&user_id, &update_request, &admin_user())
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
    let result = service.delete_user(&user_id, &admin_user()).await;

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

    let result = service.list_invite_codes(active_only, &admin_user()).await;

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
                        &admin_user(),
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
) -> Result<Vec<String>, String> {
    // ensure config and database are initialized
    ensure_initialized(&app_handle).await?;

    // ensure wordlist is initialized (needed for generating word-based codes)
    if !grimoire::wordlist::is_initialized() {
        // get wordlist path from config
        let wordlist_path = grimoire::config::get_config().wordlist_path();

        // check if wordlist file exists, create with defaults if not
        if !wordlist_path.exists() {
            std::fs::write(&wordlist_path, generate_default_wordlist_content())
                .map_err(|e| format!("failed to create wordlist file: {}", e))?;
        }

        let config = grimoire::wordlist::ManagementWordlistConfig {
            file_path: wordlist_path.to_string_lossy().to_string(),
            ..Default::default()
        };
        let init_result = grimoire::wordlist::initialize_wordlist(&config);
        if !init_result.is_success() {
            return Err(format!(
                "wordlist initialization failed: {}",
                init_result.message
            ));
        }
    }

    let service = grimoire::users::UserService::new();

    let request = grimoire::users::CreateInviteCodeRequest {
        code_type: None,
        link_for_user_id: None,
        expires_hours: None,
    };

    let result = service
        .generate_invite_codes(&request, count, 3, &admin_user())
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
    let result = service.deactivate_invite_code(&code, &admin_user()).await;

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
