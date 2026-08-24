//! generic, domain-agnostic entity routes
//!
//! covers `entity_taxonz` and `playlist_itemz`, both polymorphic tables
//! any domain (music, video, and future ones) can write rows into -
//! genuinely cross-domain, so they don't belong under `offal::music` or
//! `offal::video`. today only the video domain's `crate::video::crud`
//! functions actually implement reading/writing these tables, so these
//! handlers validate the incoming `entity_type` string against the shared
//! `crate::entities::TaggableEntity` allowlist first (rejecting anything
//! not a recognized entity type at all), then narrow to
//! `crate::video::VideoEntityType` for the actual database call (rejecting
//! recognized-but-not-yet-wired-up types like `song`/`album` until each
//! domain exposes its own generalized-table functions).

pub mod favorites;
pub mod playlist_items;
pub mod ratings;
pub mod taxon_links;

use crate::api_registry::{Method, RouteInfo};
use crate::error::{ErrorDetail, GrimoireError};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use serde_json::Value as JsonValue;

/// collect all route metadata from the entities domain
pub fn routes() -> Vec<RouteInfo> {
    let mut all = Vec::new();
    all.extend_from_slice(taxon_links::ROUTES);
    all.extend_from_slice(playlist_items::ROUTES);
    all.extend_from_slice(favorites::ROUTES);
    all.extend_from_slice(ratings::ROUTES);
    all
}

/// dispatch entities domain routes
///
/// returns Some(response) if path matches this domain, None otherwise
pub async fn dispatch(
    path: &str,
    caller: &Caller,
    body: &JsonValue,
    _method: Option<Method>,
) -> Option<GrimoireResponse<JsonValue>> {
    match path {
        "/api/entities/taxons/get" => Some(taxon_links::get(caller, body.clone()).await),
        "/api/entities/taxons/add" => Some(taxon_links::add(caller, body.clone()).await),
        "/api/entities/taxons/remove" => Some(taxon_links::remove(caller, body.clone()).await),

        "/api/entities/playlists/items/list" => {
            Some(playlist_items::list(caller, body.clone()).await)
        }
        "/api/entities/playlists/items/add" => {
            Some(playlist_items::add(caller, body.clone()).await)
        }
        "/api/entities/playlists/items/remove" => {
            Some(playlist_items::remove(caller, body.clone()).await)
        }

        "/api/entities/favorites/set" => Some(favorites::set(caller, body.clone()).await),
        "/api/entities/favorites/status-bulk" => {
            Some(favorites::get_status_bulk(caller, body.clone()).await)
        }

        "/api/entities/ratings/set" => Some(ratings::set(caller, body.clone()).await),
        "/api/entities/ratings/remove" => Some(ratings::remove(caller, body.clone()).await),
        "/api/entities/ratings/stats" => Some(ratings::stats(caller, body.clone()).await),
        "/api/entities/ratings/status-bulk" => {
            Some(ratings::get_status_bulk(caller, body.clone()).await)
        }

        _ => None,
    }
}

/// resolve an `entity_type` wire string to the video domain's narrower
/// `VideoEntityType` - the only domain whose generalized-table functions
/// exist today. valid-but-unsupported types (song/album/...) surface a
/// distinct error detail from genuinely-unrecognized ones.
pub(super) fn resolve_video_entity_type(
    entity_type: &str,
) -> Result<crate::video::VideoEntityType, GrimoireResponse<JsonValue>> {
    use crate::entities::TaggableEntity;
    use crate::video::VideoEntityType;

    let taggable = TaggableEntity::parse(entity_type).map_err(|e| {
        GrimoireResponse::failure("invalid entity type", vec![ErrorDetail::from(&e)])
    })?;

    match taggable {
        TaggableEntity::Video => Ok(VideoEntityType::Video),
        TaggableEntity::VideoSeries => Ok(VideoEntityType::VideoSeries),
        TaggableEntity::VideoSeason => Ok(VideoEntityType::VideoSeason),
        other => {
            let err = GrimoireError::InvalidEntityType {
                entity_type: format!(
                    "{other} (a recognized entity type, but only video/video_series/video_season are wired up to entity_taxonz/playlist_itemz today)"
                ),
            };
            Err(GrimoireResponse::failure(
                "unsupported entity type",
                vec![ErrorDetail::from(&err)],
            ))
        }
    }
}
