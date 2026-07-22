//! the auth-flavored subset of the hub_admin protocol: friend crud
//! (allow/remove/block/list), admin promote/demote, and profile get/set - as
//! transport-agnostic request/response types plus a plain async handler over
//! haruspex's own stores.
//!
//! this module ships only auth-related operations. canvas/blob lifecycle ops
//! (disk usage, canvas usage, soft/hard-delete blobs, unsync canvas,
//! pending-knock aggregation, avatar image upload) stay app-side - consuming
//! apps dispatch those directly and call [`HubAdmin::handle`] for the auth
//! ops covered here. this follows the "transport does framing, core does
//! logic" split `protocol::service` already uses - no wire protocol or ALPN
//! handler lives in this module.
//!
//! # store mapping (deliberately different from skein's flat tables)
//!
//! - friend allow/remove/block/list: [`crate::stores::FriendStore`] (already
//!   has the right status vocabulary - allowed/accepted/blocked/pending, no
//!   new store needed).
//! - admin promote/demote: NOT skein's separate `adminz` flat allow-list.
//!   haruspex folds hub-admin rights into the acl model instead, per the
//!   phase doc's mapping table entry for `skein hub_adminz`: a grant of
//!   `Role::Admin` on `Resource::instance()` to the identity resolved from
//!   the target node id (creating an anonymous identity for a never-seen
//!   node id, same as `crate::knock::GrantOnAcceptPolicy`). `is_admin`
//!   checks go through the same [`AclEvaluator`] every other privilege check
//!   in this crate uses - there is no second admin bookkeeping table to keep
//!   in sync.
//! - profile get/set: [`crate::stores::PeerDirectory`]'s `is_self` row for
//!   `local_node_id`. skein's `HubProfile` in-memory `RwLock` is a read
//!   cache in front of the same `userz` table this maps to; haruspex has no
//!   equivalent cache here since `PeerDirectory::get_profile` is already a
//!   single indexed row read - the cache was skein's optimization for a very
//!   hot path (every `profile-request` reply), not a correctness
//!   requirement, and adding one is an app-level (or a later `protocol`
//!   module) concern, not this handler's.
//!
//! # revocation
//!
//! `FriendRemove` and `DemoteAdmin` both fire
//! [`crate::acl::AccessChangeHub::on_access_changed`] for the target's
//! resolved identity, if one is registered - haruspex's equivalent of
//! skein's `HubRepo::cancel_peer` call from the same two request handlers.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::acl::{AccessChangeHub, AccessChangeSubject, AclEvaluator, Caller};
use crate::identity::{DeviceNode, Identity, PeerProfile};
use crate::stores::friend_store::{FriendDirection, FriendEdge, FriendStatus};
use crate::stores::grant_store::{Resource, Role, RoleGrant, Subject};
use crate::stores::{FriendStore, GrantStore, IdentityStore, PeerDirectory};

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

