//! knock requests - P2P access request management
//!
//! allows unknown peers to request access by "knocking" with a username and message.
//! admins can approve or reject requests via CLI or tauri wizard.
//!
//! the knock lifecycle itself (dedup, decision log, pending/accepted/denied
//! status) lives in haruspex's `KnockStore`/`SqliteKnockStore`, backed by
//! haruspex's own database (see `database::connect_haruspex`). this module
//! adapts that shared store onto grimoire's wire types (`KnockRequest`,
//! `KnockStatus`, ...) and supplies grimoire's own account-creation side
//! effect for knock acceptance via `GrimoireKnockPolicy`, an implementation
//! of haruspex's `KnockPolicy` seam.

use crate::database;
use crate::error::{GrimoireError, GrimoireResult};
use crate::events::{emit, GrimoireEvent};
use crate::response::GrimoireResponse;
use crate::users::UserRole;
use haruspex::knock::{KnockOutcome, KnockPolicy, PolicyError};
use haruspex::sqlite::{SqliteIdentityStore, SqliteKnockStore};
use haruspex::stores::knock_store::{
    KnockDecision, KnockDirection, KnockRecord as HaruspexKnockRecord, KnockScope,
    KnockStatus as HaruspexKnockStatus,
};
use haruspex::stores::{IdentityStore, KnockStore as HaruspexKnockStore};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use time::OffsetDateTime;
use uuid::Uuid;
use zod_gen::ZodSchema;
use zod_gen_derive::ZodSchema;

/// knock request status
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KnockStatus {
    Pending,
    Accepted,
    Rejected,
}

impl ZodSchema for KnockStatus {
    fn zod_schema() -> String {
        r#"z.union([z.literal("pending"), z.literal("accepted"), z.literal("rejected")])"#
            .to_string()
    }
}

impl std::fmt::Display for KnockStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            KnockStatus::Pending => write!(f, "pending"),
            KnockStatus::Accepted => write!(f, "accepted"),
            KnockStatus::Rejected => write!(f, "rejected"),
        }
    }
}

impl From<String> for KnockStatus {
    fn from(s: String) -> Self {
        match s.as_str() {
            "accepted" => KnockStatus::Accepted,
            "rejected" => KnockStatus::Rejected,
            _ => KnockStatus::Pending,
        }
    }
}

/// knock request for API responses
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct KnockRequest {
    pub id: String,
    pub node_id: String,
    pub username: String,
    pub message: String,
    pub status: KnockStatus,
    pub created_at: i64,
    pub processed_at: Option<i64>,
    pub processed_by: Option<String>,
    /// true when this knock's `node_id` matches a peer node that has
    /// been soft-deleted (either individually or via cascade from a
    /// soft-deleted user). the admin ui surfaces this so the operator
    /// knows to restore the peer/user before accepting, rather than
    /// silently re-creating a new user account for an old device.
    /// populated by `list_knocks`; other accessors leave this `None`.
    #[serde(default)]
    pub from_deleted_peer: Option<bool>,
    /// when `from_deleted_peer` is true, the username of the
    /// soft-deleted user this peer belongs to (for ui labeling).
    #[serde(default)]
    pub deleted_user_username: Option<String>,
}

/// payload sent by a remote peer when a device link completes
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct DeviceLinkedCallbackRequest {
    pub peer_addr: String,
    pub server_name: String,
}

/// payload sent by a remote peer when a knock request is accepted
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct KnockAcceptedCallbackRequest {
    pub peer_addr: String,
    pub server_name: String,
}

/// request to create a knock
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateKnockRequest {
    pub username: String,
    pub message: String,
}

/// request to accept/process a knock
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ProcessKnockRequest {
    /// optional username override (defaults to knock's username)
    pub username: Option<String>,
    /// role to assign: "viewer", "member", "admin"
    pub role: String,
    /// optional existing user_id to link instead of creating new user
    pub user_id: Option<String>,
}

/// response for knock status check
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct KnockStatusResponse {
    pub status: KnockStatus,
    /// true if knock has been processed (accepted or rejected)
    pub processed: bool,
}

