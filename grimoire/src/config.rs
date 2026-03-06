//! Configuration module for grimoire
//!
//! Provides configuration loading, validation, and global storage.
//! Config files use TOML format (supports comments).

use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use thiserror::Error;
use toml_edit::{value, Array, DocumentMut};

// Global config - initialized once at startup
static CONFIG: OnceCell<GrimoireConfig> = OnceCell::new();

/// Main grimoire configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrimoireConfig {
    /// Data directory - base directory for all data
    pub data_dir: PathBuf,
    /// Database configuration
    pub database: DatabaseConfig,
    /// Media processing and categorization
    pub media: MediaConfig,
    /// MusicBrainz integration
    pub musicbrainz: MusicBrainzConfig,
    /// Logging configuration
    pub logging: LoggingConfig,
    /// Server configuration (optional - only needed for server mode)
    #[serde(default)]
    pub server: Option<ServerConfig>,
    /// Federation/P2P configuration (optional - for peer-to-peer music sharing)
    #[serde(default)]
    pub federation: Option<FederationConfig>,
}

/// Database configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseConfig {
    /// SQLite database filename (stored in data_dir)
    pub filename: String,
    /// Automatically run migrations on startup
    pub auto_run_migrations: bool,
    /// Maximum number of connections in the pool (default: 5)
    #[serde(default = "default_max_connections")]
    pub max_connections: u32,
    /// Timeout in seconds when acquiring a connection from the pool (default: 120)
    /// increase this on slower hardware (e.g. Raspberry Pi) to avoid pool timeout errors
    #[serde(default = "default_acquire_timeout_seconds")]
    pub acquire_timeout_seconds: u64,
    /// Idle timeout in seconds before closing unused connections (default: 300)
    #[serde(default = "default_idle_timeout_seconds")]
    pub idle_timeout_seconds: u64,
}

/// Media processing configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaConfig {
    /// Maximum file size for filesystem storage (bytes)
    #[serde(default = "default_max_fs_file_size")]
    pub max_fs_file_size: u64,
    /// Supported audio file formats
    #[serde(default = "default_supported_audio_formats")]
    pub supported_audio_formats: Vec<String>,
    /// Path to ffmpeg binary
    #[serde(default = "default_ffmpeg_path")]
    pub ffmpeg_path: String,
    /// Path to ffprobe binary (optional, used as fallback for duration extraction
    /// when lofty can't determine duration). if not set, the fallback is skipped.
    #[serde(default)]
    pub ffprobe_path: Option<String>,
    /// Args for extracting duration via ffprobe (placeholder: {input})
    /// output must be a single line with duration in seconds (float).
    #[serde(default = "default_ffprobe_duration_args")]
    pub ffprobe_duration_args: String,
    /// Args for extracting file properties via ffprobe (placeholder: {input})
    /// output must be JSON with format and streams sections.
    #[serde(default = "default_ffprobe_properties_args")]
    pub ffprobe_properties_args: String,
    /// Args for extracting album art (placeholders: {input}, {output})
    #[serde(default = "default_extract_album_art_args")]
    pub extract_album_art_args: String,
    /// Args for generating waveform (placeholders: {input}, {output})
    #[serde(default = "default_generate_waveform_args")]
    pub generate_waveform_args: String,
    /// Skip importing duplicate songs during scan
    #[serde(default = "default_skip_duplicates")]
    pub skip_duplicates: bool,
    /// Generate CSV report of skipped duplicates during scan
    #[serde(default = "default_generate_scan_duplicate_report")]
    pub generate_scan_duplicate_report: bool,
}

fn default_max_connections() -> u32 {
    5
}

fn default_acquire_timeout_seconds() -> u64 {
    120
}

fn default_idle_timeout_seconds() -> u64 {
    300
}

fn default_ffmpeg_path() -> String {
    "ffmpeg".to_string()
}

fn default_ffprobe_duration_args() -> String {
    "-v quiet -show_entries format=duration -of csv=p=0 {input}".to_string()
}

fn default_ffprobe_properties_args() -> String {
    "-v quiet -print_format json -show_format -show_streams {input}".to_string()
}

