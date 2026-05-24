//! Configuration module for grimoire
//!
//! Provides configuration loading, validation, and global storage.
//! Config files use TOML format (supports comments).

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{OnceLock, RwLock};
use thiserror::Error;
use toml_edit::{value, Array, DocumentMut};

// Global config - can be reloaded at runtime
static CONFIG: OnceLock<RwLock<GrimoireConfig>> = OnceLock::new();

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
    /// last.fm integration (optional)
    #[serde(default)]
    pub lastfm: LastFmConfig,
    /// theaudiodb integration (optional)
    #[serde(default)]
    pub audiodb: AudioDbConfig,
    /// Logging configuration
    pub logging: LoggingConfig,
    /// Server configuration (optional - only needed for server mode)
    #[serde(default)]
    pub server: Option<ServerConfig>,
    /// Federation/P2P configuration (optional - for peer-to-peer music sharing)
    #[serde(default)]
    pub federation: Option<FederationConfig>,
    /// Radio streaming configuration (optional - only when broadcasting).
    #[serde(default)]
    pub radio: Option<crate::radio::config::RadioConfig>,
    /// Client UI configuration (optional). knobs that only the
    /// frontend cares about (queue limits, etc.) — fetched by the
    /// charnel host via a tauri command on app boot.
    #[serde(default)]
    pub client: Option<ClientConfig>,

    /// Path this config was loaded from. Set by `init_config`; not
    /// (de)serialized. Used by admin handlers that need to write changes
    /// back to disk without re-running cwd-based config discovery.
    #[serde(default, skip)]
    pub loaded_from: Option<PathBuf>,
}

/// Database configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseConfig {
    /// SQLite database filename (stored in data_dir)
    pub filename: String,
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
    /// Thumbnail sizes to generate (in pixels, square thumbnails)
    /// thumbnails are always generated when images are created (scan/upload)
    #[serde(default = "default_thumbnail_sizes")]
    pub thumbnail_sizes: Vec<u32>,
    /// Enable on-demand thumbnail generation via /api/blobs/{id}/thumb/{size}
    /// when disabled (default), the endpoint returns 404 if thumbnail doesn't exist
    /// when enabled, thumbnails are generated lazily on first request
    #[serde(default)]
    pub thumbnail_on_demand_enabled: bool,
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

fn default_true() -> bool {
    true
}

fn default_generate_scan_duplicate_report() -> bool {
    false
}

fn default_thumbnail_sizes() -> Vec<u32> {
    vec![50, 200]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MusicBrainzConfig {
    /// Enable MusicBrainz API integration (default: false)
    #[serde(default)]
    pub enabled: bool,
    /// preferred country code for release tiebreaks. matched case-sensitively
    /// against MB `release.country`. "XW" (worldwide) always outranks any
    /// specific country, so this only affects the second-place tier.
    /// default: "US"
    #[serde(default = "default_mb_preferred_country")]
    pub preferred_country: String,
}

fn default_mb_preferred_country() -> String {
    "US".to_string()
}
impl Default for MusicBrainzConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            preferred_country: default_mb_preferred_country(),
        }
    }
}

/// last.fm web api integration. requires a free api key from
/// <https://www.last.fm/api/account/create>.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LastFmConfig {
    /// enable last.fm enrichment (default: false)
    #[serde(default)]
    pub enabled: bool,
    /// last.fm api key. write-style endpoints would also need a shared
    /// secret, but read-only enrichment only needs this.
    #[serde(default)]
    pub api_key: String,
}

/// theaudiodb integration. test key `123` is the public free key for low
/// volume non-commercial requests; donate at theaudiodb.com to get a real
/// key. `AUDIODB_API_KEY` env var overrides any value here.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDbConfig {
    /// enable theaudiodb enrichment (default: false)
    #[serde(default)]
    pub enabled: bool,
    /// api key (default: "123", the public free key)
    #[serde(default = "default_audiodb_api_key")]
    pub api_key: String,
}

impl Default for AudioDbConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            api_key: default_audiodb_api_key(),
        }
    }
}

fn default_audiodb_api_key() -> String {
    "123".to_string()
}