/// grimoire's own account-creation side effect for knock acceptance:
/// resolves (or creates) the grimoire user the knock's username refers to,
/// links the knocking node id to it, and reports back the haruspex
/// identity `KnockOutcome`'s shape expects.
///
/// `KnockPolicy::on_accept` only ever receives the `KnockRecord` itself, so
/// the admin's per-request choices (username override, an explicit
/// existing user to link, the role to assign) live as fields on the policy
/// instead of method arguments - the same shape haruspex's own
/// `GrantOnAcceptPolicy` reference implementation uses for its
/// `default_role`/`granted_by` fields. a fresh instance is built for each
/// acceptance.
struct GrimoireKnockPolicy {
    role: UserRole,
    username_override: Option<String>,
    existing_user_id: Option<String>,
}

impl GrimoireKnockPolicy {
    fn new(
        role: UserRole,
        username_override: Option<String>,
        existing_user_id: Option<String>,
    ) -> Self {
        Self {
            role,
            username_override,
            existing_user_id,
        }
    }
}

#[async_trait::async_trait]
impl KnockPolicy for GrimoireKnockPolicy {
    async fn on_accept(&self, knock: &HaruspexKnockRecord) -> Result<KnockOutcome, PolicyError> {
        let requested_username = match &knock.scope {
            KnockScope::Account { requested_username } => requested_username.clone(),
            // grimoire only ever creates Account-scoped knocks (see
            // `create_knock`); anything else reaching here would be a bug
            // elsewhere in this module, not a legitimate acceptance.
            KnockScope::Browse | KnockScope::Resource { .. } => {
                return Err(PolicyError::new("knock scope is not an account request"));
            }
        };
        let username = self
            .username_override
            .clone()
            .or(requested_username)
            .unwrap_or_default();
        if username.is_empty() {
            return Err(PolicyError::new("no username available for this knock"));
        }

        let user_service = crate::users::UserService::new();

        // resolve the user to link this knock to. preference order:
        //   1. explicit existing user id (admin picked an existing user)
        //   2. existing user matching the (typed-or-knock) username
        //   3. create a new user with that username + role
        let user = if let Some(user_id) = &self.existing_user_id {
            match user_service.get_user(user_id).await.data {
                Some(u) => u,
                None => return Err(PolicyError::new(format!("user not found: {}", user_id))),
            }
        } else {
            match user_service.get_user_by_username(&username).await.data {
                Some(existing) => existing,
                None => {
                    let create_request = crate::users::CreateUserRequest {
                        username: username.clone(),
                        role: Some(self.role),
                        invite_code: None,
                    };
                    let result = user_service.register_user(&create_request).await;
                    if !result.success {
                        let details = if result.errors.is_empty() {
                            result.message.clone()
                        } else {
                            result
                                .errors
                                .iter()
                                .map(|e| e.detail.clone())
                                .collect::<Vec<_>>()
                                .join("; ")
                        };
                        return Err(PolicyError::new(format!(
                            "could not create user `{}` from knock: {}",
                            username, details
                        )));
                    }
                    match result.data {
                        Some(u) => u,
                        None => return Err(PolicyError::new("user creation returned no data")),
                    }
                }
            }
        };

        // link peer node to user (this is also what ensures a haruspex
        // identity exists for the user - see `UserRepository::upsert_peer_node`)
        let peer_result = user_service
            .add_peer_node(&user.id, &knock.node_id, None)
            .await;
        if !peer_result.success {
            return Err(PolicyError::new(peer_result.message));
        }

        let identities = match database::connect_haruspex().await {
            Ok(pool) => SqliteIdentityStore::new(pool),
            Err(e) => return Err(PolicyError::new(format!("database error: {e}"))),
        };
        let identity_id = crate::users::haruspex_bridge::identity_id_for_existing_user(&user.id);
        let account = match identities.get_identity(identity_id).await {
            Ok(identity) => identity,
            Err(e) => return Err(PolicyError::new(format!("failed to load identity: {e}"))),
        };

        Ok(KnockOutcome {
            status: HaruspexKnockStatus::Accepted,
            // role assignment already happened via `CreateUserRequest.role`
            // above; wiring grimoire's own role vocabulary onto haruspex's
            // shared grant `Role` is a separate, later cutover pass, not
            // this one.
            granted_role: None,
            granted_resource_ids: None,
            account,
        })
    }
}

