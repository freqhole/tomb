//! video import review route handlers (mirrors
//! `crate::offal::music::import_review`, grouped by detected series
//! instead of album)

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;
use crate::video::entities::import_review::{
    models::{
        ListPendingVideoReviewRequest, MarkVideoGroupReviewedRequest, MoveVideoReviewRequest,
        PatchVideoGroupReviewRequest, VideoImportReviewOk, VideoPendingRequest,
    },
    repository,
};
use crate::video::{update_video, update_video_series, UpdateVideoRequest, UpdateVideoSeriesRequest};
use serde_json::Value as JsonValue;

pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "list_pending_video_import_review",
        path: "/api/video/import/pending",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "ListPendingVideoReviewRequest",
        response_type: "Vec<PendingVideoReviewSession>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "mark_video_group_reviewed",
        path: "/api/video/import/mark-reviewed",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "MarkVideoGroupReviewedRequest",
        response_type: "VideoImportReviewOk",
        auth: RouteAuth::OwnerOr(UserRole::Admin),
    },
    RouteInfo {
        name: "patch_video_group_review",
        path: "/api/video/import/patch-group",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "PatchVideoGroupReviewRequest",
        response_type: "VideoImportReviewOk",
        auth: RouteAuth::OwnerOr(UserRole::Admin),
    },
    RouteInfo {
        name: "move_video_review",
        path: "/api/video/import/move-video",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "MoveVideoReviewRequest",
        response_type: "VideoImportReviewOk",
        auth: RouteAuth::OwnerOr(UserRole::Admin),
    },
    RouteInfo {
        name: "video_pending",
        path: "/api/video/import/video-pending",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "VideoPendingRequest",
        response_type: "VideoPendingResponse",
        auth: RouteAuth::Authenticated,
    },
];

/// list sessions with pending (unreviewed) video groups.
/// members see only sessions where they uploaded at least one file.
pub async fn list_pending(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if let Err(resp) =
        crate::acl_bridge::require_scope(caller, "list_pending_video_import_review").await
    {
        return resp;
    }

    let req: ListPendingVideoReviewRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "invalid request body",
                vec![ErrorDetail::new(
                    "invalid_request",
                    "Invalid Request",
                    e.to_string(),
                )],
            )
        }
    };

    match repository::list_pending_sessions(
        &caller.user_id,
        caller.is_admin(),
        req.session_id.as_deref(),
    )
    .await
    {
        Ok(sessions) => match serde_json::to_value(sessions) {
            Ok(v) => GrimoireResponse::success("ok", v),
            Err(e) => GrimoireResponse::failure(
                "serialization error",
                vec![ErrorDetail::new(
                    "serialization_error",
                    "Serialization Error",
                    e.to_string(),
                )],
            ),
        },
        Err(e) => GrimoireResponse::failure("failed to list pending sessions", vec![e.into()]),
    }
}

/// mark all pending blobs for a group (in a session) as reviewed, with no
/// metadata changes.
pub async fn mark_reviewed(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: MarkVideoGroupReviewedRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "invalid request body",
                vec![ErrorDetail::new(
                    "invalid_request",
                    "Invalid Request",
                    e.to_string(),
                )],
            )
        }
    };

    if !crate::acl_bridge::caller_meets_scope(caller, "mark_video_group_reviewed").await {
        match repository::is_group_uploader(&req.group_key, &caller.user_id).await {
            Ok(true) => {}
            Ok(false) => {
                return GrimoireResponse::failure(
                    "forbidden",
                    vec![ErrorDetail::new(
                        "forbidden",
                        "Forbidden",
                        "you did not upload this video",
                    )],
                )
            }
            Err(e) => return GrimoireResponse::failure("db error", vec![e.into()]),
        }
    }

    match repository::mark_group_reviewed(&req.group_key, &req.session_id, &caller.user_id).await
    {
        Ok(()) => ok_response(),
        Err(e) => GrimoireResponse::failure("failed to mark reviewed", vec![e.into()]),
    }
}

