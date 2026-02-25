//! setup service - centralizes all setup wizard steps
//!
//! used by both CLI and Tauri to perform the same setup operations.
//! all file operations are non-destructive - existing files are never overwritten.

use serde::Serialize;
use std::path::PathBuf;

use crate::config::{create_config_full, get_config, init_config, ConfigError};
use crate::database;
use crate::error::SetupStep;
use crate::users::{
    CreateInviteCodeRequest, CreateUserRequest, InviteCodeType, User, UserRole, UserService,
};
use crate::wordlist::{
    initialize_wordlist, ManagementWordlistConfig, WordlistConfig, WordlistService,
};
use crate::GrimoireError;

/// configuration for setup wizard
#[derive(Debug, Clone)]
pub struct SetupConfig {
    /// where to write the config file
    pub config_path: PathBuf,
    /// data directory (database, cache, media)
    pub data_dir: PathBuf,
    /// server display name
    pub server_name: String,
    /// server id (derived from name if not provided)
    pub server_id: Option<String>,
    /// server port
    pub server_port: u16,
    /// optional server icon image path
    pub image_path: Option<String>,
    /// root username to create
    pub username: String,
    /// generate API key for root user (optional, typically for Tauri)
    pub generate_api_key: bool,
    /// generate invite code (optional, typically for CLI)
    pub generate_invite_code: bool,
    /// whether yt-dlp is available (enables fetch download config)
    pub ytdlp_available: bool,
    /// initial directories to scan with optional tags
    pub initial_scan_dirs: Vec<ScanDir>,
}

/// a directory to scan with optional tags
#[derive(Debug, Clone, Serialize)]
pub struct ScanDir {
    pub path: String,
    pub tags: Vec<String>,
}

impl SetupConfig {
    /// derive server_id from server_name if not explicitly set
    pub fn server_id(&self) -> String {
        self.server_id.clone().unwrap_or_else(|| {
            self.server_name
                .to_lowercase()
                .chars()
                .filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-')
                .collect::<String>()
                .split_whitespace()
                .collect::<Vec<_>>()
                .join("-")
        })
    }
}

/// result of running setup
#[derive(Debug, Clone, Serialize)]
pub struct SetupResult {
    pub success: bool,
    pub config_path: String,
    pub data_dir: String,
    pub user_id: Option<String>,
    pub username: Option<String>,
    pub api_key: Option<String>,
    pub invite_code: Option<String>,
    pub scan_jobs_created: usize,
    pub errors: Vec<String>,
}

/// setup service handles the complete setup flow
pub struct SetupService;

impl SetupService {
    pub fn new() -> Self {
        Self
    }