fn default_extract_album_art_args() -> String {
    "-i {input} -an -vcodec mjpeg -vframes 1 -q:v 2 -y {output}".to_string()
}

fn default_generate_waveform_args() -> String {
    "-i {input} -filter_complex \"color=black:s=800x200[bg];[0:a]showwavespic=s=800x200:colors=0xff00ff[fg];[bg][fg]overlay=format=auto\" -frames:v 1 -y {output}"
        .to_string()
}

fn default_skip_duplicates() -> bool {
    true
}

fn default_generate_scan_duplicate_report() -> bool {
    false
}

fn default_max_fs_file_size() -> u64 {
    1073741824 // 1GB
}

fn default_supported_audio_formats() -> Vec<String> {
    vec![
        "mp3".to_string(),
        "ogg".to_string(),
        "wav".to_string(),
        "flac".to_string(),
        "m4a".to_string(),
        "aif".to_string(),
        "aiff".to_string(),
    ]
}

/// MusicBrainz integration configuration
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MusicBrainzConfig {
    /// Enable MusicBrainz API integration (default: false)
    #[serde(default)]
    pub enabled: bool,
}

/// Federation/P2P configuration for peer-to-peer music sharing
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FederationConfig {
    /// Enable federation features (default: false)
    #[serde(default)]
    pub enabled: bool,
    /// Haruspex (Supabase) URL for peer coordination
    /// e.g., "http://127.0.0.1:54321" for local dev or "https://xxx.supabase.co"
    #[serde(default)]
    pub haruspex_url: String,
    /// Haruspex (Supabase) anon/publishable key (NOT the service role key!)
    #[serde(default)]
    pub haruspex_anon_key: String,
    /// Automatically create freqhole users for authenticated peers on first request
    /// When true: P2P request from known node_id creates user with default_role
    /// When false: users must be synced manually via CLI or admin UI
    #[serde(default)]
    pub auto_create_users: bool,
    /// Role to assign auto-created users: "visitor", "member", etc.
    #[serde(default = "default_federation_role")]
    pub default_role: String,
    /// Maximum message size in MB for P2P requests (default: 10)
    /// This does not apply to blob streaming, only JSON message payloads.
    #[serde(default = "default_max_message_size_mb")]
    pub max_message_size_mb: u32,
}

fn default_federation_role() -> String {
    "visitor".to_string()
}

fn default_max_message_size_mb() -> u32 {
    10
}

impl FederationConfig {
    /// Get the max message size in bytes
    pub fn max_message_size_bytes(&self) -> usize {
        (self.max_message_size_mb as usize) * 1024 * 1024
    }
}

/// Logging configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingConfig {
    /// Log level: trace, debug, info, warn, error
    pub level: String,
}

/// Server configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    /// Unique identifier for this server instance (stable across restarts)
    pub id: String,
    /// Server display name
    pub name: String,
    /// Server version (semantic versioning recommended)
    pub version: String,
    /// Optional server description
    pub description: Option<String>,
    /// Server host to bind to
    pub host: String,
    /// Server port to bind to
    pub port: u16,
    /// Authentication configuration
    pub auth: AuthConfig,
    /// Static file serving configuration
    pub static_files: StaticFilesConfig,
    /// CORS configuration
    pub cors: CorsConfig,
    /// Fetch music configuration
    #[serde(default)]
    pub fetch_music: Option<FetchMusicConfig>,
    /// Start job processor in server (default: false)
    /// When enabled, server spawns a background task to process jobs
    /// When disabled, jobs must be processed via CLI (freqhole jobs run-processor)
    #[serde(default)]
    pub start_job_runner: bool,
    /// Optional path to server image (served publicly for remote identification)
    /// Path is relative to data_dir unless absolute
    pub image_path: Option<PathBuf>,
}

