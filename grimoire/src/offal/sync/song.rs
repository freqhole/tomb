//! song sync: pull one song's audio blob from a source peer and write a
//! complete songz row (plus its images) on the destination.

use serde_json::Value as JsonValue;

use crate::error::ErrorDetail;
use crate::media_domain::MediaDomain;
use crate::music::crud::create_or_update::import_song_with_metadata;
use crate::music::crud::ImportSongRequest;
use crate::offal::caller::Caller;
use crate::offal::upload::pull_audio_blob_to_local_storage;
use crate::response::GrimoireResponse;

use super::images::resolve_sync_image_ref;
use super::models::{SyncSongByBlake3Request, SyncSongByBlake3Response};

/// get all song sha256s from local grimoire database
/// used by client to initialize synced song cache on startup
pub async fn get_synced_sha256s(_caller: &Caller) -> GrimoireResponse<JsonValue> {
    match crate::music::entities::songs::get_all_song_sha256s().await {
        Ok(sha256s) => GrimoireResponse::success("synced sha256s", serde_json::json!(sha256s)),
        Err(e) => GrimoireResponse::failure("failed to fetch sha256s", vec![e.into()]),
    }
}

/// sync a song from a source remote via iroh-blobs pull.
///
/// path: POST /api/sync/song-by-blake3
///
/// flow:
///   1. parse + validate request
///   2. shortcut: if a song row already exists keyed by `blake3`, skip the pull entirely
///   3. otherwise, call `pull_audio_blob_to_local_storage` (verified streaming + dedupe)
///   4. write a complete song row via `import_song_with_metadata` (no async ImportMusic job)
///   5. attach song images by `SyncImageRef` (inline base64 OR existing-by-sha256)
pub async fn sync_song_by_blake3(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: SyncSongByBlake3Request = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(
                "sync_song_by_blake3: bad request from {}: {}",
                caller.username,
                e
            );
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
        "sync_song_by_blake3: START from {} -- title=\"{}\" blake3={} sha256={} size={:?} source_node={} source_remote={:?} filename=\"{}\"",
        caller.username,
        req.title,
        req.blake3,
        &req.sha256[..16.min(req.sha256.len())],
        req.size,
        req.source_node_id,
        req.source_remote_id,
        req.filename,
    );

    // 2. shortcut: song already linked to this blake3 -> idempotent success.
    //
    //    before returning we reconcile artist/album/genre membership using the
    //    request's metadata. without this, a partial-album sync (where some
    //    songs were already on the dest from a prior run, a manual upload, or
    //    a re-tag of the source album) would leave those songs orphaned from
    //    the freshly-created dest album row, producing the classic "missing
    //    last song" symptom on send-to-remote.
    if let Ok(Some(existing_song_id)) =
        crate::music::entities::songs::get_song_by_blake3(&req.blake3).await
    {
        tracing::info!(
            "sync_song_by_blake3: song already exists for blake3 {} -> {}; reconciling links",
            &req.blake3[..16.min(req.blake3.len())],
            existing_song_id
        );

        if let Err(e) = reconcile_existing_song_links(&existing_song_id, &req, caller).await {
            tracing::warn!(
                "sync_song_by_blake3: reconcile failed for song {} (blake3 {}): {}",
                existing_song_id,
                &req.blake3[..16.min(req.blake3.len())],
                e,
            );
        }

        // single lookup for both id and local_path
        let opt_blob = crate::media_blobz::get_media_blob_by_blake3(&req.blake3)
            .await
            .ok();
        let media_blob_id = opt_blob.as_ref().map(|b| b.id.clone()).unwrap_or_default();
        let local_path = opt_blob
            .as_ref()
            .and_then(|b| b.local_path.clone())
            .unwrap_or_default();

        if local_path.is_empty() {
            // song row exists but the file isn't on disk (local_path null or blob row missing).
            // fall through to the pull path so it re-downloads and returns a usable path.
            // the pull path handles the resulting duplicate detection cleanly.
            tracing::warn!(
                "sync_song_by_blake3: song {} exists for blake3 {} but local_path is empty (media_blob='{}') — re-pulling",
                existing_song_id,
                &req.blake3[..16.min(req.blake3.len())],
                media_blob_id,
            );
        } else {
            tracing::info!(
                "sync_song_by_blake3: song {} already local — media_blob={} path={}",
                existing_song_id,
                media_blob_id,
                local_path,
            );
            let response = SyncSongByBlake3Response {
                song_id: existing_song_id,
                media_blob_id,
                file_path: local_path,
                sha256: req.sha256.clone(),
                blake3: req.blake3.clone(),
                existing: true,
                images_linked: 0,
                missing_image_sha256s: Vec::new(),
            };
            return GrimoireResponse::success(
                "song already existed",
                serde_json::to_value(response).unwrap_or_default(),
            );
        }
    }

    // 3. pull the audio blob (verified streaming + sha256 verify + dedupe)
    tracing::info!(
        "sync_song_by_blake3: pulling blob {} from source peer {} ({} bytes declared)",
        &req.blake3[..16.min(req.blake3.len())],
        &req.source_node_id[..16.min(req.source_node_id.len())],
        req.size.map(|s| s as i64).unwrap_or(-1),
    );
    let pulled = match pull_audio_blob_to_local_storage(
        &req.source_node_id,
        &req.blake3,
        Some(&req.sha256),
        req.size,
        &req.filename,
        caller,
        MediaDomain::Music,
    )
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(
                "sync_song_by_blake3: FAIL pull for {} title=\"{}\" blake3={}: {:?}",
                caller.username,
                req.title,
                &req.blake3[..16.min(req.blake3.len())],
                e,
            );
            // if the source peer says we are not a registered federation peer,
            // automatically send a knock request on behalf of the caller and
            // return a structured peer_unauthorized error so the client can
            // surface a friendly message. subsequent retries of this sync job
            // should just work once the source accepts the knock.
            if let crate::offal::upload::PullAudioBlobError::PeerUnauthorized { peer, blake3 } = &e
            {
                let short = &blake3[..16.min(blake3.len())];
                let knock_body = serde_json::json!({
                    "username": caller.username.clone(),
                    "message": format!(
                        "auto-knock: {} needs access to sync song (blake3={})",
                        caller.username, short,
                    ),
                })
                .to_string();
                match crate::federation::p2p_client::api_request(
                    peer,
                    "POST",
                    "/api/knock",
                    Some(knock_body),
                )
                .await
                {
                    Ok(resp) => {
                        tracing::info!(
                            "sync_song_by_blake3: auto-knock sent to {} (status {})",
                            &peer[..16.min(peer.len())],
                            resp.status,
                        );
                    }
                    Err(knock_err) => {
                        tracing::warn!(
                            "sync_song_by_blake3: auto-knock failed for {}: {}",
                            &peer[..16.min(peer.len())],
                            knock_err,
                        );
                    }
                }
            }
            return e.into_grimoire_response();
        }
    };
    tracing::info!(
        "sync_song_by_blake3: pulled blob {} ({} bytes) -> media_blob {} at {}",
        &req.blake3[..16.min(req.blake3.len())],
        pulled.size,
        pulled.blob.id,
        pulled.local_path.display(),
    );

    // 4. write the song row immediately with the supplied metadata.
    //    no async ImportMusic job — sync trusts the source's tags.
    let import_response = import_song_with_metadata(ImportSongRequest {
        media_blob_id: pulled.blob.id.clone(),
        title: req.title.clone(),
        artist_name: Some(req.artist_name.clone()),
        album_title: Some(req.album_title.clone()),
        genre_name: req.genre_name.clone(),
        track_number: req.track_number,
        disc_number: req.disc_number,
        duration: req.duration_ms,
        year: req.year,
        bpm: req.bpm,
        track_artist: req.track_artist.clone(),
        metadata: req.metadata.clone(),
        lyrics: req.lyrics.clone(),
        created_by: Some(caller.user_id.clone()),
        is_compilation: req.is_compilation,
    })
    .await;

    if !import_response.success {
        tracing::error!(
            "sync_song_by_blake3: import failed for title=\"{}\" blake3={} blob={} — {} — errors: {}",
            req.title,
            &req.blake3[..16.min(req.blake3.len())],
            pulled.blob.id,
            import_response.message,
            import_response.errors
                .iter()
                .map(|e| format!("[{}] {}", e.error_type, e.detail))
                .collect::<Vec<_>>()
                .join("; "),
        );
        return GrimoireResponse::failure("failed to import song", import_response.errors);
    }
    let import_result = match import_response.data {
        Some(r) => r,
        None => {
            return GrimoireResponse::failure(
                "import returned no data",
                vec![ErrorDetail::new(
                    "internal_error",
                    "import failed",
                    "no import result returned",
                )],
            );
        }
    };
    if import_result.existing {
        tracing::info!(
            "sync_song_by_blake3: pulled blob {} is a duplicate of existing song {} — using pulled blob path",
            pulled.blob.id,
            import_result.song.id,
        );
    }
    let import_existing = import_result.existing;
    let song_id = import_result.song.id.clone();

    // 5. link song images. each ref is either inline base64 (decode + dedupe by
    //    sha256) or a pure reference (look up existing blob by sha256). missing
    //    referenced blobs are recorded but not fatal.
    let mut images_linked: i64 = 0;
    let mut missing_image_sha256s: Vec<String> = Vec::new();
    for (idx, img) in req.song_images.iter().enumerate() {
        let blob_id_opt = match resolve_sync_image_ref(
            img,
            &format!("song-{}-{}", song_id, idx),
            Some(&pulled.blob.id),
        )
        .await
        {
            Ok(Some(id)) => Some(id),
            Ok(None) => {
                missing_image_sha256s.push(img.content_sha256.clone());
                None
            }
            Err(e) => {
                tracing::warn!(
                    "sync_song_by_blake3: failed to import image {} for song {}: {}",
                    img.content_sha256,
                    song_id,
                    e
                );
                None
            }
        };
        if let Some(blob_id) = blob_id_opt {
            let is_primary = img.is_primary || idx == 0;
            let add_result =
                crate::music::entities::songs::add_song_image(&song_id, &blob_id, is_primary, None)
                    .await;
            if add_result.success {
                images_linked += 1;
            }
        }
    }

    // 5b. link album images. look up the album_id that was just associated
    // with the imported song and attach each album image. inline-base64 refs
    // are deduped via sha256, so an album cover that's byte-identical to a
    // song cover already linked above will resolve to the same blob_id and
    // simply create the album_imagez row.
    if !req.album_images.is_empty() {
        let album_id_opt: Option<String> = match crate::database::connect().await {
            Ok(pool) => sqlx::query_scalar!(
                "SELECT album_id FROM album_songz WHERE song_id = ? LIMIT 1",
                song_id
            )
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten(),
            Err(_) => None,
        };
        if let Some(album_id) = album_id_opt {
            for (idx, img) in req.album_images.iter().enumerate() {
                // album-level images are almost always Original cover art, but
                // pass the song's audio blob as a fallback parent in case a
                // derived blob_type slips through (better than a CHECK panic).
                let blob_id_opt = match resolve_sync_image_ref(
                    img,
                    &format!("album-{}-{}", album_id, idx),
                    Some(&pulled.blob.id),
                )
                .await
                {
                    Ok(Some(id)) => Some(id),
                    Ok(None) => {
                        missing_image_sha256s.push(img.content_sha256.clone());
                        None
                    }
                    Err(e) => {
                        tracing::warn!(
                            "sync_song_by_blake3: failed to import album image {} for album {}: {}",
                            img.content_sha256,
                            album_id,
                            e
                        );
                        None
                    }
                };
                if let Some(blob_id) = blob_id_opt {
                    let is_primary = img.is_primary || idx == 0;
                    let add_result = crate::music::entities::albums::add_album_image(
                        &album_id, &blob_id, is_primary, None,
                    )
                    .await;
                    if add_result.success {
                        images_linked += 1;
                    }
                }
            }
        }
    }

    tracing::info!(
        "sync_song_by_blake3: OK for {} title=\"{}\" song_id={} blob_id={} images_linked={} missing_images={}",
        caller.username,
        req.title,
        song_id,
        pulled.blob.id,
        images_linked,
        missing_image_sha256s.len(),
    );

    let response = SyncSongByBlake3Response {
        song_id,
        media_blob_id: pulled.blob.id,
        file_path: pulled.local_path.to_string_lossy().to_string(),
        sha256: pulled.sha256,
        blake3: req.blake3.clone(),
        existing: import_existing,
        images_linked,
        missing_image_sha256s,
    };

    GrimoireResponse::success(
        "song synced successfully",
        serde_json::to_value(response).unwrap_or_default(),
    )
}

