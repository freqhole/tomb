//! playlist sync: create/refresh a playlist shell whose members are
//! resolved on the destination by song blake3.

use serde_json::Value as JsonValue;

use crate::error::ErrorDetail;
use crate::music::crud::create_or_update::import_song_with_metadata;
use crate::music::crud::ImportSongRequest;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;

use super::images::resolve_sync_image_ref;
use super::models::{SyncPlaylistRequest, SyncPlaylistResponse};

/// sync a playlist to local grimoire storage.
///
/// path: POST /api/sync/playlist
///
/// resolves each `song_blake3` via `media_blobz.blake3 -> songz.media_blob_id`.
/// when a media_blob exists for the blake3 but no song row is linked yet
/// (race with `/api/upload/music-by-blake3`'s ImportMusic job), creates a
/// minimal song stub from the blob's filename so the playlist still gets a
/// row at the right position. blake3s with no media_blob at all are reported
/// in `missing_song_blake3s` and skipped (caller may retry later).
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
        "sync_playlist: START from {} -- title=\"{}\" remote_playlist_id={} songs={} images={}",
        caller.username,
        req.title,
        req.remote_playlist_id,
        req.song_blake3s.len(),
        req.images.len(),
    );

    // resolve each blake3 -> song_id, preserving original positions.
    // if no song row exists yet but a media_blob does, create a stub so the
    // playlist member still anchors at the right position.
    let mut songs_with_positions: Vec<(String, i64)> = Vec::new();
    let mut missing_song_blake3s: Vec<String> = Vec::new();
    let mut song_stubs_created: i64 = 0;

    for (idx, blake3) in req.song_blake3s.iter().enumerate() {
        match crate::music::entities::songs::get_song_by_blake3(blake3).await {
            Ok(Some(id)) => songs_with_positions.push((id, idx as i64)),
            Ok(None) => {
                // no song row yet — see if a media_blob exists for this blake3.
                // if so, create a stub song row from the blob's filename.
                match crate::media_blobz::get_media_blob_by_blake3(blake3).await {
                    Ok(blob) => {
                        let stub_title = blob
                            .filename
                            .clone()
                            .unwrap_or_else(|| format!("(unknown {})", &blake3[..8]));
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
                            songs_with_positions.push((result.song.id, idx as i64));
                            song_stubs_created += 1;
                        } else {
                            tracing::warn!(
                                "sync_playlist: failed to create stub song for blake3 {}: {}",
                                &blake3[..16],
                                stub_resp.message
                            );
                            missing_song_blake3s.push(blake3.clone());
                        }
                    }
                    Err(_) => missing_song_blake3s.push(blake3.clone()),
                }
            }
            Err(e) => {
                tracing::warn!(
                    "sync_playlist: failed to lookup song by blake3 {}: {}",
                    &blake3[..16],
                    e
                );
                missing_song_blake3s.push(blake3.clone());
            }
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

    // set songs with explicit positions (blake3 order from request)
    if !songs_with_positions.is_empty() {
        let set_result = crate::music::entities::playlists::set_playlist_songs(
            &playlist.id,
            &songs_with_positions,
            Some((caller.user_id.as_str(), caller.username.as_str())),
        )
        .await;
        if !set_result.success {
            tracing::warn!(
                "sync_playlist: failed to set songs on playlist {}: {}",
                playlist.id,
                set_result.message
            );
        }
    }

    // link playlist images (sha256-addressed; existing blobs reused)
    let mut images_linked: i64 = 0;
    let mut missing_image_sha256s: Vec<String> = Vec::new();
    for (idx, img) in req.images.iter().enumerate() {
        let blob_id_opt =
            match resolve_sync_image_ref(img, &format!("playlist-{}-{}", playlist.id, idx), None)
                .await
            {
                Ok(Some(id)) => Some(id),
                Ok(None) => {
                    missing_image_sha256s.push(img.content_sha256.clone());
                    None
                }
                Err(e) => {
                    tracing::warn!(
                        "sync_playlist: failed to import image {} for playlist {}: {}",
                        img.content_sha256,
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
        songs_added: songs_with_positions.len() as i64,
        missing_song_blake3s,
        song_stubs_created,
        images_linked,
        missing_image_sha256s,
    };

    tracing::info!(
        "sync_playlist: OK for {} title=\"{}\" playlist_id={} songs_added={} stubs={} missing_songs={} images_linked={} missing_images={}",
        caller.username,
        req.title,
        playlist.id,
        songs_with_positions.len(),
        song_stubs_created,
        response.missing_song_blake3s.len(),
        images_linked,
        response.missing_image_sha256s.len(),
    );

    GrimoireResponse::success(
        format!(
            "playlist synced with {} songs ({} missing, {} stubbed)",
            songs_with_positions.len(),
            response.missing_song_blake3s.len(),
            song_stubs_created,
        ),
        serde_json::to_value(response).unwrap_or_default(),
    )
}
