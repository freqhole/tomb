//! playlist sync: create/refresh a playlist shell whose members (songs
//! and/or videos) are resolved on the destination by blake3.

use serde_json::Value as JsonValue;

use crate::entities::TaggableEntity;
use crate::error::ErrorDetail;
use crate::music::crud::create_or_update::import_song_with_metadata;
use crate::music::crud::ImportSongRequest;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;

use super::images::resolve_sync_image_ref;
use super::models::{SyncPlaylistRequest, SyncPlaylistResponse};

/// look up an existing (non-deleted) video by its media_blob_id - mirrors
/// `video::importer`'s private helper of the same shape, kept separate
/// since that one lives in a module this doesn't otherwise depend on.
async fn find_video_by_media_blob_id(media_blob_id: &str) -> Option<String> {
    let pool = crate::database::connect().await.ok()?;
    let row = sqlx::query_scalar!(
        "SELECT id FROM videoz WHERE media_blob_id = ? AND deleted_at IS NULL LIMIT 1",
        media_blob_id
    )
    .fetch_optional(&pool)
    .await
    .ok()?;
    row.flatten()
}

/// sync a playlist to local grimoire storage.
///
/// path: POST /api/sync/playlist
///
/// resolves each member's `blake3` to a song or video row (per its `kind`).
/// for songs: when a media_blob exists for the blake3 but no song row is
/// linked yet (race with `/api/upload/music-by-blake3`'s ImportMusic job),
/// creates a minimal song stub from the blob's filename so the playlist
/// still gets a row at the right position. video has no stub-creation
/// equivalent (a missing video is just reported missing - nothing to stub
/// from, since videos always needs real import metadata). blake3s that
/// resolve to nothing at all are reported in `missing_member_blake3s` and
/// skipped (caller may retry later).
pub async fn sync_playlist(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: SyncPlaylistRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("sync_playlist: bad request from {}: {}", caller.username, e);
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
        "sync_playlist: START from {} -- title=\"{}\" remote_playlist_id={} members={} images={}",
        caller.username,
        req.title,
        req.remote_playlist_id,
        req.members.len(),
        req.images.len(),
    );

    // resolve each member -> (entity_type, entity_id), preserving original
    // order (one shared position space across song+video - see
    // `crate::playlists::set_playlist_items`).
    let mut resolved_refs: Vec<(TaggableEntity, String)> = Vec::new();
    let mut missing_member_blake3s: Vec<String> = Vec::new();
    let mut song_stubs_created: i64 = 0;

    for member in &req.members {
        match member.kind.as_str() {
            "video" => match crate::media_blobz::get_media_blob_by_blake3(&member.blake3).await {
                Ok(blob) => match find_video_by_media_blob_id(&blob.id).await {
                    Some(video_id) => resolved_refs.push((TaggableEntity::Video, video_id)),
                    None => missing_member_blake3s.push(member.blake3.clone()),
                },
                Err(_) => missing_member_blake3s.push(member.blake3.clone()),
            },
            // default to "song" - keeps old callers (pre-dating the `kind`
            // field) working the same way they always did.
            _ => match crate::music::entities::songs::get_song_by_blake3(&member.blake3).await {
                Ok(Some(id)) => resolved_refs.push((TaggableEntity::Song, id)),
                Ok(None) => {
                    // no song row yet — see if a media_blob exists for this blake3.
                    // if so, create a stub song row from the blob's filename.
                    match crate::media_blobz::get_media_blob_by_blake3(&member.blake3).await {
                        Ok(blob) => {
                            let stub_title = blob
                                .filename
                                .clone()
                                .unwrap_or_else(|| format!("(unknown {})", &member.blake3[..8]));
                            let stub_resp = import_song_with_metadata(ImportSongRequest {
                                media_blob_id: blob.id.clone(),
                                title: stub_title,
                                artist_name: None,
                                album_title: None,
                                genre_name: None,
                                track_number: 0,
                                disc_number: 0,
                                duration: None,
                                year: None,
                                bpm: None,
                                track_artist: None,
                                metadata: None,
                                lyrics: None,
                                created_by: Some(caller.user_id.clone()),
                                is_compilation: false,
                            })
                            .await;
                            if let Some(result) = stub_resp.data {
                                resolved_refs.push((TaggableEntity::Song, result.song.id));
                                song_stubs_created += 1;
                            } else {
                                tracing::warn!(
                                    "sync_playlist: failed to create stub song for blake3 {}: {}",
                                    &member.blake3[..16],
                                    stub_resp.message
                                );
                                missing_member_blake3s.push(member.blake3.clone());
                            }
                        }
                        Err(_) => missing_member_blake3s.push(member.blake3.clone()),
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        "sync_playlist: failed to lookup song by blake3 {}: {}",
                        &member.blake3[..16],
                        e
                    );
                    missing_member_blake3s.push(member.blake3.clone());
                }
            },
        }
    }

    // deterministic synced playlist id (idempotent across replays).
    // includes source_remote_id when supplied so the same remote_playlist_id
    // from two different remotes maps to two distinct destination playlists.
    let synced_playlist_id = match &req.source_remote_id {
        Some(rid) if !rid.is_empty() => format!("synced-{}-{}", rid, req.remote_playlist_id),
        _ => format!("synced-{}", req.remote_playlist_id),
    };

    let existing = crate::music::entities::playlists::get_playlist(&synced_playlist_id).await;

    let playlist_id = if existing.success && existing.data.is_some() {
        tracing::info!(
            "sync_playlist: updating existing synced playlist {} ({})",
            req.title,
            synced_playlist_id
        );
        let _ = crate::music::entities::playlists::update_playlist(
            &synced_playlist_id,
            crate::music::entities::playlists::UpdatePlaylistRequest {
                playlist_id: synced_playlist_id.clone(),
                title: Some(req.title.clone()),
                description: req.description.clone(),
                is_public: Some(false),
                collaborative: None,
                private: None,
                updated_by: Some(caller.user_id.clone()),
                entity_urls: None,
            },
        )
        .await;
        synced_playlist_id
    } else {
        tracing::info!(
            "sync_playlist: creating new synced playlist {} ({})",
            req.title,
            synced_playlist_id
        );
        let create_response = crate::music::entities::playlists::create_playlist(
            crate::music::entities::playlists::CreatePlaylistRequest {
                id: Some(synced_playlist_id.clone()),
                title: Some(req.title.clone()),
                description: req.description.clone(),
                is_public: Some(false),
                created_by_id: Some(caller.user_id.clone()),
            },
        )
        .await;
        if !create_response.success {
            return GrimoireResponse::failure("failed to create playlist", create_response.errors);
        }
        synced_playlist_id
    };

    let playlist_response = crate::music::entities::playlists::get_playlist(&playlist_id).await;
    let playlist = match playlist_response.data {
        Some(p) => p,
        None => {
            return GrimoireResponse::failure(
                "playlist not found after create/update",
                vec![ErrorDetail::new(
                    "internal_error",
                    "fetch failed",
                    "could not retrieve playlist",
                )],
            );
        }
    };

    // replace the playlist's full membership with the resolved refs, in
    // order (one shared position space across song+video).
    if !resolved_refs.is_empty() {
        let set_result = crate::playlists::set_playlist_items(
            &playlist.id,
            &resolved_refs,
            Some(caller.user_id.clone()),
        )
        .await;
        if !set_result.success {
            tracing::warn!(
                "sync_playlist: failed to set members on playlist {}: {}",
                playlist.id,
                set_result.message
            );
        }
    }

    // link playlist images (blake3-addressed; pulled from source_node_id if
    // not already local)
    let mut images_linked: i64 = 0;
    let mut missing_image_blake3s: Vec<String> = Vec::new();
    let source_node_id = req.source_node_id.as_deref().unwrap_or("");
    for (idx, img) in req.images.iter().enumerate() {
        let blob_id_opt = match resolve_sync_image_ref(
            img,
            source_node_id,
            &format!("playlist-{}-{}", playlist.id, idx),
            None,
        )
        .await
        {
            Ok(Some(id)) => Some(id),
            Ok(None) => {
                missing_image_blake3s.push(img.blake3.clone());
                None
            }
            Err(e) => {
                tracing::warn!(
                    "sync_playlist: failed to import image {} for playlist {}: {}",
                    img.blake3,
                    playlist.id,
                    e
                );
                None
            }
        };
        if let Some(blob_id) = blob_id_opt {
            let is_primary = img.is_primary || idx == 0;
            let add_result = crate::music::entities::playlists::add_playlist_image(
                &playlist.id,
                &blob_id,
                is_primary,
                None,
            )
            .await;
            if add_result.success {
                images_linked += 1;
            }
        }
    }

    // single feed event for the playlist (idempotent upsert)
    let _ = crate::music::analytics::feed_events::upsert_playlist_feed_event(
        &playlist.id,
        &caller.user_id,
        &caller.username,
    )
    .await;

    let response = SyncPlaylistResponse {
        playlist_id: playlist.id.clone(),
        members_added: resolved_refs.len() as i64,
        missing_member_blake3s,
        song_stubs_created,
        images_linked,
        missing_image_blake3s,
    };

    tracing::info!(
        "sync_playlist: OK for {} title=\"{}\" playlist_id={} members_added={} stubs={} missing_members={} images_linked={} missing_images={}",
        caller.username,
        req.title,
        playlist.id,
        resolved_refs.len(),
        song_stubs_created,
        response.missing_member_blake3s.len(),
        images_linked,
        response.missing_image_blake3s.len(),
    );

    GrimoireResponse::success(
        format!(
            "playlist synced with {} members ({} missing, {} stubbed)",
            resolved_refs.len(),
            response.missing_member_blake3s.len(),
            song_stubs_created,
        ),
        serde_json::to_value(response).unwrap_or_default(),
    )
}
