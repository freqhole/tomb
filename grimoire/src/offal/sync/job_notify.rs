//! best-effort completion push for `sync_song_by_blake3`/`sync_video_by_blake3`
//! background jobs - see `SyncJobNotify`'s doc comment for the full
//! rationale (peers triggering a cross-remote sync no longer need to keep
//! a connection open for the whole transfer; this is how they can still
//! hear back, on a purely best-effort basis).

use serde_json::Value as JsonValue;
use tokio::sync::broadcast;

use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;

use super::models::SyncJobNotify;

/// in-process fanout for received job-notify pushes. nothing subscribes by
/// default - this exists so a consuming app (e.g. charnel, which already
/// has an `AppHandle` to turn this into a UI toast) can `subscribe()` and
/// react, without `grimoire` itself needing to know about UI/tauri at all.
static JOB_NOTIFY_CHANNEL: std::sync::OnceLock<broadcast::Sender<SyncJobNotify>> =
    std::sync::OnceLock::new();

fn channel() -> &'static broadcast::Sender<SyncJobNotify> {
    JOB_NOTIFY_CHANNEL.get_or_init(|| broadcast::channel(32).0)
}

/// subscribe to incoming job-notify pushes - see `JOB_NOTIFY_CHANNEL`'s doc
/// comment. lagging subscribers silently miss old events (a 32-slot ring
/// buffer) rather than block senders; this is purely informational.
/// not yet called anywhere in this crate - a future consumer (e.g. charnel,
/// which owns a tauri `AppHandle` to turn this into a UI toast) subscribes.
#[allow(dead_code)]
pub fn subscribe() -> broadcast::Receiver<SyncJobNotify> {
    channel().subscribe()
}

/// receive a job-notify push from a peer.
///
/// path: POST /api/sync/job-notify
///
/// does nothing beyond logging + fanning out to any local subscriber -
/// there is no state here to update and no response the sender needs
/// beyond "received".
pub async fn sync_job_notify(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let notify: SyncJobNotify = match serde_json::from_value(body) {
        Ok(n) => n,
        Err(e) => {
            tracing::debug!("sync_job_notify: bad request from {}: {}", caller.username, e);
            return GrimoireResponse::success("ignored", JsonValue::Bool(false));
        }
    };

    tracing::info!(
        "sync_job_notify: {} job {} for \"{}\" (blake3={}) domain={} from {}{}",
        if notify.success { "completed" } else { "failed" },
        notify.job_id,
        notify.title,
        &notify.blake3[..16.min(notify.blake3.len())],
        notify.domain,
        caller.username,
        notify
            .error
            .as_deref()
            .map(|e| format!(": {e}"))
            .unwrap_or_default(),
    );

    // best-effort fanout - no subscribers is the common case and not an error.
    let _ = channel().send(notify);

    GrimoireResponse::success("received", JsonValue::Bool(true))
}