/// Authentication configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthConfig {
    /// Enable WebAuthn passkey authentication (requires binary built with webauthn feature)
    #[serde(default)]
    pub webauthn_enabled: bool,
    /// Session max age in seconds (0 or negative = never expire)
    #[serde(default)]
    pub session_max_age_seconds: i64,
    /// Session cookie mode: "auto", "lax", or "none" (default: "auto")
    /// - auto: dual cookies for maximum compatibility (HTTP same-site + HTTPS cross-site)
    /// - lax: single cookie with SameSite=Lax (same-site only)
    /// - none: single cookie with SameSite=None + Secure (HTTPS cross-site only)
    #[serde(default = "default_session_cookie_mode")]
    pub session_cookie_mode: String,
    /// Allowed origins for CORS and WebAuthn
    /// Use "any" to allow any origin (reflects request origin, does not use *)
    /// If not specified, only same-origin requests work
    #[serde(default)]
    pub allowed_origins: Vec<String>,
}

fn default_session_cookie_mode() -> String {
    "auto".to_string()
}

/// Session cookie mode for browser authentication
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionCookieMode {
    /// Dual cookies: SameSite=Lax for HTTP + SameSite=None+Secure for HTTPS
    Auto,
    /// Single cookie with SameSite=Lax
    Lax,
    /// Single cookie with SameSite=None + Secure=true
    None,
}

impl SessionCookieMode {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "auto" => Some(Self::Auto),
            "lax" => Some(Self::Lax),
            "none" => Some(Self::None),
            _ => Option::None,
        }
    }
}

impl AuthConfig {
    /// Check if an origin is allowed
    /// Returns true if:
    /// - allowed_origins contains "any"
    /// - allowed_origins contains the exact origin
    pub fn is_origin_allowed(&self, origin: &str) -> bool {
        self.allowed_origins
            .iter()
            .any(|o| o == "any" || o == origin)
    }

    /// Check if "any" origin is configured
    pub fn allows_any_origin(&self) -> bool {
        self.allowed_origins.iter().any(|o| o == "any")
    }
}

/// Extract rp_id (hostname) from an origin URL
/// e.g., "http://localhost:1420" -> "localhost"
/// e.g., "https://music.freqhole.net" -> "music.freqhole.net"
pub fn extract_rp_id(origin: &str) -> Option<String> {
    url::Url::parse(origin)
        .ok()
        .and_then(|u| u.host_str().map(|s| s.to_string()))
}

/// Static file serving configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StaticFilesConfig {
    /// Enable static file serving
    pub enabled: bool,
    /// Directory to serve static files from (relative to data_dir or absolute)
    pub directory: Option<PathBuf>,
}

/// CORS configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorsConfig {
    /// Enable CORS headers
    /// If enabled with no auth.allowed_origins, only same-origin requests work
    pub enabled: bool,
}

/// Fetch music configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchMusicConfig {
    /// Enable media fetching functionality
    pub enabled: bool,
    /// Absolute path where fetched files are temporarily stored
    pub output_dir: Option<String>,
    /// Command to extract metadata without downloading (for precheck/deduplication)
    pub precheck_command: Option<String>,
    /// Command to actually fetch media files
    pub fetch_command: Option<String>,
}

impl ServerConfig {
    /// Get all allowed origins
    pub fn get_allowed_origins(&self) -> &[String] {
        &self.auth.allowed_origins
    }

    /// Check if an origin is allowed (delegates to AuthConfig)
    pub fn is_origin_allowed(&self, origin: &str) -> bool {
        self.auth.is_origin_allowed(origin)
    }
}

impl GrimoireConfig {
    /// Load config from file
    pub fn load<P: AsRef<Path>>(path: P) -> Result<Self, ConfigError> {
        let path_ref = path.as_ref();
        let content = std::fs::read_to_string(path_ref).map_err(|e| ConfigError::FileNotFound {
            path: path_ref.display().to_string(),
            error: e.to_string(),
        })?;

        let config: GrimoireConfig =
            toml::from_str(&content).map_err(|e| ConfigError::ParseError(e.to_string()))?;

        config.validate()?;
        Ok(config)
    }

