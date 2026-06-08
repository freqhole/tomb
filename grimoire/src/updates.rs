//! new-version update checks.
//!
//! queries the github releases api for the latest published freqhole release
//! and compares it against the running binary version. gated behind the
//! `[updates] enabled` config flag (off by default); callers that bypass the
//! flag (e.g. `fetch_latest_release`) are responsible for honoring user intent.

use crate::config::{get_binary_version, get_config};
use crate::error::{GrimoireError, GrimoireResult};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use std::time::Duration;
use zod_gen_derive::ZodSchema;

const USER_AGENT: &str = "freqhole/1.0 (https://github.com/freqhole/tomb)";
const LATEST_RELEASE_URL: &str = "https://api.github.com/repos/freqhole/tomb/releases/latest";
const TIMEOUT_SECONDS: u64 = 15;

/// download page surfaced in the toast / landing message.
pub const DOWNLOAD_URL: &str = "https://freqhole.net/getting-started/download/";

/// shared, long-lived http client for github api calls.
fn shared_http_client() -> &'static Client {
    static HTTP_CLIENT: OnceLock<Client> = OnceLock::new();
    HTTP_CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(Duration::from_secs(TIMEOUT_SECONDS))
            .user_agent(USER_AGENT)
            .build()
            .expect("failed to build updates http client")
    })
}

/// subset of the github "latest release" response we care about.
#[derive(Debug, Clone, Deserialize)]
struct GithubRelease {
    tag_name: String,
}

/// result of a new-version check.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UpdateStatus {
    /// version of the running binary (semver, e.g. "0.1.28")
    pub current_version: String,
    /// latest published release version, when the check succeeded
    pub latest_version: Option<String>,
    /// true when `latest_version` is newer than `current_version`
    pub update_available: bool,
    /// whether update checks are enabled in config
    pub enabled: bool,
    /// download page url for the toast / landing message
    pub download_url: String,
}

/// the running binary version (semver string).
pub fn current_version() -> &'static str {
    get_binary_version()
}

/// whether update checks are enabled in config.
pub fn checks_enabled() -> bool {
    get_config().updates.enabled
}

/// query github for the latest release tag (with any leading `v` stripped).
///
/// this performs the network call unconditionally; it does not consult the
/// config flag. use [`check_for_update`] for the gated, higher-level api.
pub async fn fetch_latest_release() -> GrimoireResult<String> {
    let resp = shared_http_client()
        .get(LATEST_RELEASE_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("github release check failed: {}", e),
        })?;

    if !resp.status().is_success() {
        return Err(GrimoireError::ProcessingFailed {
            message: format!("github release check returned status {}", resp.status()),
        });
    }

    let release: GithubRelease =
        resp.json()
            .await
            .map_err(|e| GrimoireError::ProcessingFailed {
                message: format!("failed to parse github release response: {}", e),
            })?;

    Ok(release.tag_name.trim_start_matches('v').trim().to_string())
}

/// full update status, respecting the config flag.
///
/// when `[updates] enabled` is false, returns immediately without any network
/// call (`enabled = false`, `latest_version = None`). when enabled, queries
/// github and compares versions.
pub async fn check_for_update() -> GrimoireResult<UpdateStatus> {
    let current = current_version().to_string();

    if !checks_enabled() {
        return Ok(UpdateStatus {
            current_version: current,
            latest_version: None,
            update_available: false,
            enabled: false,
            download_url: DOWNLOAD_URL.to_string(),
        });
    }

    let latest = fetch_latest_release().await?;
    let update_available = is_newer(&latest, &current);

    Ok(UpdateStatus {
        current_version: current,
        latest_version: Some(latest),
        update_available,
        enabled: true,
        download_url: DOWNLOAD_URL.to_string(),
    })
}

/// full update status, ignoring the config flag.
///
/// always performs the network call regardless of `[updates] enabled`. this
/// backs the desktop app's manual "check for updates" menu item, which should
/// work even when automatic update checks are turned off. the returned
/// `enabled` field still reflects the config value for the caller's reference.
pub async fn check_for_update_now() -> GrimoireResult<UpdateStatus> {
    let current = current_version().to_string();
    let latest = fetch_latest_release().await?;
    let update_available = is_newer(&latest, &current);

    Ok(UpdateStatus {
        current_version: current,
        latest_version: Some(latest),
        update_available,
        enabled: checks_enabled(),
        download_url: DOWNLOAD_URL.to_string(),
    })
}

/// parse a semver-ish string into numeric components, ignoring a leading `v`
/// and any pre-release/build suffix after the first `-` or `+`.
fn parse_version(v: &str) -> Vec<u64> {
    v.trim()
        .trim_start_matches('v')
        .split(['-', '+'])
        .next()
        .unwrap_or("")
        .split('.')
        .map(|part| {
            part.chars()
                .take_while(|c| c.is_ascii_digit())
                .collect::<String>()
                .parse::<u64>()
                .unwrap_or(0)
        })
        .collect()
}

/// true when `latest` is a strictly newer version than `current`.
fn is_newer(latest: &str, current: &str) -> bool {
    let l = parse_version(latest);
    let c = parse_version(current);
    let len = l.len().max(c.len());
    for i in 0..len {
        let lv = l.get(i).copied().unwrap_or(0);
        let cv = c.get(i).copied().unwrap_or(0);
        if lv != cv {
            return lv > cv;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newer_detection() {
        assert!(is_newer("0.1.29", "0.1.28"));
        assert!(is_newer("0.2.0", "0.1.28"));
        assert!(is_newer("1.0.0", "0.9.9"));
        assert!(is_newer("v0.1.29", "0.1.28"));
    }

    #[test]
    fn not_newer() {
        assert!(!is_newer("0.1.28", "0.1.28"));
        assert!(!is_newer("0.1.27", "0.1.28"));
        assert!(!is_newer("0.1.28", "v0.1.28"));
    }

    #[test]
    fn handles_prerelease_suffix() {
        assert!(!is_newer("0.1.28-rc1", "0.1.28"));
        assert!(is_newer("0.1.29-rc1", "0.1.28"));
    }
}
