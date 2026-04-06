//! peer resolver - resolves node_id to local freqhole user
//!
//! when a peer connects via P2P, we need to know who they are.
//! this module looks up the node_id in haruspex, and optionally
//! creates a local user if auto_create_users is enabled.

use crate::config::get_config;
use crate::federation::client::NodeIdUserInfo;
use crate::federation::setup::get_authenticated_client;
use crate::response::GrimoireResponse;
use crate::users::{User, UserService};
use serde::{Deserialize, Serialize};

/// result of resolving a peer's node_id
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedPeer {
    /// the node_id that was looked up
    pub node_id: String,
    /// the resolved freqhole user (if found or created)
    pub user: Option<User>,
    /// info from haruspex (if lookup succeeded)
    pub haruspex_info: Option<NodeIdUserInfo>,
    /// whether a new user was created
    pub user_created: bool,
    /// why resolution failed (if it did)
    pub error: Option<String>,
}

/// resolve a peer's node_id to a local freqhole user
///
/// this is the main entry point for P2P peer resolution:
/// 1. check if federation is enabled and credentials exist
/// 2. lookup node_id in haruspex
/// 3. if found, check if we have a local user with that haruspex_user_id
/// 4. if auto_create_users is enabled and no local user exists, create one
/// 5. return the resolved user info
pub async fn resolve_peer(node_id: &str) -> ResolvedPeer {
    let config = get_config();

    // check federation config
    let federation_config = match &config.federation {
        Some(fed) if fed.enabled => fed,
        _ => {
            return ResolvedPeer {
                node_id: node_id.to_string(),
                user: None,
                haruspex_info: None,
                user_created: false,
                error: Some("federation not enabled".to_string()),
            };
        }
    };

    // check if haruspex is configured - if not, can't do lookup
    if !is_haruspex_configured() {
        return ResolvedPeer {
            node_id: node_id.to_string(),
            user: None,
            haruspex_info: None,
            user_created: false,
            error: Some(
                "haruspex not configured (missing haruspex_url or haruspex_anon_key)".to_string(),
            ),
        };
    }

    // get authenticated client (this will refresh token if needed)
    let (client, _creds) = match get_authenticated_client().await {
        Ok(c) => c,
        Err(e) => {
            return ResolvedPeer {
                node_id: node_id.to_string(),
                user: None,
                haruspex_info: None,
                user_created: false,
                error: Some(format!("failed to authenticate: {}", e)),
            };
        }
    };

    // lookup node_id in haruspex
    let haruspex_info = match client.get_user_by_node_id(node_id).await {
        Ok(Some(info)) => info,
        Ok(None) => {
            // node_id not found or not in shared group
            return ResolvedPeer {
                node_id: node_id.to_string(),
                user: None,
                haruspex_info: None,
                user_created: false,
                error: Some("node_id not found or not in shared group".to_string()),
            };
        }
        Err(e) => {
            return ResolvedPeer {
                node_id: node_id.to_string(),
                user: None,
                haruspex_info: None,
                user_created: false,
                error: Some(format!("haruspex lookup failed: {}", e)),
            };
        }
    };

    // check if we already have a local user with this haruspex_user_id
    let user_service = UserService::new();
    let existing_user = user_service
        .get_by_haruspex_user_id(&haruspex_info.user_id)
        .await;

    if let GrimoireResponse {
        success: true,
        data: Some(user),
        ..
    } = existing_user
    {
        // user already exists locally - ensure they have an API key
        let user_with_key = match user_service.ensure_api_key(user).await {
            GrimoireResponse {
                success: true,
                data: Some(u),
                ..
            } => u,
            _ => {
                return ResolvedPeer {
                    node_id: node_id.to_string(),
                    user: None,
                    haruspex_info: Some(haruspex_info),
                    user_created: false,
                    error: Some("failed to ensure api key for existing user".to_string()),
                };
            }
        };

        return ResolvedPeer {
            node_id: node_id.to_string(),
            user: Some(user_with_key),
            haruspex_info: Some(haruspex_info),
            user_created: false,
            error: None,
        };
    }

    // no local user - check if auto_create_users is enabled
    if !federation_config.auto_create_users {
        return ResolvedPeer {
            node_id: node_id.to_string(),
            user: None,
            haruspex_info: Some(haruspex_info),
            user_created: false,
            error: Some("auto_create_users is disabled".to_string()),
        };
    }

    // create local user via shared resolve_or_create path
    let social_service = crate::social::service::SocialService::new();
    let display_name = haruspex_info.display_name.as_deref();
    match social_service
        .resolve_or_create_user_for_node(node_id, display_name)
        .await
    {
        Ok(resolved) => {
            // fetch full user record
            match user_service.get_user(&resolved.user_id).await {
                GrimoireResponse {
                    success: true,
                    data: Some(user),
                    ..
                } => {
                    // ensure API key exists
                    let user_with_key = match user_service.ensure_api_key(user).await {
                        GrimoireResponse {
                            success: true,
                            data: Some(u),
                            ..
                        } => u,
                        _ => {
                            return ResolvedPeer {
                                node_id: node_id.to_string(),
                                user: None,
                                haruspex_info: Some(haruspex_info),
                                user_created: resolved.created,
                                error: Some("failed to ensure api key for new user".to_string()),
                            };
                        }
                    };
                    ResolvedPeer {
                        node_id: node_id.to_string(),
                        user: Some(user_with_key),
                        haruspex_info: Some(haruspex_info),
                        user_created: resolved.created,
                        error: None,
                    }
                }
                _ => ResolvedPeer {
                    node_id: node_id.to_string(),
                    user: None,
                    haruspex_info: Some(haruspex_info),
                    user_created: resolved.created,
                    error: Some("failed to fetch user after resolve".to_string()),
                },
            }
        }
        Err(e) => ResolvedPeer {
            node_id: node_id.to_string(),
            user: None,
            haruspex_info: Some(haruspex_info),
            user_created: false,
            error: Some(format!("failed to resolve user for node: {}", e)),
        },
    }
}

/// check if a node_id belongs to a known peer
///
/// lighter-weight check that only looks at local database,
/// without contacting haruspex. returns true if we have a
/// peer_node record for this node_id.
pub async fn is_known_peer(node_id: &str) -> bool {
    let user_service = UserService::new();
    match user_service.get_user_by_peer_node_id(node_id).await {
        GrimoireResponse {
            success: true,
            data: Some(_),
            ..
        } => true,
        _ => false,
    }
}

/// get local user by peer node_id (no haruspex lookup)
///
/// returns the local user if we have a peer_node record for this node_id.
pub async fn get_local_user_by_node_id(node_id: &str) -> Option<User> {
    let user_service = UserService::new();
    match user_service.get_user_by_peer_node_id(node_id).await {
        GrimoireResponse {
            success: true,
            data: Some(user),
            ..
        } => Some(user),
        _ => None,
    }
}

/// check if haruspex is configured (has url and anon_key)
pub(crate) fn is_haruspex_configured() -> bool {
    let config = get_config();
    let Some(f) = config.federation.as_ref().filter(|f| f.enabled) else {
        return false;
    };
    !f.haruspex_url.is_empty() && !f.haruspex_anon_key.is_empty()
}

/// check if knocking is enabled in config
pub(crate) fn is_knocking_enabled() -> bool {
    let config = get_config();
    config
        .federation
        .as_ref()
        .is_some_and(|f| f.enabled && f.knocking_enabled)
}
