use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

#[derive(Debug, Deserialize, ZodSchema)]
pub struct LibraryRegisterSourceRequest {
    pub device_path: String,
    pub mount_path: String,
    #[serde(default)]
    pub relative_path: String,
    #[serde(default)]
    pub domain: crate::external_storage::sources::SourceDomain,
    pub generate_renditions: Option<bool>,
}

#[derive(Debug, Deserialize, ZodSchema)]
pub struct LibrarySourceByIdRequest {
    pub id: String,
}

#[derive(Debug, Deserialize, ZodSchema)]
pub struct LibraryScanStatusRequest {
    pub session_id: String,
}

#[derive(Debug, Serialize, ZodSchema)]
pub struct LibraryScanResponse {
    pub session_id: String,
    pub files_discovered: u64,
    pub jobs_created: u64,
    pub success: bool,
    pub message: String,
}