/// federation/p2p configuration for peer-to-peer music sharing
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FederationConfig {
    /// enable federation features (default: false)
    #[serde(default)]
    pub enabled: bool,
    /// haruspex (supabase) url for peer coordination
    /// e.g., "http://127.0.0.1:54321" for local dev or "https://xxx.supabase.co"
    #[serde(default)]
    pub haruspex_url: String,
    /// haruspex (supabase) anon/publishable key (not the service role key!)
    #[serde(default)]
    pub haruspex_anon_key: String,
    /// automatically create freqhole users for authenticated peers on first request
    /// when true: p2p request from known node_id creates user with default_role
    /// when false: users must be synced manually via cli or admin ui
    #[serde(default)]
    pub auto_create_users: bool,
    /// role to assign auto-created users: "visitor", "member", etc.
    #[serde(default = "default_federation_role")]
    pub default_role: String,
    /// maximum message size in mb for p2p requests (default: 10)
    /// this does not apply to blob streaming, only json message payloads.
    #[serde(default = "default_max_message_size_mb")]
    pub max_message_size_mb: u32,
    /// maximum upload size in mb for p2p file uploads (default: 500)
    /// larger files will be rejected with an error response.
    #[serde(default = "default_max_upload_size_mb")]
    pub max_upload_size_mb: u32,
    /// allow unknown peers to "knock" and request access (default: false)
    /// when true: unauthenticated p2p peers can send a knock request
    /// requests are stored and can be approved/rejected via cli or tauri wizard
    #[serde(default)]
    pub knocking_enabled: bool,
    /// optional: bind the iroh endpoint to a specific UDP port for port forwarding
    /// when set: iroh binds to this local UDP port instead of a random one
    /// useful for users without UPnP who manually forward a UDP port in their router
    /// the same port should be forwarded on the router (UDP, external:same -> internal:same)
    #[serde(default)]
    pub bind_port: Option<u16>,
    /// remote admin configuration (`freqhole-admin/1` ALPN).
    /// when absent or `enabled = false`, incoming admin connections are
    /// rejected. see docs/wizard-remote-admin.md.
    #[serde(default)]
    pub remote_admin: Option<RemoteAdminConfig>,
    /// remote player configuration (`freqhole-player/1` ALPN).
    /// when absent or `enabled = false`, incoming player-control
    /// connections are rejected. opt-in. see
    /// docs/rodio-into-freqhole-plan.md.
    #[serde(default)]
    pub remote_player: Option<RemotePlayerConfig>,
}

/// remote admin configuration for the `freqhole-admin/1` ALPN
///
/// opt-in. when `enabled = false` (default), the admin ALPN handler rejects
/// all incoming connections regardless of role. when `enabled = true`, the
/// connecting peer must (a) resolve to a User with `role == Admin` and
/// (b) appear in `allowed_node_ids` if that list is non-empty.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RemoteAdminConfig {
    /// main switch for the admin ALPN (default: false)
    #[serde(default)]
    pub enabled: bool,
    /// optional explicit allowlist of admin peer node IDs.
    /// empty list = allow any peer that resolves to an admin user.
    /// non-empty list = require both role==admin AND node_id membership.
    #[serde(default)]
    pub allowed_node_ids: Vec<String>,
    /// maximum admin message size in mb (default: 16)
    #[serde(default = "default_admin_max_message_size_mb")]
    pub max_message_size_mb: u32,
}

fn default_admin_max_message_size_mb() -> u32 {
    16
}

impl RemoteAdminConfig {
    /// max message size in bytes
    pub fn max_message_size_bytes(&self) -> usize {
        (self.max_message_size_mb as usize) * 1024 * 1024
    }

    /// is this peer node id allowed?
    /// returns true when the allowlist is empty (admin role check still
    /// applies elsewhere) or when the node id is explicitly listed.
    pub fn is_allowed_node(&self, node_id: &str) -> bool {
        self.allowed_node_ids.is_empty() || self.allowed_node_ids.iter().any(|n| n == node_id)
    }
}

/// remote player configuration for the `freqhole-player/1` ALPN.
///
/// opt-in. structure mirrors [`RemoteAdminConfig`] for symmetry: an
/// `enabled` switch, an optional explicit allowlist, and a frame size
/// cap. peer must resolve to a User with `role == Admin` to be
/// accepted; this protocol is intentionally admin-only because it
/// drives a process running real audio output on the host machine.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RemotePlayerConfig {
    /// main switch (default: false)
    #[serde(default)]
    pub enabled: bool,
    /// optional explicit allowlist of player peer node IDs.
    /// empty = any admin peer is allowed; non-empty = require both
    /// role==admin AND node_id membership.
    #[serde(default)]
    pub allowed_node_ids: Vec<String>,
    /// per-frame size cap, in mb (default: 1). much smaller than the
    /// admin cap because player frames are typed commands/events, not
    /// blob payloads.
    #[serde(default = "default_player_max_message_size_mb")]
    pub max_message_size_mb: u32,
}

fn default_player_max_message_size_mb() -> u32 {
    1
}

impl RemotePlayerConfig {
    /// max message size in bytes
    pub fn max_message_size_bytes(&self) -> usize {
        (self.max_message_size_mb as usize) * 1024 * 1024
    }

