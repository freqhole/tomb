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

    pub fn is_admin(&self) -> bool {
        matches!(self.role, UserRole::Root | UserRole::Admin)
    }

    pub fn is_member(&self) -> bool {
        matches!(
            self.role,
            UserRole::Root | UserRole::Admin | UserRole::Member
        )
    }
}
