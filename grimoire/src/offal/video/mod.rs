//! video domain handlers
//!
//! covers: video series, seasons, and videos (episodes/movies/clips).

pub mod import_review;
pub mod progress;
pub mod relations;
pub mod seasons;
pub mod series;
pub mod videos;

use crate::api_registry::{Method, RouteInfo};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use serde_json::Value as JsonValue;

/// collect all route metadata from the video domain
pub fn routes() -> Vec<RouteInfo> {
    let mut all = Vec::new();
    all.extend_from_slice(series::ROUTES);
    all.extend_from_slice(seasons::ROUTES);
    all.extend_from_slice(videos::ROUTES);
    all.extend_from_slice(progress::ROUTES);
    all.extend_from_slice(relations::ROUTES);
    all.extend_from_slice(import_review::ROUTES);
    all
}

/// dispatch video domain routes
///
/// returns Some(response) if path matches this domain, None otherwise
pub async fn dispatch(
    path: &str,
    caller: &Caller,
    body: &JsonValue,
    _method: Option<Method>,
) -> Option<GrimoireResponse<JsonValue>> {
    match path {
        // series
        "/api/video/series/query" => Some(series::query(caller, body.clone()).await),
        "/api/video/series" => Some(series::create(caller, body.clone()).await),
        "/api/video/series/list" => Some(series::list(caller, body.clone()).await),
        "/api/video/series/get" => Some(series::get(caller, body.clone()).await),
        "/api/video/series/detail" => Some(series::detail(caller, body.clone()).await),
        "/api/video/series/update" => Some(series::update(caller, body.clone()).await),
        "/api/video/series/delete" => Some(series::delete(caller, body.clone()).await),

        // seasons
        "/api/video/seasons" => Some(seasons::create(caller, body.clone()).await),
        "/api/video/seasons/list" => Some(seasons::list(caller, body.clone()).await),
        "/api/video/seasons/get" => Some(seasons::get(caller, body.clone()).await),
        "/api/video/seasons/update" => Some(seasons::update(caller, body.clone()).await),
        "/api/video/seasons/delete" => Some(seasons::delete(caller, body.clone()).await),

        // videos
        "/api/video/videos/query" => Some(videos::query(caller, body.clone()).await),
        "/api/video/videos" => Some(videos::create(caller, body.clone()).await),
        "/api/video/videos/get" => Some(videos::get(caller, body.clone()).await),
        "/api/video/videos/get-with-metadata" => {
            Some(videos::get_with_metadata(caller, body.clone()).await)
        }
        "/api/video/videos/list-by-series" => {
            Some(videos::list_by_series(caller, body.clone()).await)
        }
        "/api/video/videos/list-by-season" => {
            Some(videos::list_by_season(caller, body.clone()).await)
        }
        "/api/video/videos/list-unattached" => {
            Some(videos::list_unattached(caller, body.clone()).await)
        }
        "/api/video/videos/update" => Some(videos::update(caller, body.clone()).await),
        "/api/video/videos/delete" => Some(videos::delete(caller, body.clone()).await),
        "/api/video/videos/bulk-delete" => Some(videos::bulk_delete(caller, body.clone()).await),
        "/api/video/videos/renditions" => Some(videos::get_renditions(caller, body.clone()).await),
        "/api/video/videos/renditions/delete" => {
            Some(videos::delete_rendition(caller, body.clone()).await)
        }

        // playback progress
        "/api/video/progress/upsert" => Some(progress::upsert(caller, body.clone()).await),
        "/api/video/progress/get" => Some(progress::get(caller, body.clone()).await),
        "/api/video/progress/list" => Some(progress::list(caller, body.clone()).await),

        // universal-domain relation hubs (era/recently_added/unassigned +
        // generic categorical hubs like genre/mood/style)
        "/api/video/relations/videos-by-value" => {
            Some(relations::videos_by_value(caller, body.clone()).await)
        }
        "/api/video/relations/recently-added-videos" => {
            Some(relations::recently_added_videos(caller, body.clone()).await)
        }
        "/api/video/relations/unassigned-videos" => {
            Some(relations::unassigned_videos(caller, body.clone()).await)
        }

        // import review (grouped by detected series)
        "/api/video/import/pending" => {
            Some(import_review::list_pending(caller, body.clone()).await)
        }
        "/api/video/import/mark-reviewed" => {
            Some(import_review::mark_reviewed(caller, body.clone()).await)
        }
        "/api/video/import/patch-group" => {
            Some(import_review::patch_group(caller, body.clone()).await)
        }
        "/api/video/import/move-video" => {
            Some(import_review::move_video(caller, body.clone()).await)
        }
        "/api/video/import/video-pending" => {
            Some(import_review::video_pending(caller, body.clone()).await)
        }

        _ => None,
    }
}