    /// is this peer node id allowed?
    pub fn is_allowed_node(&self, node_id: &str) -> bool {
        self.allowed_node_ids.is_empty() || self.allowed_node_ids.iter().any(|n| n == node_id)
    }
}

fn default_federation_role() -> String {
    "visitor".to_string()
}

fn default_max_message_size_mb() -> u32 {
    10
}

fn default_max_upload_size_mb() -> u32 {
    500
}

impl FederationConfig {
    /// Get the max message size in bytes
    pub fn max_message_size_bytes(&self) -> usize {
        (self.max_message_size_mb as usize) * 1024 * 1024
    }

    /// Get the max upload size in bytes
    pub fn max_upload_size_bytes(&self) -> usize {
        (self.max_upload_size_mb as usize) * 1024 * 1024
    }
}

/// Logging configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingConfig {
    /// Log level: trace, debug, info, warn, error
    pub level: String,
    /// Log file path (relative to data_dir or absolute)
    /// default: "freqhole.log"
    /// set to empty string "" to disable file logging
    #[serde(default = "default_log_file")]
    pub log_file: String,
}

fn default_log_file() -> String {
    "freqhole.log".to_string()
}

/// Server configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    /// Enable HTTP server (default: true when section exists)
    #[serde(default = "default_true")]
    pub enabled: bool,
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
    /// Blob ID for the server image (for P2P transport)
    /// Set automatically when using `freqhole config update-server-image`
    #[serde(default)]
    pub image_blob_id: Option<String>,
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

/// Client-only UI configuration. read by the charnel tauri host and
/// surfaced to the spume frontend via `get_client_config`. nothing
/// in the server / cli paths consumes these.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientConfig {
    /// Maximum number of songs allowed in the play queue. when an
    /// add would exceed this, the ui prompts the user to either
    /// trim from the head or cancel. default: 150.
    #[serde(default = "default_queue_size_limit")]
    pub queue_size_limit: u32,
}

impl Default for ClientConfig {
    fn default() -> Self {
        Self {
            queue_size_limit: default_queue_size_limit(),
        }
    }
}

fn default_queue_size_limit() -> u32 {
    150
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
            // Validate static_files.directory when set and enabled
            // when enabled=true + no directory → embedded assets are served
            // when enabled=true + directory set → directory must be valid
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
                }
                // if directory is None, embedded assets will be served - no validation needed
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

    /// Get path to freqhole-blobz directory (iroh-blobs FsStore)
    pub fn freqhole_blobz_path(&self) -> PathBuf {
        self.data_dir.join("freqhole-blobz")
    }

    /// Get path to wordlist file
    pub fn wordlist_path(&self) -> PathBuf {
        self.data_dir.join("wordlist.txt")
    }

    /// Get path to federation credentials file
    pub fn federation_credentials_path(&self) -> PathBuf {
        self.data_dir.join("federation-creds.toml")
    }

    /// Get path to log file
    /// returns None if log_file is empty (file logging disabled)
    /// returns absolute path resolved from data_dir if relative
    pub fn log_file_path(&self) -> Option<PathBuf> {
        if self.logging.log_file.is_empty() {
            return None;
        }
        let path = PathBuf::from(&self.logging.log_file);
        if path.is_absolute() {
            Some(path)
        } else {
            Some(self.data_dir.join(&self.logging.log_file))
        }
    }
}

/// Initialize a minimal in-memory config for unit tests.
///
/// idempotent and safe to call from multiple tests; later calls
/// overwrite the installed config via the inner RwLock. only
/// intended for #[cfg(test)] callers — production code should use
/// `init_config(...)`.
#[doc(hidden)]
pub fn init_config_for_tests() {
    let config = GrimoireConfig {
        data_dir: PathBuf::from("/tmp/grimoire-test"),
        database: DatabaseConfig {
            filename: "test.db".to_string(),
            max_connections: default_max_connections(),
            acquire_timeout_seconds: default_acquire_timeout_seconds(),
            idle_timeout_seconds: default_idle_timeout_seconds(),
        },
        media: MediaConfig {
            max_fs_file_size: default_max_fs_file_size(),
            supported_audio_formats: default_supported_audio_formats(),
            ffmpeg_path: default_ffmpeg_path(),
            ffprobe_path: None,
            ffprobe_duration_args: default_ffprobe_duration_args(),
            ffprobe_properties_args: default_ffprobe_properties_args(),
            extract_album_art_args: default_extract_album_art_args(),
            generate_waveform_args: default_generate_waveform_args(),
            skip_duplicates: default_skip_duplicates(),
            generate_scan_duplicate_report: default_generate_scan_duplicate_report(),
            thumbnail_sizes: default_thumbnail_sizes(),
            thumbnail_on_demand_enabled: false,
        },
        musicbrainz: MusicBrainzConfig::default(),
        lastfm: LastFmConfig::default(),
        audiodb: AudioDbConfig::default(),
        logging: LoggingConfig {
            level: "info".to_string(),
            log_file: String::new(),
        },
        server: None,
        federation: None,
        radio: None,
        client: None,
        loaded_from: None,
    };
    match CONFIG.get() {
        Some(lock) => {
            *lock.write().unwrap() = config;
        }
        None => {
            let _ = CONFIG.set(RwLock::new(config));
        }
    }
}

