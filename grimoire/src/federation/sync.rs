//! federation sync - syncs haruspex group members to freqhole users
//!
//! takes the admin's haruspex credentials, fetches all group members,
//! and creates/updates corresponding freqhole users.

use crate::config::FederationConfig;
use crate::error::GrimoireResult;
use crate::federation::client::{GroupMember, HaruspexClient};
use crate::response::GrimoireResponse;
use crate::users::{User, UserPeerNode, UserRole, UserService};
use std::collections::HashSet;

/// result of a sync operation
#[derive(Debug, Clone)]
pub struct SyncResult {
    /// users that were created or updated
    pub users: Vec<User>,
    /// peer nodes that were registered
    pub peer_nodes: Vec<UserPeerNode>,
    /// statistics about the sync
    pub stats: SyncStats,
}

/// statistics from the sync operation
#[derive(Debug, Clone, Default)]
pub struct SyncStats {
    pub groups_found: usize,
    pub members_found: usize,
    pub users_created: usize,
    pub users_updated: usize,
    pub users_skipped: usize,
    pub peer_nodes_registered: usize,
    pub errors: Vec<String>,
}

/// sync all group members from haruspex to freqhole users
///
/// this is the main sync function - it:
/// 1. authenticates to haruspex with the provided credentials
/// 2. fetches all groups the user is a member of
/// 3. fetches all members from each group
/// 4. creates/updates freqhole users for each unique member
/// 5. registers peer node_ids for any online peers
pub async fn sync_users_from_haruspex(
    config: &FederationConfig,
    email: &str,
    password: &str,
) -> GrimoireResult<SyncResult> {
    let mut stats = SyncStats::default();
    let mut synced_users = Vec::new();
    let mut synced_peer_nodes = Vec::new();

    // create client and authenticate
    let client = HaruspexClient::new(&config.haruspex_url, &config.haruspex_anon_key);
    let session = client.sign_in(email, password).await?;
    let client = HaruspexClient::new(&config.haruspex_url, &config.haruspex_anon_key)
        .with_token(&session.access_token);

    // fetch groups
    let groups = client.list_groups().await?;
    stats.groups_found = groups.len();

    if groups.is_empty() {
        return Ok(SyncResult {
            users: synced_users,
            peer_nodes: synced_peer_nodes,
            stats,
        });
    }

    // fetch all members from all groups
    let mut all_members: Vec<GroupMember> = Vec::new();
    for group in &groups {
        match client.get_group_members(&group.id).await {
            Ok(members) => all_members.extend(members),
            Err(e) => {
                stats.errors.push(format!(
                    "failed to get members of group {}: {}",
                    group.name, e
                ));
            }
        }
    }

    // deduplicate by user_id
    let mut seen_users = HashSet::new();
    all_members.retain(|m| seen_users.insert(m.user_id.clone()));
    stats.members_found = all_members.len();

    // parse default role from config
    let default_role = UserRole::from(config.default_role.as_str());

    // sync each member to freqhole
    let user_service = UserService::new();
    for member in &all_members {
        // use display_name as username, falling back to user_id
        let username = member
            .display_name
            .clone()
            .unwrap_or_else(|| member.user_id.clone());

        match user_service
            .sync_federated_user(
                &username,
                &member.user_id,
                default_role,
                member.avatar_url.as_deref(),
            )
            .await
        {
            GrimoireResponse {
                success: true,
                data: Some(user),
                ..
            } => {
                // check if this was a create or update based on created_at vs updated_at
                if user.created_at == user.updated_at {
                    stats.users_created += 1;
                } else {
                    stats.users_updated += 1;
                }
                synced_users.push(user);
            }
            GrimoireResponse {
                success: false,
                message,
                ..
            } => {
                stats.users_skipped += 1;
                stats
                    .errors
                    .push(format!("failed to sync user {}: {}", username, message));
            }
            _ => {
                stats.users_skipped += 1;
            }
        }
    }

    // fetch online peers to get node_ids
    let peers = client.get_online_peers(Some(60)).await.unwrap_or_default();

    // register peer node_ids for users we synced
    for peer in &peers {
        // find the corresponding synced user
        if let Some(user) = synced_users.iter().find(|u| {
            u.haruspex_user_id
                .as_ref()
                .map_or(false, |h| h == &peer.user_id)
        }) {
            match user_service
                .upsert_peer_node(&user.id, &peer.node_id, peer.instance_name.as_deref())
                .await
            {
                GrimoireResponse {
                    success: true,
                    data: Some(peer_node),
                    ..
                } => {
                    stats.peer_nodes_registered += 1;
                    synced_peer_nodes.push(peer_node);
                }
                GrimoireResponse {
                    success: false,
                    message,
                    ..
                } => {
                    stats.errors.push(format!(
                        "failed to register peer node for {}: {}",
                        user.username, message
                    ));
                }
                _ => {}
            }
        }
    }

    Ok(SyncResult {
        users: synced_users,
        peer_nodes: synced_peer_nodes,
        stats,
    })
}