/// patch a group's metadata (series title/description when the group is a
/// series, per-video title/episode patches always) and mark it reviewed.
pub async fn patch_group(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: PatchVideoGroupReviewRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "invalid request body",
                vec![ErrorDetail::new(
                    "invalid_request",
                    "Invalid Request",
                    e.to_string(),
                )],
            )
        }
    };

    if !crate::acl_bridge::caller_meets_scope(caller, "patch_video_group_review").await {
        match repository::is_group_uploader(&req.group_key, &caller.user_id).await {
            Ok(true) => {}
            Ok(false) => {
                return GrimoireResponse::failure(
                    "forbidden",
                    vec![ErrorDetail::new(
                        "forbidden",
                        "Forbidden",
                        "you did not upload this video",
                    )],
                )
            }
            Err(e) => return GrimoireResponse::failure("db error", vec![e.into()]),
        }
    }

    // series-level metadata only applies when the group is actually a
    // series (a standalone video's group_key is its own video id, not a
    // real video_seriez row) - probe for it rather than assuming.
    let group_series = crate::video::get_video_series(&req.group_key).await;
    let group_series_id = group_series.success.then(|| req.group_key.clone());

    if (req.series_title.is_some() || req.series_description.is_some()) && group_series.success {
        let update_req = UpdateVideoSeriesRequest {
            series_id: req.group_key.clone(),
            title: req.series_title.clone(),
            description: req.series_description.clone(),
            poster_blob_id: None,
            updated_by: Some(caller.user_id.clone()),
        };
        let result = update_video_series(update_req).await;
        if !result.success {
            return GrimoireResponse::failure("failed to update series", result.errors);
        }
    }

    // per-video patches
    if let Some(ref video_patches) = req.videos {
        for patch in video_patches {
            let mut season_id = patch.season_id.clone();
            if season_id.is_none() {
                if let Some(new_season) = &patch.new_season {
                    let series_id = match &group_series_id {
                        Some(id) => id.clone(),
                        None => {
                            return GrimoireResponse::failure(
                                "failed to create season",
                                vec![ErrorDetail::new(
                                    "bad_request",
                                    "Bad Request",
                                    "this group has no series to attach a season to",
                                )],
                            )
                        }
                    };
                    let season_result = crate::video::find_or_create_video_season(
                        &series_id,
                        new_season.season_number,
                        new_season.title.clone(),
                    )
                    .await;
                    match season_result {
                        GrimoireResponse {
                            success: true,
                            data: Some(season),
                            ..
                        } => season_id = Some(season.id),
                        response => {
                            return GrimoireResponse::failure(
                                "failed to create season",
                                response.errors,
                            )
                        }
                    }
                }
            }

            let update_req = UpdateVideoRequest {
                video_id: patch.video_id.clone(),
                series_id: None,
                season_id,
                episode_number: patch.episode_number,
                content_type: patch.content_type.clone(),
                title: patch.title.clone(),
                description: None,
                poster_blob_id: None,
                duration_seconds: None,
                release_date: None,
                updated_by: Some(caller.user_id.clone()),
                clear_series_id: false,
                clear_season_id: false,
            };
            let result = update_video(update_req).await;
            if !result.success {
                return GrimoireResponse::failure("failed to update video", result.errors);
            }
        }
    }


    match repository::mark_group_reviewed(&req.group_key, &req.session_id, &caller.user_id).await
    {
        Ok(()) => ok_response(),
        Err(e) => GrimoireResponse::failure("failed to mark reviewed", vec![e.into()]),
    }
}