/// Initialize or reload global config from file path
///
/// First call initializes the config. Subsequent calls reload from disk,
/// allowing runtime config changes (e.g., toggling federation).
pub fn init_config(path: Option<PathBuf>) -> Result<(), ConfigError> {
    let config_path = find_config(path)?;
    let mut config = GrimoireConfig::load(&config_path)?;
    config.loaded_from = Some(config_path);

    match CONFIG.get() {
        Some(lock) => {
            // reload existing config
            *lock.write().unwrap() = config;
        }
        None => {
            // first init
            let _ = CONFIG.set(RwLock::new(config));
        }
    }
    Ok(())
}

/// Get the path to the currently-loaded config file (set by init_config).
/// Returns None if config hasn't been initialized yet.
pub fn get_config_path() -> Option<PathBuf> {
    CONFIG
        .get()
        .and_then(|lock| lock.read().unwrap().loaded_from.clone())
}

/// Check if config has been initialized
pub fn is_config_initialized() -> bool {
    CONFIG.get().is_some()
}

/// Get a clone of the global config (available after init_config)
///
/// Returns a cloned GrimoireConfig. This allows the config to be
/// used across await points without Send issues.
pub fn get_config() -> GrimoireConfig {
    CONFIG
        .get()
        .expect("Config not initialized - call init_config first")
        .read()
        .unwrap()
        .clone()
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
    create_config_with_server_info(output_path, data_dir, force, None, None)
}

/// Create a config file with custom server info
///
/// # Arguments
/// * `output_path` - Where to write the config
/// * `data_dir` - Data directory path
/// * `force` - Overwrite existing file
/// * `server_name` - Human-readable server name
/// * `server_port` - Server listen port
pub fn create_config_with_server_info(
    output_path: Option<PathBuf>,
    data_dir: Option<PathBuf>,
    force: bool,
    server_name: Option<String>,
    server_port: Option<u16>,
) -> Result<PathBuf, ConfigError> {
    create_config_full(
        output_path,
        data_dir,
        force,
        server_name,
        server_port,
        None,  // description
        None,  // image_path
        false, // ytdlp_available
        None,  // fetch_music_dir
        None,  // allowed_origins
        None,  // ffmpeg_path
        None,  // ffprobe_path
        None,  // ytdlp_path
        None,  // server_enabled (use template default: true)
        None,  // federation_enabled (use template default: false)
        None,  // knocking_enabled (use template default: false)
    )
}

