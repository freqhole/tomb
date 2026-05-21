//! knock requests - P2P access request management
//!
//! allows unknown peers to request access by "knocking" with a username and message.
//! admins can approve or reject requests via CLI or tauri wizard.

use crate::database;
use crate::error::GrimoireResult;
use crate::events::{emit, GrimoireEvent};
use crate::response::GrimoireResponse;
use serde::{Deserialize, Serialize};
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

/// internal row struct for sqlx mapping
struct KnockRow {
    id: String,
    node_id: String,
    username: String,
    message: String,
    status: String,
    created_at: i64,
    processed_at: Option<i64>,
    processed_by: Option<String>,
}

impl From<KnockRow> for KnockRequest {
    fn from(row: KnockRow) -> Self {
        Self {
            id: row.id,
            node_id: row.node_id,
            username: row.username,
            message: row.message,
            status: KnockStatus::from(row.status),
            created_at: row.created_at,
            processed_at: row.processed_at,
            processed_by: row.processed_by,
            from_deleted_peer: None,
            deleted_user_username: None,
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

/// create a knock request from a peer
/// returns existing knock if node_id already has one (pending)
/// silently fails if node_id was previously rejected
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

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => return GrimoireResponse::failure(&format!("database error: {}", e), vec![]),
    };

    // check if node_id was previously rejected - silently "succeed" without creating
    let existing = sqlx::query_as!(
        KnockRow,
        r#"
        SELECT id as "id!", node_id as "node_id!", username as "username!",
               message as "message!", status as "status!", created_at as "created_at!",
               processed_at, processed_by
        FROM knock_requestz 
        WHERE node_id = ?
        "#,
        node_id
    )
    .fetch_optional(&pool)
    .await
    .unwrap_or(None);

    if let Some(row) = existing {
        let knock = KnockRequest::from(row);
        if knock.status == KnockStatus::Rejected {
            // silently "succeed" - don't reveal rejection
            return GrimoireResponse::success("knock request received", knock);
        }
        // return existing pending/accepted knock
        return GrimoireResponse::success("existing knock request", knock);
    }

    // create new knock request (SQLite generates id via DEFAULT)
    let result = sqlx::query!(
        r#"INSERT INTO knock_requestz (node_id, username, message) VALUES (?, ?, ?)"#,
        node_id,
        request.username,
        request.message
    )
    .execute(&pool)
    .await;

    match result {
        Ok(_) => {
            // fetch the created knock by node_id (unique constraint)
            let row = sqlx::query_as!(
                KnockRow,
                r#"
                SELECT id as "id!", node_id as "node_id!", username as "username!",
                       message as "message!", status as "status!", created_at as "created_at!",
                       processed_at, processed_by
                FROM knock_requestz 
                WHERE node_id = ?
                "#,
                node_id
            )
            .fetch_one(&pool)
            .await
            .expect("just inserted");

            let knock = KnockRequest::from(row);

            // emit event for real-time notifications
            emit(GrimoireEvent::KnockCreated {
                id: knock.id.clone(),
                username: knock.username.clone(),
                node_id: knock.node_id.clone(),
                message: knock.message.clone(),
            });

            GrimoireResponse::success("knock request created", knock)
        }
        Err(e) => GrimoireResponse::failure(&format!("failed to create knock: {}", e), vec![]),
    }
}

/// get knock status for a node_id (public endpoint for clients to check)
pub async fn get_knock_status(node_id: &str) -> GrimoireResponse<KnockStatusResponse> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => return GrimoireResponse::failure(&format!("database error: {}", e), vec![]),
    };

    let row = sqlx::query!(
        r#"SELECT status as "status!" FROM knock_requestz WHERE node_id = ?"#,
        node_id
    )
    .fetch_optional(&pool)
    .await
    .unwrap_or(None);

    match row {
        Some(r) => {
            let status = KnockStatus::from(r.status);
            let processed = status != KnockStatus::Pending;
            GrimoireResponse::success(
                "knock status found",
                KnockStatusResponse { status, processed },
            )
        }
        None => GrimoireResponse::success(
            "no knock found",
            KnockStatusResponse {
                status: KnockStatus::Pending,
                processed: false,
            },
        ),
    }
}

