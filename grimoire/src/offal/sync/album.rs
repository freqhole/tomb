//! album sync: receive an album shell with metadata + cover images.
//! see docs/SEND_TO_REMOTE_PLAN.md.

use serde_json::Value as JsonValue;

use crate::error::ErrorDetail;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;

use super::images::resolve_sync_image_ref;
use super::models::{SyncAlbumRequest, SyncAlbumResponse};

/// sync an album shell to local grimoire storage.
///
/// path: POST /api/sync/album
pub async fn sync_album(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    use crate::music::crud::create_or_update::{
        find_or_create_album_for_artist, find_or_create_artist,
    };
    use crate::music::crud::{AlbumImportRequest, ArtistImportRequest};
    use crate::music::entities::taxonomy::find_or_create_taxon;

    let req: SyncAlbumRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("sync_album: bad request from {}: {}", caller.username, e);
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    e.to_string(),
                )],
            );
        }
    };

    tracing::info!(
        "sync_album: START from {} -- title=\"{}\" artist=\"{}\" remote_album_id={} expected_songs={} images={}",
        caller.username,
        req.title,
        req.artist_name,
        req.remote_album_id,
        req.expected_song_blake3s.len(),
        req.images_base64.len(),
    );

    // 1. resolve / create the album artist by name (case-insensitive)
    let artist_resp = find_or_create_artist(ArtistImportRequest {
        name: req.artist_name.clone(),
        created_by: Some(caller.user_id.clone()),
    })
    .await;
    if !artist_resp.success {
        return GrimoireResponse::failure("failed to resolve artist", artist_resp.errors);
    }
    let (artist, _artist_was_new) = match artist_resp.data {
        Some(d) => d,
        None => {
            return GrimoireResponse::failure(
                "artist resolve returned no data",
                vec![ErrorDetail::new(
                    "internal_error",
                    "artist resolve",
                    "no artist returned",
                )],
            )
        }
    };

    // 2. resolve genre names → taxon ids (best-effort; skip any that fail)
    let mut genre_ids: Vec<String> = Vec::new();
    for name in &req.genres {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            continue;
        }
        let resp = find_or_create_taxon("genre", trimmed).await;
        if let Some(taxon) = resp.data {
            genre_ids.push(taxon.id);
        } else {
            tracing::warn!(
                "sync_album: failed to resolve genre {}: {}",
                trimmed,
                resp.message
            );
        }
    }
    let genre_ids_opt = if genre_ids.is_empty() {
        None
    } else {
        Some(genre_ids)
    };

    // 3. dedupe / create album by (artist_id, lower(title)).
    //    find_or_create_album_for_artist also auto-updates album_type if it differs.
    let album_req = AlbumImportRequest {
        title: req.title.clone(),
        album_type: req.album_type.clone(),
        release_date: req.release_date.clone(),
        label: req.label.clone(),
        genre_ids: genre_ids_opt,
        created_by: Some(caller.user_id.clone()),
    };
    let (album, was_created) = match find_or_create_album_for_artist(album_req, &artist.id).await {
        Ok(t) => t,
        Err(e) => {
            return GrimoireResponse::failure("failed to find or create album", vec![e.into()])
        }
    };
    let existing = !was_created;

    // TODO: when existing=true, merge missing fields (release_date, label, urls)
    // into the existing row. for now we leave existing rows untouched to keep
    // step 3 small. mb_release_id / mb_release_group_id / urls aren't persisted
    // on the album row at all yet.

    // 4. import album cover images.
    //    each ref is either inline base64 (decode + dedupe by sha256) or a
    //    pure reference (look up existing blob by sha256). missing referenced
    //    blobs are skipped, not fatal.
    let mut images_linked: i64 = 0;
    let mut missing_image_sha256s: Vec<String> = Vec::new();
    for (idx, img) in req.images_base64.iter().enumerate() {
        let blob_id_opt =
            match resolve_sync_image_ref(img, &format!("album-{}-{}", album.id, idx), None).await {
                Ok(Some(id)) => Some(id),
                Ok(None) => {
                    missing_image_sha256s.push(img.content_sha256.clone());
                    None
                }
                Err(e) => {
                    tracing::warn!(
                        "sync_album: failed to import image {} for album {}: {}",
                        img.content_sha256,
                        album.id,
                        e
                    );
                    None
                }
            };
        if let Some(blob_id) = blob_id_opt {
            let is_primary = img.is_primary || idx == 0;
            let add_result = crate::music::entities::albums::add_album_image(
                &album.id, &blob_id, is_primary, None,
            )
            .await;
            if add_result.success {
                images_linked += 1;
            } else {
                tracing::warn!(
                    "sync_album: failed to add image {} to album {}: {}",
                    blob_id,
                    album.id,
                    add_result.message
                );
            }
        }
    }

    // 5. attach tags (provenance + caller-supplied). idempotent.
    let mut tag_names: Vec<String> = Vec::with_capacity(1 + req.tags.len());
    tag_names.push(req.remote_name.clone());
    tag_names.extend(req.tags.iter().cloned());
    let tag_names: Vec<String> = tag_names
        .into_iter()
        .filter(|n| !n.trim().is_empty())
        .collect();
    if !tag_names.is_empty() {
        let tag_result = crate::music::entities::tags::add_albums_tags(
            crate::music::entities::tags::AddAlbumsTagsRequest {
                album_ids: vec![album.id.clone()],
                tag_ids: vec![],
                tag_names,
            },
        )
        .await;
        if !tag_result.success {
            tracing::warn!(
                "sync_album: failed to add tags to album {}: {}",
                album.id,
                tag_result.message
            );
        }
    }

    let response = SyncAlbumResponse {
        album_id: album.id.clone(),
        artist_id: artist.id.clone(),
        existing,
        images_linked,
        missing_image_sha256s: missing_image_sha256s.clone(),
    };

    tracing::info!(
        "sync_album: OK for {} title=\"{}\" album_id={} artist_id={} existing={} images_linked={} missing_images={}",
        caller.username,
        req.title,
        album.id,
        artist.id,
        existing,
        images_linked,
        missing_image_sha256s.len(),
    );

    GrimoireResponse::success(
        if existing {
            "album already existed"
        } else {
            "album synced successfully"
        },
        serde_json::to_value(response).unwrap_or_default(),
    )
}
