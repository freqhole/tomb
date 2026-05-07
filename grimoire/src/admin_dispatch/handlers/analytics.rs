//! analytics handlers (read-only).

use crate::admin_dispatch::helpers::{
    bad_request, map_response_to_json, opt_i64, require_str, to_value,
};
use crate::response::GrimoireResponse;
use serde_json::{json, Value as JsonValue};

pub(in crate::admin_dispatch) async fn admin_overview() -> GrimoireResponse<JsonValue> {
    to_value(crate::music::analytics::get_overview_stats().await)
}

pub(in crate::admin_dispatch) async fn top_songs(args: JsonValue) -> GrimoireResponse<JsonValue> {
    to_value(crate::music::analytics::get_top_songs(opt_i64(&args, "limit", 20)).await)
}

pub(in crate::admin_dispatch) async fn top_albums(args: JsonValue) -> GrimoireResponse<JsonValue> {
    to_value(crate::music::analytics::get_top_albums(opt_i64(&args, "limit", 20)).await)
}

pub(in crate::admin_dispatch) async fn top_artists(args: JsonValue) -> GrimoireResponse<JsonValue> {
    to_value(crate::music::analytics::get_top_artists(opt_i64(&args, "limit", 20)).await)
}

pub(in crate::admin_dispatch) async fn user_stats(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let user_id = match require_str(&args, "user_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    to_value(crate::music::analytics::get_user_stats(&user_id).await)
}

pub(in crate::admin_dispatch) async fn all_user_stats(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    to_value(crate::music::analytics::get_all_user_stats(opt_i64(&args, "limit", 50)).await)
}

pub(in crate::admin_dispatch) async fn song_stats(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let song_id = match require_str(&args, "song_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    to_value(crate::music::analytics::get_song_play_analytics(&song_id).await)
}

pub(in crate::admin_dispatch) async fn user_history(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let user_id = match require_str(&args, "user_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    let limit = opt_i64(&args, "limit", 50);
    let offset = opt_i64(&args, "offset", 0);
    let resp = crate::music::analytics::get_user_listening_history(&user_id, limit, offset).await;
    map_response_to_json(
        resp,
        |(items, total_count)| json!({ "items": items, "total_count": total_count }),
    )
}

pub(in crate::admin_dispatch) async fn session(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let session_id = match require_str(&args, "session_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    to_value(crate::music::analytics::get_session_summary(&session_id).await)
}

pub(in crate::admin_dispatch) async fn recent_listens(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let limit = opt_i64(&args, "limit", 20);
    let offset = opt_i64(&args, "offset", 0);
    let types = vec![crate::music::analytics::FeedItemType::RecentListen];
    let resp =
        crate::music::analytics::get_combined_feed(limit, offset, Some(&types), None, None).await;
    map_response_to_json(
        resp,
        |(items, total_count)| json!({ "items": items, "total_count": total_count }),
    )
}

pub(in crate::admin_dispatch) async fn recent_favorites(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let limit = opt_i64(&args, "limit", 20);
    let offset = opt_i64(&args, "offset", 0);
    let types = vec![crate::music::analytics::FeedItemType::RecentFavorite];
    let resp =
        crate::music::analytics::get_combined_feed(limit, offset, Some(&types), None, None).await;
    map_response_to_json(
        resp,
        |(items, total_count)| json!({ "items": items, "total_count": total_count }),
    )
}

pub(in crate::admin_dispatch) async fn recent_albums(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let limit = opt_i64(&args, "limit", 20);
    let offset = opt_i64(&args, "offset", 0);
    let types = vec![crate::music::analytics::FeedItemType::RecentAlbum];
    let resp =
        crate::music::analytics::get_combined_feed(limit, offset, Some(&types), None, None).await;
    map_response_to_json(
        resp,
        |(items, total_count)| json!({ "items": items, "total_count": total_count }),
    )
}

pub(in crate::admin_dispatch) async fn feed(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let limit = opt_i64(&args, "limit", 20);
    let offset = opt_i64(&args, "offset", 0);
    let resp = crate::music::analytics::get_combined_feed(limit, offset, None, None, None).await;
    map_response_to_json(
        resp,
        |(items, total_count)| json!({ "items": items, "total_count": total_count }),
    )
}

pub(in crate::admin_dispatch) async fn counts(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let entity_type = match require_str(&args, "entity_type") {
        Ok(s) => s,
        Err(r) => return r,
    };
    let entity_id = match require_str(&args, "entity_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    let resp = match entity_type.to_lowercase().as_str() {
        "song" => crate::music::analytics::get_song_play_count(&entity_id).await,
        "album" => crate::music::analytics::get_album_play_count(&entity_id).await,
        "artist" => crate::music::analytics::get_artist_play_count(&entity_id).await,
        other => {
            return bad_request(format!(
                "invalid entity_type '{}': expected song, album, or artist",
                other
            ))
        }
    };
    map_response_to_json(resp, |count| json!({ "count": count }))
}