/// Create a config file with full customization options
///
/// # Arguments
/// * `output_path` - Where to write the config
/// * `data_dir` - Data directory path
/// * `force` - Overwrite existing file
/// * `server_name` - Human-readable server name
/// * `server_port` - Server listen port
/// * `image_path` - Optional path to server icon image
/// * `ytdlp_available` - Whether yt-dlp is available for downloads
/// * `fetch_music_dir` - Optional custom directory for fetched/uploaded music (defaults to data_dir/fetch)
/// * `allowed_origins` - Optional list of allowed origins for CORS/WebAuthn (None = derive from port, vec!["any"] = allow any)
/// * `ffmpeg_path` - Optional absolute path to ffmpeg binary
/// * `ffprobe_path` - Optional absolute path to ffprobe binary
/// * `ytdlp_path` - Optional absolute path to yt-dlp binary
/// * `server_enabled` - Optional server enabled flag (default: true)
/// * `federation_enabled` - Optional federation enabled flag (default: false)
/// * `knocking_enabled` - Optional knocking enabled flag (default: false)
pub fn create_config_full(
    output_path: Option<PathBuf>,
    data_dir: Option<PathBuf>,
    force: bool,
    server_name: Option<String>,
    server_port: Option<u16>,
    description: Option<String>,
    image_path: Option<String>,
    ytdlp_available: bool,
    fetch_music_dir: Option<PathBuf>,
    allowed_origins: Option<Vec<String>>,
    ffmpeg_path: Option<PathBuf>,
    ffprobe_path: Option<PathBuf>,
    ytdlp_path: Option<PathBuf>,
    server_enabled: Option<bool>,
    federation_enabled: Option<bool>,
    knocking_enabled: Option<bool>,
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
        port,
        description.as_deref(),
        image_path.as_deref(),
        ytdlp_available,
        &fetch_dir,
        allowed_origins.as_deref(),
        ffmpeg_path.as_deref(),
        ffprobe_path.as_deref(),
        ytdlp_path.as_deref(),
        server_enabled,
        federation_enabled,
        knocking_enabled,
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
    server_port: u16,
    description: Option<&str>,
    image_path: Option<&str>,
    ytdlp_available: bool,
    fetch_dir: &Path,
    allowed_origins: Option<&[String]>,
    ffmpeg_path: Option<&Path>,
    ffprobe_path: Option<&Path>,
    ytdlp_path: Option<&Path>,
    server_enabled: Option<bool>,
    federation_enabled: Option<bool>,
    knocking_enabled: Option<bool>,
) -> String {
    let mut doc = CONFIG_TEMPLATE
        .parse::<DocumentMut>()
        .expect("embedded config template should be valid TOML");

    // update data_dir
    doc["data_dir"] = value(data_dir.display().to_string());

    // update media section with absolute paths if provided
    if let Some(media) = doc["media"].as_table_mut() {
        if let Some(path) = ffmpeg_path {
            media["ffmpeg_path"] = value(path.display().to_string());
        }
        if let Some(path) = ffprobe_path {
            media["ffprobe_path"] = value(path.display().to_string());
        }
    }

    // update server section
    doc["server"]["name"] = value(server_name);
    doc["server"]["version"] = value(env!("CARGO_PKG_VERSION"));
    doc["server"]["port"] = value(server_port as i64);

    // set or remove description
    if let Some(d) = description {
        if d.is_empty() {
            doc["server"]
                .as_table_mut()
                .map(|t| t.remove("description"));
        } else {
            doc["server"]["description"] = value(d);
        }
    }

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

    // update fetch commands with absolute yt-dlp path if provided
    if let Some(ytdlp) = ytdlp_path {
        let ytdlp_str = ytdlp.display().to_string();
        if let Some(fetch_music) = doc["server"]["fetch_music"].as_table_mut() {
            // precheck_command uses yt-dlp
            fetch_music["precheck_command"] =
                value(format!("{} --print-json --no-download", ytdlp_str));
            // fetch_command uses yt-dlp
            fetch_music["fetch_command"] = value(format!(
                "{} --ignore-errors --extract-audio --audio-format mp3 --audio-quality 0 --add-metadata --embed-thumbnail --no-overwrites --output %(uploader)s-%(title)s-[%(id)s].%(ext)s --print after_move:filepath",
                ytdlp_str
            ));
        }
    }

    // set server.enabled (default: true in template)
    if let Some(enabled) = server_enabled {
        doc["server"]["enabled"] = value(enabled);
    }

    // set federation.enabled (default: false in template)
    if let Some(enabled) = federation_enabled {
        doc["federation"]["enabled"] = value(enabled);
    }

    // set federation.knocking_enabled (default: false in template)
    if let Some(enabled) = knocking_enabled {
        doc["federation"]["knocking_enabled"] = value(enabled);
    }

    doc.to_string()
}

/// read config directly from file (bypasses the cached CONFIG)
///
/// useful when the config file may have changed since startup.
pub fn read_config_from_file(config_path: &Path) -> Result<GrimoireConfig, ConfigError> {
    let content = std::fs::read_to_string(config_path).map_err(|e| ConfigError::FileNotFound {
        path: config_path.display().to_string(),
        error: e.to_string(),
    })?;

    toml::from_str(&content)
        .map_err(|e| ConfigError::ParseError(format!("failed to parse config: {}", e)))
}

/// set config values using dot-path keys (preserves comments and formatting)
///
/// key paths use dots to navigate nested tables: "server.static_files.enabled"
/// intermediate tables are created if they don't exist.
///
/// NOTE: key paths are validated at runtime only - typos won't cause compile errors.
/// the resulting config is validated after writing to catch structural issues.
///
/// # example
/// ```ignore
/// set_config_values(&path, &[
///     ("server.static_files.enabled", true.into()),
///     ("server.static_files.directory", "/path/to/dir".into()),
/// ])?;
/// ```
pub fn set_config_values(
    config_path: &Path,
    updates: &[(&str, toml_edit::Value)],
) -> Result<(), ConfigError> {
    let content = std::fs::read_to_string(config_path).map_err(|e| ConfigError::FileNotFound {
        path: config_path.display().to_string(),
        error: e.to_string(),
    })?;

    let mut doc = content
        .parse::<DocumentMut>()
        .map_err(|e| ConfigError::ParseError(format!("failed to parse config: {}", e)))?;

    for (key_path, val) in updates {
        set_nested_value(&mut doc, key_path, val.clone())?;
    }

    std::fs::write(config_path, doc.to_string())
        .map_err(|e| ConfigError::CreateFailed(format!("failed to write config: {}", e)))?;

    // refresh in-memory CONFIG so subsequent get_config() calls see the
    // updated values immediately (without requiring a process restart).
    // we only refresh if the config has been initialized — callers using
    // set_config_values during setup may run before init_config.
    if is_config_initialized() {
        if let Err(e) = init_config(Some(config_path.to_path_buf())) {
            tracing::warn!("failed to reload config after set_config_values: {}", e);
        }
    }

    Ok(())
}

