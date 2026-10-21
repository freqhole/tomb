//! library availability cache invalidation, shared by music and video clients.

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::{ErrorDetail, GrimoireResponse};
use serde_json::Value;

#[derive(serde::Serialize, zod_gen_derive::ZodSchema)]
pub struct LibraryAvailabilityRevision {
    pub revision: String,
}

pub const ROUTES: &[RouteInfo] = &[RouteInfo {
    name: "library_availability_revision",
    path: "/api/library/availability-revision",
    method: Method::GET,
    domain: Domain::Music,
    request_type: "String",
    response_type: "LibraryAvailabilityRevision",
    auth: RouteAuth::Authenticated,
}];

pub async fn availability_revision() -> GrimoireResponse<Value> {
    let result = async {
        let pool = crate::database::connect().await?;
        crate::external_storage::availability::revision(&pool).await
    }
    .await;
    match result {
        Ok(revision) => GrimoireResponse::success(
            "library availability revision",
            serde_json::json!({ "revision": revision }),
        ),
        Err(error) => {
            tracing::warn!(%error, "could not read library availability revision");
            GrimoireResponse::failure(
                "could not read library availability revision",
                vec![ErrorDetail::from(&error)],
            )
        }
    }
}
