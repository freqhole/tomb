//! background waveform backfill for synced songs and videos.
//!
//! sync never runs the full import pipelines (file_processor.rs's step 4 for
//! music, video/importer.rs's inline step for video), so media whose source
//! never generated (or never sent) a waveform would otherwise go without one
//! forever. generation is NOT awaited by sync: the sync response gates
//! playback start, and ffmpeg on a long file can take seconds. completion is
//! announced via `GrimoireEvent::WaveformReady` instead, and the next sync of
//! the same media echoes the existing waveform in its response.

use std::collections::HashSet;
use std::sync::Mutex;

use once_cell::sync::Lazy;

use crate::events::WaveformEntityKind;

/// `"<kind>:<entity_id>"` keys with a background generation currently
/// running, so overlapping syncs of the same media (e.g. auto-download +
/// play) don't each spawn their own ffmpeg run.
static IN_FLIGHT: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));

/// removes a key from `IN_FLIGHT` on drop, so a panicking generation task
/// can't leave the entity permanently marked in-flight.
struct InFlightGuard(String);

impl Drop for InFlightGuard {
    fn drop(&mut self) {
        if let Ok(mut set) = IN_FLIGHT.lock() {
            set.remove(&self.0);
        }
    }
}

fn in_flight_key(kind: WaveformEntityKind, entity_id: &str) -> String {
    format!("{}:{}", kind.as_str(), entity_id)
}

/// claim an entity for background generation. `None` if another task
/// already holds it.
fn claim(kind: WaveformEntityKind, entity_id: &str) -> Option<InFlightGuard> {
    let key = in_flight_key(kind, entity_id);
    let mut set = IN_FLIGHT.lock().ok()?;
    set.insert(key.clone()).then(|| InFlightGuard(key))
}

/// the entity's linked waveform blob id, if it has one.
async fn existing_waveform_blob_id(kind: WaveformEntityKind, entity_id: &str) -> Option<String> {
    let pool = crate::database::connect().await.ok()?;
    let result = match kind {
        WaveformEntityKind::Song => {
            sqlx::query_scalar!(
                "SELECT si.media_blob_id FROM song_imagez si
                 JOIN media_blobz mb ON mb.id = si.media_blob_id
                 WHERE si.song_id = ? AND mb.blob_type = 'waveform'
                 LIMIT 1",
                entity_id
            )
            .fetch_optional(&pool)
            .await
        }
        WaveformEntityKind::Video => {
            let entity_type = crate::video::VideoEntityType::Video.as_str();
            sqlx::query_scalar!(
                "SELECT ei.media_blob_id FROM entity_imagez ei
                 JOIN media_blobz mb ON mb.id = ei.media_blob_id
                 WHERE ei.entity_type = ? AND ei.entity_id = ? AND mb.blob_type = 'waveform'
                 LIMIT 1",
                entity_type,
                entity_id
            )
            .fetch_optional(&pool)
            .await
        }
    };
    result.ok().flatten()
}

/// return the entity's existing waveform blob id, or kick off a background
/// generation and return `None`. a `WaveformReady` event follows on success.
pub(super) async fn waveform_or_spawn(
    kind: WaveformEntityKind,
    entity_id: &str,
    media_blob_id: &str,
    file_path: &str,
    blake3: &str,
    user_id: &str,
) -> Option<String> {
    if let Some(id) = existing_waveform_blob_id(kind, entity_id).await {
        return Some(id);
    }
    if media_blob_id.is_empty() || file_path.is_empty() {
        return None;
    }
    let guard = claim(kind, entity_id)?;
    let entity_id = entity_id.to_string();
    let media_blob_id = media_blob_id.to_string();
    let file_path = file_path.to_string();
    let blake3 = blake3.to_string();
    let user_id = user_id.to_string();
    tokio::spawn(async move {
        let _guard = guard;
        generate_and_link(
            kind,
            &entity_id,
            &media_blob_id,
            &file_path,
            &blake3,
            user_id,
        )
        .await;
    });
    None
}

