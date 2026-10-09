//! tauri commands for setup wizard and admin operations
//!
//! these commands are called from the JS side via invoke()
//! they provide access to grimoire functionality without going through HTTP
//!
//! config file always lives in app data dir (e.g. ~/Library/Application Support/...)
//! the config's data_dir field can point to a different location for the database/media

use serde::Serialize;
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

use crate::app_config::{get_server_config_path_resolved, save_admin_user, FreqholeAppConfig};
use crate::spume_bridge::{
    notify_config_changed, notify_scan_complete, notify_scan_progress, notify_server_image_updated,
};
use crate::ShutdownToken;

/// resolve a path to its canonical form, falling back to the original if resolution fails.
/// useful for resolving symlinks (e.g. /home -> /var/home on Fedora Silverblue).
/// delegates to `grimoire::paths::canonical_path_string` so all surfaces share one rule.
fn canonicalize_or_original(path: &str) -> String {
    grimoire::paths::canonical_path_string(path)
}

/// ensure config is initialized, returns Ok if already initialized or successfully initialized
fn ensure_config_initialized(config_path: &Path) -> Result<(), String> {
    if grimoire::is_config_initialized() {
        return Ok(());
    }
    if !config_path.exists() {
        return Err(format!("config file not found: {}", config_path.display()));
    }
    match grimoire::config::init_config(Some(config_path.to_path_buf())) {
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

// bundled by scripts/fetch-mpv-runtime.sh (macOS) / scripts/windows/
// fetch-mpv-runtime.ps1 (windows) - see their own doc comments for how/why.
// on linux and when unbundled (e.g. `tauri dev`), these always return
// `None` and callers fall back to grimoire's normal PATH/common-install-
// dir search.
//
// lands at Contents/Resources/mpv-runtime/lib/{ffmpeg,ffprobe} - same
// nesting `set_vulkan_icd_env` (video_window/libmpv_backend.rs) already
// resolves against, see that function's doc comment for the full story
// on why tauri's `resources` key preserves this path instead of
// flattening it.
#[cfg(target_os = "macos")]
fn resolve_bundled_media_binary(name: &str) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let path = exe
        .parent()?
        .parent()?
        .join("Resources")
        .join("mpv-runtime")
        .join("lib")
        .join(name);
    path.is_file().then_some(path)
}

// windows' `bundle.resources` placement isn't a fixed path relative to the
// exe the way macOS's .app bundle structure is (see
// `register_bundled_dll_search_path` in lib.rs, which warns about exactly
// this) - the real $RESOURCE dir is only knowable via `AppHandle::path()`,
// which only exists once tauri's `.setup()` hook runs. `set_windows_resource_dir`
// stashes that resolved path (lib.rs's setup hook already computes it for
// `register_bundled_dll_search_path`, so this just reuses it) - called
// before anything would actually need to read it (setup/first-run always
// happens after `.setup()`, never before).
#[cfg(target_os = "windows")]
static WINDOWS_RESOURCE_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

#[cfg(target_os = "windows")]
pub(crate) fn set_windows_resource_dir(dir: PathBuf) {
    let _ = WINDOWS_RESOURCE_DIR.set(dir);
}

#[cfg(target_os = "windows")]
fn resolve_bundled_media_binary(name: &str) -> Option<PathBuf> {
    // flat at $RESOURCE root, matching the existing libmpv-2.dll mapping
    // in tauri.windows.conf.json's `bundle.resources` (source paths can be
    // nested under mpv-runtime/, but dest names here are all flat).
    let path = WINDOWS_RESOURCE_DIR.get()?.join(format!("{name}.exe"));
    path.is_file().then_some(path)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn resolve_bundled_media_binary(_name: &str) -> Option<PathBuf> {
    None
}

/// prefers the bundled ffmpeg/ffprobe (no separate install required by the
/// user) over grimoire's generic PATH/common-install-dir search, which
/// still runs as a fallback - both so unbundled dev builds keep working
/// and so a user who explicitly picked their own ffmpeg via
/// `validate_and_set_ffmpeg_path` isn't affected (that's a separate,
/// already-persisted config value this function has no say over - it only
/// supplies defaults for a FRESH setup / the live dependency-check
/// status, never overrides an existing saved choice).
fn check_dependencies_preferring_bundled() -> grimoire::setup::DependencyStatus {
    match bundled_ffmpeg_paths() {
        (Some(ffmpeg_path), Some(ffprobe_path)) => {
            let mut status = grimoire::setup::check_dependencies();
            status.ffmpeg_path = Some(ffmpeg_path);
            status.ffprobe_path = Some(ffprobe_path);
            status
        }
        _ => grimoire::setup::check_dependencies(),
    }
}

/// `(ffmpeg, ffprobe)` bundled binary paths, or `None`/`None` if either is
/// missing (unbundled dev build, linux, etc.) - the one place both
/// `check_dependencies_preferring_bundled` and `run_setup_core` (and, via
/// `grimoire::config::set_bundled_ffmpeg_resolver`, grimoire's own
/// config-load-time resolution) ask "is anything actually bundled here".
///
/// also genuinely smoke-tests the pair (`grimoire::setup::smoke_test_ffmpeg` -
/// a tiny real encode + probe, not just `-version`) before returning them -
/// a bundled binary that merely EXISTS on disk can still be unusable on
/// this OS (confirmed for real 2026-10-02, see that function's doc
/// comment). previously this smoke test only ever ran on a version-
/// upgrade path (`maybe_fallback_to_bundled_ffmpeg`), so a brand-new
/// install on an old mac could silently pick a bundled ffmpeg that
/// exists but can't execute, with no fallback - checking here instead
/// covers every caller (fresh installs included) in one place. a failed
/// smoke test returns `(None, None)` so callers fall through to
/// grimoire's normal PATH/common-install-dir search for BOTH binaries
/// together, matching `smoke_test_ffmpeg`'s own pairwise (encode-then-
/// probe) semantics.
pub(crate) fn bundled_ffmpeg_paths() -> (Option<PathBuf>, Option<PathBuf>) {
    let (ffmpeg, ffprobe) = (
        resolve_bundled_media_binary("ffmpeg"),
        resolve_bundled_media_binary("ffprobe"),
    );
    match (&ffmpeg, &ffprobe) {
        (Some(ffmpeg_path), Some(ffprobe_path))
            if !grimoire::setup::smoke_test_ffmpeg(ffmpeg_path, ffprobe_path) =>
        {
            tracing::warn!(
                ffmpeg = %ffmpeg_path.display(),
                ffprobe = %ffprobe_path.display(),
                "bundled ffmpeg/ffprobe failed smoke test, falling back to PATH lookup"
            );
            (None, None)
        }
        _ => (ffmpeg, ffprobe),
    }
}

/// check for required external dependencies (ffmpeg, yt-dlp)
#[tauri::command]
pub async fn check_dependencies() -> DependencyCheckResult {
    let status = check_dependencies_preferring_bundled();
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

/// result of validating and persisting a user-picked binary path.
#[derive(Debug, Clone, Serialize)]
pub struct BinaryValidationResult {
    pub path: String,
    /// first line of the binary's own version output, shown to the user
    /// as confirmation that the picked file is really that binary.
    pub version_info: String,
}

/// result of validating a user-picked ffmpeg binary. `ffprobe` is `None`
/// when a sibling ffprobe binary couldn't be found/validated next to
/// ffmpeg - the ffmpeg path is still saved either way, ffprobe is best-effort.
#[derive(Debug, Clone, Serialize)]
pub struct FfmpegValidationResult {
    pub ffmpeg: BinaryValidationResult,
    pub ffprobe: Option<BinaryValidationResult>,
}

/// shell out `<path> <version_flag>` and confirm it looks like a real,
/// runnable binary - some tools print version info to stdout, some to
/// stderr, so both are checked. returns the first non-blank output line
/// as a human-readable confirmation string, or a specific error message
/// explaining what went wrong.
fn validate_binary(path: &Path, version_flag: &str) -> Result<String, String> {
    if !path.is_file() {
        return Err(format!("'{}' is not a file", path.display()));
    }

    let mut cmd = std::process::Command::new(path);
    cmd.arg(version_flag);
    grimoire::process_ext::hide_console_window_std(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("couldn't run '{}': {}", path.display(), e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let first_line = stdout
        .lines()
        .chain(stderr.lines())
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim().to_string());

    match first_line {
        Some(line) => Ok(line),
        None => Err(format!(
            "'{}' ran but produced no output - this doesn't look like a valid {} binary",
            path.display(),
            path.file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default()
        )),
    }
}

/// infer ffprobe's path from ffmpeg's directory (same directory, same
/// executable extension) - ffmpeg and ffprobe always ship as sibling
/// binaries, so no separate file picker is needed for ffprobe.
fn infer_ffprobe_path(ffmpeg_path: &Path) -> Option<PathBuf> {
    let dir = ffmpeg_path.parent()?;
    let mut ffprobe_name = std::ffi::OsString::from("ffprobe");
    if let Some(ext) = ffmpeg_path.extension() {
        ffprobe_name.push(".");
        ffprobe_name.push(ext);
    }
    Some(dir.join(ffprobe_name))
}

/// validate a user-picked ffmpeg binary (and its inferred ffprobe sibling,
/// best-effort), then persist both into the currently running instance's
/// config file. called from the settings view's "advanced" section, which
/// only offers this picker when the configured ffmpeg couldn't be found.
#[tauri::command]
pub async fn validate_and_set_ffmpeg_path(
    app_handle: tauri::AppHandle,
    path: String,
) -> Result<FfmpegValidationResult, String> {
    let ffmpeg_path = PathBuf::from(canonicalize_or_original(&path));
    let ffmpeg_version = validate_binary(&ffmpeg_path, "-version")?;

    let ffprobe_result = infer_ffprobe_path(&ffmpeg_path)
        .and_then(|p| validate_binary(&p, "-version").ok().map(|v| (p, v)));

    let config_path = get_server_config_path_resolved(&app_handle)
        .ok_or_else(|| "server config not found - run setup first".to_string())?;

    grimoire::config::set_ffmpeg_path(
        &config_path,
        &ffmpeg_path,
        ffprobe_result.as_ref().map(|(p, _)| p.as_path()),
    )
    .map_err(|e| e.to_string())?;

    Ok(FfmpegValidationResult {
        ffmpeg: BinaryValidationResult {
            path: ffmpeg_path.display().to_string(),
            version_info: ffmpeg_version,
        },
        ffprobe: ffprobe_result.map(|(p, v)| BinaryValidationResult {
            path: p.display().to_string(),
            version_info: v,
        }),
    })
}

/// validate a user-picked yt-dlp binary, then persist it into the
/// currently running instance's config file. see `validate_and_set_ffmpeg_path`.
#[tauri::command]
pub async fn validate_and_set_ytdlp_path(
    app_handle: tauri::AppHandle,
    path: String,
) -> Result<BinaryValidationResult, String> {
    let ytdlp_path = PathBuf::from(canonicalize_or_original(&path));
    let version_info = validate_binary(&ytdlp_path, "--version")?;

    let config_path = get_server_config_path_resolved(&app_handle)
        .ok_or_else(|| "server config not found - run setup first".to_string())?;

    grimoire::config::set_ytdlp_path(&config_path, &ytdlp_path).map_err(|e| e.to_string())?;

    Ok(BinaryValidationResult {
        path: ytdlp_path.display().to_string(),
        version_info,
    })
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
#[allow(clippy::too_many_arguments)]
pub async fn run_setup_core(
    app_handle: tauri::AppHandle,
    config_path: String,
    data_dir: String,
    server_name: String,
    server_port: u16,
    image_path: Option<String>,
    fetch_music_dir: Option<String>,
    federation_enabled: Option<bool>,
    knocking_enabled: Option<bool>,
    remote_admin_enabled: Option<bool>,
    radio_enabled: Option<bool>,
    fetch_music_enabled: Option<bool>,
) -> grimoire::setup::SetupResult {
    // resolve paths to canonical form (safety net for Flatpak portal paths / symlinks)
    let data_dir = canonicalize_or_original(&data_dir);
    let config_path = canonicalize_or_original(&config_path);
    let fetch_music_dir = fetch_music_dir.map(|p| canonicalize_or_original(&p));
    let image_path = image_path.map(|p| canonicalize_or_original(&p));

    let deps = check_dependencies_preferring_bundled();
    let bundled = bundled_ffmpeg_paths();

    // when both are bundled, leave the persisted config on "auto" (None)
    // rather than baking in the bundled path as a literal string - lets
    // the user later clear their own override back to "use whatever's
    // bundled" without needing a dedicated "reset" affordance (grimoire's
    // own config-load-time resolution - see `set_bundled_ffmpeg_resolver`
    // - fills this back in every time). only persist a concrete path when
    // nothing's bundled here (linux, unbundled dev builds) - those still
    // need `deps`' PATH/common-install-dir discovery result written down,
    // since a bare "ffmpeg" wouldn't reliably resolve for a GUI app
    // launched without a shell's PATH.
    let (ffmpeg_path, ffprobe_path) = match (&bundled.0, &bundled.1) {
        (Some(_), Some(_)) => (None, None),
        _ => (deps.ffmpeg_path.clone(), deps.ffprobe_path.clone()),
    };

    // set allowed origins based on build type
    // dev builds use http://localhost:1420 (vite dev server for tauri UI)
    // release builds use tauri://localhost (tauri's internal protocol)
    #[cfg(debug_assertions)]
    let allowed_origins = vec!["http://localhost:1420".to_string()];
    #[cfg(not(debug_assertions))]
    let allowed_origins = vec!["tauri://localhost".to_string()];

    // if image_path provided, resize to 200x200 webp and save as
    // freqhole-icon.webp in data_dir. matches what update_server_image and
    // server_update_image do post-setup, so the on-disk path is stable
    // across the lifetime of the install (no orphaned freqhole-icon.png).
    let final_image_path = if let Some(src_path) = image_path {
        let src = std::path::Path::new(&src_path);
        if src.exists() {
            let dest = PathBuf::from(&data_dir).join("freqhole-icon.webp");
            let _ = std::fs::create_dir_all(&data_dir);
            match std::fs::read(&src_path) {
                Ok(bytes) => match grimoire::blob_data::resize_to_square_webp(&bytes, 200) {
                    Ok(webp) => match std::fs::write(&dest, &webp) {
                        Ok(_) => Some(dest.to_string_lossy().to_string()),
                        Err(e) => {
                            tracing::error!(error = %e, "failed to write icon");
                            None
                        }
                    },
                    Err(e) => {
                        tracing::error!(error = %e, "failed to resize icon");
                        None
                    }
                },
                Err(e) => {
                    tracing::error!(error = %e, "failed to read source icon");
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
        description: None,
        image_path: final_image_path,
        admin_username: None,        // no admin user in core setup
        generate_api_key: false,     // no API key without admin user
        generate_invite_code: false, // tauri doesn't need this
        ytdlp_available: deps.has_ytdlp(),
        fetch_music_dir: fetch_music_dir.map(PathBuf::from),
        initial_scan_dirs: Vec::new(), // handled by music step in UI
        allowed_origins: Some(allowed_origins),
        ffmpeg_path,
        ffprobe_path,
        ytdlp_path: deps.ytdlp_path.clone(),
        server_enabled: Some(false), // HTTP server disabled in charnel (tauri) mode
        federation_enabled,          // passed from UI (default: false)
        knocking_enabled,            // passed from UI (default: false)
        remote_admin_enabled,        // passed from UI (default: false)
        radio_enabled,               // passed from UI (default: false)
        fetch_music_enabled,         // passed from UI (default: false)
    };

    let service = grimoire::setup::SetupService::new();
    let result = service.run_setup(setup_config).await;

    if result.success {
        maybe_enable_experimental_player_default(&app_handle, &bundled, &deps);
    }

    result
}

/// decides the "experimental player" (bundled-libmpv-backed playback)
/// default for a fresh install: linux already defaults to on via
/// `default_use_libmpv_playback` and is left alone here; macOS/windows
/// only flip to on if we can actually confirm the bundled mpv +
/// ffmpeg/ffprobe genuinely work on this machine right now, rather than
/// just assuming bundling succeeded (see `grimoire::player::libmpv::
/// smoke_test` and `grimoire::setup::smoke_test_ffmpeg`'s own doc
/// comments for why a real functional test is used instead of trusting
/// file-exists/`-version` checks). a separate function (not an inline
/// `cfg!()` check in `run_setup_core`) because `grimoire::player::libmpv`
/// only compiles in on desktop targets at all - android needs this to
/// not even reference that module, not just skip it at runtime.
#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
pub(crate) fn maybe_enable_experimental_player_default(
    app_handle: &tauri::AppHandle,
    bundled: &(Option<PathBuf>, Option<PathBuf>),
    deps: &grimoire::setup::DependencyStatus,
) {
    if !cfg!(any(target_os = "macos", target_os = "windows")) {
        return;
    }
    let effective_ffmpeg = bundled.0.clone().or_else(|| deps.ffmpeg_path.clone());
    let effective_ffprobe = bundled.1.clone().or_else(|| deps.ffprobe_path.clone());
    let mpv_ok = grimoire::player::libmpv::smoke_test();
    let ffmpeg_ok = match (&effective_ffmpeg, &effective_ffprobe) {
        (Some(ffmpeg), Some(ffprobe)) => grimoire::setup::smoke_test_ffmpeg(ffmpeg, ffprobe),
        _ => false,
    };
    if mpv_ok && ffmpeg_ok {
        let mut app_cfg = crate::app_config::load_or_create(app_handle);
        app_cfg.use_libmpv_playback = true;
        if let Err(e) = app_cfg.save(app_handle) {
            tracing::warn!(error = %e, "failed to persist experimental-player default-on after setup");
        }
    } else {
        tracing::info!(
            mpv_ok,
            ffmpeg_ok,
            "experimental player smoke test failed - leaving it off for this install"
        );
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
pub(crate) fn maybe_enable_experimental_player_default(
    _app_handle: &tauri::AppHandle,
    _bundled: &(Option<PathBuf>, Option<PathBuf>),
    _deps: &grimoire::setup::DependencyStatus,
) {
}

/// last app-config version shipped before mac/windows builds could
/// genuinely smoke-test their bundled mpv+ffmpeg (both introduced this
/// same release) - see `maybe_enable_experimental_player_on_upgrade`.
#[cfg(any(target_os = "macos", target_os = "windows"))]
const LAST_VERSION_PREDATING_BUNDLED_PLAYER: (u32, u32, u32) = (0, 3, 11);

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn parse_version_tuple(v: &str) -> (u32, u32, u32) {
    let mut parts = v.split('.').map(|p| p.parse::<u32>().unwrap_or(0));
    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    )
}

/// one-time "turn on experimental player" nudge for app configs
/// upgrading from `LAST_VERSION_PREDATING_BUNDLED_PLAYER` or older on
/// mac/windows - reuses `maybe_enable_experimental_player_default`'s own
/// real mpv+ffmpeg smoke tests rather than assuming bundling succeeded.
/// called from `app_config::upgrade_app_config` right after it persists
/// the version bump, so this gate naturally never re-fires for the same
/// install again. a no-op if the player is already on (user already
/// enabled it, or this same check already flipped it once).
#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(crate) fn maybe_enable_experimental_player_on_upgrade(
    app_handle: &tauri::AppHandle,
    old_version: &str,
) {
    if parse_version_tuple(old_version) > LAST_VERSION_PREDATING_BUNDLED_PLAYER {
        return;
    }
    if crate::app_config::load_or_create(app_handle).use_libmpv_playback {
        return; // already on - nothing to do
    }
    let bundled = bundled_ffmpeg_paths();
    let deps = check_dependencies_preferring_bundled();
    maybe_enable_experimental_player_default(app_handle, &bundled, &deps);
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
    if !grimoire::is_config_initialized()
        && grimoire::config::init_config(Some(config_path.clone())).is_err()
    {
        return SetupStatus {
            needs_setup: true,
            config_exists: true,
            has_root_user: false,
            config_path: Some(config_path.display().to_string()),
            data_dir: None,
        };
    }

    let config = grimoire::config::get_config();

    // check if we can connect to db and find a root user
    let has_root = check_has_root_user().await.unwrap_or_default();

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
/// delegates to `canonicalize_or_original` so flatpak document-portal paths are
/// left untouched instead of being resolved to their (typically read-only) real
/// host path - see grimoire::paths and docs/flatpak-filesystem-access-plan.md.
#[tauri::command]
pub fn resolve_path(path: String) -> Result<String, String> {
    Ok(canonicalize_or_original(&path))
}

/// resolve a media blob id to a local filesystem path.
///
/// returns `Ok({ id, path, mime })` for blobs that have a
/// `local_path` (i.e. the file lives on disk — true for songs synced
/// via the local importer or downloaded over p2p), and an `Err` with
/// a structured `error_type` discriminant otherwise. spume callers
/// (both the desktop libmpv backend and the cross-platform html
/// `<audio>` backend) can introspect the error to decide whether to
/// fall back to streaming on a per-song basis. NOT gated to desktop -
/// android/ios need this too (see `resolve_blob_path_by_blake3`'s
/// doc comment for why it used to live in the desktop-only
/// `player_commands.rs` and no longer does).
#[tauri::command]
pub async fn resolve_blob_path(blob_id: String) -> Result<serde_json::Value, String> {
    let resp = grimoire::media_blobz::build_blob_path_response(&blob_id).await;
    match resp.data {
        Some(data) => Ok(data),
        None => {
            // surface the first error_type if available so the client
            // can branch on `no_local_path` vs `not_found` etc.
            let kind = resp
                .errors
                .first()
                .map(|e| e.error_type.clone())
                .unwrap_or_else(|| "unknown_error".to_string());
            // log at warn so path failures are visible in charnel logz
            tracing::warn!(
                blob_id = %blob_id,
                error_type = %kind,
                "resolve_blob_path: {}",
                resp.message,
            );
            Err(format!("{kind}: {}", resp.message))
        }
    }
}

/// same as `resolve_blob_path`, but resolved by blake3 instead of
/// `media_blobz.id`. a song's `media_blobz.id` gets replaced with a fresh
/// one every time it's (re-)synced/downloaded locally, so a caller that
/// only has a queue snapshot's original (often remote) `media_blob_id`
/// can't reliably find the CURRENT local record with it - the blake3 is
/// stable across syncs and is what callers should key their "have we
/// already got this on disk" lookup on. every song that's ever been
/// synced locally via iroh-blobs is guaranteed to have a blake3 (the sync
/// itself hard-requires one), so callers can try this unconditionally for
/// any queue item that has one. see libmpvBackend.ts's
/// `resolveLocalPathByBlake3` and audioAccess.ts's
/// `resolveCharnelLocalPath` for the callers.
///
/// this and `resolve_blob_path` used to live in the desktop-only
/// `player_commands.rs` (libmpv is desktop-only), but the html `<audio>`
/// backend's `resolveCharnelLocalPath` needs it on every platform
/// including android/ios - that fast-path check was previously a
/// guaranteed no-op on mobile since the command didn't exist there at
/// all, forcing every play of an already-downloaded song through a full
/// network round-trip. moved here (an always-compiled module) to fix that.
#[tauri::command]
pub async fn resolve_blob_path_by_blake3(blake3: String) -> Result<serde_json::Value, String> {
    let resp = grimoire::media_blobz::build_blob_path_response_by_blake3(&blake3).await;
    match resp.data {
        Some(data) => Ok(data),
        None => {
            let kind = resp
                .errors
                .first()
                .map(|e| e.error_type.clone())
                .unwrap_or_else(|| "unknown_error".to_string());
            tracing::debug!(
                blake3 = %blake3,
                error_type = %kind,
                "resolve_blob_path_by_blake3: {}",
                resp.message,
            );
            Err(format!("{kind}: {}", resp.message))
        }
    }
}

/// write arbitrary image bytes to a reused, fixed-name temp file and
/// return its path - for handing the OS media session (lock screen /
/// control center / MPRIS widget) a real `file://` path it can open
/// directly, when the source image only exists as in-memory bytes (e.g.
/// a video poster read from OPFS, which has no path Rust can reach at
/// all). always overwrites the same file rather than allocating a new
/// one per call - only one track is ever "now playing" at a time, so
/// there is nothing to disambiguate between calls, and no cleanup to
/// track. songs don't need this at all: their artwork already lives in
/// grimoire's blob store, resolved directly via `resolve_blob_path`
/// (a real path, no bytes to copy) - see spume's
/// `getLocalArtworkFilePath` vs. `getLocalPosterFilePathForVideo`.
#[tauri::command]
pub fn write_media_session_artwork(bytes: Vec<u8>) -> Result<String, String> {
    let path = std::env::temp_dir().join("freqhole-media-session-artwork");
    std::fs::write(&path, &bytes).map_err(|e| {
        format!(
            "failed to write media session artwork to {}: {e}",
            path.display()
        )
    })?;
    Ok(path.display().to_string())
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

/// build provenance of the running binary: semver + the git short sha baked in
/// at compile time by `build.rs`. paired with the frontend's own build-time sha
/// so a stale ui bundle (or stale binary) is visible in the ui.
#[derive(Debug, Clone, serde::Serialize)]
pub struct BuildInfo {
    pub version: String,
    pub git_sha: String,
    pub target_os: String,
    pub debug: bool,
}

#[tauri::command]
pub fn get_build_info() -> BuildInfo {
    BuildInfo {
        version: crate::app_config::get_binary_version().to_string(),
        git_sha: env!("FREQHOLE_GIT_SHA").to_string(),
        target_os: std::env::consts::OS.to_string(),
        debug: cfg!(debug_assertions),
    }
}

/// drain any deep-link urls (`freqhole://...`) received before the frontend's
/// event listener was ready. spume calls this on startup to handle cold-start
/// share links. urls received after this call arrive via the
/// `freqhole:event` channel as `share-link-received`.
#[tauri::command]
pub fn take_pending_deep_links(state: tauri::State<crate::PendingDeepLinks>) -> Vec<String> {
    state.drain()
}

/// get the config file path (from app config or legacy location)
#[tauri::command]
pub fn get_config_path(app_handle: tauri::AppHandle) -> Option<String> {
    get_server_config_path_resolved(&app_handle).map(|p| p.display().to_string())
}

/// get the client-only ui config (queue limits, etc.) from the loaded
/// grimoire config. returns the default `ClientConfig` (queue_size_limit=150)
/// when the toml omits the `[client]` section, so callers never need
/// to handle a None.
#[tauri::command]
pub fn get_client_config() -> grimoire::config::ClientConfig {
    grimoire::config::get_config()
        .client
        .clone()
        .unwrap_or_default()
}

/// get the data directory from loaded config
#[tauri::command]
pub fn get_data_dir(app_handle: tauri::AppHandle) -> Option<String> {
    let config_path = get_server_config_path_resolved(&app_handle)?;

    if config_path.exists() {
        // use existing config if initialized, otherwise try to init
        if grimoire::is_config_initialized()
            || grimoire::config::init_config(Some(config_path)).is_ok()
        {
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

/// true if this process is running inside a flatpak sandbox. flatpak sets
/// `FLATPAK_ID` in the environment of every app it launches - see
/// docs/flatpak-filesystem-access-plan.md for why this matters (only
/// portal-brokered folders are writable, typed real paths are not).
#[tauri::command]
pub fn is_flatpak() -> bool {
    std::env::var("FLATPAK_ID").is_ok()
}

/// probe whether `path` (a directory) is actually writable, by creating and
/// removing a throwaway marker file inside it. used to detect a stale/broken
/// flatpak document-portal grant (revoked permission, deleted folder, etc.)
/// instead of only finding out deep inside a background sync job.
#[tauri::command]
pub fn check_dir_writable(path: String) -> bool {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return false;
    }
    let probe = dir.join(format!(".freqhole-write-probe-{}", std::process::id()));
    match std::fs::write(&probe, b"") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// get the fetched-music storage directory from loaded config (falls back to
/// `<data_dir>/fetch`, mirroring grimoire's own default resolution).
#[tauri::command]
pub fn get_fetch_music_dir(app_handle: tauri::AppHandle) -> Option<String> {
    let config_path = get_server_config_path_resolved(&app_handle)?;
    ensure_config_initialized(&config_path).ok()?;
    let config = grimoire::config::get_config();
    let output_dir = config
        .server
        .as_ref()
        .and_then(|s| s.fetch_music.as_ref())
        .and_then(|f| f.output_dir.clone());
    Some(output_dir.unwrap_or_else(|| config.data_dir.join("fetch").display().to_string()))
}

/// update the fetched-music storage directory (`server.fetch_music.output_dir`)
/// and reload the in-memory config immediately - no restart required. `path`
/// is resolved via `canonicalize_or_original` first (a no-op for flatpak
/// document-portal paths, see grimoire::paths). also updates
/// `server.fetch_video.output_dir` to the same path - music and video
/// fetches deliberately share one directory (see `SetupView.tsx`'s own
/// `fetchMusicDir` comment) so they stay in sync here too, rather than
/// silently diverging the way they could before this fn also touched video.
#[tauri::command]
pub fn update_fetch_music_dir(
    app_handle: tauri::AppHandle,
    path: String,
) -> Result<String, String> {
    let config_path = get_server_config_path_resolved(&app_handle)
        .ok_or_else(|| "config file not found - run setup first".to_string())?;
    let resolved = canonicalize_or_original(&path);

    std::fs::create_dir_all(&resolved)
        .map_err(|e| format!("failed to create '{}': {}", resolved, e))?;
    if !check_dir_writable(resolved.clone()) {
        return Err(format!("'{}' is not writable", resolved));
    }

    grimoire::set_config_values(
        &config_path,
        &[
            ("server.fetch_music.output_dir", resolved.clone().into()),
            ("server.fetch_video.output_dir", resolved.clone().into()),
        ],
    )
    .map_err(|e| format!("failed to update config: {}", e))?;

    Ok(resolved)
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
    /// which view/route spume should land on at cold app boot (default: "explore")
    pub initial_view: String,
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
    let initial_view = app_config
        .as_ref()
        .map(|c| c.initial_view.clone())
        .unwrap_or_else(crate::app_config::default_initial_view);

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
        initial_view,
    })
}

/// open (or focus) the "about freqhole" window - desktop only (mobile has
/// no system window to open); referenced unconditionally from the single
/// invoke_handler list, unlike `menu::show_about_window` which lives in a
/// `#[cfg(desktop)]`-gated module.
#[tauri::command]
pub fn open_about_window(app_handle: tauri::AppHandle) {
    #[cfg(desktop)]
    crate::menu::show_about_window(&app_handle);
    #[cfg(not(desktop))]
    let _ = app_handle;
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

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        app_handle
            .opener()
            .open_path(path.to_string_lossy().to_string(), None::<&str>)
            .or_else(|_| {
                Command::new("xdg-open")
                    .arg(dir)
                    .spawn()
                    .map(|_| ())
                    .map_err(|e| format!("xdg-opne failed to open directory: {}", e))
            })
    }

    #[cfg(not(target_os = "linux"))]
    {
        app_handle
            .opener()
            .reveal_item_in_dir(&path)
            .map_err(|e| format!("failed to open directory: {}", e))
    }
}

/// directory playlist zip bundles get saved to.
///
/// macOS has a real, always-accessible `~/Downloads`, so bundles land there
/// as before. linux and windows builds instead get a `playlistz` folder
/// inside the app's own data dir: on linux, `~/Downloads` may not exist (or
/// may be a different filesystem than temp, see `move_file_across_devices`),
/// and sandboxed/flatpak installs may not have permission to write there at
/// all; windows has no equivalent guarantee either. the app data dir always
/// exists and is always writable.
fn zip_bundle_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        app_handle
            .path()
            .download_dir()
            .map_err(|e| format!("could not resolve downloads directory: {}", e))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("could not resolve app data directory: {}", e))?
            .join("playlistz");
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("failed to create playlistz directory: {}", e))?;
        Ok(dir)
    }
}

/// move a file, falling back to copy+delete if `rename` fails because `src`
/// and `dest` are on different filesystems (`EXDEV` / "invalid cross-device
/// link", os error 18 on linux) - e.g. a temp dir on tmpfs and a destination
/// on a real disk/mount. `rename` is tried first since it's atomic and free
/// when both paths share a filesystem, which is the common case.
fn move_file_across_devices(src: &Path, dest: &Path) -> std::io::Result<()> {
    match std::fs::rename(src, dest) {
        Ok(()) => Ok(()),
        Err(e) if e.raw_os_error() == Some(libc_exdev()) => {
            std::fs::copy(src, dest)?;
            std::fs::remove_file(src)?;
            Ok(())
        }
        Err(e) => Err(e),
    }
}

/// os error code for "invalid cross-device link" (EXDEV). windows' rename
/// (`MoveFileExW`) can fail across drives too, but returns a different code
/// (`ERROR_NOT_SAME_DEVICE`, 17) than linux's EXDEV (18) - check whichever
/// applies to the target OS.
fn libc_exdev() -> i32 {
    #[cfg(windows)]
    {
        17
    }
    #[cfg(not(windows))]
    {
        18
    }
}

/// save raw bytes to the platform's zip bundle dir (see `zip_bundle_dir`) and
/// return the final file path. used by spume's zip-bundle download in tauri mode.
#[tauri::command]
pub fn save_zip_to_downloads(
    app_handle: tauri::AppHandle,
    bytes: Vec<u8>,
    filename: String,
) -> Result<String, String> {
    let downloads = zip_bundle_dir(&app_handle)?;

    if !downloads.exists() {
        std::fs::create_dir_all(&downloads)
            .map_err(|e| format!("failed to create downloads directory: {}", e))?;
    }

    // sanitize filename: allow letters, digits, hyphens, underscores, dots
    let safe: String = filename
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || "-_.".contains(c) {
                c
            } else {
                '_'
            }
        })
        .collect();
    let safe = if safe.is_empty() {
        "playlist.zip".to_string()
    } else {
        safe
    };

    // if the file already exists, append an incrementing counter before the extension
    // e.g. my-playlist.zip -> my-playlist_2.zip -> my-playlist_3.zip
    let dest = {
        let base = downloads.join(&safe);
        if !base.exists() {
            base
        } else {
            let stem = std::path::Path::new(&safe)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("playlist")
                .to_string();
            let ext = std::path::Path::new(&safe)
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("zip")
                .to_string();
            let mut n = 2u32;
            loop {
                let candidate = downloads.join(format!("{}_{}.{}", stem, n, ext));
                if !candidate.exists() {
                    break candidate;
                }
                n += 1;
            }
        }
    };

    std::fs::write(&dest, &bytes)
        .map_err(|e| format!("failed to write zip to downloads: {}", e))?;

    dest.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "file path contains non-utf8 characters".to_string())
}

/// open the folder containing the given file path in Finder / Files.
/// used with the "open folder" button after a zip download.
#[tauri::command]
pub fn open_path_in_folder(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let p = std::path::PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("path does not exist: {}", path));
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        // reveal the parent directory on linux
        let dir = p.parent().unwrap_or(&p);
        app_handle
            .opener()
            .open_path(dir.to_string_lossy().to_string(), None::<&str>)
            .or_else(|_| {
                Command::new("xdg-open")
                    .arg(dir)
                    .spawn()
                    .map(|_| ())
                    .map_err(|e| format!("xdg-open failed: {}", e))
            })
    }

    #[cfg(not(target_os = "linux"))]
    {
        app_handle
            .opener()
            .reveal_item_in_dir(&p)
            .map_err(|e| format!("failed to reveal file: {}", e))
    }
}

// ---- streaming zip builder ----
//
// js calls zip_create → zip_append_file (once per song/image/metadata file) → zip_finish.
// on error, call zip_abort to clean up the temp file.
// this avoids accumulating the entire zip in the js heap: only one file's bytes
// cross the ipc boundary at a time, and rust writes them to disk immediately.

type ZipWriterMap = Mutex<HashMap<String, zip::ZipWriter<std::fs::File>>>;

// module-level state for in-progress zip builds, keyed by caller-supplied temp_id.
static ZIP_WRITERS: std::sync::OnceLock<ZipWriterMap> = std::sync::OnceLock::new();

fn zip_writers() -> &'static ZipWriterMap {
    ZIP_WRITERS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn zip_temp_path(temp_id: &str) -> PathBuf {
    std::env::temp_dir().join(format!("playlistz-{}.zip", temp_id))
}

/// create a new in-progress zip file identified by temp_id.
#[tauri::command]
pub fn zip_create(temp_id: String) -> Result<(), String> {
    let path = zip_temp_path(&temp_id);
    let file = std::fs::File::create(&path)
        .map_err(|e| format!("failed to create temp zip at {}: {}", path.display(), e))?;
    let writer = zip::ZipWriter::new(file);
    zip_writers().lock().unwrap().insert(temp_id, writer);
    Ok(())
}

/// append a file to the in-progress zip. bytes are written directly to disk;
/// the caller can drop the buffer immediately after this call returns.
#[tauri::command]
pub fn zip_append_file(temp_id: String, path: String, bytes: Vec<u8>) -> Result<(), String> {
    let mut map = zip_writers().lock().unwrap();
    let writer = map
        .get_mut(&temp_id)
        .ok_or_else(|| format!("no zip in progress for id '{}'", temp_id))?;
    let opts =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    writer
        .start_file(&path, opts)
        .map_err(|e| format!("zip_append_file start_file '{}': {}", path, e))?;
    writer
        .write_all(&bytes)
        .map_err(|e| format!("zip_append_file write '{}': {}", path, e))?;
    Ok(())
}

/// finalize the zip, move it into the platform's zip bundle dir (see
/// `zip_bundle_dir`) with deduplication, return the final path.
#[tauri::command]
pub fn zip_finish(
    app_handle: tauri::AppHandle,
    temp_id: String,
    filename: String,
) -> Result<String, String> {
    let writer = zip_writers()
        .lock()
        .unwrap()
        .remove(&temp_id)
        .ok_or_else(|| format!("no zip in progress for id '{}'", temp_id))?;
    writer
        .finish()
        .map_err(|e| format!("failed to finalize zip: {}", e))?;

    let temp_path = zip_temp_path(&temp_id);
    let downloads = zip_bundle_dir(&app_handle)?;

    let safe: String = filename
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || "-_.".contains(c) {
                c
            } else {
                '_'
            }
        })
        .collect();
    let safe = if safe.is_empty() {
        "playlist.zip".to_string()
    } else {
        safe
    };

    let dest = {
        let base = downloads.join(&safe);
        if !base.exists() {
            base
        } else {
            let stem = std::path::Path::new(&safe)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("playlist")
                .to_string();
            let ext = std::path::Path::new(&safe)
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("zip")
                .to_string();
            let mut n = 2u32;
            loop {
                let candidate = downloads.join(format!("{}_{}.{}", stem, n, ext));
                if !candidate.exists() {
                    break candidate;
                }
                n += 1;
            }
        }
    };

    move_file_across_devices(&temp_path, &dest)
        .map_err(|e| format!("failed to move zip to downloads: {}", e))?;

    dest.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "file path contains non-utf8 characters".to_string())
}

