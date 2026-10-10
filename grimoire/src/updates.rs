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

/// parse a semver-ish string into (numeric core components, pre-release
/// build number). the pre-release marker can be the standard semver
/// `-`/`+` suffix (`0.3.13-rc1`) OR a plain dot-separated dev convention
/// (`0.3.13.pre0`, used for local pre-release builds that iterate on
/// upgrade migrations before the real version ships) - either form is
/// recognized by "a dot/hyphen-separated piece that doesn't start with a
/// digit", with its own trailing digit run (default 0) becoming the
/// pre-release number. `None` means a final release (no pre-release
/// marker at all). see `is_newer`'s doc comment for why the distinction
/// matters.
fn parse_version(v: &str) -> (Vec<u64>, Option<u64>) {
    let v = v.trim().trim_start_matches('v');
    let mut core = Vec::new();
    let mut pre: Option<u64> = None;
    'outer: for raw_part in v.split('.') {
        // a part may itself carry the standard semver `-`/`+` marker
        // (e.g. "13-rc1") even though the outer split is on `.` (for the
        // ".pre0" dev convention).
        for (i, piece) in raw_part.split(['-', '+']).enumerate() {
            if piece.is_empty() {
                continue;
            }
            let starts_with_digit = piece.chars().next().is_some_and(|c| c.is_ascii_digit());
            if i == 0 && starts_with_digit {
                let n: u64 = piece
                    .chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect::<String>()
                    .parse()
                    .unwrap_or(0);
                core.push(n);
                continue;
            }
            // a non-numeric-leading piece (or anything after a `-`/`+`
            // split within this part) is the pre-release marker - every
            // remaining part of the version string belongs to it, not
            // to `core`.
            let digits: String = piece.chars().filter(|c| c.is_ascii_digit()).collect();
            pre = Some(digits.parse().unwrap_or(0));
            break 'outer;
        }
    }
    (core, pre)
}

/// true when `latest` is a strictly newer version than `current`.
///
/// a pre-release build (however it's spelled - see `parse_version`)
/// always ranks BELOW the final release of the same core version, so
/// downloading the real `0.3.13` after running on a local `0.3.13.pre0`/
/// `0.3.13-rc1` build still re-triggers that version's upgrade
/// migrations rather than treating them as already-applied. among two
/// pre-releases of the same core version, a higher pre-release number
/// wins, so repeatedly bumping `.pre0` -> `.pre1` -> ... during local
/// migration development keeps re-triggering them too, without a
/// pre-release ever appearing to have "caught up to" the eventual real
/// release.
pub(crate) fn is_newer(latest: &str, current: &str) -> bool {
    let (l_core, l_pre) = parse_version(latest);
    let (c_core, c_pre) = parse_version(current);
    let len = l_core.len().max(c_core.len());
    for i in 0..len {
        let lv = l_core.get(i).copied().unwrap_or(0);
        let cv = c_core.get(i).copied().unwrap_or(0);
        if lv != cv {
            return lv > cv;
        }
    }
    match (l_pre, c_pre) {
        (None, None) => false,
        (None, Some(_)) => true,
        (Some(_), None) => false,
        (Some(lp), Some(cp)) => lp > cp,
    }
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

    #[test]
    fn dev_dot_prerelease_bumps_are_newer_than_the_previous_bump() {
        // dev workflow: `.pre0` -> `.pre1` -> ... while iterating on
        // upgrade migrations locally, before the real version ships.
        assert!(is_newer("0.3.13.pre1", "0.3.13.pre0"));
        assert!(!is_newer("0.3.13.pre0", "0.3.13.pre1"));
        assert!(!is_newer("0.3.13.pre0", "0.3.13.pre0"));
    }

    #[test]
    fn final_release_outranks_any_prerelease_of_the_same_core_version() {
        // downloading the real 0.3.13 build after running a local
        // 0.3.13.pre0/0.3.13-rc1 build must still re-trigger that
        // version's upgrade migrations.
        assert!(is_newer("0.3.13", "0.3.13.pre0"));
        assert!(is_newer("0.3.13", "0.3.13-rc1"));
        // and a prerelease build must never look like it's already past
        // (ahead of) a real shipped release of the same core version.
        assert!(!is_newer("0.3.13.pre0", "0.3.13"));
        assert!(!is_newer("0.3.13-rc1", "0.3.13"));
    }

    #[test]
    fn prerelease_tag_never_overrides_a_real_core_version_difference() {
        assert!(is_newer("0.3.14.pre0", "0.3.13"));
        assert!(!is_newer("0.3.12.pre9", "0.3.13"));
    }
}