/// move a single video to a different series/season (e.g. fix a
/// misdetected series during review) - does not itself mark anything
/// reviewed, mirrors music's `move_song`.
pub async fn move_video(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: MoveVideoReviewRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "invalid request body",
                vec![ErrorDetail::new(
                    "invalid_request",
                    "Invalid Request",
                    e.to_string(),
                )],
            )
        }
    };

    if !crate::acl_bridge::caller_meets_scope(caller, "move_video_review").await {
        match repository::is_group_uploader(&req.video_id, &caller.user_id).await {
            Ok(true) => {}
            Ok(false) => {
                return GrimoireResponse::failure(
                    "forbidden",
                    vec![ErrorDetail::new(
                        "forbidden",
                        "Forbidden",
                        "you did not upload this video",
                    )],
                )
            }
            Err(e) => return GrimoireResponse::failure("db error", vec![e.into()]),
        }
    }

    // `to_series_id`/`to_season_id` are always the literal desired final
    // state (never a "leave unchanged" partial patch); `new_series_title`/
    // `new_season` resolve (find-or-create) a series/season inline under
    // this call's own review permission, so the uploader never needs the
    // admin-gated create_video_series/create_video_season routes just to
    // organize their own upload, and take precedence when both are set.
    let mut to_series_id = req.to_series_id;
    if let Some(new_series_title) = &req.new_series_title {
        let series_result =
            crate::video::find_or_create_video_series(new_series_title, Some(caller.user_id.clone()))
                .await;
        match series_result {
            GrimoireResponse {
                success: true,
                data: Some(series),
                ..
            } => to_series_id = Some(series.id),
            response => {
                return GrimoireResponse::failure("failed to create series", response.errors)
            }
        }
    }

    let mut to_season_id = req.to_season_id;
    if let Some(new_season) = &req.new_season {
        let series_id = match &to_series_id {
            Some(id) => id.clone(),
            None => {
                return GrimoireResponse::failure(
                    "failed to create season",
                    vec![ErrorDetail::new(
                        "bad_request",
                        "Bad Request",
                        "cannot create a season without a series",
                    )],
                )
            }
        };
        let season_result = crate::video::find_or_create_video_season(
            &series_id,
            new_season.season_number,
            new_season.title.clone(),
        )
        .await;
        match season_result {
            GrimoireResponse {
                success: true,
                data: Some(season),
                ..
            } => to_season_id = Some(season.id),
            response => {
                return GrimoireResponse::failure("failed to create season", response.errors)
            }
        }
    }

    // `None` at this point (for either) means "clear it" -
    // `clear_series_id`/`clear_season_id` force that through
    // `update_video`'s otherwise COALESCE-only ("no change" on `None`)
    // semantics.
    let clear_series_id = to_series_id.is_none();
    let clear_season_id = to_season_id.is_none();
    // moving into a series always implies "series" content; moving to
    // standalone uses the caller's explicit choice (movie/clip),
    // defaulting to "movie" to match create_video's own default.
    let content_type = Some(if to_series_id.is_some() {
        "series".to_string()
    } else {
        req.content_type.clone().unwrap_or_else(|| "movie".to_string())
    });

    let update_req = UpdateVideoRequest {
        video_id: req.video_id,
        series_id: to_series_id,
        season_id: to_season_id,
        episode_number: None,
        content_type,
        title: None,
        description: None,
        poster_blob_id: None,
        duration_seconds: None,
        release_date: None,
        updated_by: Some(caller.user_id.clone()),
        clear_series_id,
        clear_season_id,
    };
    let result = update_video(update_req).await;
    if !result.success {
        return GrimoireResponse::failure("failed to move video", result.errors);
    }

    ok_response()
}

/// check whether a video's review group has pending unreviewed import blobs.
pub async fn video_pending(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if let Err(resp) = crate::acl_bridge::require_scope(caller, "video_pending").await {
        return resp;
    }

    let req: VideoPendingRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "invalid request body",
                vec![ErrorDetail::new(
                    "invalid_request",
                    "Invalid Request",
                    e.to_string(),
                )],
            )
        }
    };

    match repository::video_pending(&req.video_id, &caller.user_id, caller.is_admin()).await {
        Ok(resp) => match serde_json::to_value(resp) {
            Ok(v) => GrimoireResponse::success("ok", v),
            Err(e) => GrimoireResponse::failure(
                "serialization error",
                vec![ErrorDetail::new(
                    "serialization_error",
                    "Serialization Error",
                    e.to_string(),
                )],
            ),
        },
        Err(e) => GrimoireResponse::failure("failed to check pending status", vec![e.into()]),
    }
}

fn ok_response() -> GrimoireResponse<JsonValue> {
    match serde_json::to_value(VideoImportReviewOk { ok: true }) {
        Ok(v) => GrimoireResponse::success("ok", v),
        Err(e) => GrimoireResponse::failure(
            "serialization error",
            vec![ErrorDetail::new(
                "serialization_error",
                "Serialization Error",
                e.to_string(),
            )],
        ),
    }
}
