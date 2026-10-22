//! library availability cache invalidation and offline existence summaries.
//! both routes are authenticated, bodyless GETs shared by music and video clients.

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::{ErrorDetail, GrimoireResponse};
use serde_json::Value;

#[derive(serde::Serialize, zod_gen_derive::ZodSchema)]
pub struct LibraryAvailabilityRevision {
    pub revision: String,
}

pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "library_availability_revision",
        path: "/api/library/availability-revision",
        method: Method::GET,
        domain: Domain::Music,
        request_type: "String",
        response_type: "LibraryAvailabilityRevision",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "library_offline_media",
        path: "/api/library/offline-media",
        method: Method::GET,
        domain: Domain::Music,
        request_type: "String",
        response_type: "OfflineMediaSummary",
        auth: RouteAuth::Authenticated,
    },
];

pub async fn offline_media() -> GrimoireResponse<Value> {
    let result = async {
        let pool = crate::database::connect().await?;
        let summary =
            crate::external_storage::media_availability::offline_media_summary(&pool).await?;
        Ok::<_, crate::GrimoireError>(serde_json::to_value(summary)?)
    }
    .await;
    match result {
        Ok(summary) => GrimoireResponse::success("offline media summary", summary),
        Err(error) => {
            tracing::warn!(%error, "could not check offline media");
            GrimoireResponse::failure(
                "could not check offline media",
                vec![ErrorDetail::from(&error)],
            )
        }
    }
}

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