/// convenience wrapper for the rathole repl: set both autostart
/// toggles (`server.enabled` + `federation.enabled`) in one call so
/// callers don't have to depend on `toml_edit` directly. takes
/// effect on the next process launch; current subprocesses (if any)
/// are unaffected and must be stopped separately.
pub fn set_autostart(
    config_path: &Path,
    server_enabled: bool,
    federation_enabled: bool,
) -> Result<(), ConfigError> {
    set_config_values(
        config_path,
        &[
            ("server.enabled", server_enabled.into()),
            ("federation.enabled", federation_enabled.into()),
        ],
    )
}

/// helper to set a value at a dot-separated path, creating intermediate tables as needed
fn set_nested_value(
    doc: &mut DocumentMut,
    key_path: &str,
    val: toml_edit::Value,
) -> Result<(), ConfigError> {
    let parts: Vec<&str> = key_path.split('.').collect();
    if parts.is_empty() {
        return Err(ConfigError::InvalidValue("empty key path".to_string()));
    }

    // navigate/create intermediate tables
    let mut current: &mut toml_edit::Item = doc.as_item_mut();
    for (i, part) in parts.iter().enumerate() {
        let is_last = i == parts.len() - 1;

        if is_last {
            // set the final value
            match current {
                toml_edit::Item::Table(t) => {
                    t[*part] = toml_edit::Item::Value(val);
                    return Ok(());
                }
                _ => {
                    return Err(ConfigError::InvalidValue(format!(
                        "cannot set '{}': parent is not a table",
                        key_path
                    )));
                }
            }
        } else {
            // navigate or create intermediate table
            match current {
                toml_edit::Item::Table(t) => {
                    if !t.contains_key(*part) {
                        t[*part] = toml_edit::Item::Table(toml_edit::Table::new());
                    }
                    current = &mut t[*part];
                }
                toml_edit::Item::None => {
                    // this shouldn't happen for a parsed doc, but handle it
                    return Err(ConfigError::InvalidValue(format!(
                        "cannot navigate '{}': path segment is None",
                        key_path
                    )));
                }
                _ => {
                    return Err(ConfigError::InvalidValue(format!(
                        "cannot navigate '{}': '{}' is not a table",
                        key_path, part
                    )));
                }
            }
        }
    }

    Ok(())
}

/// ensure server image is stored as a media blob and update config
///
/// reads the image at server.image_path from the config, creates a media blob
/// (or finds existing by sha256), and updates the config file with the blob_id.
///
/// # arguments
/// * `config_path` - path to the freqhole-config.toml
///
/// # returns
/// the blob_id of the server image
pub async fn ensure_server_image_blob(config_path: &Path) -> Result<String, ConfigError> {
    use crate::blob_data::generate_sized_thumbnails;
    use crate::media_blobz::{create_media_blob, BlobType, CreateMediaBlobRequest};
    use crate::Bytes;
    use sha2::{Digest, Sha256};

    // load config to get image_path and data_dir
    let config = GrimoireConfig::load(config_path)?;

    let server_config = config.server.as_ref().ok_or_else(|| {
        ConfigError::InvalidValue("server section required to update server image".to_string())
    })?;

    let image_path = server_config.image_path.as_ref().ok_or_else(|| {
        ConfigError::InvalidValue("server.image_path required to create image blob".to_string())
    })?;

    // resolve image path (relative to data_dir or absolute)
    let full_path = if image_path.is_absolute() {
        image_path.to_path_buf()
    } else {
        config.data_dir.join(image_path)
    };

    // read image file
    let data = std::fs::read(&full_path).map_err(|e| ConfigError::FileNotFound {
        path: full_path.display().to_string(),
        error: e.to_string(),
    })?;

    // compute sha256
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let sha256 = format!("{:x}", hasher.finalize());

    // get mime type
    let mime = mime_guess::from_path(&full_path)
        .first()
        .map(|m| m.to_string())
        .unwrap_or_else(|| "image/png".to_string());

    let filename = full_path
        .file_name()
        .and_then(|n: &std::ffi::OsStr| n.to_str())
        .unwrap_or("server-image")
        .to_string();

    // create media blob (idempotent - returns existing if same sha256)
    let request = CreateMediaBlobRequest {
        sha256: sha256.clone(),
        size: Some(data.len() as i64),
        mime: Some(mime),
        source_client_id: None,
        local_path: None,
        filename: Some(filename),
        parent_blob_id: None,
        blob_type: Some(BlobType::Original),
        metadata: serde_json::json!({}),
        created_by: None,
        data: Some(Bytes::from(data)),
        width: None,
        height: None,
        blake3: None,
    };

    let blob = create_media_blob(request)
        .await
        .map_err(|e| ConfigError::InvalidValue(format!("failed to create media blob: {}", e)))?;

    // generate thumbnails for the server image
    let thumb_result = generate_sized_thumbnails(&blob.id, None).await;
    if !thumb_result.success {
        tracing::warn!(
            "failed to generate thumbnails for server image: {}",
            thumb_result.message
        );
    }

    // update config with blob_id
    set_config_values(
        config_path,
        &[("server.image_blob_id", blob.id.clone().into())],
    )?;

    Ok(blob.id)
}

