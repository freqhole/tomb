//! federation credentials storage
//!
//! stores haruspex (Supabase) authentication credentials in a secure file.
//! the file is chmod 600 to prevent other users from reading it.

use crate::error::{GrimoireError, GrimoireResult};
use serde::{Deserialize, Serialize};
use std::path::Path;
use time::OffsetDateTime;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

/// stored federation credentials
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederationCredentials {
    /// haruspex user ID (Supabase auth.users.id)
    pub haruspex_user_id: String,

    /// email used for authentication
    pub email: String,

    /// Supabase refresh token (long-lived)
    pub refresh_token: String,

    /// when credentials were first created (unix timestamp)
    pub created_at: i64,

    /// when tokens were last refreshed (unix timestamp)
    pub last_refreshed_at: i64,
}

impl FederationCredentials {
    /// create new credentials from a sign-in session
    pub fn new(haruspex_user_id: String, email: String, refresh_token: String) -> Self {
        let now = OffsetDateTime::now_utc().unix_timestamp();
        Self {
            haruspex_user_id,
            email,
            refresh_token,
            created_at: now,
            last_refreshed_at: now,
        }
    }

    /// update the refresh token after a token refresh
    pub fn update_token(&mut self, new_refresh_token: String) {
        self.refresh_token = new_refresh_token;
        self.last_refreshed_at = OffsetDateTime::now_utc().unix_timestamp();
    }

    /// get created_at as ISO 8601 string
    pub fn created_at_iso(&self) -> String {
        OffsetDateTime::from_unix_timestamp(self.created_at)
            .map(|dt| {
                dt.format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default()
            })
            .unwrap_or_else(|_| self.created_at.to_string())
    }

    /// get last_refreshed_at as ISO 8601 string
    pub fn last_refreshed_at_iso(&self) -> String {
        OffsetDateTime::from_unix_timestamp(self.last_refreshed_at)
            .map(|dt| {
                dt.format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default()
            })
            .unwrap_or_else(|_| self.last_refreshed_at.to_string())
    }

    /// load credentials from file
    pub fn load(path: &Path) -> GrimoireResult<Self> {
        let content = std::fs::read_to_string(path)
            .map_err(|_| GrimoireError::FederationCredentialsNotFound)?;

        toml::from_str(&content).map_err(|e| GrimoireError::FederationCredentialsInvalid {
            message: format!("failed to parse credentials: {}", e),
        })
    }

    /// save credentials to file with secure permissions (chmod 600)
    pub fn save(&self, path: &Path) -> GrimoireResult<()> {
        // ensure parent directory exists
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| GrimoireError::Io(e))?;
        }

        let content = toml::to_string_pretty(self).map_err(|e| {
            GrimoireError::FederationCredentialsInvalid {
                message: format!("failed to serialize credentials: {}", e),
            }
        })?;

        // add a warning comment at the top
        let content_with_header = format!(
            "# federation credentials - DO NOT SHARE\n# this file contains sensitive authentication tokens\n\n{}",
            content
        );

        std::fs::write(path, &content_with_header).map_err(|e| GrimoireError::Io(e))?;

        // set file permissions to 600 (owner read/write only) on unix
        #[cfg(unix)]
        {
            let mut perms = std::fs::metadata(path)
                .map_err(|e| GrimoireError::Io(e))?
                .permissions();
            perms.set_mode(0o600);
            std::fs::set_permissions(path, perms).map_err(|e| GrimoireError::Io(e))?;
        }

        Ok(())
    }

    /// check if credentials file exists at the given path
    pub fn exists(path: &Path) -> bool {
        path.exists()
    }

    /// delete credentials file
    pub fn delete(path: &Path) -> GrimoireResult<()> {
        if path.exists() {
            std::fs::remove_file(path).map_err(|e| GrimoireError::Io(e))?;
        }
        Ok(())
    }
}
