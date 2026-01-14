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
