//! import review route handlers

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::music::crud::{update_songs, UpdateSongsRequest};
use crate::music::entities::albums::{update_album as grimoire_update_album, UpdateAlbumRequest};
use crate::music::entities::import_review::{
    models::{
        ImportReviewOk, ListPendingReviewRequest, MarkAlbumReviewedRequest,
        MergeAlbumsReviewRequest, MoveSongReviewRequest, PatchAlbumReviewRequest,
        PendingReviewSession,
    },
    repository,
};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use serde_json::Value as JsonValue;

pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "list_pending_import_review",
        path: "/api/music/import/pending",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ListPendingReviewRequest",
        response_type: "Vec<PendingReviewSession>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "mark_album_reviewed",
        path: "/api/music/import/mark-reviewed",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "MarkAlbumReviewedRequest",
        response_type: "ImportReviewOk",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "patch_album_review",
        path: "/api/music/import/patch-album",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "PatchAlbumReviewRequest",
        response_type: "ImportReviewOk",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "merge_albums_review",
        path: "/api/music/import/merge-albums",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "MergeAlbumsReviewRequest",
        response_type: "ImportReviewOk",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "move_song_review",
        path: "/api/music/import/move-song",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "MoveSongReviewRequest",
        response_type: "ImportReviewOk",
        auth: RouteAuth::Authenticated,
    },
];

/// list sessions with pending (unreviewed) albums.
/// members see only sessions where they uploaded at least one file.
pub async fn list_pending(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_member() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "Forbidden", "authentication required")],
        );
    }

    let req: ListPendingReviewRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "invalid request body",
                vec![ErrorDetail::new("invalid_request", "Invalid Request", e.to_string())],
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
                vec![ErrorDetail::new("serialization_error", "Serialization Error", e.to_string())],
            ),
        },
        Err(e) => GrimoireResponse::failure(
            "failed to list pending sessions",
            vec![e.into()],
        ),
    }
}

/// mark all pending blobs for an album in a session as reviewed.
pub async fn mark_reviewed(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_member() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "Forbidden", "authentication required")],
        );
    }

    let req: MarkAlbumReviewedRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "invalid request body",
                vec![ErrorDetail::new("invalid_request", "Invalid Request", e.to_string())],
            )
        }
    };

    if !caller.is_admin() {
        match repository::is_uploader(&req.album_id, &caller.user_id).await {
            Ok(true) => {}
            Ok(false) => {
                return GrimoireResponse::failure(
                    "forbidden",
                    vec![ErrorDetail::new("forbidden", "Forbidden", "you did not upload this album")],
                )
            }
            Err(e) => return GrimoireResponse::failure("db error", vec![e.into()]),
        }
    }

    match repository::mark_album_reviewed(&req.album_id, &req.session_id, &caller.user_id).await {
        Ok(()) => match serde_json::to_value(ImportReviewOk { ok: true }) {
            Ok(v) => GrimoireResponse::success("ok", v),
            Err(e) => GrimoireResponse::failure(
                "serialization error",
                vec![ErrorDetail::new("serialization_error", "Serialization Error", e.to_string())],
            ),
        },
        Err(e) => GrimoireResponse::failure("failed to mark reviewed", vec![e.into()]),
    }
}

/// patch album metadata and mark it reviewed in one call.
pub async fn patch_album(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_member() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "Forbidden", "authentication required")],
        );
    }

    let req: PatchAlbumReviewRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "invalid request body",
                vec![ErrorDetail::new("invalid_request", "Invalid Request", e.to_string())],
            )
        }
    };

    if !caller.is_admin() {
        match repository::is_uploader(&req.album_id, &caller.user_id).await {
            Ok(true) => {}
            Ok(false) => {
                return GrimoireResponse::failure(
                    "forbidden",
                    vec![ErrorDetail::new("forbidden", "Forbidden", "you did not upload this album")],
                )
            }
            Err(e) => return GrimoireResponse::failure("db error", vec![e.into()]),
        }
    }

    // apply album-level metadata update if any fields are set
    let has_album_changes = req.title.is_some()
        || req.artist_id.is_some()
        || req.artist_name.is_some()
        || req.album_type.is_some()
        || req.release_date.is_some()
        || req.label.is_some();

    if has_album_changes {
        let update_req = UpdateAlbumRequest {
            album_id: req.album_id.clone(),
            title: req.title.clone(),
            artist_id: req.artist_id.clone(),
            artist_name: req.artist_name.clone(),
            album_type: req.album_type.clone(),
            release_date: req.release_date.clone(),
            label: req.label.clone(),
            entity_urls: None,
            updated_by: Some(caller.user_id.clone()),
            merge_into_album_id: None,
        };
        let result = grimoire_update_album(update_req).await;
        if !result.success {
            return GrimoireResponse::failure("failed to update album", result.errors);
        }
    }

    // apply per-song patches if provided
    if let Some(ref song_patches) = req.songs {
        for patch in song_patches {
            let update_req: UpdateSongsRequest = match serde_json::from_value(serde_json::json!({
                "song_ids": [patch.song_id],
                "user_id": caller.user_id,
                "updated_by": caller.user_id,
                "title": patch.title,
                "track_number": patch.track_number,
                "disc_number": patch.disc_number,
                "track_artist": patch.track_artist,
            })) {
                Ok(r) => r,
                Err(e) => return GrimoireResponse::failure(
                    "failed to build song update request",
                    vec![ErrorDetail::new("internal_error", "Internal Error", e.to_string())],
                ),
            };
            let result = update_songs(update_req).await;
            if !result.success {
                return GrimoireResponse::failure(
                    "failed to update song",
                    result.errors,
                );
            }
        }
    }

    // mark reviewed
    match repository::mark_album_reviewed(&req.album_id, &req.session_id, &caller.user_id).await {
        Ok(()) => match serde_json::to_value(ImportReviewOk { ok: true }) {
            Ok(v) => GrimoireResponse::success("ok", v),
            Err(e) => GrimoireResponse::failure(
                "serialization error",
                vec![ErrorDetail::new("serialization_error", "Serialization Error", e.to_string())],
            ),
        },
        Err(e) => GrimoireResponse::failure("failed to mark reviewed", vec![e.into()]),
    }
}