/// abort an in-progress zip and delete the temp file.
#[tauri::command]
pub fn zip_abort(temp_id: String) {
    zip_writers().lock().unwrap().remove(&temp_id);
    let _ = std::fs::remove_file(zip_temp_path(&temp_id));
}

/// scan result
#[derive(Debug, Serialize)]
pub struct ScanResult {
    pub success: bool,
    pub jobs_created: u32,
    pub message: String,
}

/// scan a directory for music and/or video files (creates a ScanDirectory job,
/// which in turn creates ProcessFile jobs for each file found)
///
/// `domain` selects which media pipeline to scan for: `"music"`, `"video"`,
/// `"both"`, or omitted. a JSON-absent `domain` defaults to music-only
/// (matching `media_domain::default_music_domain`), preserving today's
/// behavior for any call site that hasn't been updated to pass it
/// explicitly. `"both"` is a distinct, explicit choice (maps to
/// `ScanDirectoryParams.domain: None`, which the job processor already
/// treats as "detect per-file by extension") - kept separate from the
/// absent-field case so that case's meaning can't silently change later.
#[tauri::command]
pub async fn scan_directory(
    app_handle: tauri::AppHandle,
    path: String,
    tags: Vec<String>,
    domain: Option<String>,
) -> ScanResult {
    use std::str::FromStr;

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

    let domain = match domain.as_deref() {
        Some("both") => None,
        Some(s) => match grimoire::MediaDomain::from_str(s) {
            Ok(d) => Some(d),
            Err(e) => {
                return ScanResult {
                    success: false,
                    jobs_created: 0,
                    message: e,
                }
            }
        },
        None => Some(grimoire::MediaDomain::Music),
    };

    // set up directory tag rules if tags were specified
    if !tags.is_empty() {
        let tag_response =
            grimoire::jobs::add_directory_tags(&path, tags.clone(), Some("tauri-scan".to_string()))
                .await;
        if !tag_response.success {
            tracing::warn!(error = %tag_response.message, "failed to set up directory tags");
        }
    }

    // create a job session first (required for foreign key constraint) -
    // mirrors cli's `jobs scan` handler (cli/src/plumbing/jobs.rs)
    let session_request = grimoire::jobs::CreateJobSessionRequest {
        job_type: grimoire::jobs::JobType::ScanDirectory,
        batch_size: Some(100),
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
    let session_id = session.id.clone();

    let scan_params = grimoire::jobs::ScanDirectoryParams {
        directory_path: path.clone(),
        recursive: true,
        max_depth: None,
        file_extensions: None,
        skip_tracked_subdirs: false,
        domain,
    };

    let job_request = grimoire::jobs::CreateJobRequest {
        job_type: grimoire::jobs::JobType::ScanDirectory,
        session_id: Some(session_id.clone()),
        parameters: serde_json::json!(scan_params),
        max_retries: Some(3),
        scheduled_at: None,
        created_by: Some("tauri-scan".to_string()),
        priority: None,
    };
    let job_response = grimoire::jobs::create_job(job_request).await;

    let job = match job_response.data {
        Some(j) => j,
        None => {
            return ScanResult {
                success: false,
                jobs_created: 0,
                message: format!("failed to create scan job: {}", job_response.message),
            };
        }
    };

    // start background polling for job completion. the ScanDirectory job
    // and every ProcessFile job it spawns share this session_id (see
    // `grimoire::jobs::music::scan_processor`), so polling by session_id
    // already covers both the scan itself and its resulting imports.
    let app_handle_clone = app_handle.clone();
    let session_id_clone = session_id.clone();
    let scan_job_id = job.id.clone();
    let scanned_path = path.clone();
    let shutdown_token = app_handle.state::<ShutdownToken>().inner().clone();
    tauri::async_runtime::spawn(async move {
        poll_scan_jobs_until_complete(
            app_handle_clone,
            session_id_clone,
            scan_job_id,
            scanned_path,
            shutdown_token,
        )
        .await;
    });

    let domain_label = domain.map(|d| d.as_str()).unwrap_or("music and video");
    ScanResult {
        success: true,
        jobs_created: 1,
        message: format!("scanning {} for {} files", path, domain_label),
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
        priority: None,
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
    let mut first_poll = true;

    // emit an immediate progress event so the ui shows activity right away
    {
        let initial_jobs = list_jobs(None, None, Some(1000), None).await;
        if let Some(jobs) = initial_jobs.data {
            let jobs_total = jobs.len() as u32;
            let pending = jobs
                .iter()
                .filter(|j| {
                    j.status()
                        .map(|s| s == JobStatus::Pending || s == JobStatus::Running)
                        .unwrap_or(false)
                })
                .count() as u32;
            let _ = notify_scan_progress(&app_handle, 0, 0, 0, pending, jobs_total);
        }
    }

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

                // always emit progress on every poll so the ui sees pending
                // counts decrement even when no new songs are added.
                let current_songs = current_stats.as_ref().map(|s| s.total_songs).unwrap_or(0);
                let songs_changed = current_songs != last_songs;
                last_songs = current_songs;
                if first_poll || songs_changed || pending > 0 || jobs_total > 0 {
                    first_poll = false;
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
                    // fetch the rescan job's result to surface rescan-specific stats
                    let (blobs_deleted, restored_blobs, restored_songs, purged_scan_dirs) =
                        match grimoire::jobs::get_job(&job_id).await.data {
                            Some(j) => match j.result {
                                Some(s) => serde_json::from_str::<serde_json::Value>(&s)
                                    .ok()
                                    .map(|v| {
                                        (
                                            v.get("blobs_deleted")
                                                .and_then(|n| n.as_u64())
                                                .map(|n| n as u32),
                                            v.get("restored_blobs")
                                                .and_then(|n| n.as_u64())
                                                .map(|n| n as u32),
                                            v.get("restored_songs")
                                                .and_then(|n| n.as_u64())
                                                .map(|n| n as u32),
                                            v.get("purged_scan_dirs")
                                                .and_then(|n| n.as_u64())
                                                .map(|n| n as u32),
                                        )
                                    })
                                    .unwrap_or((None, None, None, None)),
                                None => (None, None, None, None),
                            },
                            None => (None, None, None, None),
                        };

                    // all jobs complete - send final notification
                    if let Err(e) = crate::spume_bridge::notify_scan_complete_full(
                        &app_handle,
                        songs_added,
                        albums_added,
                        artists_added,
                        blobs_deleted,
                        restored_blobs,
                        restored_songs,
                        purged_scan_dirs,
                    ) {
                        tracing::error!(error = %e, "rescan-poll: failed to notify spume");
                    }

                    tracing::info!(
                        songs = songs_added,
                        albums = albums_added,
                        artists = artists_added,
                        blobs_deleted = ?blobs_deleted,
                        restored_blobs = ?restored_blobs,
                        restored_songs = ?restored_songs,
                        purged_scan_dirs = ?purged_scan_dirs,
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

/// result of `repair_library_run` - mirrors `ScanResult`'s shape plus the
/// real job `session_id`, which a caller needs to poll
/// `repair_library_run_status` for genuine completion (see that
/// command's doc comment for why the generic job-events "Completed"
/// signal can't be trusted here).
#[derive(Debug, Serialize)]
pub struct RepairLibraryRunResult {
    pub success: bool,
    pub session_id: Option<String>,
    pub message: String,
}

/// final, authoritative result of a `repair_library_run` session, once
/// both the scan phase and the full `RepairLibraryImages` batch chain
/// have settled - stashed by `run_repair_library_session` and handed out
/// by `repair_library_run_status`.
#[derive(Debug, Clone, Serialize)]
pub struct RepairLibraryStatus {
    pub done: bool,
    pub message: Option<String>,
}

type RepairLibraryResults = Mutex<HashMap<String, RepairLibraryStatus>>;
static REPAIR_LIBRARY_RESULTS: std::sync::OnceLock<RepairLibraryResults> =
    std::sync::OnceLock::new();

fn repair_library_results() -> &'static RepairLibraryResults {
    REPAIR_LIBRARY_RESULTS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// kick off the combined "repair library" flow: a `RescanDirectories` job
/// followed by a chained `RepairLibraryImages` batch job chain, both
/// sharing ONE job session - replaces the old `rescan_directories` +
/// client-driven `maintenance_repair_library_step` polling loop (fully
/// synchronous, zero cancellation/resume support, and the toast/progress
/// UI could only ever see the scan half finish, confirmed real
/// 2026-10-09: "scan complete" toasts fired while image repair was still
/// quietly running underneath).
///
/// returns immediately with the session_id - actual orchestration runs
/// in `run_repair_library_session` on a spawned task. poll
/// `repair_library_run_status` with that session_id to learn when
/// EVERYTHING (not just the scan) is truly done.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn repair_library_run(
    app_handle: tauri::AppHandle,
    dry_run: Option<bool>,
    scan_directory: Option<String>,
    backfill_waveforms: Option<bool>,
    backfill_embedded_art: Option<bool>,
    backfill_directory_art: Option<bool>,
    remove_overapplied: Option<bool>,
    backfill_video_thumbnails: Option<bool>,
) -> RepairLibraryRunResult {
    use grimoire::jobs::{
        create_job, create_job_session, CreateJobRequest, CreateJobSessionRequest, JobType,
    };

    if let Err(e) = ensure_initialized(&app_handle).await {
        return RepairLibraryRunResult {
            success: false,
            session_id: None,
            message: format!("initialization failed: {}", e),
        };
    }

    let session_request = CreateJobSessionRequest {
        job_type: JobType::RescanDirectories,
        batch_size: None,
        created_by: Some("tauri-repair-library".to_string()),
    };
    let session_response = create_job_session(session_request).await;
    let session_id = match session_response.data {
        Some(s) => s.id,
        None => {
            return RepairLibraryRunResult {
                success: false,
                session_id: None,
                message: format!("failed to create job session: {}", session_response.message),
            }
        }
    };

    let job_request = CreateJobRequest {
        job_type: JobType::RescanDirectories,
        session_id: Some(session_id.clone()),
        parameters: serde_json::json!({}),
        max_retries: Some(0),
        scheduled_at: None,
        created_by: Some("tauri-repair-library".to_string()),
        priority: None,
    };
    let response = create_job(job_request).await;
    if !response.success {
        return RepairLibraryRunResult {
            success: false,
            session_id: Some(session_id),
            message: format!("failed to create rescan job: {}", response.message),
        };
    }

    repair_library_results().lock().unwrap().insert(
        session_id.clone(),
        RepairLibraryStatus {
            done: false,
            message: None,
        },
    );

    let options = grimoire::maintenance::RepairLibraryImagesOptions {
        backfill_waveforms: backfill_waveforms.unwrap_or(true),
        backfill_embedded_art: backfill_embedded_art.unwrap_or(true),
        backfill_directory_art: backfill_directory_art.unwrap_or(true),
        remove_overapplied: remove_overapplied.unwrap_or(false),
        backfill_video_thumbnails: backfill_video_thumbnails.unwrap_or(true),
    };

    let app_handle_clone = app_handle.clone();
    let session_id_clone = session_id.clone();
    let shutdown_token = app_handle.state::<ShutdownToken>().inner().clone();
    tauri::async_runtime::spawn(async move {
        run_repair_library_session(
            app_handle_clone,
            session_id_clone,
            dry_run.unwrap_or(false),
            scan_directory,
            options,
            shutdown_token,
        )
        .await;
    });

    RepairLibraryRunResult {
        success: true,
        session_id: Some(session_id),
        message: "repair library started".to_string(),
    }
}

/// poll whether a `repair_library_run` session has fully settled - needed
/// because the generic grimoire job-events "Completed" signal for this
/// session fires once the SCAN phase's jobs happen to hit zero
/// pending/running, which can race with (and fire before)
/// `run_repair_library_session` enqueueing the repair-images job a few
/// seconds later on its own poll tick - a premature "Completed" that
/// looks identical to the real, final one from the event alone. this
/// command instead reports the one thing that's actually unambiguous:
/// whether `run_repair_library_session` itself has reached its own last
/// line.
#[tauri::command]
pub fn repair_library_run_status(session_id: String) -> RepairLibraryStatus {
    repair_library_results()
        .lock()
        .unwrap()
        .get(&session_id)
        .cloned()
        .unwrap_or(RepairLibraryStatus {
            done: false,
            message: None,
        })
}

/// drives a `repair_library_run` session to completion: waits for the
/// scan phase's jobs to settle, chains in the `RepairLibraryImages` batch
/// job (reusing the SAME session_id - its own `enqueue_next_batch`
/// preserves that across every continuation batch, so the whole chain
/// stays trackable as one session), waits for that to settle too, then
/// notifies spume and stashes the final result for
/// `repair_library_run_status` to hand back to the wizard.
#[allow(clippy::too_many_arguments)]
async fn run_repair_library_session(
    app_handle: tauri::AppHandle,
    session_id: String,
    dry_run: bool,
    scan_directory: Option<String>,
    options: grimoire::maintenance::RepairLibraryImagesOptions,
    shutdown_token: ShutdownToken,
) {
    use grimoire::jobs::{
        create_job, get_session_job_counts, list_jobs, CreateJobRequest, JobStatus, JobType,
        RepairLibraryImagesJobResult, RepairLibraryImagesParams,
    };
    use grimoire::music::analytics::admin::get_overview_stats;
    use std::time::Duration;

    let baseline = match get_overview_stats().await.data {
        Some(stats) => (stats.total_songs, stats.total_albums, stats.total_artists),
        None => (0, 0, 0),
    };

    let poll_interval = Duration::from_secs(3);
    let max_polls = 2400; // 2 hours max
    let mut repair_started = false;

    for _ in 0..max_polls {
        tokio::select! {
            _ = tokio::time::sleep(poll_interval) => {}
            _ = shutdown_token.cancelled() => {
                tracing::info!("repair-library-session: shutdown requested, stopping");
                return;
            }
        }

        let counts = match get_session_job_counts(&session_id).await.data {
            Some(c) => c,
            None => {
                tracing::warn!(session_id = %session_id, "repair-library-session: failed to get session job counts");
                continue;
            }
        };

        let current_stats = get_overview_stats().await.data;
        let (songs_added, albums_added, artists_added) = match &current_stats {
            Some(stats) => (
                (stats.total_songs - baseline.0).max(0) as u32,
                (stats.total_albums - baseline.1).max(0) as u32,
                (stats.total_artists - baseline.2).max(0) as u32,
            ),
            None => (0, 0, 0),
        };

        let pending = counts.pending + counts.running;
        let _ = notify_scan_progress(
            &app_handle,
            songs_added,
            albums_added,
            artists_added,
            pending,
            counts.total,
        );

        if pending > 0 {
            continue;
        }

        if !repair_started {
            // scan phase just settled - chain the repair-images batch
            // job into the SAME session and keep polling; `pending`
            // will go back above 0 on the next tick once this job
            // actually gets claimed.
            repair_started = true;
            let params = RepairLibraryImagesParams {
                dry_run,
                scan_directory: scan_directory.clone(),
                options,
                ..Default::default()
            };
            let parameters = match serde_json::to_value(&params) {
                Ok(v) => v,
                Err(e) => {
                    tracing::error!(error = %e, "repair-library-session: failed to serialize repair params");
                    return;
                }
            };
            let job_request = CreateJobRequest {
                job_type: JobType::RepairLibraryImages,
                session_id: Some(session_id.clone()),
                parameters,
                max_retries: Some(1),
                scheduled_at: None,
                created_by: Some("tauri-repair-library".to_string()),
                priority: None,
            };
            let resp = create_job(job_request).await;
            if !resp.success {
                tracing::error!(message = %resp.message, "repair-library-session: failed to enqueue repair-images job");
                return;
            }
            continue;
        }

        // both phases have now settled - pull the terminal batch's own
        // totals out of the (small, session-scoped) job list.
        let totals = list_jobs(
            Some(&session_id),
            Some(JobStatus::Completed),
            Some(200),
            None,
        )
        .await
        .data
        .unwrap_or_default()
        .into_iter()
        .filter(|j| matches!(j.job_type(), Ok(JobType::RepairLibraryImages)))
        .find_map(|j| {
            j.result::<RepairLibraryImagesJobResult>()
                .ok()
                .flatten()
                .filter(|r| r.done)
                .map(|r| r.totals)
        })
        .unwrap_or_default();

        let message = format!(
            "repair library complete: {} song(s) scanned, {} song waveform(s) backfilled, \
             {} album thumbnail(s) backfilled, {} video waveform(s) backfilled, \
             {} video thumbnail(s) backfilled, {} over-applied image(s) removed{}",
            songs_added,
            totals.songs_waveforms_backfilled,
            totals.albums_thumbnails_backfilled,
            totals.videos_waveforms_backfilled,
            totals.videos_thumbnails_backfilled,
            totals.albums_thumbnails_removed_overapplied,
            if totals.errors.is_empty() {
                String::new()
            } else {
                format!(" ({} error(s))", totals.errors.len())
            },
        );

        if let Err(e) = crate::spume_bridge::notify_repair_library_complete(
            &app_handle,
            songs_added,
            albums_added,
            artists_added,
            message.clone(),
        ) {
            tracing::error!(error = %e, "repair-library-session: failed to notify spume");
        }

        repair_library_results().lock().unwrap().insert(
            session_id.clone(),
            RepairLibraryStatus {
                done: true,
                message: Some(message.clone()),
            },
        );

        tracing::info!(session_id = %session_id, "repair-library-session: complete");
        return;
    }

    tracing::warn!("repair-library-session: polling timed out after 2 hours");
    repair_library_results().lock().unwrap().insert(
        session_id.clone(),
        RepairLibraryStatus {
            done: true,
            message: Some("repair library timed out after 2 hours".to_string()),
        },
    );
}

/// poll for scan job completion and notify spume with progress updates
///
/// this runs in the background after scan_directory creates jobs.
/// polls every 3 seconds and sends progress updates on each poll.
/// exits early if shutdown_token is cancelled.
async fn poll_scan_jobs_until_complete(
    app_handle: tauri::AppHandle,
    session_id: String,
    scan_job_id: String,
    scanned_path: String,
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
    let mut first_poll = true;

    // emit an immediate "starting" progress event so the ui doesn't sit
    // empty for 3s (or forever, if all files are duplicates so total_songs
    // never changes and the progress-on-change check below stays silent).
    {
        let initial_jobs = list_jobs(Some(&session_id), None, Some(1000), None).await;
        if let Some(jobs) = initial_jobs.data {
            let jobs_total = jobs.len() as u32;
            let pending = jobs
                .iter()
                .filter(|j| {
                    j.status()
                        .map(|s| s == JobStatus::Pending || s == JobStatus::Running)
                        .unwrap_or(false)
                })
                .count() as u32;
            let _ = notify_scan_progress(&app_handle, 0, 0, 0, pending, jobs_total);
        }
    }

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

                // always emit progress on every poll — the ui needs to see
                // pending counts decrement even when no new songs are added
                // (eg. duplicate-only scans never grow total_songs).
                let current_songs = current_stats.as_ref().map(|s| s.total_songs).unwrap_or(0);
                let songs_changed = current_songs != last_songs;
                last_songs = current_songs;
                if first_poll || songs_changed || pending > 0 || jobs_total > 0 {
                    first_poll = false;
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
                    // record the scanned directory now that the scan job's
                    // own result (file count) is available - this used to
                    // happen synchronously right after `scan_directory`
                    // returned, back when it called the scanner directly
                    // instead of going through the job queue.
                    if let Some(scan_job) = grimoire::jobs::get_job(&scan_job_id).await.data {
                        if let Some(result_str) = &scan_job.result {
                            match serde_json::from_str::<grimoire::jobs::ScanDirectoryResult>(
                                result_str,
                            ) {
                                Ok(scan_result) => {
                                    let _ = grimoire::jobs::record_scanned_directory(
                                        &scanned_path,
                                        scan_result.files_discovered as i64,
                                        None,
                                    )
                                    .await;
                                }
                                Err(e) => {
                                    tracing::warn!(error = %e, "scan-poll: failed to parse scan job result");
                                }
                            }
                        }
                    }

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

        if let Some(jobs) = jobs_response.data {
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
                let _ = notify_scan_complete(&app_handle, songs_added, albums_added, artists_added);
                tracing::info!(
                    songs = songs_added,
                    albums = albums_added,
                    artists = artists_added,
                    "scan-poll: resume complete"
                );
                return;
            }
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
    /// outcome of the haruspex auth data migration (tagged by "status")
    pub haruspex_migration: serde_json::Value,
    /// outcome of the reliquary blob data migration (tagged by "status")
    pub reliquary_migration: serde_json::Value,
    /// outcome of the stale radio encode_args cleanup (tagged by "status")
    pub radio_encode_args_migration: serde_json::Value,
    /// outcome of the blake3 backfill (tagged by "status")
    pub blake3_backfill_migration: serde_json::Value,
}

/// event name used to stream live progress lines to the wizard/settings
/// ui while `upgrade_config` is running - see `grimoire::progress` for
/// the sender side.
const CONFIG_UPGRADE_PROGRESS_EVENT: &str = "config-upgrade-progress";

/// upgrade server config to current version and run the one-shot data migrations
///
/// creates backup first, then merges user values into fresh template, reloads
/// the in-memory config, and runs the haruspex + reliquary data migrations.
/// migration failures are non-fatal - their outcomes ride along in the result.
/// app config (freqhole-app-config.toml) is upgraded silently on startup.
#[tauri::command]
pub async fn upgrade_config(app_handle: tauri::AppHandle) -> Result<ConfigUpgradeResult, String> {
    let config_path = get_server_config_path_resolved(&app_handle)
        .ok_or_else(|| "config file not found".to_string())?;

    // stream progress lines to the wizard/settings view as they're
    // reported (haruspex/reliquary/radio/blake3-backfill steps all call
    // `grimoire::progress::report` from inside this scope) so a long
    // blake3 backfill isn't just a silent spinner.
    let (prog_tx, mut prog_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let forward_app = app_handle.clone();
    let forwarder = tauri::async_runtime::spawn(async move {
        while let Some(line) = prog_rx.recv().await {
            let _ = forward_app.emit(CONFIG_UPGRADE_PROGRESS_EVENT, line);
        }
    });

    let outcome = grimoire::progress::scope(
        prog_tx,
        grimoire::upgrade::upgrade_config_and_migrate(&config_path),
    )
    .await;
    // closing the sender (dropped when `scope`'s future completes) ends
    // the forwarder loop above.
    let _ = forwarder.await;
    let outcome = outcome.map_err(|e| e.to_string())?;

    // land the migration results in the log even if the ui ignores them
    tracing::info!("{}", grimoire::upgrade::describe_outcome(&outcome));

    Ok(ConfigUpgradeResult {
        backup_path: outcome.config.backup_path.display().to_string(),
        old_version: outcome.config.old_version,
        new_version: outcome.config.new_version,
        haruspex_migration: serde_json::to_value(&outcome.haruspex)
            .unwrap_or(serde_json::Value::Null),
        reliquary_migration: serde_json::to_value(&outcome.reliquary)
            .unwrap_or(serde_json::Value::Null),
        radio_encode_args_migration: serde_json::to_value(&outcome.radio_encode_args)
            .unwrap_or(serde_json::Value::Null),
        blake3_backfill_migration: serde_json::to_value(&outcome.blake3_backfill)
            .unwrap_or(serde_json::Value::Null),
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

/// get the use_libmpv_playback setting (default: on for linux). drives
/// both audio and video - see `FreqholeAppConfig::use_libmpv_playback`'s
/// doc comment and `docs/libmpv-experimental-player-plan.md`.
#[tauri::command]
pub fn get_libmpv_playback(app_handle: tauri::AppHandle) -> bool {
    FreqholeAppConfig::load(&app_handle)
        .map(|c| c.use_libmpv_playback)
        .unwrap_or_else(crate::app_config::default_use_libmpv_playback)
}

/// get the chromeless_title_bar setting (default: true). read by both the
/// main (spume) and setup-wizard frontends to decide whether to render
/// their own drag-strip + traffic-light buttons, mirroring whatever the
/// rust side actually did when it built the window (see lib.rs/wizard.rs).
///
/// always false off macOS/linux - `decorations(false)` is only ever applied
/// `#[cfg(any(target_os = "macos", target_os = "linux"))]`, so other
/// platforms (windows, mobile) keep their system title bar regardless of
/// the config value, and must not also draw a custom one on top of it.
#[tauri::command]
pub fn get_chromeless_title_bar(app_handle: tauri::AppHandle) -> bool {
    if !cfg!(any(target_os = "macos", target_os = "linux")) {
        return false;
    }
    FreqholeAppConfig::load(&app_handle)
        .map(|c| c.chromeless_title_bar)
        .unwrap_or_else(crate::app_config::default_chromeless_title_bar)
}

/// set the use_libmpv_playback setting. fires `config_changed` so spume can
/// re-read it without a restart. does NOT swap any in-flight backend; the
/// new value takes effect when the playback session next reconstructs its
/// `PlayerBackend` (typically next page reload or next track). also does
/// not hot-swap an in-flight backend, and the linux video window backend
/// (`video_window::mod.rs`) re-reads this on the next `Load`, not
/// mid-playback either.
#[tauri::command]
pub fn set_libmpv_playback(app_handle: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut config = FreqholeAppConfig::load(&app_handle).unwrap_or_default();
    config.use_libmpv_playback = enabled;
    config.save(&app_handle)?;

    let _ = notify_config_changed(&app_handle, "use_libmpv_playback changed");

    Ok(())
}

/// whether this build's platform actually supports the chromeless title
/// bar - used by the settings ui to hide the toggle entirely on platforms
/// where it has no effect (see `get_chromeless_title_bar`'s matching gate).
#[tauri::command]
pub fn supports_chromeless_title_bar() -> bool {
    cfg!(any(target_os = "macos", target_os = "linux"))
}

/// set the chromeless_title_bar setting. the system window is only ever
/// built with decorations on/off once, at window-creation time (see
/// lib.rs/wizard.rs), so this just persists the preference - it takes
/// effect the next time the app is restarted, same as `use_libmpv_playback`.
#[tauri::command]
pub fn set_chromeless_title_bar(app_handle: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut config = FreqholeAppConfig::load(&app_handle).unwrap_or_default();
    config.chromeless_title_bar = enabled;
    config.save(&app_handle)?;

    let _ = notify_config_changed(&app_handle, "chromeless_title_bar changed");

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

    // temporary diagnostic for the tauri tag-filter bug - confirm the body
    // tauri's IPC layer actually delivers matches what the JS side sent.
    if path.contains("/query") {
        tracing::info!("api_call: path={} body={}", path, body);
    }

    // get caller from app config admin user
    let caller = get_caller_from_app_config(&app_handle)?;

    let response = grimoire::offal::dispatch(&path, &caller, body, None).await;

    // return the full response as JSON
    serde_json::to_value(&response).map_err(|e| e.to_string())
}

/// same as `POST /api/sync/song-by-blake3` via `api_call`, but reports live
/// download progress over a tauri channel instead of going silent for the
/// whole pull (routinely 8-70+ seconds for a real audio file - the generic
/// `api_call`/offal-route dispatch above has no side channel to carry
/// progress on, by design, since it also serves HTTP/CLI/remote-ALPN
/// callers that have no such channel either). mirrors
/// `p2p_commands::p2p_fetch_blob_verified`'s channel pattern exactly -
/// same `BlobDownloadProgress`/`progress_forwarder`, just wired to
/// `grimoire::offal::sync::sync_song_by_blake3_impl` instead of a raw
/// blob fetch, so the rest of the sync (song row + image linking) still
/// happens the same way `sync_song_by_blake3` already does it.
#[tauri::command]
pub async fn sync_song_by_blake3_with_progress(
    app_handle: tauri::AppHandle,
    body: serde_json::Value,
    on_progress: tauri::ipc::Channel<crate::p2p_commands::BlobDownloadProgress>,
) -> Result<serde_json::Value, String> {
    ensure_initialized(&app_handle).await?;

    let caller = get_caller_from_app_config(&app_handle)?;

    let req: grimoire::offal::sync::SyncSongByBlake3Request = serde_json::from_value(body)
        .map_err(|e| format!("bad sync_song_by_blake3_with_progress request: {}", e))?;

    let progress_cb = crate::p2p_commands::progress_forwarder(on_progress);
    let response =
        grimoire::offal::sync::sync_song_by_blake3_impl(&caller, req, Some(progress_cb.as_ref()))
            .await;

    serde_json::to_value(&response).map_err(|e| e.to_string())
}

/// video counterpart of `sync_song_by_blake3_with_progress` - see its doc
/// comment for the full rationale.
#[tauri::command]
pub async fn sync_video_by_blake3_with_progress(
    app_handle: tauri::AppHandle,
    body: serde_json::Value,
    on_progress: tauri::ipc::Channel<crate::p2p_commands::BlobDownloadProgress>,
) -> Result<serde_json::Value, String> {
    ensure_initialized(&app_handle).await?;

    let caller = get_caller_from_app_config(&app_handle)?;

    let req: grimoire::offal::sync::SyncVideoByBlake3Request = serde_json::from_value(body)
        .map_err(|e| format!("bad sync_video_by_blake3_with_progress request: {}", e))?;

    let progress_cb = crate::p2p_commands::progress_forwarder(on_progress);
    let response =
        grimoire::offal::sync::sync_video_by_blake3_impl(&caller, req, Some(progress_cb.as_ref()))
            .await;

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
    let lines: Vec<String> = reader.lines().map_while(Result::ok).collect();

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