/// list knock requests (admin only)
/// by default only shows pending, use include_all to see all.
///
/// also LEFT JOINs the `user_peer_nodez` + `user_accountz` tables to
/// populate `from_deleted_peer` / `deleted_user_username` so the admin
/// ui can flag knocks coming from a node_id that was previously linked
/// to a now-soft-deleted user/peer.
pub async fn list_knocks(include_all: bool) -> GrimoireResponse<Vec<KnockRequest>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => return GrimoireResponse::failure(&format!("database error: {}", e), vec![]),
    };

    struct KnockJoinRow {
        id: String,
        node_id: String,
        username: String,
        message: String,
        status: String,
        created_at: i64,
        processed_at: Option<i64>,
        processed_by: Option<String>,
        peer_deleted_at: Option<i64>,
        user_deleted_at: Option<i64>,
        deleted_username: Option<String>,
    }

    let rows: Vec<KnockJoinRow> = if include_all {
        sqlx::query_as!(
            KnockJoinRow,
            r#"
            SELECT
                k.id as "id!",
                k.node_id as "node_id!",
                k.username as "username!",
                k.message as "message!",
                k.status as "status!",
                k.created_at as "created_at!",
                k.processed_at,
                k.processed_by,
                p.deleted_at as "peer_deleted_at",
                u.deleted_at as "user_deleted_at",
                u.username as "deleted_username"
            FROM knock_requestz k
            LEFT JOIN user_peer_nodez p ON p.node_id = k.node_id
            LEFT JOIN user_accountz u ON u.id = p.user_id
            ORDER BY k.created_at DESC
            "#
        )
        .fetch_all(&pool)
        .await
        .unwrap_or_default()
    } else {
        sqlx::query_as!(
            KnockJoinRow,
            r#"
            SELECT
                k.id as "id!",
                k.node_id as "node_id!",
                k.username as "username!",
                k.message as "message!",
                k.status as "status!",
                k.created_at as "created_at!",
                k.processed_at,
                k.processed_by,
                p.deleted_at as "peer_deleted_at",
                u.deleted_at as "user_deleted_at",
                u.username as "deleted_username"
            FROM knock_requestz k
            LEFT JOIN user_peer_nodez p ON p.node_id = k.node_id
            LEFT JOIN user_accountz u ON u.id = p.user_id
            WHERE k.status = 'pending'
            ORDER BY k.created_at DESC
            "#
        )
        .fetch_all(&pool)
        .await
        .unwrap_or_default()
    };

    let knocks: Vec<KnockRequest> = rows
        .into_iter()
        .map(|r| {
            let from_deleted_peer = r.peer_deleted_at.is_some() || r.user_deleted_at.is_some();
            let deleted_user_username = if from_deleted_peer {
                r.deleted_username
            } else {
                None
            };
            let from_deleted_peer = Some(from_deleted_peer);
            KnockRequest {
                id: r.id,
                node_id: r.node_id,
                username: r.username,
                message: r.message,
                status: KnockStatus::from(r.status),
                created_at: r.created_at,
                processed_at: r.processed_at,
                processed_by: r.processed_by,
                from_deleted_peer,
                deleted_user_username,
            }
        })
        .collect();
    GrimoireResponse::success("knock list retrieved", knocks)
}

/// get a specific knock by id
pub async fn get_knock(id: &str) -> GrimoireResponse<KnockRequest> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => return GrimoireResponse::failure(&format!("database error: {}", e), vec![]),
    };

    let row = sqlx::query_as!(
        KnockRow,
        r#"
        SELECT id as "id!", node_id as "node_id!", username as "username!",
               message as "message!", status as "status!", created_at as "created_at!",
               processed_at, processed_by
        FROM knock_requestz 
        WHERE id = ?
        "#,
        id
    )
    .fetch_optional(&pool)
    .await
    .unwrap_or(None);

    match row {
        Some(r) => GrimoireResponse::success("knock found", KnockRequest::from(r)),
        None => GrimoireResponse::failure("knock not found", vec![]),
    }
}