// ============================================================================
// config upgrade / migration
// ============================================================================

/// get the binary version (from Cargo.toml at compile time)
pub fn get_binary_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// result of a config upgrade operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigUpgradeResult {
    /// path to the backup copy of the original config
    pub backup_path: PathBuf,
    /// old version from user's config
    pub old_version: String,
    /// new version written to upgraded config
    pub new_version: String,
}

/// check if config needs upgrade (version mismatch)
///
/// returns true if server.version in config differs from binary version
pub fn config_needs_upgrade(config_path: &Path) -> Result<bool, ConfigError> {
    let content = std::fs::read_to_string(config_path).map_err(|e| ConfigError::FileNotFound {
        path: config_path.display().to_string(),
        error: e.to_string(),
    })?;

    let doc = content
        .parse::<DocumentMut>()
        .map_err(|e| ConfigError::ParseError(format!("failed to parse config: {}", e)))?;

    let config_version = doc
        .get("server")
        .and_then(|s| s.get("version"))
        .and_then(|v| v.as_str())
        .unwrap_or("0.0.0");

    Ok(config_version != get_binary_version())
}

/// upgrade config by merging user values into fresh template
///
/// 1. creates backup of original config
/// 2. parses user config to extract values
/// 3. merges values into fresh template (preserves template comments)
/// 4. writes upgraded config
///
/// keys that exist in user config but not in template are silently dropped.
/// server.version is always set to binary version (not migrated from user config).
pub fn upgrade_config(config_path: &Path) -> Result<ConfigUpgradeResult, ConfigError> {
    // read user's current config
    let user_content =
        std::fs::read_to_string(config_path).map_err(|e| ConfigError::FileNotFound {
            path: config_path.display().to_string(),
            error: e.to_string(),
        })?;

    // parse user config to get current version
    let user_doc = user_content
        .parse::<DocumentMut>()
        .map_err(|e| ConfigError::ParseError(format!("failed to parse user config: {}", e)))?;

    let old_version = user_doc
        .get("server")
        .and_then(|s| s.get("version"))
        .and_then(|v| v.as_str())
        .unwrap_or("0.0.0")
        .to_string();

    // parse user config as toml::Value for easy traversal
    let user_values: toml::Value = toml::from_str(&user_content)
        .map_err(|e| ConfigError::ParseError(format!("failed to parse user config: {}", e)))?;

    // parse fresh template (preserves comments)
    let mut template_doc = CONFIG_TEMPLATE
        .parse::<DocumentMut>()
        .expect("embedded config template should be valid TOML");

    // merge user values into template
    if let toml::Value::Table(user_table) = user_values {
        merge_values_into_doc(&mut template_doc, &user_table, "");
    }

    // always set server.version from binary (don't keep user's old version)
    if let Some(server) = template_doc.get_mut("server") {
        if let Some(server_table) = server.as_table_mut() {
            server_table["version"] = value(get_binary_version());
        }
    }

    // create backup with timestamp
    let now = time::OffsetDateTime::now_utc();
    let timestamp = format!(
        "{:04}{:02}{:02}_{:02}{:02}{:02}",
        now.year(),
        now.month() as u8,
        now.day(),
        now.hour(),
        now.minute(),
        now.second()
    );
    let backup_path = config_path.with_extension(format!("toml.bak.{}", timestamp));
    std::fs::copy(config_path, &backup_path)
        .map_err(|e| ConfigError::CreateFailed(format!("failed to create backup: {}", e)))?;

    // write upgraded config
    std::fs::write(config_path, template_doc.to_string()).map_err(|e| {
        ConfigError::CreateFailed(format!("failed to write upgraded config: {}", e))
    })?;

    Ok(ConfigUpgradeResult {
        backup_path,
        old_version,
        new_version: get_binary_version().to_string(),
    })
}

