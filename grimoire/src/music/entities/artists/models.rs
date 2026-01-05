//! artist domain models

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// artist model (normalized table)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, FromRow)]
pub struct Artist {
    pub rowid: i64,
    pub id: String,
    pub name: String,
    pub created_at: i64,         // unix timestamp UTC
    pub updated_at: i64,         // unix timestamp UTC
    pub deleted_at: Option<i64>, // unix timestamp UTC
    pub deleted_by: Option<String>,
    pub created_by: Option<String>,
    pub updated_by: Option<String>,
}

/// request for creating a new artist
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateArtistRequest {
    pub name: String,
    pub created_by: Option<String>,
}
