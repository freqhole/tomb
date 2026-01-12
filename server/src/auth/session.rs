//! session management
//!
//! handles session storage and retrieval
//! uses tower-sessions with sqlite backend

use uuid::Uuid;

/// session key for storing user id
pub const SESSION_USER_ID_KEY: &str = "user_id";

/// session key for storing username
pub const SESSION_USERNAME_KEY: &str = "username";

/// session key for storing user role
pub const SESSION_ROLE_KEY: &str = "role";

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

// TODO: implement session store initialization
// TODO: implement session save/load helpers
// TODO: implement session deletion (logout)