/// raw row shape for the two lookups `KnockStore` has no trait method for:
/// find-by-node-id (used to replicate grimoire's "one knock ever per
/// node_id" rule - see `find_latest_knock_row`) and list-everything (used
/// by `list_knocks`'s `include_all` branch - see `list_all_knock_rows`).
/// both are documented stopgaps against haruspex's own `knockz` table.
#[derive(sqlx::FromRow)]
struct RawKnockRow {
    id: String,
    node_id: String,
    scope_json: String,
    message: String,
    status: String,
    created_at: i64,
    processed_at: Option<i64>,
    processed_by: Option<String>,
}

fn raw_status_to_knock_status(status: &str) -> KnockStatus {
    match status {
        "accepted" => KnockStatus::Accepted,
        "denied" => KnockStatus::Rejected,
        _ => KnockStatus::Pending,
    }
}

fn scope_username(scope: KnockScope) -> String {
    match scope {
        KnockScope::Account { requested_username } => requested_username.unwrap_or_default(),
        KnockScope::Browse | KnockScope::Resource { .. } => String::new(),
    }
}

fn raw_row_to_knock_request(row: RawKnockRow) -> Result<KnockRequest, serde_json::Error> {
    let scope: KnockScope = serde_json::from_str(&row.scope_json)?;
    Ok(KnockRequest {
        id: row.id,
        node_id: row.node_id,
        username: scope_username(scope),
        message: row.message,
        status: raw_status_to_knock_status(&row.status),
        created_at: row.created_at,
        processed_at: row.processed_at,
        processed_by: row.processed_by,
        from_deleted_peer: None,
        deleted_user_username: None,
    })
}

fn haruspex_record_to_knock_request(record: HaruspexKnockRecord) -> KnockRequest {
    let status = match record.status {
        HaruspexKnockStatus::Pending => KnockStatus::Pending,
        HaruspexKnockStatus::Accepted => KnockStatus::Accepted,
        HaruspexKnockStatus::Denied => KnockStatus::Rejected,
    };
    KnockRequest {
        id: record.id.to_string(),
        node_id: record.node_id,
        username: scope_username(record.scope),
        message: record.message,
        status,
        created_at: record.created_at,
        processed_at: record.processed_at,
        processed_by: record.processed_by,
        from_deleted_peer: None,
        deleted_user_username: None,
    }
}

/// `KnockStore` only enforces dedup against *pending* knocks (one per
/// node id + scope) - grimoire's original schema had a permanent
/// `UNIQUE(node_id)` constraint instead, so a node_id that has ever
/// knocked keeps returning that same knock regardless of its resolved
/// status until an admin explicitly deletes it. replicated here with a
/// direct lookup against haruspex's own `knockz` table, since `KnockStore`
/// has no "find by node_id" method.
async fn find_latest_knock_row(
    pool: &SqlitePool,
    node_id: &str,
) -> Result<Option<RawKnockRow>, sqlx::Error> {
    sqlx::query_as::<_, RawKnockRow>(
        r#"
        SELECT id, node_id, scope_json, message, status, created_at, processed_at, processed_by
        FROM knockz
        WHERE node_id = ?1
        ORDER BY created_at DESC
        LIMIT 1
        "#,
    )
    .bind(node_id)
    .fetch_optional(pool)
    .await
}

/// `KnockStore::list_pending` only returns pending knocks - there is no
/// trait method for "list everything" - so `list_knocks`'s `include_all`
/// branch falls back to a direct query against haruspex's own `knockz`
/// table.
async fn list_all_knock_rows(pool: &SqlitePool) -> Result<Vec<RawKnockRow>, sqlx::Error> {
    sqlx::query_as::<_, RawKnockRow>(
        r#"
        SELECT id, node_id, scope_json, message, status, created_at, processed_at, processed_by
        FROM knockz
        ORDER BY created_at DESC
        "#,
    )
    .fetch_all(pool)
    .await
}

