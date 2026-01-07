//! tag domain models

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// tag model for music domain
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, FromRow)]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub created_at: i64, // unix timestamp UTC
}

/// request for creating a new tag
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTagRequest {
    pub name: String,
}
