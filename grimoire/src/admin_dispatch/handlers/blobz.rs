//! blob-store inspection handlers (blake3 status / backfill / has-check / refs).

use crate::admin_dispatch::helpers::{bad_request, opt_i64, require_str, to_value};
use crate::response::GrimoireResponse;
use serde_json::{json, Value as JsonValue};

/// count how many media_blobz rows still need a blake3 hash backfilled.
/// args: `{}`
pub(in crate::admin_dispatch) async fn blake3_status() -> GrimoireResponse<JsonValue> {
    match crate::media_blobz::count_blobs_needing_blake3().await {
        Ok(n) => GrimoireResponse::success(
            &format!("{n} blobs need blake3 backfill"),
            json!({ "needing_backfill": n }),
        ),
        Err(e) => GrimoireResponse::failure("failed to count blobs", vec![e.into()]),
    }
}

/// backfill blake3 hashes for media_blobz rows that don't have one.
/// args: `{ batch_size?: i64 (default 100) }`
/// returns `{ scanned, hashed }` totals.
pub(in crate::admin_dispatch) async fn backfill_blake3(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let batch_size = opt_i64(&args, "batch_size", 100);
    if batch_size <= 0 {
        return bad_request("batch_size must be > 0");
    }
    match crate::blobz::backfill_blake3_hashes(batch_size).await {
        Ok((scanned, hashed)) => GrimoireResponse::success(
            &format!("scanned {scanned} blobs, hashed {hashed}"),
            json!({ "scanned": scanned, "hashed": hashed }),
        ),
        Err(e) => GrimoireResponse::failure("backfill failed", vec![e.into()]),
    }
}

/// list the references (songs / albums / etc.) that point at a media
/// blob. used to check whether deleting a blob will cascade.
/// args: `{ blob_id: String }`
pub(in crate::admin_dispatch) async fn check_references(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let blob_id = match require_str(&args, "blob_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    match crate::media_blobz::find_media_blob_references(&blob_id).await {
        Ok(refs) => to_value(GrimoireResponse::success("ok", refs)),
        Err(e) => GrimoireResponse::failure("failed to list references", vec![e.into()]),
    }
}