/// create a knock request from a peer
/// returns existing knock if node_id already has one (any status)
pub async fn create_knock(
    node_id: &str,
    request: CreateKnockRequest,
) -> GrimoireResponse<KnockRequest> {
    // validate message length
    if request.message.len() > 512 {
        return GrimoireResponse::failure("message must be 512 characters or less", vec![]);
    }

    if request.username.is_empty() {
        return GrimoireResponse::failure("username is required", vec![]);
    }

    let pool = match database::connect_haruspex().await {
        Ok(p) => p,
        Err(e) => return GrimoireResponse::failure(format!("database error: {}", e), vec![]),
    };

    // a node_id that has ever knocked before keeps returning that same
    // knock, whatever its status - see `find_latest_knock_row`.
    match find_latest_knock_row(&pool, node_id).await {
        Ok(Some(row)) => {
            return match raw_row_to_knock_request(row) {
                Ok(existing) => GrimoireResponse::success("existing knock request", existing),
                Err(e) => GrimoireResponse::failure(format!("corrupt knock record: {}", e), vec![]),
            };
        }
        Ok(None) => {}
        Err(e) => return GrimoireResponse::failure(format!("database error: {}", e), vec![]),
    }

    let store = SqliteKnockStore::new(pool);
    let now = OffsetDateTime::now_utc().unix_timestamp();
    let scope = KnockScope::Account {
        requested_username: Some(request.username.clone()),
    };

    match store
        .create_knock(
            node_id,
            KnockDirection::Inbound,
            scope,
            request.message.clone(),
            now,
        )
        .await
    {
        Ok(record) => {
            let knock = haruspex_record_to_knock_request(record);

            // emit event for real-time notifications
            emit(GrimoireEvent::KnockCreated {
                id: knock.id.clone(),
                username: knock.username.clone(),
                node_id: knock.node_id.clone(),
                message: knock.message.clone(),
            });

            GrimoireResponse::success("knock request created", knock)
        }
        Err(e) => GrimoireResponse::failure(format!("failed to create knock: {}", e), vec![]),
    }
}

/// get knock status for a node_id (public endpoint for clients to check)
pub async fn get_knock_status(node_id: &str) -> GrimoireResponse<KnockStatusResponse> {
    let pool = match database::connect_haruspex().await {
        Ok(p) => p,
        Err(e) => return GrimoireResponse::failure(format!("database error: {}", e), vec![]),
    };

    match find_latest_knock_row(&pool, node_id).await {
        Ok(Some(row)) => {
            let status = raw_status_to_knock_status(&row.status);
            let processed = status != KnockStatus::Pending;
            GrimoireResponse::success(
                "knock status found",
                KnockStatusResponse { status, processed },
            )
        }
        Ok(None) => GrimoireResponse::success(
            "no knock found",
            KnockStatusResponse {
                status: KnockStatus::Pending,
                processed: false,
            },
        ),
        Err(e) => GrimoireResponse::failure(format!("database error: {}", e), vec![]),
    }
}

/// list knock requests (admin only)
/// by default only shows pending, use include_all to see all.
///
/// also populates `from_deleted_peer` / `deleted_user_username` so the
/// admin ui can flag knocks coming from a node_id that was previously
/// linked to a now-soft-deleted user/peer: haruspex's `IdentityStore`
/// batch-resolves node ids to identities in one call (`identities_for`),
/// `resolve_device` reports the device-level `deleted_at` haruspex's
/// identity model tracks, and the linked grimoire user's own soft-delete
/// state (haruspex has no notion of it) comes from a lookup against
/// grimoire's own user table via the existing `haruspex_bridge`/
/// `UserService`.
pub async fn list_knocks(include_all: bool) -> GrimoireResponse<Vec<KnockRequest>> {
    let pool = match database::connect_haruspex().await {
        Ok(p) => p,
        Err(e) => return GrimoireResponse::failure(format!("database error: {}", e), vec![]),
    };
    let store = SqliteKnockStore::new(pool.clone());
    let identities = SqliteIdentityStore::new(pool.clone());

    let mut knocks: Vec<KnockRequest> = if include_all {
        match list_all_knock_rows(&pool).await {
            Ok(rows) => rows
                .into_iter()
                .filter_map(|row| raw_row_to_knock_request(row).ok())
                .collect(),
            Err(e) => return GrimoireResponse::failure(format!("database error: {}", e), vec![]),
        }
    } else {
        match store.list_pending().await {
            Ok(records) => records
                .into_iter()
                .map(haruspex_record_to_knock_request)
                .collect(),
            Err(e) => return GrimoireResponse::failure(format!("database error: {}", e), vec![]),
        }
    };
    knocks.sort_by_key(|k| std::cmp::Reverse(k.created_at));

    let node_ids: Vec<String> = knocks.iter().map(|k| k.node_id.clone()).collect();
    let identities_by_node = identities
        .identities_for(&node_ids)
        .await
        .unwrap_or_default();
    let user_service = crate::users::UserService::new();

    for knock in &mut knocks {
        let peer_deleted = identities
            .resolve_device(&knock.node_id)
            .await
            .ok()
            .flatten()
            .map(|device| device.deleted_at.is_some())
            .unwrap_or(false);

        let user_state = match identities_by_node.get(&knock.node_id) {
            Some(identity) => {
                match crate::users::haruspex_bridge::grimoire_user_id_for_identity(
                    &identities,
                    identity.id,
                )
                .await
                {
                    Ok(Some(grimoire_user_id)) => user_service
                        .get_user(&grimoire_user_id)
                        .await
                        .data
                        .map(|u| (u.username, u.deleted_at.is_some())),
                    _ => None,
                }
            }
            None => None,
        };
        let user_deleted = user_state
            .as_ref()
            .map(|(_, deleted)| *deleted)
            .unwrap_or(false);

        knock.from_deleted_peer = Some(peer_deleted || user_deleted);
        knock.deleted_user_username = if peer_deleted || user_deleted {
            user_state.map(|(username, _)| username)
        } else {
            None
        };
    }

    GrimoireResponse::success("knock list retrieved", knocks)
}

