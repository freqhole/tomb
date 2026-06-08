//! federation setup - handles initial authentication and credential storage
//!
//! this module provides the setup flow for federation:
//! 1. generate/load iroh keypair for P2P identity
//! 2. authenticate to haruspex with email/password
//! 3. store refresh token securely in data directory
//! 4. register node_id with all user's groups

use crate::config::{get_config, FederationConfig};
use crate::error::{GrimoireError, GrimoireResult};
use crate::federation::client::HaruspexClient;
use crate::federation::credentials::FederationCredentials;
use crate::federation::identity;
use std::path::PathBuf;

/// result of a setup operation
#[derive(Debug, Clone)]
pub struct SetupResult {
    /// whether setup was successful
    pub success: bool,
    /// path where credentials were saved
    pub credentials_path: PathBuf,
    /// haruspex user ID
    pub haruspex_user_id: String,
    /// email used
    pub email: String,
    /// this instance's node_id (iroh public key)
    pub node_id: String,
    /// number of groups registered with
    pub groups_registered: usize,
    /// message describing the result
    pub message: String,
}

/// result of checking setup status
#[derive(Debug, Clone)]
pub struct SetupStatus {
    /// whether federation is enabled in config
    pub federation_enabled: bool,
    /// whether credentials file exists
    pub credentials_exist: bool,
    /// path to credentials file
    pub credentials_path: PathBuf,
    /// email from stored credentials (if any)
    pub email: Option<String>,
    /// haruspex user ID from stored credentials (if any)
    pub haruspex_user_id: Option<String>,
    /// when credentials were created (if any)
    pub created_at: Option<String>,
    /// when tokens were last refreshed (if any)
    pub last_refreshed_at: Option<String>,
    /// whether credentials were verified (None = not checked, Some(true) = valid)
    pub verified: Option<bool>,
    /// error message if verification failed
    pub verification_error: Option<String>,
    /// whether iroh identity exists
    pub identity_exists: bool,
    /// this instance's node_id (if identity exists)
    pub node_id: Option<String>,
}

/// perform federation setup by authenticating to haruspex
///
/// this is the main setup function - it:
/// 1. generates/loads iroh keypair for P2P identity
/// 2. authenticates with the provided credentials
/// 3. saves the refresh token to the data directory
/// 4. registers node_id with all user's groups
pub async fn setup_federation(
    config: &FederationConfig,
    email: &str,
    password: &str,
) -> GrimoireResult<SetupResult> {
    let app_config = get_config();
    let credentials_path = app_config.federation_credentials_path();

    // 1. generate or load iroh keypair
    let secret_key = identity::load_or_generate_keypair()?;
    let node_id = secret_key.public().to_string();

    // 2. authenticate to haruspex
    let client = HaruspexClient::new(&config.haruspex_url, &config.haruspex_anon_key);
    let session = client.sign_in(email, password).await?;

    // create authenticated client for subsequent calls
    let authed_client = HaruspexClient::new(&config.haruspex_url, &config.haruspex_anon_key)
        .with_token(&session.access_token);

    // 3. save credentials
    let creds = FederationCredentials::new(
        session.user.id.clone(),
        email.to_string(),
        session.refresh_token,
    );
    creds.save(&credentials_path)?;

    // 4. fetch groups and register node_id with each
    let groups = authed_client.list_groups().await.unwrap_or_default();
    let mut groups_registered = 0;

    for group in &groups {
        // get instance name from server config if available
        let instance_name = app_config.server.as_ref().map(|s| s.name.as_str());

        match authed_client
            .register_peer(&node_id, &group.id, None, instance_name)
            .await
        {
            Ok(_) => groups_registered += 1,
            Err(e) => {
                // log but don't fail - registration is best-effort
                eprintln!(
                    "warning: failed to register with group {}: {}",
                    group.name, e
                );
            }
        }
    }

    Ok(SetupResult {
        success: true,
        credentials_path,
        haruspex_user_id: session.user.id,
        email: email.to_string(),
        node_id,
        groups_registered,
        message: format!(
            "federation setup complete - registered with {} groups",
            groups_registered
        ),
    })
}

/// get current setup status
pub fn get_setup_status() -> SetupStatus {
    let config = get_config();
    let credentials_path = config.federation_credentials_path();
    let federation_enabled = config.federation.as_ref().is_some_and(|f| f.enabled);

    // check identity
    let identity_exists = identity::keypair_exists();
    let node_id = identity::get_node_id();

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
        identity_exists,
        node_id,
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

/// get setup status and verify credentials are valid by refreshing the token
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

/// load and refresh credentials, returning an authenticated client
///
/// this is the main entry point for using stored credentials:
/// 1. load credentials from file
/// 2. refresh the access token
/// 3. update stored credentials with new refresh token
/// 4. return authenticated client
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

/// clear stored credentials (logout)
pub fn clear_credentials() -> GrimoireResult<()> {
    let config = get_config();
    let credentials_path = config.federation_credentials_path();
    FederationCredentials::delete(&credentials_path)
}
