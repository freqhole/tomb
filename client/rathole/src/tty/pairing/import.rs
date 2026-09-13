//! imports a remote-pushed queue item (from `freqhole-player/1`'s
//! `replace_queue`/`append_queue`) into rathole's OWN local grimoire
//! library - real `songz`/`videoz` + `media_blobz` rows, same as any
//! other import - instead of a throwaway, non-library-integrated file
//! cache. mirrors exactly what charnel's "sync queue to local library"
//! feature does, reusing the same grimoire primitives rather than a
//! rathole-specific reinvention:
//!
//! - `grimoire::offal::upload::pull_audio_blob_to_local_storage` (the
//!   shared pull-from-peer-and-land-in-media_blobz primitive behind
//!   the `*-by-blake3` upload routes and every `offal::sync` handler)
//!   fetches + hashes + dedupes + moves the file into permanent
//!   library storage.
//! - `grimoire::music::scanner::extract_and_import`/`grimoire::video::
//!   importer::import_video_file` (the same functions a normal file
//!   scan/upload uses) then create the actual song/video row.
//!
//! download progress (step 3 of the pull) is reported via an optional
//! cumulative-bytes callback, same as the old cache-only path used.

use grimoire::federation::p2p_client::BlobProgressFn;
use grimoire::media_domain::MediaDomain;
use grimoire::offal::upload::pull_audio_blob_to_local_storage_with_progress;
use grimoire::offal::Caller;

use crate::ratcore::app::MediaKind;

/// the result of importing a remote-pushed item into the local library.
pub struct ImportedMedia {
    pub media_blob_id: String,
    pub local_path: String,
    /// the imported `songz.id` (audio) or `videoz.id` (video).
    pub entity_id: String,
}

/// same "first root user" bootstrap pattern `LocalTransport::from_
/// first_root` uses - fetched fresh each import rather than threaded
/// through `DispatchContext`, since this is a rare (per queue-push),
/// not per-frame, operation and avoids widening that struct.
async fn system_caller() -> Result<Caller, String> {
    let service = grimoire::users::UserService::new();
    let resp = service.get_first_root_user().await;
    resp.data
        .map(|u| Caller::new(&u.id, &u.username, u.role))
        .ok_or_else(|| "no root user configured on this device".to_string())
}

/// pulls `blake3_hash` from `source_peer_addr` and imports it into the
/// local library as a real song or video (per `kind`), returning the
/// resulting entity/media_blob ids for building a `QueueEntry` that
/// behaves identically to a locally-queued one (art lookup, favorites,
/// search, etc. all work normally - no more special-casing needed).
pub async fn import_pushed_media(
    source_peer_addr: &str,
    blake3_hash: &str,
    filename: &str,
    size_hint: Option<u64>,
    kind: MediaKind,
    on_progress: Option<&BlobProgressFn>,
) -> Result<ImportedMedia, String> {
    let caller = system_caller().await?;
    let domain = match kind {
        MediaKind::Audio => MediaDomain::Music,
        MediaKind::Video => MediaDomain::Video,
    };

    let pull = pull_audio_blob_to_local_storage_with_progress(
        source_peer_addr,
        blake3_hash,
        None,
        size_hint,
        filename,
        &caller,
        domain,
        on_progress,
    )
    .await
    .map_err(|e| e.into_grimoire_response().message)?;

    let media_blob_id = pull.blob.id.clone();
    let local_path = pull.local_path.to_string_lossy().into_owned();

    let entity_id = match kind {
        MediaKind::Audio => {
            grimoire::music::scanner::extract_and_import(
                &media_blob_id,
                &pull.local_path,
                Some(caller.user_id.clone()),
                Some(filename),
            )
            .await
            .map_err(|e| format!("audio import failed: {e}"))?
            .song_id
        }
        MediaKind::Video => {
            grimoire::video::importer::import_video_file(
                &media_blob_id,
                &pull.local_path,
                Some(filename),
                Some(caller.user_id.clone()),
                None,
                None,
            )
            .await
            .map_err(|e| format!("video import failed: {e}"))?
            .video_id
        }
    };

    Ok(ImportedMedia {
        media_blob_id,
        local_path,
        entity_id,
    })
}