/// sync users using stored credentials
///
/// convenience function that uses previously stored credentials from setup.
/// fails if credentials are not stored or invalid.
pub async fn sync_users_from_stored_credentials(
    config: &FederationConfig,
) -> GrimoireResult<SyncResult> {
    use crate::federation::setup::get_authenticated_client;

    let mut stats = SyncStats::default();
    let mut synced_users = Vec::new();
    let mut synced_peer_nodes = Vec::new();

    // get authenticated client using stored credentials
    let (client, _creds) = get_authenticated_client().await?;

    // fetch groups
    let groups = client.list_groups().await?;
    stats.groups_found = groups.len();

    if groups.is_empty() {
        return Ok(SyncResult {
            users: synced_users,
            peer_nodes: synced_peer_nodes,
            stats,
        });
    }

    // fetch all members from all groups
    let mut all_members: Vec<GroupMember> = Vec::new();
    for group in &groups {
        match client.get_group_members(&group.id).await {
            Ok(members) => all_members.extend(members),
            Err(e) => {
                stats.errors.push(format!(
                    "failed to get members of group {}: {}",
                    group.name, e
                ));
            }
        }
    }

    // deduplicate by user_id
    let mut seen_users = HashSet::new();
    all_members.retain(|m| seen_users.insert(m.user_id.clone()));
    stats.members_found = all_members.len();

    // parse default role from config
    let default_role = UserRole::from(config.default_role.as_str());

    // sync each member to freqhole
    let user_service = UserService::new();
    for member in &all_members {
        // use display_name as username, falling back to user_id
        let username = member
            .display_name
            .clone()
            .unwrap_or_else(|| member.user_id.clone());

        match user_service
            .sync_federated_user(
                &username,
                &member.user_id,
                default_role.clone(),
                member.avatar_url.as_deref(),
            )
            .await
        {
            GrimoireResponse {
                data: Some(user), ..
            } => {
                // we don't get a was_created flag from this method, count as updated
                stats.users_updated += 1;
                synced_users.push(user);
            }
            GrimoireResponse {
                success: false,
                message,
                ..
            } => {
                stats
                    .errors
                    .push(format!("failed to sync user {}: {}", username, message));
            }
            _ => {
                stats.users_skipped += 1;
            }
        }
    }

    // fetch online peers to get node_ids
    let peers = client.get_online_peers(Some(60)).await.unwrap_or_default();

    // register peer node_ids for users we synced
    for peer in &peers {
        if let Some(user) = synced_users.iter().find(|u| {
            u.haruspex_user_id
                .as_ref()
                .map_or(false, |h| h == &peer.user_id)
        }) {
            match user_service
                .upsert_peer_node(&user.id, &peer.node_id, peer.instance_name.as_deref())
                .await
            {
                GrimoireResponse {
                    success: true,
                    data: Some(peer_node),
                    ..
                } => {
                    stats.peer_nodes_registered += 1;
                    synced_peer_nodes.push(peer_node);
                }
                GrimoireResponse {
                    success: false,
                    message,
                    ..
                } => {
                    stats.errors.push(format!(
                        "failed to register peer node for {}: {}",
                        user.username, message
                    ));
                }
                _ => {}
            }
        }
    }

    Ok(SyncResult {
        users: synced_users,
        peer_nodes: synced_peer_nodes,
        stats,
    })
}