/// recursively merge user values into template document
///
/// walks the user's toml::Table and for each key that exists in the template,
/// sets the user's value. nested tables are handled recursively.
fn merge_values_into_doc(
    doc: &mut DocumentMut,
    user_table: &toml::map::Map<String, toml::Value>,
    path_prefix: &str,
) {
    for (key, user_value) in user_table {
        let full_path = if path_prefix.is_empty() {
            key.clone()
        } else {
            format!("{}.{}", path_prefix, key)
        };

        // skip server.version - always set from binary
        if full_path == "server.version" {
            continue;
        }

        match user_value {
            toml::Value::Table(nested_table) => {
                // check if this table exists in template
                let template_has_table = get_item_at_path(doc, &full_path)
                    .map(|item| item.is_table() || item.is_inline_table())
                    .unwrap_or(false);

                if template_has_table {
                    // recurse into nested table
                    merge_values_into_doc(doc, nested_table, &full_path);
                }
                // if template doesn't have this table, skip it (deprecated section)
            }
            _ => {
                // check if key exists in template before setting
                if get_item_at_path(doc, &full_path).is_some() {
                    let toml_edit_value = toml_value_to_edit_value(user_value);
                    let _ = set_nested_value(doc, &full_path, toml_edit_value);
                }
                // if key doesn't exist in template, skip it (deprecated key)
            }
        }
    }
}

/// get item at dot-separated path in document
fn get_item_at_path<'a>(doc: &'a DocumentMut, path: &str) -> Option<&'a toml_edit::Item> {
    let parts: Vec<&str> = path.split('.').collect();
    let mut current: &toml_edit::Item = doc.as_item();

    for part in parts {
        match current {
            toml_edit::Item::Table(t) => {
                current = t.get(part)?;
            }
            _ => return None,
        }
    }

    Some(current)
}

/// convert toml::Value to toml_edit::Value
fn toml_value_to_edit_value(v: &toml::Value) -> toml_edit::Value {
    match v {
        toml::Value::String(s) => toml_edit::Value::from(s.as_str()),
        toml::Value::Integer(i) => toml_edit::Value::from(*i),
        toml::Value::Float(f) => toml_edit::Value::from(*f),
        toml::Value::Boolean(b) => toml_edit::Value::from(*b),
        toml::Value::Datetime(dt) => {
            // format datetime back to string and parse as toml_edit datetime
            let dt_str = dt.to_string();
            dt_str
                .parse()
                .unwrap_or_else(|_| toml_edit::Value::from(dt_str))
        }
        toml::Value::Array(arr) => {
            let mut edit_arr = toml_edit::Array::new();
            for item in arr {
                edit_arr.push(toml_value_to_edit_value(item));
            }
            toml_edit::Value::Array(edit_arr)
        }
        toml::Value::Table(t) => {
            let mut edit_table = toml_edit::InlineTable::new();
            for (k, val) in t {
                edit_table.insert(k, toml_value_to_edit_value(val));
            }
            toml_edit::Value::InlineTable(edit_table)
        }
    }
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
                thumbnail_sizes: vec![50, 200],
                thumbnail_on_demand_enabled: false,
            },
            musicbrainz: MusicBrainzConfig::default(),
            lastfm: LastFmConfig::default(),
            audiodb: AudioDbConfig::default(),
            logging: LoggingConfig {
                level: "info".to_string(),
                log_file: "freqhole.log".to_string(),
            },
            server: None,
            federation: None,
            radio: None,
            client: None,
            loaded_from: None,
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
                thumbnail_sizes: vec![50, 200],
                thumbnail_on_demand_enabled: false,
            },
            musicbrainz: MusicBrainzConfig::default(),
            lastfm: LastFmConfig::default(),
            audiodb: AudioDbConfig::default(),
            logging: LoggingConfig {
                level: "invalid".to_string(),
                log_file: "freqhole.log".to_string(),
            },
            server: None,
            federation: None,
            radio: None,
            client: None,
            loaded_from: None,
        };

        assert!(config.validate().is_err());
    }

    #[test]
    fn test_config_validation_empty_filename() {
        let config = GrimoireConfig {
            data_dir: PathBuf::from("/data"),
            database: DatabaseConfig {
                filename: "".to_string(),
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
                thumbnail_sizes: vec![50, 200],
                thumbnail_on_demand_enabled: false,
            },
            musicbrainz: MusicBrainzConfig::default(),
            lastfm: LastFmConfig::default(),
            audiodb: AudioDbConfig::default(),
            logging: LoggingConfig {
                level: "info".to_string(),
                log_file: "freqhole.log".to_string(),
            },
            server: None,
            federation: None,
            radio: None,
            client: None,
            loaded_from: None,
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