    /// Validate configuration
    fn validate(&self) -> Result<(), ConfigError> {
        // Validate logging level
        let valid_levels = ["trace", "debug", "info", "warn", "error"];
        if !valid_levels.contains(&self.logging.level.as_str()) {
            return Err(ConfigError::InvalidValue(format!(
                "Invalid log level: '{}'. Must be one of: {}",
                self.logging.level,
                valid_levels.join(", ")
            )));
        }

        // Validate database filename is not empty
        if self.database.filename.is_empty() {
            return Err(ConfigError::InvalidValue(
                "database.filename cannot be empty".to_string(),
            ));
        }

        // Validate server config if present
        if let Some(server) = &self.server {
            // Validate static_files.directory is absolute when enabled
            if server.static_files.enabled {
                if let Some(ref dir) = server.static_files.directory {
                    if !dir.is_absolute() {
                        return Err(ConfigError::InvalidValue(format!(
                            "server.static_files.directory must be an absolute path when enabled, got: {}",
                            dir.display()
                        )));
                    }
                    if !dir.exists() {
                        return Err(ConfigError::InvalidValue(format!(
                            "server.static_files.directory does not exist: {}",
                            dir.display()
                        )));
                    }
                    if !dir.is_dir() {
                        return Err(ConfigError::InvalidValue(format!(
                            "server.static_files.directory is not a directory: {}",
                            dir.display()
                        )));
                    }
                } else {
                    return Err(ConfigError::InvalidValue(
                        "server.static_files.directory must be set when static_files.enabled is true".to_string(),
                    ));
                }
            }

            // Validate fetch_music.output_dir is absolute when enabled
            if let Some(ref fetch) = server.fetch_music {
                if fetch.enabled {
                    if let Some(ref output_dir) = fetch.output_dir {
                        let path = Path::new(output_dir);
                        if !path.is_absolute() {
                            return Err(ConfigError::InvalidValue(format!(
                                "server.fetch_music.output_dir must be an absolute path when enabled, got: {}",
                                output_dir
                            )));
                        }
                    }
                }
            }

            // Validate session_cookie_mode
            if SessionCookieMode::from_str(&server.auth.session_cookie_mode).is_none() {
                return Err(ConfigError::InvalidValue(format!(
                    "server.auth.session_cookie_mode must be 'auto', 'lax', or 'none', got: '{}'",
                    server.auth.session_cookie_mode
                )));
            }
        }

        Ok(())
    }

    /// Get path to SQLite database file
    pub fn database_path(&self) -> PathBuf {
        self.data_dir.join(&self.database.filename)
    }

    /// Get path to blob data SQLite database file
    /// derives from main database filename: grimoire.db → grimoire-blobdata.db
    pub fn blob_data_path(&self) -> PathBuf {
        let stem = std::path::Path::new(&self.database.filename)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("grimoire");
        let ext = std::path::Path::new(&self.database.filename)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("db");
        self.data_dir.join(format!("{}-blobdata.{}", stem, ext))
    }

    /// Get path to temp directory
    pub fn temp_dir(&self) -> PathBuf {
        self.data_dir.join("tmp")
    }

    /// Get path to wordlist file
    pub fn wordlist_path(&self) -> PathBuf {
        self.data_dir.join("wordlist.txt")
    }

    /// Get path to federation credentials file
    pub fn federation_credentials_path(&self) -> PathBuf {
        self.data_dir.join("federation-creds.toml")
    }
}

/// Initialize global config from file path (call once at app startup)
pub fn init_config(path: Option<PathBuf>) -> Result<(), ConfigError> {
    let config_path = find_config(path)?;
    let config = GrimoireConfig::load(config_path)?;
    CONFIG
        .set(config)
        .map_err(|_| ConfigError::AlreadyInitialized)?;
    Ok(())
}

/// Check if config has been initialized
pub fn is_config_initialized() -> bool {
    CONFIG.get().is_some()
}

/// Get global config reference (available after init_config)
pub fn get_config() -> &'static GrimoireConfig {
    CONFIG
        .get()
        .expect("Config not initialized - call init_config first")
}