/// idempotently ensure an existing song is linked to the artist / album /
/// genres carried in the sync request. all inserts are `INSERT OR IGNORE`.
///
/// passes `album_type: None` to `find_or_create_album_for_artist` so the
/// auto-album_type-update branch in that helper does NOT fire from this
/// reconcile path -- the sync_album call (which ran first and is the
/// authoritative source for album_type) already set the right value, and
/// per-song requests are not authoritative here.
async fn reconcile_existing_song_links(
    song_id: &str,
    req: &SyncSongByBlake3Request,
    caller: &Caller,
) -> Result<(), String> {
    use crate::music::crud::create_or_update::{
        find_or_create_album_for_artist, find_or_create_artist,
    };
    use crate::music::crud::{AlbumImportRequest, ArtistImportRequest};
    use crate::music::entities::taxonomy::find_or_create_taxon;

    let pool = crate::database::connect()
        .await
        .map_err(|e| e.to_string())?;

    // 1. resolve / create artist by name (case-insensitive).
    let artist_resp = find_or_create_artist(ArtistImportRequest {
        name: req.artist_name.clone(),
        created_by: Some(caller.user_id.clone()),
    })
    .await;
    let artist_id = match artist_resp.data {
        Some((a, _)) => a.id,
        None => return Err(format!("artist resolve failed: {}", artist_resp.message)),
    };

    // 2. resolve genre names -> taxon ids (best-effort; matches sync_album).
    //    genre_name on the request is a comma-separated list; matches the
    //    behavior of import_song_with_metadata.
    let genre_ids: Vec<String> = match &req.genre_name {
        Some(g) => {
            let mut ids = Vec::new();
            for name in g.split(',').map(str::trim).filter(|s| !s.is_empty()) {
                let resp = find_or_create_taxon("genre", name).await;
                if let Some(taxon) = resp.data {
                    ids.push(taxon.id);
                }
            }
            ids
        }
        None => Vec::new(),
    };
    let genre_ids_opt = if genre_ids.is_empty() {
        None
    } else {
        Some(genre_ids.clone())
    };

    // 3. resolve / create album for this artist.
    //    album_type=None ensures we don't clobber whatever sync_album already
    //    set. release_date / label likewise omitted; sync_album owns those.
    let album_req = AlbumImportRequest {
        title: req.album_title.clone(),
        album_type: None,
        release_date: None,
        label: None,
        genre_ids: genre_ids_opt,
        created_by: Some(caller.user_id.clone()),
    };
    let (album, _was_created) = find_or_create_album_for_artist(album_req, &artist_id)
        .await
        .map_err(|e| format!("album resolve failed: {}", e))?;

    // 4. idempotent junction inserts.
    sqlx::query!(
        "INSERT OR IGNORE INTO artist_songz (artist_id, song_id) VALUES (?, ?)",
        artist_id,
        song_id,
    )
    .execute(&pool)
    .await
    .map_err(|e| format!("artist_songz insert failed: {}", e))?;

    sqlx::query!(
        "INSERT OR IGNORE INTO album_songz (album_id, song_id) VALUES (?, ?)",
        album.id,
        song_id,
    )
    .execute(&pool)
    .await
    .map_err(|e| format!("album_songz insert failed: {}", e))?;

    sqlx::query!(
        "INSERT OR IGNORE INTO artist_albumz (artist_id, album_id) VALUES (?, ?)",
        artist_id,
        album.id,
    )
    .execute(&pool)
    .await
    .map_err(|e| format!("artist_albumz insert failed: {}", e))?;

    // 5. attach genres to album (junction is album_taxonz with kind=genre).
    for gid in &genre_ids {
        let _ = sqlx::query!(
            "INSERT OR IGNORE INTO album_taxonz (album_id, taxon_id, origin) VALUES (?, ?, 'user')",
            album.id,
            gid,
        )
        .execute(&pool)
        .await;
    }

    tracing::debug!(
        "sync_song_by_blake3: reconciled song {} -> artist {} album {} ({} genres)",
        song_id,
        artist_id,
        album.id,
        genre_ids.len(),
    );

    Ok(())
}