/// accept a knock request - creates user and peer mapping
pub async fn accept_knock(
    knock_id: &str,
    request: ProcessKnockRequest,
    admin_user_id: &str,
) -> GrimoireResult<KnockRequest> {
    use crate::users::{CreateUserRequest, UserRole, UserService};

    let pool = database::connect().await?;

    // get the knock
    let row = sqlx::query!(
        r#"
        SELECT id as "id!", node_id as "node_id!", username as "username!",
               message as "message!", status as "status!", created_at as "created_at!",
               processed_at, processed_by
        FROM knock_requestz 
        WHERE id = ?
        "#,
        knock_id
    )
    .fetch_optional(&pool)
    .await?;

    let row = match row {
        Some(r) => r,
        None => {
            return Err(crate::error::GrimoireError::KnockNotFound {
                id: knock_id.to_string(),
            })
        }
    };

    if row.status != "pending" {
        return Err(crate::error::GrimoireError::KnockAlreadyProcessed {
            id: knock_id.to_string(),
        });
    }

    // refuse if this node_id already maps to a soft-deleted peer/user.
    // the admin must explicitly restore the user/peer first so we don't
    // silently re-link an old device under a new account.
    let deleted_check = sqlx::query!(
        r#"
        SELECT u.username as "username!", u.deleted_at, p.deleted_at as "peer_deleted_at"
        FROM user_peer_nodez p
        INNER JOIN user_accountz u ON u.id = p.user_id
        WHERE p.node_id = ?
          AND (u.deleted_at IS NOT NULL OR p.deleted_at IS NOT NULL)
        LIMIT 1
        "#,
        row.node_id
    )
    .fetch_optional(&pool)
    .await?;

    if let Some(dc) = deleted_check {
        return Err(crate::error::GrimoireError::ProcessingFailed {
            message: format!(
                "cannot accept knock: node_id is linked to a soft-deleted peer (user '{}'). restore the user/peer first.",
                dc.username
            ),
        });
    }

    let username = request.username.unwrap_or(row.username.clone());
    let role_str = request.role;

    // parse role
    let role = match role_str.as_str() {
        "admin" => UserRole::Admin,
        "viewer" => UserRole::Viewer,
        _ => UserRole::Member,
    };

    let user_service = UserService::new();

    // resolve the user to link this knock to. preference order:
    //   1. explicit `user_id` (admin picked an existing user)
    //   2. existing user matching the (typed-or-knock) `username`
    //   3. create a new user with `username` + `role`
    // this lets the admin just type a username and have it Just Work
    // whether or not the username already exists.
    let user = if let Some(user_id) = request.user_id {
        let user_result = user_service.get_user(&user_id).await;
        user_result
            .data
            .ok_or_else(|| crate::error::GrimoireError::ProcessingFailed {
                message: format!("user not found: {}", user_id),
            })?
    } else {
        // try to find by username first
        let lookup = user_service.get_user_by_username(&username).await;
        if let Some(existing) = lookup.data {
            existing
        } else {
            // not found -> register a fresh user (admin bypasses invite code)
            let create_request = CreateUserRequest {
                username: username.clone(),
                role: Some(role),
                invite_code: None,
            };
            let user_result = user_service.register_user(&create_request).await;
            if !user_result.success {
                return Err(crate::error::GrimoireError::ProcessingFailed {
                    message: user_result.message,
                });
            }
            user_result
                .data
                .ok_or_else(|| crate::error::GrimoireError::ProcessingFailed {
                    message: "user creation returned no data".to_string(),
                })?
        }
    };

    // link peer node to user
    let peer_result = user_service
        .add_peer_node(&user.id, &row.node_id, None)
        .await;
    if !peer_result.success {
        return Err(crate::error::GrimoireError::ProcessingFailed {
            message: peer_result.message,
        });
    }

    // update knock status and fetch in one query
    let updated = sqlx::query_as!(
        KnockRow,
        r#"
        UPDATE knock_requestz 
        SET status = 'accepted', processed_at = unixepoch(), processed_by = ?
        WHERE id = ?
        RETURNING id as "id!", node_id as "node_id!", username as "username!",
                  message as "message!", status as "status!", created_at as "created_at!",
                  processed_at, processed_by
        "#,
        admin_user_id,
        knock_id
    )
    .fetch_one(&pool)
    .await?;

    Ok(KnockRequest::from(updated))
}

/// reject a knock request
pub async fn reject_knock(knock_id: &str, admin_user_id: &str) -> GrimoireResult<KnockRequest> {
    let pool = database::connect().await?;

    // check knock exists and is pending
    let row = sqlx::query!(
        r#"SELECT status as "status!" FROM knock_requestz WHERE id = ?"#,
        knock_id
    )
    .fetch_optional(&pool)
    .await?;

    let row = match row {
        Some(r) => r,
        None => {
            return Err(crate::error::GrimoireError::KnockNotFound {
                id: knock_id.to_string(),
            })
        }
    };

    if row.status != "pending" {
        return Err(crate::error::GrimoireError::KnockAlreadyProcessed {
            id: knock_id.to_string(),
        });
    }

    // update knock status and fetch in one query
    let updated = sqlx::query_as!(
        KnockRow,
        r#"
        UPDATE knock_requestz 
        SET status = 'rejected', processed_at = unixepoch(), processed_by = ?
        WHERE id = ?
        RETURNING id as "id!", node_id as "node_id!", username as "username!",
                  message as "message!", status as "status!", created_at as "created_at!",
                  processed_at, processed_by
        "#,
        admin_user_id,
        knock_id
    )
    .fetch_one(&pool)
    .await?;

    Ok(KnockRequest::from(updated))
}

/// delete a knock request (allows node to knock again)
pub async fn delete_knock(knock_id: &str) -> GrimoireResult<()> {
    let pool = database::connect().await?;

    let result = sqlx::query!(r#"DELETE FROM knock_requestz WHERE id = ?"#, knock_id)
        .execute(&pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(crate::error::GrimoireError::KnockNotFound {
            id: knock_id.to_string(),
        });
    }

    Ok(())
}

/// reject all pending knocks
pub async fn reject_all_knocks(admin_user_id: &str) -> GrimoireResult<u64> {
    let pool = database::connect().await?;

    let result = sqlx::query!(
        r#"
        UPDATE knock_requestz 
        SET status = 'rejected', processed_at = unixepoch(), processed_by = ?
        WHERE status = 'pending'
        "#,
        admin_user_id
    )
    .execute(&pool)
    .await?;

    Ok(result.rows_affected())
}
