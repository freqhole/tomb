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
/// by default only shows pending, use include_all to see all
pub async fn list_knocks(include_all: bool) -> GrimoireResponse<Vec<KnockRequest>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => return GrimoireResponse::failure(&format!("database error: {}", e), vec![]),
    };

    let rows = if include_all {
        sqlx::query_as!(
            KnockRow,
            r#"
            SELECT id as "id!", node_id as "node_id!", username as "username!",
                   message as "message!", status as "status!", created_at as "created_at!",
                   processed_at, processed_by
            FROM knock_requestz 
            ORDER BY created_at DESC
            "#
        )
        .fetch_all(&pool)
        .await
        .unwrap_or_default()
    } else {
        sqlx::query_as!(
            KnockRow,
            r#"
            SELECT id as "id!", node_id as "node_id!", username as "username!",
                   message as "message!", status as "status!", created_at as "created_at!",
                   processed_at, processed_by
            FROM knock_requestz 
            WHERE status = 'pending'
            ORDER BY created_at DESC
            "#
        )
        .fetch_all(&pool)
        .await
        .unwrap_or_default()
    };

    let knocks: Vec<KnockRequest> = rows.into_iter().map(KnockRequest::from).collect();
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

    let username = request.username.unwrap_or(row.username.clone());
    let role_str = request.role;

    // parse role
    let role = match role_str.as_str() {
        "admin" => UserRole::Admin,
        "viewer" => UserRole::Viewer,
        _ => UserRole::Member,
    };

    let user_service = UserService::new();

    // get existing user or create new one
    let user = if let Some(user_id) = request.user_id {
        // use existing user
        let user_result = user_service.get_user(&user_id).await;
        user_result
            .data
            .ok_or_else(|| crate::error::GrimoireError::ProcessingFailed {
                message: format!("user not found: {}", user_id),
            })?
    } else {
        // create new user
        let create_request = CreateUserRequest {
            username: username.clone(),
            role: Some(role),
            invite_code: None, // admin is approving directly
        };

        // register user (bypassing invite code since admin is approving)
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