/// try to find a config file
///
/// search order:
/// 1. explicit path if provided (e.g. from --config flag)
/// 2. ./freqhole-config.toml (current directory)
pub fn find_config(explicit_path: Option<PathBuf>) -> Result<PathBuf, ConfigError> {
    // 1. explicit path (e.g. from --config flag)
    if let Some(path) = explicit_path {
        if path.exists() {
            return Ok(path);
        }
        return Err(ConfigError::FileNotFound {
            path: path.display().to_string(),
            error: "specified config file does not exist".to_string(),
        });
    }

    // 2. ./freqhole-config.toml in current directory
    let local = PathBuf::from("freqhole-config.toml");
    if local.exists() {
        return Ok(local);
    }

    Err(ConfigError::NotFound)
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("Config file not found: {path}\nError: {error}")]
    FileNotFound { path: String, error: String },

    #[error("Failed to parse config: {0}")]
    ParseError(String),

    #[error("Invalid config value: {0}")]
    InvalidValue(String),

    #[error("Config already initialized")]
    AlreadyInitialized,

    #[error("Config file already exists: {0}")]
    FileExists(String),

    #[error("Failed to create config: {0}")]
    CreateFailed(String),

    #[error(
        "no config file found. searched:\n  \
         - ./freqhole-config.toml\n\n\
         try running: config init"
    )]
    NotFound,
}

/// create a new config file with default values
///
/// # arguments
/// * `output_path` - Where to write the config file (default: ./freqhole-config.toml)
/// * `data_dir` - Data directory to use in config (default: ./data)
/// * `force` - Overwrite existing file if it exists
///
/// # returns
/// the path where the config was written
pub fn create_config(
    output_path: Option<PathBuf>,
    data_dir: Option<PathBuf>,
    force: bool,
) -> Result<PathBuf, ConfigError> {
    create_config_with_server_info(output_path, data_dir, force, None, None, None)
}

/// Create a config file with custom server info
///
/// # Arguments
/// * `output_path` - Where to write the config
/// * `data_dir` - Data directory path
/// * `force` - Overwrite existing file
/// * `server_name` - Human-readable server name
/// * `server_id` - Server identifier (lowercase, alphanumeric + hyphens)
/// * `server_port` - Server listen port
pub fn create_config_with_server_info(
    output_path: Option<PathBuf>,
    data_dir: Option<PathBuf>,
    force: bool,
    server_name: Option<String>,
    server_id: Option<String>,
    server_port: Option<u16>,
) -> Result<PathBuf, ConfigError> {
    create_config_full(
        output_path,
        data_dir,
        force,
        server_name,
        server_id,
        server_port,
        None,  // image_path
        false, // ytdlp_available
        None,  // fetch_music_dir
        None,  // allowed_origins
    )
}

/// Create a config file with full customization options
///
/// # Arguments
/// * `output_path` - Where to write the config
/// * `data_dir` - Data directory path
/// * `force` - Overwrite existing file
/// * `server_name` - Human-readable server name
/// * `server_id` - Server identifier (lowercase, alphanumeric + hyphens)
/// * `server_port` - Server listen port
/// * `image_path` - Optional path to server icon image
/// * `ytdlp_available` - Whether yt-dlp is available for downloads
/// * `fetch_music_dir` - Optional custom directory for fetched/uploaded music (defaults to data_dir/fetch)
/// * `allowed_origins` - Optional list of allowed origins for CORS/WebAuthn (None = derive from port, vec!["any"] = allow any)
pub fn create_config_full(
    output_path: Option<PathBuf>,
    data_dir: Option<PathBuf>,
    force: bool,
    server_name: Option<String>,
    server_id: Option<String>,
    server_port: Option<u16>,
    image_path: Option<String>,
    ytdlp_available: bool,
    fetch_music_dir: Option<PathBuf>,
    allowed_origins: Option<Vec<String>>,
) -> Result<PathBuf, ConfigError> {
    let path = output_path.unwrap_or_else(|| PathBuf::from("freqhole-config.toml"));
    let data = data_dir.unwrap_or_else(|| PathBuf::from("./data"));
    let port = server_port.unwrap_or(8081);

    // check if file exists
    if path.exists() && !force {
        return Err(ConfigError::FileExists(path.display().to_string()));
    }

    // create parent directories if needed
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| {
                ConfigError::CreateFailed(format!("failed to create directory: {}", e))
            })?;
        }
    }

    // create fetch directory for downloads
    let fetch_dir = fetch_music_dir.unwrap_or_else(|| data.join("fetch"));
    std::fs::create_dir_all(&fetch_dir).map_err(|e| {
        ConfigError::CreateFailed(format!("failed to create fetch directory: {}", e))
    })?;

    // generate config content
    let config_content = generate_config_template(
        &data,
        server_name.as_deref().unwrap_or("freqhole"),
        server_id.as_deref().unwrap_or("freqhole-local"),
        port,
        image_path.as_deref(),
        ytdlp_available,
        &fetch_dir,
        allowed_origins.as_deref(),
    );

    // write file
    std::fs::write(&path, config_content)
        .map_err(|e| ConfigError::CreateFailed(format!("failed to write config: {}", e)))?;

    Ok(path)
}