/// get a specific knock by id
pub async fn get_knock(id: &str) -> GrimoireResponse<KnockRequest> {
    let Ok(knock_uuid) = Uuid::parse_str(id) else {
        return GrimoireResponse::failure("knock not found", vec![]);
    };

    let pool = match database::connect_haruspex().await {
        Ok(p) => p,
        Err(e) => return GrimoireResponse::failure(format!("database error: {}", e), vec![]),
    };
    let store = SqliteKnockStore::new(pool);

    match store.get_knock(knock_uuid).await {
        Ok(Some(record)) => {
            GrimoireResponse::success("knock found", haruspex_record_to_knock_request(record))
        }
        Ok(None) => GrimoireResponse::failure("knock not found", vec![]),
        Err(e) => GrimoireResponse::failure(format!("database error: {}", e), vec![]),
    }
}

/// accept a knock request - creates user and peer mapping
pub async fn accept_knock(
    knock_id: &str,
    request: ProcessKnockRequest,
    admin_user_id: &str,
) -> GrimoireResult<KnockRequest> {
    let knock_uuid = Uuid::parse_str(knock_id).map_err(|_| GrimoireError::KnockNotFound {
        id: knock_id.to_string(),
    })?;

    let pool = database::connect_haruspex().await?;
    let store = SqliteKnockStore::new(pool.clone());
    let identities = SqliteIdentityStore::new(pool);

    let record = store
        .get_knock(knock_uuid)
        .await
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: e.to_string(),
        })?
        .ok_or_else(|| GrimoireError::KnockNotFound {
            id: knock_id.to_string(),
        })?;

    if record.status != HaruspexKnockStatus::Pending {
        return Err(GrimoireError::KnockAlreadyProcessed {
            id: knock_id.to_string(),
        });
    }

    // refuse if this node_id already maps to a soft-deleted peer/user.
    // the admin must explicitly restore the user/peer first so we don't
    // silently re-link an old device under a new account.
    if let Some(device) = identities
        .resolve_device(&record.node_id)
        .await
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: e.to_string(),
        })?
    {
        let grimoire_user_id = crate::users::haruspex_bridge::grimoire_user_id_for_identity(
            &identities,
            device.identity_id,
        )
        .await
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: e.to_string(),
        })?;

        if let Some(grimoire_user_id) = grimoire_user_id {
            if let Some(existing_user) = crate::users::UserService::new()
                .get_user(&grimoire_user_id)
                .await
                .data
            {
                if device.deleted_at.is_some() || existing_user.deleted_at.is_some() {
                    return Err(GrimoireError::ProcessingFailed {
                        message: format!(
                            "cannot accept knock: node_id is linked to a soft-deleted peer (user '{}'). restore the user/peer first.",
                            existing_user.username
                        ),
                    });
                }
            }
        }
    }

    let role = match request.role.as_str() {
        "admin" => UserRole::Admin,
        "viewer" => UserRole::Viewer,
        _ => UserRole::Member,
    };

    let policy = GrimoireKnockPolicy::new(role, request.username.clone(), request.user_id.clone());

    // run the account-creation side effect before advancing the knock's
    // stored status: `on_accept` only reads the record's scope/node_id/
    // created_at (not its status), so calling it while the record is
    // still pending is safe, and it means a failure (username clash, db
    // error) leaves the knock pending for the admin to retry.
    let outcome = policy
        .on_accept(&record)
        .await
        .map_err(|e| GrimoireError::ProcessingFailed { message: e.message })?;
    if outcome.status != HaruspexKnockStatus::Accepted {
        return Err(GrimoireError::ProcessingFailed {
            message: "failed to accept knock".to_string(),
        });
    }

    let now = OffsetDateTime::now_utc().unix_timestamp();
    let updated = store
        .record_decision(
            knock_uuid,
            KnockDecision {
                by_node_id: admin_user_id.to_string(),
                outcome: HaruspexKnockStatus::Accepted,
                granted_role: None,
                at: now,
            },
        )
        .await
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: e.to_string(),
        })?;

    let knock = haruspex_record_to_knock_request(updated);

    // fire-and-forget P2P notification to the requester
    let requester_node_id = knock.node_id.clone();
    let server_name = crate::config::get_config()
        .server
        .as_ref()
        .map(|s| s.name.clone())
        .unwrap_or_else(|| "freqhole".to_string());
    let peer_addr = crate::federation::get_node_id().unwrap_or_default();
    tokio::spawn(async move {
        let payload = serde_json::json!({ "peer_addr": peer_addr, "server_name": server_name });
        let body_str = serde_json::to_string(&payload).unwrap_or_default();
        if let Err(e) = crate::federation::p2p_client::proxy_request(
            &requester_node_id,
            "POST",
            "/api/internal/knock-accepted",
            Some(body_str),
        )
        .await
        {
            tracing::debug!(error = %e, "could not notify requester of knock acceptance (peer may be offline)");
        }
    });

    Ok(knock)
}