/// merge source albums into a target album, then mark them all reviewed.
pub async fn merge_albums(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_member() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "Forbidden", "authentication required")],
        );
    }

    let req: MergeAlbumsReviewRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "invalid request body",
                vec![ErrorDetail::new("invalid_request", "Invalid Request", e.to_string())],
            )
        }
    };

    if !caller.is_admin() {
        // must own the target album
        match repository::is_uploader(&req.target_id, &caller.user_id).await {
            Ok(true) => {}
            Ok(false) => {
                return GrimoireResponse::failure(
                    "forbidden",
                    vec![ErrorDetail::new("forbidden", "Forbidden", "you did not upload this album")],
                )
            }
            Err(e) => return GrimoireResponse::failure("db error", vec![e.into()]),
        }
    }

    // merge each source into target via update_album merge_into_album_id
    for source_id in &req.source_ids {
        let merge_req = UpdateAlbumRequest {
            album_id: source_id.clone(),
            merge_into_album_id: Some(req.target_id.clone()),
            updated_by: Some(caller.user_id.clone()),
            title: None,
            artist_id: None,
            artist_name: None,
            album_type: None,
            release_date: None,
            label: None,
            entity_urls: None,
        };
        let result = grimoire_update_album(merge_req).await;
        if !result.success {
            return GrimoireResponse::failure("failed to merge album", result.errors);
        }
        // mark the source album's blobs reviewed
        if let Err(e) =
            repository::mark_album_reviewed(source_id, &req.session_id, &caller.user_id).await
        {
            return GrimoireResponse::failure("failed to mark source reviewed", vec![e.into()]);
        }
    }

    // mark target reviewed
    match repository::mark_album_reviewed(&req.target_id, &req.session_id, &caller.user_id).await {
        Ok(()) => match serde_json::to_value(ImportReviewOk { ok: true }) {
            Ok(v) => GrimoireResponse::success("ok", v),
            Err(e) => GrimoireResponse::failure(
                "serialization error",
                vec![ErrorDetail::new("serialization_error", "Serialization Error", e.to_string())],
            ),
        },
        Err(e) => GrimoireResponse::failure("failed to mark target reviewed", vec![e.into()]),
    }
}

/// move a song to a different album, re-keying album_songz via update_songs.
pub async fn move_song(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_member() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "Forbidden", "authentication required")],
        );
    }

    let req: MoveSongReviewRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "invalid request body",
                vec![ErrorDetail::new("invalid_request", "Invalid Request", e.to_string())],
            )
        }
    };

    if !caller.is_admin() {
        // must own the destination album
        match repository::is_uploader(&req.to_album_id, &caller.user_id).await {
            Ok(true) => {}
            Ok(false) => {
                return GrimoireResponse::failure(
                    "forbidden",
                    vec![ErrorDetail::new("forbidden", "Forbidden", "you did not upload this album")],
                )
            }
            Err(e) => return GrimoireResponse::failure("db error", vec![e.into()]),
        }
    }

    // reuse update_songs album_id field - it handles the album_songz DELETE+INSERT
    let update_req: UpdateSongsRequest = match serde_json::from_value(serde_json::json!({
        "song_ids": [req.song_id],
        "user_id": caller.user_id,
        "album_id": req.to_album_id,
    })) {
        Ok(r) => r,
        Err(e) => return GrimoireResponse::failure(
            "failed to build song update request",
            vec![ErrorDetail::new("internal_error", "Internal Error", e.to_string())],
        ),
    };
    let result = update_songs(update_req).await;
    if !result.success {
        return GrimoireResponse::failure("failed to move song", result.errors);
    }

    match serde_json::to_value(ImportReviewOk { ok: true }) {
        Ok(v) => GrimoireResponse::success("ok", v),
        Err(e) => GrimoireResponse::failure(
            "serialization error",
            vec![ErrorDetail::new("serialization_error", "Serialization Error", e.to_string())],
        ),
    }
}