/// embedded config template (from assets/config/freqhole-config.toml)
/// this is the base template with all comments preserved
const CONFIG_TEMPLATE: &str = include_str!("../../assets/config/freqhole-config.toml");

/// Generate config file content with given parameters
/// uses toml_edit to modify the template while preserving comments
fn generate_config_template(
    data_dir: &Path,
    server_name: &str,
    server_id: &str,
    server_port: u16,
    image_path: Option<&str>,
    ytdlp_available: bool,
    fetch_dir: &Path,
    allowed_origins: Option<&[String]>,
) -> String {
    let mut doc = CONFIG_TEMPLATE
        .parse::<DocumentMut>()
        .expect("embedded config template should be valid TOML");

    // update data_dir
    doc["data_dir"] = value(data_dir.display().to_string());

    // update database settings for generated configs (auto_run_migrations = false for setup wizard)
    doc["database"]["auto_run_migrations"] = value(false);

    // update server section
    doc["server"]["id"] = value(server_id);
    doc["server"]["name"] = value(server_name);
    doc["server"]["version"] = value(env!("CARGO_PKG_VERSION"));
    doc["server"]["port"] = value(server_port as i64);

    // set or remove image_path
    if let Some(path) = image_path {
        doc["server"]["image_path"] = value(path);
    } else {
        // remove the key if no image path provided (template has a commented example)
        doc["server"].as_table_mut().map(|t| t.remove("image_path"));
    }

    // update allowed_origins for both CORS and WebAuthn
    let mut origins = Array::new();
    if let Some(custom_origins) = allowed_origins {
        // use provided origins
        for origin in custom_origins {
            origins.push(origin.clone());
        }
    } else {
        // default: server port + localhost:1420 (tauri dev)
        origins.push(format!("http://localhost:{}", server_port));
        origins.push("http://localhost:1420".to_string());
    }
    if let Some(auth) = doc["server"]["auth"].as_table_mut() {
        auth["allowed_origins"] = value(origins);
    }

    // update fetch_music
    doc["server"]["fetch_music"]["enabled"] = value(ytdlp_available);
    doc["server"]["fetch_music"]["output_dir"] = value(fetch_dir.display().to_string());

    // remove cors.allowed_origins since it's now in auth.allowed_origins
    if let Some(cors) = doc["server"]["cors"].as_table_mut() {
        cors.remove("allowed_origins");
    }

    doc.to_string()
}

