//! session management
//!
//! handles session storage and retrieval
//! uses tower-sessions (store initialized by grimoire)

use tower_sessions::Session;
use uuid::Uuid;

use crate::error::{ApiError, ApiResult};

/// session data for authenticated user
#[derive(Debug, Clone)]
pub struct SessionData {
    pub user_id: Uuid,
    pub username: String,
    pub role: String,
}

impl SessionData {
    /// create new session data
    pub fn new(user_id: Uuid, username: String, role: String) -> Self {
        Self {
            user_id,
            username,
            role,
        }
    }
}

/// save session data for authenticated user
pub async fn save_session(
    session: &Session,
    user_id: &str,
    username: &str,
    role: &str,
) -> ApiResult<()> {
    session
        .insert("user_id", user_id)
        .await
        .map_err(|e| ApiError::Internal(format!("failed to save user_id to session: {}", e)))?;

    session
        .insert("username", username)
        .await
        .map_err(|e| ApiError::Internal(format!("failed to save username to session: {}", e)))?;

    session
        .insert("role", role)
        .await
        .map_err(|e| ApiError::Internal(format!("failed to save role to session: {}", e)))?;

    Ok(())
}

/// load session data for authenticated user
pub async fn load_session(session: &Session) -> ApiResult<Option<SessionData>> {
    let user_id: Option<String> = session.get("user_id").await.ok().flatten();
    let username: Option<String> = session.get("username").await.ok().flatten();
    let role: Option<String> = session.get("role").await.ok().flatten();

    match (user_id, username, role) {
        (Some(user_id), Some(username), Some(role)) => {
            let user_id = Uuid::parse_str(&user_id)
                .map_err(|e| ApiError::Internal(format!("invalid user_id in session: {}", e)))?;
            Ok(Some(SessionData::new(user_id, username, role)))
        }
        _ => Ok(None),
    }
}

/// delete session (logout)
pub async fn delete_session(session: &Session) -> ApiResult<()> {
    session
        .flush()
        .await
        .map_err(|e| ApiError::Internal(format!("failed to delete session: {}", e)))?;
    Ok(())
}