/// a single friend edge as reported to a remote admin, enriched with
/// best-effort peer-directory profile info and the acl-derived admin flag.
/// `avatar_blake3` is the blob reference only (not resolved image bytes,
/// unlike skein's `avatar_data_url` - resolving a blob is a reliquary/media
/// concern, out of scope here; see this module's doc comment).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FriendSummary {
    pub node_id: String,
    pub status: FriendStatus,
    pub updated_at: i64,
    pub display_name: Option<String>,
    pub bio: Option<String>,
    pub avatar_blake3: Option<String>,
    pub is_admin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum HubAdminRequest {
    /// pre-approve a peer (mirrors skein's `AdminRequest::Allow`). never
    /// demotes an already-`Accepted` friend back to `Allowed`.
    FriendAllow { node_id: String },
    /// list every friend edge, enriched with profile + admin info.
    FriendList,
    /// remove a peer from the friend store entirely, firing
    /// `on_access_changed` for its resolved identity.
    FriendRemove { node_id: String },
    /// block a peer outright.
    FriendBlock { node_id: String },
    /// grant a peer hub-admin rights (a `Role::Admin` grant on the instance
    /// resource - see module docs).
    PromoteAdmin { node_id: String },
    /// revoke a peer's hub-admin rights, firing `on_access_changed`.
    DemoteAdmin { node_id: String },
    /// read the local peer's own profile.
    GetProfile,
    /// update one or more local profile fields in place - `None` leaves a
    /// field unchanged (`PeerDirectory::upsert_profile`'s coalesce
    /// semantics). rejects an empty display name and enforces the same
    /// length caps skein's `SetHubProfile` does (display name <= 64, bio
    /// <= 512 chars).
    SetProfile {
        display_name: Option<String>,
        bio: Option<String>,
        accent_color: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum HubAdminResponse {
    FriendAllowed {
        node_id: String,
        status: FriendStatus,
    },
    FriendList {
        friends: Vec<FriendSummary>,
    },
    FriendRemoved {
        node_id: String,
    },
    FriendBlocked {
        node_id: String,
    },
    /// response to `PromoteAdmin`/`DemoteAdmin`.
    AdminChanged {
        node_id: String,
        is_admin: bool,
    },
    /// caller's role fails `Caller::is_admin` - checked once up front in
    /// `HubAdmin::handle`, before any request-specific logic runs.
    NotAdmin,
    /// response to `GetProfile`/`SetProfile`.
    Profile {
        display_name: Option<String>,
        bio: Option<String>,
        accent_color: Option<String>,
    },
    /// request-level failure (bad node_id, store error, validation, etc).
    Error {
        message: String,
    },
}

// ---------------------------------------------------------------------------
// handler
// ---------------------------------------------------------------------------

/// bundles the store handles [`HubAdmin::handle`] needs. transport-agnostic
/// by construction - holds no iroh (or any other transport) types, matching
/// `protocol::service::dispatch`'s discipline. a transport constructs one of
/// these (typically once, wrapped in an `Arc` alongside its other long-lived
/// state) and calls `handle` per inbound request.
pub struct HubAdmin<'a> {
    /// this peer's own node id - the row `GetProfile`/`SetProfile` operate
    /// on, and the actor stamped as `RoleGrant::granted_by` on promote.
    pub local_node_id: String,
    pub identities: &'a dyn IdentityStore,
    pub friends: &'a dyn FriendStore,
    pub peers: &'a dyn PeerDirectory,
    pub grants: &'a dyn GrantStore,
    pub evaluator: &'a AclEvaluator,
    /// the live-revocation hook `FriendRemove`/`DemoteAdmin` fire for the
    /// target's resolved identity. `None` skips revocation notification
    /// entirely (e.g. a caller with no live-connection registry to speak
    /// of, such as a test harness).
    pub access_changed: Option<&'a AccessChangeHub>,
}

impl<'a> HubAdmin<'a> {
    /// dispatch one request. checks `caller.is_admin()` up front - every
    /// request in this subset is privileged, so the admin check runs once
    /// before any request-specific matching.
    pub async fn handle(
        &self,
        caller: &Caller,
        request: HubAdminRequest,
        now: i64,
    ) -> HubAdminResponse {
        if !caller.is_admin() {
            return HubAdminResponse::NotAdmin;
        }

        match request {
            HubAdminRequest::FriendAllow { node_id } => self.friend_allow(&node_id, now).await,
            HubAdminRequest::FriendList => self.friend_list(now).await,
            HubAdminRequest::FriendRemove { node_id } => self.friend_remove(&node_id).await,
            HubAdminRequest::FriendBlock { node_id } => self.friend_block(&node_id, now).await,
            HubAdminRequest::PromoteAdmin { node_id } => self.set_admin(&node_id, true, now).await,
            HubAdminRequest::DemoteAdmin { node_id } => self.set_admin(&node_id, false, now).await,
            HubAdminRequest::GetProfile => self.get_profile().await,
            HubAdminRequest::SetProfile {
                display_name,
                bio,
                accent_color,
            } => self.set_profile(display_name, bio, accent_color, now).await,
        }
    }

    async fn friend_allow(&self, node_id: &str, now: i64) -> HubAdminResponse {
        let node_id = node_id.trim();
        if node_id.is_empty() {
            return HubAdminResponse::Error {
                message: "node_id cannot be empty".to_string(),
            };
        }

        let existing = match self.friends.get_edge(node_id).await {
            Ok(e) => e,
            Err(e) => {
                return HubAdminResponse::Error {
                    message: format!("friend lookup failed: {e}"),
                }
            }
        };
        // mirror skein's promote-or-leave semantics: never demote an
        // already-accepted friend back to allowed.
        if matches!(
            existing.as_ref().map(|f| f.status),
            Some(FriendStatus::Accepted)
        ) {
            return HubAdminResponse::FriendAllowed {
                node_id: node_id.to_string(),
                status: FriendStatus::Accepted,
            };
        }

        let edge = FriendEdge {
            node_id: node_id.to_string(),
            status: FriendStatus::Allowed,
            direction: existing
                .as_ref()
                .map(|e| e.direction)
                .unwrap_or(FriendDirection::Inbound),
            alias: existing.as_ref().and_then(|e| e.alias.clone()),
            group_name: existing.as_ref().and_then(|e| e.group_name.clone()),
            created_at: existing.as_ref().map(|e| e.created_at).unwrap_or(now),
            updated_at: now,
        };
        match self.friends.upsert_edge(edge).await {
            Ok(e) => HubAdminResponse::FriendAllowed {
                node_id: e.node_id,
                status: e.status,
            },
            Err(e) => HubAdminResponse::Error {
                message: format!("friend upsert failed: {e}"),
            },
        }
    }

    async fn friend_list(&self, now: i64) -> HubAdminResponse {
        let edges = match self.friends.list_edges(None).await {
            Ok(e) => e,
            Err(e) => {
                return HubAdminResponse::Error {
                    message: format!("friend list failed: {e}"),
                }
            }
        };

        let mut summaries = Vec::with_capacity(edges.len());
        for edge in edges {
            let profile = self.peers.get_profile(&edge.node_id).await.ok().flatten();
            let is_admin = self.is_admin_node(&edge.node_id, now).await;
            summaries.push(FriendSummary {
                node_id: edge.node_id,
                status: edge.status,
                updated_at: edge.updated_at,
                display_name: profile.as_ref().and_then(|p| p.display_name.clone()),
                bio: profile.as_ref().and_then(|p| p.bio.clone()),
                avatar_blake3: profile.as_ref().and_then(|p| p.avatar_blake3.clone()),
                is_admin,
            });
        }
        HubAdminResponse::FriendList { friends: summaries }
    }

    async fn friend_remove(&self, node_id: &str) -> HubAdminResponse {
        let node_id = node_id.trim();
        if node_id.is_empty() {
            return HubAdminResponse::Error {
                message: "node_id cannot be empty".to_string(),
            };
        }

        if let Err(e) = self.friends.remove_edge(node_id).await {
            return HubAdminResponse::Error {
                message: format!("friend remove failed: {e}"),
            };
        }

        self.notify_access_changed(node_id).await;
        HubAdminResponse::FriendRemoved {
            node_id: node_id.to_string(),
        }
    }

    async fn friend_block(&self, node_id: &str, now: i64) -> HubAdminResponse {
        let node_id = node_id.trim();
        if node_id.is_empty() {
            return HubAdminResponse::Error {
                message: "node_id cannot be empty".to_string(),
            };
        }

        let existing = self.friends.get_edge(node_id).await.ok().flatten();
        let edge = FriendEdge {
            node_id: node_id.to_string(),
            status: FriendStatus::Blocked,
            direction: existing
                .as_ref()
                .map(|e| e.direction)
                .unwrap_or(FriendDirection::Inbound),
            alias: existing.as_ref().and_then(|e| e.alias.clone()),
            group_name: existing.as_ref().and_then(|e| e.group_name.clone()),
            created_at: existing.as_ref().map(|e| e.created_at).unwrap_or(now),
            updated_at: now,
        };
        match self.friends.upsert_edge(edge).await {
            Ok(_) => HubAdminResponse::FriendBlocked {
                node_id: node_id.to_string(),
            },
            Err(e) => HubAdminResponse::Error {
                message: format!("friend upsert failed: {e}"),
            },
        }
    }

    async fn set_admin(&self, node_id: &str, make_admin: bool, now: i64) -> HubAdminResponse {
        let node_id = node_id.trim();
        if node_id.is_empty() {
            return HubAdminResponse::Error {
                message: "node_id cannot be empty".to_string(),
            };
        }

        let identity_id = if make_admin {
            match self.resolve_or_create_identity(node_id, now).await {
                Some(id) => id,
                None => {
                    return HubAdminResponse::Error {
                        message: "failed to resolve identity for node id".to_string(),
                    }
                }
            }
        } else {
            match self.identities.resolve_device(node_id).await {
                Ok(Some(device)) => device.identity_id,
                // never registered at all - already not admin, nothing to revoke.
                Ok(None) => {
                    return HubAdminResponse::AdminChanged {
                        node_id: node_id.to_string(),
                        is_admin: false,
                    }
                }
                Err(e) => {
                    return HubAdminResponse::Error {
                        message: format!("identity lookup failed: {e}"),
                    }
                }
            }
        };

        let result = if make_admin {
            self.grants
                .grant(RoleGrant {
                    subject: Subject::Identity { identity_id },
                    resource: Resource::instance(),
                    role: Role::Admin,
                    granted_by: self.local_node_id.clone(),
                    granted_at: now,
                    expires_at: None,
                })
                .await
                .map(|_| ())
        } else {
            self.grants
                .revoke(Subject::Identity { identity_id }, Resource::instance())
                .await
        };

        match result {
            Ok(()) => {
                if !make_admin {
                    if let Some(hub) = self.access_changed {
                        hub.on_access_changed(AccessChangeSubject::Identity(identity_id))
                            .await;
                    }
                }
                HubAdminResponse::AdminChanged {
                    node_id: node_id.to_string(),
                    is_admin: make_admin,
                }
            }
            Err(e) => HubAdminResponse::Error {
                message: format!("grant update failed: {e}"),
            },
        }
    }

    async fn get_profile(&self) -> HubAdminResponse {
        match self.peers.get_profile(&self.local_node_id).await {
            Ok(Some(p)) => HubAdminResponse::Profile {
                display_name: p.display_name,
                bio: p.bio,
                accent_color: p.accent_color,
            },
            Ok(None) => HubAdminResponse::Profile {
                display_name: None,
                bio: None,
                accent_color: None,
            },
            Err(e) => HubAdminResponse::Error {
                message: format!("profile lookup failed: {e}"),
            },
        }
    }

    async fn set_profile(
        &self,
        display_name: Option<String>,
        bio: Option<String>,
        accent_color: Option<String>,
        now: i64,
    ) -> HubAdminResponse {
        if let Some(name) = &display_name {
            if name.trim().is_empty() {
                return HubAdminResponse::Error {
                    message: "display name cannot be empty".to_string(),
                };
            }
            if name.len() > 64 {
                return HubAdminResponse::Error {
                    message: "display name exceeds 64 characters".to_string(),
                };
            }
        }
        if let Some(bio) = &bio {
            if bio.len() > 512 {
                return HubAdminResponse::Error {
                    message: "bio exceeds 512 characters".to_string(),
                };
            }
        }

        // upsert_profile is a coalesce-based partial upsert (see
        // PeerDirectory's doc comment) - fields left `None` here leave any
        // existing value alone, and this call also bootstraps the row on a
        // fresh peer with no prior self profile at all.
        let profile = PeerProfile {
            node_id: self.local_node_id.clone(),
            display_name,
            alias: None,
            bio,
            avatar_blake3: None,
            accent_color,
            is_self: true,
            is_hub: false,
            first_seen: now,
            last_seen: now,
        };
        match self.peers.upsert_profile(profile).await {
            Ok(p) => HubAdminResponse::Profile {
                display_name: p.display_name,
                bio: p.bio,
                accent_color: p.accent_color,
            },
            Err(e) => HubAdminResponse::Error {
                message: format!("profile update failed: {e}"),
            },
        }
    }

    /// fires `on_access_changed` for `node_id`'s resolved identity, if any -
    /// a no-op if the node id never resolved to one or `access_changed` was
    /// not configured. see module docs.
    async fn notify_access_changed(&self, node_id: &str) {
        let Some(hub) = self.access_changed else {
            return;
        };
        if let Ok(Some(device)) = self.identities.resolve_device(node_id).await {
            hub.on_access_changed(AccessChangeSubject::Identity(device.identity_id))
                .await;
        }
    }

    /// resolve `node_id`'s effective role on the instance resource and check
    /// it against `Role::Admin` - unregistered node ids are never admin.
    async fn is_admin_node(&self, node_id: &str, now: i64) -> bool {
        let Ok(Some(device)) = self.identities.resolve_device(node_id).await else {
            return false;
        };
        matches!(
            self.evaluator
                .effective_role(device.identity_id, &Resource::instance(), &[], now, None)
                .await,
            Ok(Some(role)) if role >= Role::Admin
        )
    }

    /// resolves `node_id` to its identity, creating a fresh anonymous
    /// identity (no username) and linking the device if this is the first
    /// time the node id has been seen - the same pattern
    /// `knock::GrantOnAcceptPolicy` uses.
    async fn resolve_or_create_identity(&self, node_id: &str, now: i64) -> Option<Uuid> {
        if let Ok(Some(device)) = self.identities.resolve_device(node_id).await {
            return Some(device.identity_id);
        }

        let identity = Identity {
            id: Uuid::new_v4(),
            username: None,
            created_at: now,
            metadata: None,
            deleted_at: None,
        };
        let created = self.identities.upsert_identity(identity).await.ok()?;
        self.identities
            .add_device(DeviceNode {
                identity_id: created.id,
                node_id: node_id.to_string(),
                instance_name: None,
                created_at: now,
                last_seen_at: now,
                deleted_at: None,
            })
            .await
            .ok()?;
        Some(created.id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite::{
        test_pool, SqliteFriendStore, SqliteGrantStore, SqliteGroupStore, SqliteIdentityStore,
        SqlitePeerDirectory,
    };
    use sqlx::SqlitePool;
    use std::sync::Arc;

    struct Harness {
        identities: SqliteIdentityStore,
        friends: SqliteFriendStore,
        peers: SqlitePeerDirectory,
        grants: SqliteGrantStore,
        evaluator: AclEvaluator,
        access_changed: AccessChangeHub,
    }

    async fn harness() -> Harness {
        let pool: SqlitePool = test_pool().await;
        let grants: Arc<dyn GrantStore> = Arc::new(SqliteGrantStore::new(pool.clone()));
        let groups = Arc::new(SqliteGroupStore::new(pool.clone()));
        Harness {
            identities: SqliteIdentityStore::new(pool.clone()),
            friends: SqliteFriendStore::new(pool.clone()),
            peers: SqlitePeerDirectory::new(pool.clone()),
            grants: SqliteGrantStore::new(pool.clone()),
            evaluator: AclEvaluator::new(grants, groups),
            access_changed: AccessChangeHub::new(),
        }
    }

    fn admin<'a>(h: &'a Harness) -> HubAdmin<'a> {
        HubAdmin {
            local_node_id: "hub-node".to_string(),
            identities: &h.identities,
            friends: &h.friends,
            peers: &h.peers,
            grants: &h.grants,
            evaluator: &h.evaluator,
            access_changed: Some(&h.access_changed),
        }
    }

    fn admin_caller() -> Caller {
        Caller::new("admin-node", Role::Admin)
    }

    fn viewer_caller() -> Caller {
        Caller::new("viewer-node", Role::Viewer)
    }

    #[tokio::test]
    async fn non_admin_caller_gets_not_admin_for_every_request() {
        let h = harness().await;
        let handler = admin(&h);
        let response = handler
            .handle(&viewer_caller(), HubAdminRequest::FriendList, 100)
            .await;
        assert_eq!(response, HubAdminResponse::NotAdmin);
    }

    #[tokio::test]
    async fn friend_allow_creates_an_allowed_edge() {
        let h = harness().await;
        let handler = admin(&h);
        let response = handler
            .handle(
                &admin_caller(),
                HubAdminRequest::FriendAllow {
                    node_id: "peer-a".to_string(),
                },
                100,
            )
            .await;
        assert_eq!(
            response,
            HubAdminResponse::FriendAllowed {
                node_id: "peer-a".to_string(),
                status: FriendStatus::Allowed,
            }
        );
    }

    #[tokio::test]
    async fn friend_allow_does_not_demote_an_accepted_friend() {
        let h = harness().await;
        h.friends
            .upsert_edge(FriendEdge {
                node_id: "peer-a".to_string(),
                status: FriendStatus::Accepted,
                direction: FriendDirection::Inbound,
                alias: None,
                group_name: None,
                created_at: 1,
                updated_at: 1,
            })
            .await
            .unwrap();
        let handler = admin(&h);

        let response = handler
            .handle(
                &admin_caller(),
                HubAdminRequest::FriendAllow {
                    node_id: "peer-a".to_string(),
                },
                100,
            )
            .await;

        assert_eq!(
            response,
            HubAdminResponse::FriendAllowed {
                node_id: "peer-a".to_string(),
                status: FriendStatus::Accepted,
            }
        );
    }

    #[tokio::test]
    async fn friend_list_enriches_with_profile_and_admin_status() {
        let h = harness().await;
        let handler = admin(&h);
        handler
            .handle(
                &admin_caller(),
                HubAdminRequest::FriendAllow {
                    node_id: "peer-a".to_string(),
                },
                100,
            )
            .await;
        h.peers
            .upsert_profile(PeerProfile {
                node_id: "peer-a".to_string(),
                display_name: Some("alice".to_string()),
                alias: None,
                bio: Some("hi".to_string()),
                avatar_blake3: None,
                accent_color: None,
                is_self: false,
                is_hub: false,
                first_seen: 100,
                last_seen: 100,
            })
            .await
            .unwrap();
        handler
            .handle(
                &admin_caller(),
                HubAdminRequest::PromoteAdmin {
                    node_id: "peer-a".to_string(),
                },
                100,
            )
            .await;

        let response = handler
            .handle(&admin_caller(), HubAdminRequest::FriendList, 100)
            .await;
        let HubAdminResponse::FriendList { friends } = response else {
            panic!("expected FriendList");
        };
        assert_eq!(friends.len(), 1);
        assert_eq!(friends[0].node_id, "peer-a");
        assert_eq!(friends[0].display_name.as_deref(), Some("alice"));
        assert!(friends[0].is_admin);
    }

    #[tokio::test]
    async fn friend_remove_deletes_the_edge_and_fires_access_changed() {
        let h = harness().await;
        let handler = admin(&h);
        handler
            .handle(
                &admin_caller(),
                HubAdminRequest::FriendAllow {
                    node_id: "peer-a".to_string(),
                },
                100,
            )
            .await;
        // register a device for peer-a so on_access_changed has something
        // to resolve and fire against.
        let identity = Identity {
            id: Uuid::new_v4(),
            username: None,
            created_at: 100,
            metadata: None,
            deleted_at: None,
        };
        h.identities
            .upsert_identity(identity.clone())
            .await
            .unwrap();
        h.identities
            .add_device(DeviceNode {
                identity_id: identity.id,
                node_id: "peer-a".to_string(),
                instance_name: None,
                created_at: 100,
                last_seen_at: 100,
                deleted_at: None,
            })
            .await
            .unwrap();
        let token = tokio_util::sync::CancellationToken::new();
        h.access_changed
            .register(AccessChangeSubject::Identity(identity.id), token.clone())
            .await;

        let response = handler
            .handle(
                &admin_caller(),
                HubAdminRequest::FriendRemove {
                    node_id: "peer-a".to_string(),
                },
                100,
            )
            .await;

        assert_eq!(
            response,
            HubAdminResponse::FriendRemoved {
                node_id: "peer-a".to_string()
            }
        );
        assert!(h.friends.get_edge("peer-a").await.unwrap().is_none());
        assert!(token.is_cancelled());
    }

    #[tokio::test]
    async fn friend_block_sets_blocked_status() {
        let h = harness().await;
        let handler = admin(&h);
        let response = handler
            .handle(
                &admin_caller(),
                HubAdminRequest::FriendBlock {
                    node_id: "peer-a".to_string(),
                },
                100,
            )
            .await;
        assert_eq!(
            response,
            HubAdminResponse::FriendBlocked {
                node_id: "peer-a".to_string()
            }
        );
        let edge = h.friends.get_edge("peer-a").await.unwrap().unwrap();
        assert_eq!(edge.status, FriendStatus::Blocked);
    }

    #[tokio::test]
    async fn promote_then_demote_admin_round_trips() {
        let h = harness().await;
        let handler = admin(&h);

        let promoted = handler
            .handle(
                &admin_caller(),
                HubAdminRequest::PromoteAdmin {
                    node_id: "peer-a".to_string(),
                },
                100,
            )
            .await;
        assert_eq!(
            promoted,
            HubAdminResponse::AdminChanged {
                node_id: "peer-a".to_string(),
                is_admin: true,
            }
        );
        assert!(handler.is_admin_node("peer-a", 100).await);

        let demoted = handler
            .handle(
                &admin_caller(),
                HubAdminRequest::DemoteAdmin {
                    node_id: "peer-a".to_string(),
                },
                101,
            )
            .await;
        assert_eq!(
            demoted,
            HubAdminResponse::AdminChanged {
                node_id: "peer-a".to_string(),
                is_admin: false,
            }
        );
        assert!(!handler.is_admin_node("peer-a", 101).await);
    }

    #[tokio::test]
    async fn demote_admin_for_a_never_seen_node_is_a_no_op_success() {
        let h = harness().await;
        let handler = admin(&h);
        let response = handler
            .handle(
                &admin_caller(),
                HubAdminRequest::DemoteAdmin {
                    node_id: "never-seen".to_string(),
                },
                100,
            )
            .await;
        assert_eq!(
            response,
            HubAdminResponse::AdminChanged {
                node_id: "never-seen".to_string(),
                is_admin: false,
            }
        );
    }

    #[tokio::test]
    async fn demote_admin_fires_access_changed() {
        let h = harness().await;
        let handler = admin(&h);
        handler
            .handle(
                &admin_caller(),
                HubAdminRequest::PromoteAdmin {
                    node_id: "peer-a".to_string(),
                },
                100,
            )
            .await;
        let device = h
            .identities
            .resolve_device("peer-a")
            .await
            .unwrap()
            .unwrap();
        let token = tokio_util::sync::CancellationToken::new();
        h.access_changed
            .register(
                AccessChangeSubject::Identity(device.identity_id),
                token.clone(),
            )
            .await;

        handler
            .handle(
                &admin_caller(),
                HubAdminRequest::DemoteAdmin {
                    node_id: "peer-a".to_string(),
                },
                101,
            )
            .await;

        assert!(token.is_cancelled());
    }

    #[tokio::test]
    async fn get_profile_on_a_fresh_peer_returns_all_none() {
        let h = harness().await;
        let handler = admin(&h);
        let response = handler
            .handle(&admin_caller(), HubAdminRequest::GetProfile, 100)
            .await;
        assert_eq!(
            response,
            HubAdminResponse::Profile {
                display_name: None,
                bio: None,
                accent_color: None,
            }
        );
    }

    #[tokio::test]
    async fn set_profile_then_get_profile_round_trips() {
        let h = harness().await;
        let handler = admin(&h);

        let set = handler
            .handle(
                &admin_caller(),
                HubAdminRequest::SetProfile {
                    display_name: Some("hub".to_string()),
                    bio: Some("a friendly hub".to_string()),
                    accent_color: Some("#00ff00".to_string()),
                },
                100,
            )
            .await;
        assert_eq!(
            set,
            HubAdminResponse::Profile {
                display_name: Some("hub".to_string()),
                bio: Some("a friendly hub".to_string()),
                accent_color: Some("#00ff00".to_string()),
            }
        );

        let get = handler
            .handle(&admin_caller(), HubAdminRequest::GetProfile, 200)
            .await;
        assert_eq!(get, set);
    }

    #[tokio::test]
    async fn set_profile_partial_update_leaves_other_fields_alone() {
        let h = harness().await;
        let handler = admin(&h);
        handler
            .handle(
                &admin_caller(),
                HubAdminRequest::SetProfile {
                    display_name: Some("hub".to_string()),
                    bio: Some("original bio".to_string()),
                    accent_color: None,
                },
                100,
            )
            .await;

        let response = handler
            .handle(
                &admin_caller(),
                HubAdminRequest::SetProfile {
                    display_name: None,
                    bio: Some("updated bio".to_string()),
                    accent_color: None,
                },
                200,
            )
            .await;

        assert_eq!(
            response,
            HubAdminResponse::Profile {
                display_name: Some("hub".to_string()),
                bio: Some("updated bio".to_string()),
                accent_color: None,
            }
        );
    }

    #[tokio::test]
    async fn set_profile_rejects_an_empty_display_name() {
        let h = harness().await;
        let handler = admin(&h);
        let response = handler
            .handle(
                &admin_caller(),
                HubAdminRequest::SetProfile {
                    display_name: Some("   ".to_string()),
                    bio: None,
                    accent_color: None,
                },
                100,
            )
            .await;
        assert!(matches!(response, HubAdminResponse::Error { .. }));
    }

    #[tokio::test]
    async fn set_profile_rejects_an_oversized_bio() {
        let h = harness().await;
        let handler = admin(&h);
        let response = handler
            .handle(
                &admin_caller(),
                HubAdminRequest::SetProfile {
                    display_name: None,
                    bio: Some("x".repeat(513)),
                    accent_color: None,
                },
                100,
            )
            .await;
        assert!(matches!(response, HubAdminResponse::Error { .. }));
    }

    #[tokio::test]
    async fn empty_node_id_is_rejected_for_friend_ops() {
        let h = harness().await;
        let handler = admin(&h);
        let response = handler
            .handle(
                &admin_caller(),
                HubAdminRequest::FriendAllow {
                    node_id: "   ".to_string(),
                },
                100,
            )
            .await;
        assert!(matches!(response, HubAdminResponse::Error { .. }));
    }
}