    /// run the complete setup process
    ///
    /// this handles: directory setup, config creation, database init,
    /// wordlist init, root user creation, optional API key/invite code
    ///
    /// all operations are non-destructive - existing files are never overwritten
    pub async fn run_setup(&self, config: SetupConfig) -> SetupResult {
        let mut result = SetupResult {
            success: false,
            config_path: config.config_path.display().to_string(),
            data_dir: config.data_dir.display().to_string(),
            user_id: None,
            username: None,
            api_key: None,
            invite_code: None,
            scan_jobs_created: 0,
            errors: Vec::new(),
        };

        // step 1: ensure directories exist (non-destructive)
        if let Err(e) = self.ensure_directories(&config) {
            result
                .errors
                .push(format!("failed to create directories: {}", e));
            return result;
        }

        // step 2: create config file if it doesn't exist
        if let Err(e) = self.create_config_file_if_missing(&config) {
            result
                .errors
                .push(format!("failed to create config: {}", e));
            return result;
        }

        // step 3: initialize config and database
        if let Err(e) = self.initialize_database(&config).await {
            result
                .errors
                .push(format!("failed to initialize database: {}", e));
            return result;
        }

        // step 4: initialize wordlist (non-fatal if fails)
        if let Err(e) = self.initialize_wordlist() {
            result
                .errors
                .push(format!("wordlist initialization failed (non-fatal): {}", e));
        }

        // step 5: create root user
        match self.create_root_user(&config).await {
            Ok(root_user) => {
                result.user_id = Some(root_user.id.clone());
                result.username = Some(root_user.username.clone());

                // step 6: optionally generate API key
                if config.generate_api_key {
                    match self.generate_api_key(&root_user.id).await {
                        Ok(key) => result.api_key = Some(key),
                        Err(e) => result
                            .errors
                            .push(format!("failed to generate API key: {}", e)),
                    }
                }

                // step 7: optionally generate invite code
                if config.generate_invite_code {
                    match self.generate_invite_code(&root_user).await {
                        Ok(code) => result.invite_code = Some(code),
                        Err(e) => result
                            .errors
                            .push(format!("failed to generate invite code: {}", e)),
                    }
                }
            }
            Err(e) => {
                result
                    .errors
                    .push(format!("failed to create root user: {}", e));
                return result;
            }
        }

        // step 8: queue initial scan jobs
        if !config.initial_scan_dirs.is_empty() {
            match self.queue_initial_scans(&config).await {
                Ok(count) => result.scan_jobs_created = count,
                Err(e) => {
                    result
                        .errors
                        .push(format!("failed to queue scan jobs (non-fatal): {}", e));
                }
            }
        }

        result.success = true;
        result
    }

    /// step 1: ensure directories exist (non-destructive)
    ///
    /// only creates directories if they don't exist, never removes or overwrites
    fn ensure_directories(&self, config: &SetupConfig) -> Result<(), GrimoireError> {
        // create data directory if it doesn't exist
        if !config.data_dir.exists() {
            std::fs::create_dir_all(&config.data_dir)?;
        }

        // create fetch subdirectory for music downloads
        let fetch_dir = config.data_dir.join("fetch");
        if !fetch_dir.exists() {
            std::fs::create_dir_all(&fetch_dir)?;
        }

        // create media subdirectory for blob storage
        let media_dir = config.data_dir.join("media");
        if !media_dir.exists() {
            std::fs::create_dir_all(&media_dir)?;
        }

        Ok(())
    }

    /// step 2: create config file if it doesn't exist
    ///
    /// never overwrites an existing config file
    fn create_config_file_if_missing(&self, config: &SetupConfig) -> Result<PathBuf, ConfigError> {
        if config.config_path.exists() {
            // config already exists - don't overwrite
            return Ok(config.config_path.clone());
        }

        // convert empty image_path to None
        let image_path = config.image_path.clone().filter(|s| !s.is_empty());

        create_config_full(
            Some(config.config_path.clone()),
            Some(config.data_dir.clone()),
            false, // don't auto-run migrations, we do it explicitly
            Some(config.server_name.clone()),
            Some(config.server_id()),
            Some(config.server_port),
            image_path,
            config.ytdlp_available,
        )
    }

    /// step 3: initialize config and database
    ///
    /// creates wordlist and database files only if they don't exist
    async fn initialize_database(&self, config: &SetupConfig) -> Result<(), GrimoireError> {
        // initialize config if not already done
        if !crate::is_config_initialized() {
            init_config(Some(config.config_path.clone()))?;
        }

        let grimoire_config = get_config();

        // create wordlist file if it doesn't exist
        let wordlist_path = grimoire_config.wordlist_path();
        if !wordlist_path.exists() {
            let content = self.generate_default_wordlist_content()?;
            std::fs::write(&wordlist_path, content)?;
        }

        // create database file if it doesn't exist
        let db_path = grimoire_config.database_path();
        if !db_path.exists() {
            std::fs::File::create(&db_path)?;
        }

        // initialize database connection
        database::initialize().await?;

        // explicitly run migrations
        database::run_migrations().await?;

        Ok(())
    }

