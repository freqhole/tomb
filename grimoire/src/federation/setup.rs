//! Federation setup - handles initial authentication and credential storage
//!
//! This module provides the setup flow for federation:
//! 1. Authenticate to haruspex with email/password
//! 2. Store refresh token securely in data directory
//! 3. Provide utilities to load and refresh credentials

use crate::config::{get_config, FederationConfig};
use crate::error::{GrimoireError, GrimoireResult};
use crate::federation::client::HaruspexClient;
use crate::federation::credentials::FederationCredentials;
use std::path::PathBuf;

/// Result of a setup operation
#[derive(Debug, Clone)]
pub struct SetupResult {
    /// Whether setup was successful
    pub success: bool,
    /// Path where credentials were saved
    pub credentials_path: PathBuf,
    /// Haruspex user ID
    pub haruspex_user_id: String,
    /// Email used
    pub email: String,
    /// Message describing the result
    pub message: String,
}

/// Result of checking setup status
#[derive(Debug, Clone)]
pub struct SetupStatus {
    /// Whether federation is enabled in config
    pub federation_enabled: bool,
    /// Whether credentials file exists
    pub credentials_exist: bool,
    /// Path to credentials file
    pub credentials_path: PathBuf,
    /// Email from stored credentials (if any)
    pub email: Option<String>,
    /// Haruspex user ID from stored credentials (if any)
    pub haruspex_user_id: Option<String>,
    /// When credentials were created (if any)
    pub created_at: Option<String>,
    /// When tokens were last refreshed (if any)
    pub last_refreshed_at: Option<String>,
    /// Whether credentials were verified (None = not checked, Some(true) = valid)
    pub verified: Option<bool>,
    /// Error message if verification failed
    pub verification_error: Option<String>,
}

/// Perform federation setup by authenticating to haruspex
///
/// This is the main setup function - it:
/// 1. Authenticates with the provided credentials
/// 2. Saves the refresh token to the data directory
/// 3. Returns setup result
pub async fn setup_federation(
    config: &FederationConfig,
    email: &str,
    password: &str,
) -> GrimoireResult<SetupResult> {
    let app_config = get_config();
    let credentials_path = app_config.federation_credentials_path();

    // create client and authenticate
    let client = HaruspexClient::new(&config.haruspex_url, &config.haruspex_anon_key);
    let session = client.sign_in(email, password).await?;

    // create credentials struct
    let creds = FederationCredentials::new(
        session.user.id.clone(),
        email.to_string(),
        session.refresh_token,
    );

    // save credentials
    creds.save(&credentials_path)?;

    Ok(SetupResult {
        success: true,
        credentials_path,
        haruspex_user_id: session.user.id,
        email: email.to_string(),
        message: "federation setup complete".to_string(),
    })
}

/// Get current setup status
pub fn get_setup_status() -> SetupStatus {
    let config = get_config();
    let credentials_path = config.federation_credentials_path();
    let federation_enabled = config.federation.as_ref().map_or(false, |f| f.enabled);

    let mut status = SetupStatus {
        federation_enabled,
        credentials_exist: false,
        credentials_path: credentials_path.clone(),
        email: None,
        haruspex_user_id: None,
        created_at: None,
        last_refreshed_at: None,
        verified: None,
        verification_error: None,
    };

    // try to load existing credentials
    if let Ok(creds) = FederationCredentials::load(&credentials_path) {
        status.credentials_exist = true;
        status.email = Some(creds.email.clone());
        status.haruspex_user_id = Some(creds.haruspex_user_id.clone());
        status.created_at = Some(creds.created_at_iso());
        status.last_refreshed_at = Some(creds.last_refreshed_at_iso());
    }

    status
}

/// Get setup status and verify credentials are valid by refreshing the token
pub async fn get_setup_status_verified() -> SetupStatus {
    let mut status = get_setup_status();

    // only verify if credentials exist and federation is enabled
    if status.credentials_exist && status.federation_enabled {
        match get_authenticated_client().await {
            Ok(_) => {
                status.verified = Some(true);
                // reload status to get updated last_refreshed_at
                let updated = get_setup_status();
                status.last_refreshed_at = updated.last_refreshed_at;
            }
            Err(e) => {
                status.verified = Some(false);
                status.verification_error = Some(e.to_string());
            }
        }
    }

    status
}

/// Load and refresh credentials, returning an authenticated client
///
/// This is the main entry point for using stored credentials:
/// 1. Load credentials from file
/// 2. Refresh the access token
/// 3. Update stored credentials with new refresh token
/// 4. Return authenticated client
pub async fn get_authenticated_client() -> GrimoireResult<(HaruspexClient, FederationCredentials)> {
    let config = get_config();
    let credentials_path = config.federation_credentials_path();

    let federation_config = config
        .federation
        .as_ref()
        .ok_or(GrimoireError::FederationNotConfigured)?;

    // load credentials
    let mut creds = FederationCredentials::load(&credentials_path)?;

    // create client
    let client = HaruspexClient::new(
        &federation_config.haruspex_url,
        &federation_config.haruspex_anon_key,
    );

    // refresh token
    let session = client.refresh_token(&creds.refresh_token).await?;

    // update credentials with new refresh token
    creds.update_token(session.refresh_token);
    creds.save(&credentials_path)?;

    // return client with fresh access token
    let authed_client = HaruspexClient::new(
        &federation_config.haruspex_url,
        &federation_config.haruspex_anon_key,
    )
    .with_token(&session.access_token);

    Ok((authed_client, creds))
}

/// Clear stored credentials (logout)
pub fn clear_credentials() -> GrimoireResult<()> {
    let config = get_config();
    let credentials_path = config.federation_credentials_path();
    FederationCredentials::delete(&credentials_path)
}
