//! caller identity for API authorization

use crate::users::UserRole;
use serde::{Deserialize, Serialize};

/// authenticated caller making an API request
///
/// transports are responsible for authenticating the caller and constructing this.
/// dispatch uses this for authorization decisions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Caller {
    pub user_id: String,
    pub username: String,
    pub role: UserRole,
}

impl Caller {
    pub fn new(user_id: impl Into<String>, username: impl Into<String>, role: UserRole) -> Self {
        Self {
            user_id: user_id.into(),
            username: username.into(),
            role,
        }
    }

    /// create a local admin caller (for Tauri/CLI when no auth needed)
    pub fn local_admin() -> Self {
        Self {
            user_id: "local".to_string(),
            username: "local".to_string(),
            role: UserRole::Admin,
        }
    }

    pub fn is_admin(&self) -> bool {
        self.role == UserRole::Admin
    }

    pub fn is_member(&self) -> bool {
        matches!(self.role, UserRole::Admin | UserRole::Member)
    }
}