/// reject a knock request
pub async fn reject_knock(knock_id: &str, admin_user_id: &str) -> GrimoireResult<KnockRequest> {
    let knock_uuid = Uuid::parse_str(knock_id).map_err(|_| GrimoireError::KnockNotFound {
        id: knock_id.to_string(),
    })?;

    let pool = database::connect_haruspex().await?;
    let store = SqliteKnockStore::new(pool);

    let record = store
        .get_knock(knock_uuid)
        .await
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: e.to_string(),
        })?
        .ok_or_else(|| GrimoireError::KnockNotFound {
            id: knock_id.to_string(),
        })?;

    if record.status != HaruspexKnockStatus::Pending {
        return Err(GrimoireError::KnockAlreadyProcessed {
            id: knock_id.to_string(),
        });
    }

    let now = OffsetDateTime::now_utc().unix_timestamp();
    let updated = store
        .record_decision(
            knock_uuid,
            KnockDecision {
                by_node_id: admin_user_id.to_string(),
                outcome: HaruspexKnockStatus::Denied,
                granted_role: None,
                at: now,
            },
        )
        .await
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: e.to_string(),
        })?;

    Ok(haruspex_record_to_knock_request(updated))
}

/// delete a knock request (allows node to knock again)
pub async fn delete_knock(knock_id: &str) -> GrimoireResult<()> {
    let pool = database::connect_haruspex().await?;

    // `KnockStore` has no delete operation (by design - the store models
    // create/get/list/decide, not removal); letting an admin free up a
    // node_id to knock again needs a direct delete against haruspex's own
    // knockz table.
    let result = sqlx::query("DELETE FROM knockz WHERE id = ?1")
        .bind(knock_id)
        .execute(&pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(GrimoireError::KnockNotFound {
            id: knock_id.to_string(),
        });
    }

    Ok(())
}

/// reject all pending knocks
pub async fn reject_all_knocks(admin_user_id: &str) -> GrimoireResult<u64> {
    let pool = database::connect_haruspex().await?;
    let store = SqliteKnockStore::new(pool);

    let pending = store
        .list_pending()
        .await
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: e.to_string(),
        })?;

    let now = OffsetDateTime::now_utc().unix_timestamp();
    let mut rejected = 0u64;
    for record in pending {
        let decision = KnockDecision {
            by_node_id: admin_user_id.to_string(),
            outcome: HaruspexKnockStatus::Denied,
            granted_role: None,
            at: now,
        };
        if store.record_decision(record.id, decision).await.is_ok() {
            rejected += 1;
        }
    }

    Ok(rejected)
}
