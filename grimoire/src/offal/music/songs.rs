//! song API handlers

use crate::error::ErrorDetail;
use crate::music::crud::{
    list_recent_songs, query_songs, update_songs as grimoire_update_songs,
    BulkClearSongArtworkRequest, BulkDeleteSongsRequest, QueryParams, RecentSongsRequest,
    UpdateSongsRequest,
};
use crate::music::entities::songs::{
    bulk_clear_song_artwork as grimoire_bulk_clear_artwork,
    bulk_delete_songs as grimoire_bulk_delete, delete_song as grimoire_delete_song,
};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;
use serde_json::Value as JsonValue;

/// query songs
///
/// path: POST /api/songs/query
pub async fn query(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let mut params: QueryParams = match serde_json::from_value(body) {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    // determine the target user_id for favorites/ratings
    let target_user_id = match &params.user_id {
        Some(uid) if uid != &caller.user_id => {
            if caller.role != UserRole::Admin {
                return GrimoireResponse::failure(
                    "forbidden",
                    vec![ErrorDetail::new(
                        "forbidden",
                        "forbidden",
                        "cannot query another user's data",
                    )],
                );
            }
            uid.clone()
        }
        Some(uid) => uid.clone(),
        None => caller.user_id.clone(),
    };

    params.user_id = Some(target_user_id);

    let response = query_songs(params).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get recent songs
///
/// path: POST /api/songs/recent
pub async fn recent(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RecentSongsRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    // note: list_recent_songs doesn't support user_id for favorites/ratings yet
    let response = list_recent_songs(req.limit).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// update songs
///
/// path: POST /api/songs/update
pub async fn update(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: UpdateSongsRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    let response = grimoire_update_songs(req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// bulk delete songs
///
/// path: POST /api/songs/bulk-delete
pub async fn bulk_delete(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: BulkDeleteSongsRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    // Call the repository function with extracted fields
    let response = grimoire_bulk_delete(req.song_ids, Some(caller.user_id.clone())).await;
    let message = response.message.clone();
    GrimoireResponse::success(&message, serde_json::to_value(response).unwrap())
}

/// bulk clear song artwork
///
/// path: POST /api/songs/bulk-clear-artwork
pub async fn bulk_clear_artwork(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: BulkClearSongArtworkRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    // Call the repository function with extracted fields
    let response = grimoire_bulk_clear_artwork(req.song_ids).await;
    let message = response.message.clone();
    GrimoireResponse::success(&message, serde_json::to_value(response).unwrap())
}

/// delete a single song (path param)
///
/// path: DELETE /api/songs/{id}
pub async fn delete(caller: &Caller, id: &str, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let response = grimoire_delete_song(id, Some(caller.user_id.clone())).await;
    response.map(|_| JsonValue::Null)
}