/// update an existing config file to enable static file serving
///
/// modifies the config file in-place to set:
/// - server.static_files.enabled = true
/// - server.static_files.directory = <directory>
pub fn update_static_files_config(
    config_path: &Path,
    static_dir: &Path,
) -> Result<(), ConfigError> {
    // read existing config
    let content = std::fs::read_to_string(config_path).map_err(|e| ConfigError::FileNotFound {
        path: config_path.display().to_string(),
        error: e.to_string(),
    })?;

    // parse as toml document
    let mut doc = content
        .parse::<DocumentMut>()
        .map_err(|e| ConfigError::ParseError(format!("failed to parse config: {}", e)))?;

    // ensure server.static_files table exists
    if doc.get("server").is_none() {
        return Err(ConfigError::ParseError(
            "config missing [server] section".to_string(),
        ));
    }

    // update static_files section
    if let Some(server) = doc["server"].as_table_mut() {
        // create static_files table if it doesn't exist
        if !server.contains_key("static_files") {
            server.insert(
                "static_files",
                toml_edit::Item::Table(toml_edit::Table::new()),
            );
        }

        if let Some(static_files) = server["static_files"].as_table_mut() {
            static_files.insert("enabled", value(true));
            static_files.insert("directory", value(static_dir.display().to_string()));
        }
    }

    // write back
    std::fs::write(config_path, doc.to_string())
        .map_err(|e| ConfigError::CreateFailed(format!("failed to write config: {}", e)))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_helper_methods() {
        let config = GrimoireConfig {
            data_dir: PathBuf::from("/data"),
            database: DatabaseConfig {
                filename: "test.db".to_string(),
                auto_run_migrations: true,
                max_connections: default_max_connections(),
                acquire_timeout_seconds: default_acquire_timeout_seconds(),
                idle_timeout_seconds: default_idle_timeout_seconds(),
            },
            media: MediaConfig {
                max_fs_file_size: 1000,
                supported_audio_formats: vec!["mp3".to_string()],
                ffmpeg_path: "ffmpeg".to_string(),
                ffprobe_path: None,
                ffprobe_duration_args: default_ffprobe_duration_args(),
                ffprobe_properties_args: default_ffprobe_properties_args(),
                extract_album_art_args: "--whatever".to_string(),
                generate_waveform_args: "--whatever".to_string(),
                generate_scan_duplicate_report: false,
                skip_duplicates: true,
            },
            musicbrainz: MusicBrainzConfig { enabled: false },
            logging: LoggingConfig {
                level: "info".to_string(),
            },
            server: None,
            federation: None,
        };

        assert_eq!(config.database_path(), PathBuf::from("/data/test.db"));
        assert_eq!(config.temp_dir(), PathBuf::from("/data/tmp"));
        assert_eq!(config.wordlist_path(), PathBuf::from("/data/wordlist.txt"));
    }

    #[test]
    fn test_config_validation_invalid_log_level() {
        let config = GrimoireConfig {
            data_dir: PathBuf::from("/data"),
            database: DatabaseConfig {
                filename: "test.db".to_string(),
                auto_run_migrations: true,
                max_connections: default_max_connections(),
                acquire_timeout_seconds: default_acquire_timeout_seconds(),
                idle_timeout_seconds: default_idle_timeout_seconds(),
            },
            media: MediaConfig {
                max_fs_file_size: 1000,
                supported_audio_formats: vec![],
                ffmpeg_path: "ffmpeg".to_string(),
                ffprobe_path: None,
                ffprobe_duration_args: default_ffprobe_duration_args(),
                ffprobe_properties_args: default_ffprobe_properties_args(),
                extract_album_art_args: "--whatever".to_string(),
                generate_waveform_args: "--whatever".to_string(),
                generate_scan_duplicate_report: false,
                skip_duplicates: true,
            },
            musicbrainz: MusicBrainzConfig { enabled: false },
            logging: LoggingConfig {
                level: "invalid".to_string(),
            },
            server: None,
            federation: None,
        };

        assert!(config.validate().is_err());
    }

    #[test]
    fn test_config_validation_empty_filename() {
        let config = GrimoireConfig {
            data_dir: PathBuf::from("/data"),
            database: DatabaseConfig {
                filename: "".to_string(),
                auto_run_migrations: true,
                max_connections: default_max_connections(),
                acquire_timeout_seconds: default_acquire_timeout_seconds(),
                idle_timeout_seconds: default_idle_timeout_seconds(),
            },
            media: MediaConfig {
                max_fs_file_size: 1000,
                supported_audio_formats: vec![],
                ffmpeg_path: "ffmpeg".to_string(),
                ffprobe_path: None,
                ffprobe_duration_args: default_ffprobe_duration_args(),
                ffprobe_properties_args: default_ffprobe_properties_args(),
                extract_album_art_args: "--whatever".to_string(),
                generate_waveform_args: "--whatever".to_string(),
                generate_scan_duplicate_report: false,
                skip_duplicates: true,
            },
            musicbrainz: MusicBrainzConfig { enabled: false },
            logging: LoggingConfig {
                level: "info".to_string(),
            },
            server: None,
            federation: None,
        };

        assert!(config.validate().is_err());
    }
}

/// Response for config validation (CLI output)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigValidationResponse {
    pub valid: bool,
    pub config_path: String,
    pub server_name: String,
    pub server_version: String,
    pub data_dir: String,
    pub database_path: String,
}