/// generate + link a waveform, then emit `GrimoireEvent::WaveformReady`.
/// best-effort: failures are logged and the entity stays without one.
async fn generate_and_link(
    kind: WaveformEntityKind,
    entity_id: &str,
    media_blob_id: &str,
    file_path: &str,
    blake3: &str,
    user_id: String,
) {
    let label = kind.as_str();

    // re-check under the claim: a generation that finished between the
    // caller's check and the claim would otherwise produce a duplicate.
    if let Some(waveform_blob_id) = existing_waveform_blob_id(kind, entity_id).await {
        emit_ready(kind, entity_id, blake3, waveform_blob_id);
        return;
    }

    let config = crate::config::get_config();

    // silent videos have nothing for ffmpeg's `showwavespic` `[0:a]` to bind
    // to - skip them the same way the video importer does.
    if kind == WaveformEntityKind::Video
        && !crate::video::importer::video_has_audio_stream(std::path::Path::new(file_path), &config)
            .await
    {
        tracing::debug!("waveform backfill skipped for video {entity_id}: no audio stream");
        return;
    }

    let response = crate::blob_data::create_audio_waveform_blob(
        media_blob_id,
        file_path,
        &config,
        Some(user_id.clone()),
    )
    .await;
    if !response.success {
        tracing::warn!(
            "waveform backfill failed for {label} {entity_id}: {}",
            response.message
        );
        return;
    }
    let Some(waveform_blob_id) = response.data else {
        return;
    };

    let (linked, message) = match kind {
        WaveformEntityKind::Song => {
            let r = crate::music::entities::songs::add_song_image(
                entity_id,
                &waveform_blob_id,
                false,
                None,
            )
            .await;
            (r.success, r.message)
        }
        WaveformEntityKind::Video => {
            let r = crate::video::add_entity_image(
                crate::video::VideoEntityType::Video,
                entity_id,
                &waveform_blob_id,
                Some(false),
                crate::media_blobz::BlobType::Waveform,
                Some(user_id.as_str()),
            )
            .await;
            (r.success, r.message)
        }
    };
    if !linked {
        tracing::warn!("failed to link backfilled waveform for {label} {entity_id}: {message}");
        return;
    }
    tracing::debug!("backfilled waveform for {label} {entity_id}");
    emit_ready(kind, entity_id, blake3, waveform_blob_id);
}

fn emit_ready(kind: WaveformEntityKind, entity_id: &str, blake3: &str, waveform_blob_id: String) {
    crate::events::emit(crate::events::GrimoireEvent::WaveformReady {
        kind,
        entity_id: entity_id.to_string(),
        blake3: blake3.to_string(),
        waveform_blob_id,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claim_is_exclusive_per_entity_and_released_on_drop() {
        let id = "test-waveform-claim";
        let first = claim(WaveformEntityKind::Song, id).expect("first claim succeeds");
        assert!(
            claim(WaveformEntityKind::Song, id).is_none(),
            "second claim must fail while the first is held"
        );
        assert!(
            claim(WaveformEntityKind::Video, id).is_some(),
            "a song and a video with the same id don't collide"
        );
        assert!(
            claim(WaveformEntityKind::Song, "test-waveform-other").is_some(),
            "claims are per entity"
        );
        drop(first);
        assert!(
            claim(WaveformEntityKind::Song, id).is_some(),
            "claim is released when the guard drops"
        );
    }

    #[tokio::test]
    async fn claim_released_when_task_panics() {
        let id = "test-waveform-panic";
        let guard = claim(WaveformEntityKind::Video, id).expect("claim succeeds");
        let handle = tokio::spawn(async move {
            let _guard = guard;
            panic!("simulated generation failure");
        });
        assert!(handle.await.is_err());
        assert!(claim(WaveformEntityKind::Video, id).is_some());
    }
}
