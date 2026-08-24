//! generic entity <-> image link listing (`entity_imagez`)
//!
//! adding/removing/promoting images reuses the existing music-domain
//! upload/delete/set-primary routes (`crate::offal::music::albums`'s
//! `delete_image`/`set_primary_image`, and the shared upload pipeline's
//! `associate_image_with_entity`) - those already dispatch by a plain
//! `entity_type` string, so video/video_series only needed new match
//! arms there, not new routes. this file just adds the one genuinely
//! new capability: listing an entity's current images (album/artist/etc.
//! get this for free by embedding `images` in their query view; video's
//! `Video`/`VideoSeries` types don't have an equivalent view to embed
//! into, so it's fetched the same way entity urls/taxons already are).

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use zod_gen_derive::ZodSchema;

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;

use super::resolve_video_entity_type;

/// request for listing every image linked to an entity
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetEntityImagesRequest {
    pub entity_type: String,
    pub entity_id: String,
}

/// route metadata for entity <-> image links
pub const ROUTES: &[RouteInfo] = &[RouteInfo {
    name: "get_entity_images",
    path: "/api/entities/images/get",
    method: Method::POST,
    domain: Domain::Entities,
    request_type: "GetEntityImagesRequest",
    response_type: "Vec<ImageMetadata>",
    auth: RouteAuth::Authenticated,
}];

/// list every image linked to an entity
///
/// path: POST /api/entities/images/get
pub async fn get(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetEntityImagesRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    e.to_string(),
                )],
            )
        }
    };

    let entity_type = match resolve_video_entity_type(&req.entity_type) {
        Ok(t) => t,
        Err(resp) => return resp,
    };

    let response = crate::video::list_entity_images(entity_type, &req.entity_id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}
