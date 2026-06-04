//! health check types

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

/// health check response
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct HealthResponse {
    pub status: String,
    pub database: String,
}

/// empty response for operations that return void
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct EmptyResponse {
    pub success: bool,
}

impl EmptyResponse {
    pub fn ok() -> Self {
        Self { success: true }
    }
}

/// server info response for remote identification
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ServerInfoResponse {
    /// server display name
    pub name: String,
    /// optional server description
    pub description: Option<String>,
    /// server version
    pub version: String,
    /// optional server image url (publicly accessible via HTTP)
    pub image_url: Option<String>,
    /// optional server image blob id (for P2P transport)
    pub image_blob_id: Option<String>,
    /// whether knocking is enabled for P2P access requests
    pub knocking_enabled: Option<bool>,
    /// whether musicbrainz enrichment is enabled on the server
    pub musicbrainz_enabled: Option<bool>,
    /// whether last.fm enrichment is enabled on the server
    pub lastfm_enabled: Option<bool>,
    /// whether theaudiodb enrichment is enabled on the server
    pub audiodb_enabled: Option<bool>,
}
