//! generic, domain-agnostic entity routes
//!
//! covers `entity_taxonz` and `playlist_itemz`, both polymorphic tables
//! any domain (music, video, and future ones) can write rows into -
//! genuinely cross-domain, so they don't belong under `offal::music` or
//! `offal::video`. `entity_taxonz`/`entity_tagz`/`entity_urlz`/`entity_imagez`
//! are still only wired up for the video domain today, so their handlers
//! validate the incoming `entity_type` string against the shared
//! `crate::entities::TaggableEntity` allowlist first (rejecting anything
//! not a recognized entity type at all), then narrow to
//! `crate::video::VideoEntityType` for the actual database call (rejecting
//! recognized-but-not-yet-wired-up types like `song`/`album`). `playlist_itemz`
//! is different: it's genuinely cross-domain (songs and video entities both
//! use it), so `playlist_items.rs` uses `resolve_playlist_entity_type`
//! instead, which accepts `TaggableEntity::Song` alongside the video entity
//! types.

pub mod favorites;
pub mod image_links;
pub mod playlist_items;
pub mod ratings;
pub mod tag_links;
pub mod taxon_links;
pub mod url_links;

use crate::api_registry::{Method, RouteInfo};
use crate::error::{ErrorDetail, GrimoireError};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use serde_json::Value as JsonValue;

/// collect all route metadata from the entities domain
pub fn routes() -> Vec<RouteInfo> {
    let mut all = Vec::new();
    all.extend_from_slice(taxon_links::ROUTES);
    all.extend_from_slice(tag_links::ROUTES);
    all.extend_from_slice(url_links::ROUTES);
    all.extend_from_slice(image_links::ROUTES);
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

        "/api/entities/tags/get" => Some(tag_links::get(caller, body.clone()).await),
        "/api/entities/tags/list-by-type" => {
            Some(tag_links::list_by_type(caller, body.clone()).await)
        }
        "/api/entities/tags/add" => Some(tag_links::add(caller, body.clone()).await),
        "/api/entities/tags/remove" => Some(tag_links::remove(caller, body.clone()).await),

        "/api/entities/urls/get" => Some(url_links::get(caller, body.clone()).await),
        "/api/entities/urls/add" => Some(url_links::add(caller, body.clone()).await),
        "/api/entities/urls/remove" => Some(url_links::remove(caller, body.clone()).await),

        "/api/entities/images/get" => Some(image_links::get(caller, body.clone()).await),

        "/api/entities/playlists/items/list" => {
            Some(playlist_items::list(caller, body.clone()).await)
        }
        "/api/entities/playlists/items/add" => {
            Some(playlist_items::add(caller, body.clone()).await)
        }
        "/api/entities/playlists/items/remove" => {
            Some(playlist_items::remove(caller, body.clone()).await)
        }
        "/api/entities/playlists/items/reorder" => {
            Some(playlist_items::reorder(caller, body.clone()).await)
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
///
/// used by `entity_taxonz`/`entity_tagz`/`entity_urlz`/`entity_imagez`
/// handlers, which remain video-only for now. `playlist_items.rs` uses
/// `resolve_playlist_entity_type` instead - see its docs for why.
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
                    "{other} (a recognized entity type, but only video/video_series/video_season are wired up to entity_taxonz today)"
                ),
            };
            Err(GrimoireResponse::failure(
                "unsupported entity type",
                vec![ErrorDetail::from(&err)],
            ))
        }
    }
}

/// resolve an `entity_type` wire string for playlist membership -
/// `playlist_itemz` is genuinely cross-domain (unlike `entity_taxonz` and
/// friends, still video-only), so this accepts `TaggableEntity::Song` in
/// addition to the video entity types. valid-but-not-a-playlist-item types
/// (album/artist/playlist/taxon/...) surface a distinct error detail from
/// genuinely-unrecognized ones.
pub(super) fn resolve_playlist_entity_type(
    entity_type: &str,
) -> Result<crate::entities::TaggableEntity, GrimoireResponse<JsonValue>> {
    use crate::entities::TaggableEntity;

    let taggable = TaggableEntity::parse(entity_type).map_err(|e| {
        GrimoireResponse::failure("invalid entity type", vec![ErrorDetail::from(&e)])
    })?;

    match taggable {
        TaggableEntity::Song
        | TaggableEntity::Video
        | TaggableEntity::VideoSeries
        | TaggableEntity::VideoSeason => Ok(taggable),
        other => {
            let err = GrimoireError::InvalidEntityType {
                entity_type: format!(
                    "{other} (a recognized entity type, but not a valid playlist item type)"
                ),
            };
            Err(GrimoireResponse::failure(
                "unsupported entity type",
                vec![ErrorDetail::from(&err)],
            ))
        }
    }
}