    /// generate default wordlist content
    fn generate_default_wordlist_content(&self) -> Result<String, GrimoireError> {
        let service = WordlistService::new();
        let wordlist_config = WordlistConfig::default();
        match service.generate_wordlist(&wordlist_config) {
            Ok(result) => Ok(result.words.join("\n") + "\n"),
            Err(e) => Err(GrimoireError::SetupFailed {
                step: SetupStep::Wordlist,
                message: format!("failed to generate wordlist: {}", e),
            }),
        }
    }

    /// step 4: initialize wordlist
    fn initialize_wordlist(&self) -> Result<(), GrimoireError> {
        let wordlist_config = ManagementWordlistConfig::default();
        let result = initialize_wordlist(&wordlist_config);
        if result.is_success() {
            Ok(())
        } else {
            Err(GrimoireError::SetupFailed {
                step: SetupStep::Wordlist,
                message: "wordlist initialization failed".to_string(),
            })
        }
    }

    /// step 5: create root user
    async fn create_root_user(&self, config: &SetupConfig) -> Result<User, GrimoireError> {
        let service = UserService::new();

        let request = CreateUserRequest {
            username: config.username.clone(),
            role: Some(UserRole::Root),
            invite_code: None,
        };

        let response = service.register_user(&request).await;

        match response.data {
            Some(user) => Ok(user),
            None => {
                let error = response
                    .errors
                    .first()
                    .map(|e| e.detail.clone())
                    .unwrap_or_else(|| "unknown error".to_string());
                Err(GrimoireError::SetupFailed {
                    step: SetupStep::User,
                    message: error,
                })
            }
        }
    }

    /// step 6: generate API key for user
    async fn generate_api_key(&self, user_id: &str) -> Result<String, GrimoireError> {
        let service = UserService::new();
        let response = service.generate_api_key(user_id).await;

        match response.data.and_then(|u| u.api_key) {
            Some(key) => Ok(key),
            None => Err(GrimoireError::SetupFailed {
                step: SetupStep::ApiKey,
                message: "failed to generate API key".to_string(),
            }),
        }
    }

    /// step 7: generate invite code (grants admin role for CLI setup)
    async fn generate_invite_code(&self, user: &User) -> Result<String, GrimoireError> {
        let service = UserService::new();

        let request = CreateInviteCodeRequest {
            code_type: Some(InviteCodeType::Invite),
            link_for_user_id: None,
            expires_hours: None,
            grants_role: Some(UserRole::Admin), // CLI setup generates admin invites
        };

        let response = service.generate_invite_codes(&request, 1, 3, user).await;

        match response.data.and_then(|codes| codes.into_iter().next()) {
            Some(code) => Ok(code.code),
            None => Err(GrimoireError::SetupFailed {
                step: SetupStep::InviteCode,
                message: "failed to generate invite code".to_string(),
            }),
        }
    }

    /// step 8: queue initial scan jobs for directories
    async fn queue_initial_scans(&self, config: &SetupConfig) -> Result<usize, GrimoireError> {
        use crate::jobs::add_directory_tags;
        use crate::music::scanner::scan_directory;

        let session_id = format!("setup-{}", time::OffsetDateTime::now_utc().unix_timestamp());
        let mut total_jobs = 0;

        for scan_dir in &config.initial_scan_dirs {
            // check directory exists before trying to scan
            let path = std::path::Path::new(&scan_dir.path);
            if !path.exists() {
                continue;
            }

            // set up directory tag rules if tags were specified
            if !scan_dir.tags.is_empty() {
                let _ = add_directory_tags(
                    &scan_dir.path,
                    scan_dir.tags.clone(),
                    Some("setup".to_string()),
                )
                .await;
            }

            // scan_directory creates import jobs for audio files found
            let response = scan_directory(
                &scan_dir.path,
                &session_id,
                true, // recursive
                None, // no max depth
                None, // default extensions
                true, // skip tracked subdirs for teh perf
            )
            .await;

            if let Some(count) = response.data {
                total_jobs += count;
            }
        }

        Ok(total_jobs)
    }
}

impl Default for SetupService {
    fn default() -> Self {
        Self::new()
    }
}
