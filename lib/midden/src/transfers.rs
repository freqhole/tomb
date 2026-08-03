//! browser-side outgoing blob transfer progress (this node serving, some
//! peer snatching) - a self-contained mirror of reliquary's
//! `gate::TransferRegistry` (see that module's doc comment for the full
//! design this replicates). kept independent rather than depending on the
//! `reliquary` crate directly: midden is wasm32-only, excluded from the
//! tomb cargo workspace, and built via wasm-pack rather than cargo (see
//! `freqhole-repo-layout` notes) - this keeps that boundary intact for one
//! small feature. single-threaded (wasm has no real threads), so plain
//! `Rc<RefCell<...>>` in place of reliquary's `Arc<Mutex<...>>`.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use iroh_blobs::provider::events::RequestUpdate;
use serde::Serialize;
use tracing::debug;
use web_time::Instant;

/// one outgoing blob transfer in progress - this node is serving `blake3`
/// to `peer_id`. `#[serde(rename_all = "camelCase")]` matches the field
/// naming loam's `p2p/transfer-progress.ts` (`RawTransferRow`) expects.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveTransfer {
    pub peer_id: String,
    pub blake3: String,
    pub bytes_sent: u64,
    pub total_size: u64,
    // not yet surfaced to js - kept for a future elapsed-time field, mirrors
    // reliquary's `gate::ActiveTransfer` (which does use it for its
    // dashboard). `#[allow(dead_code)]` rather than dropping it now to keep
    // the two structs' shapes recognizably parallel.
    #[serde(skip)]
    #[allow(dead_code)]
    started_at: Instant,
}

/// keyed by (connection_id, request_id) - unique per in-flight get/get_many
/// request, per iroh-blobs' own event fields.
type TransferKey = (u64, u64);

/// live registry of this browser peer's own outgoing blob transfers,
/// fed by [`crate::build_gated_blobs_events`] whenever
/// `EventMask.get`/`get_many` is `RequestMode::InterceptLog`.
#[derive(Default)]
pub struct TransferRegistry {
    transfers: RefCell<HashMap<TransferKey, ActiveTransfer>>,
}

impl TransferRegistry {
    pub fn new() -> Rc<Self> {
        Rc::new(Self::default())
    }

    /// snapshot of transfers currently in flight - unordered.
    pub fn snapshot(&self) -> Vec<ActiveTransfer> {
        self.transfers.borrow().values().cloned().collect()
    }

    fn upsert(&self, key: TransferKey, transfer: ActiveTransfer) {
        self.transfers.borrow_mut().insert(key, transfer);
    }

    fn remove(&self, key: TransferKey) {
        self.transfers.borrow_mut().remove(&key);
    }
}

/// RAII registration for one outgoing transfer: removed from the registry on
/// drop (covers successful completion, abort, and the drain task being
/// cancelled alike) - mirrors reliquary's `gate::TransferGuard`.
struct TransferGuard {
    registry: Rc<TransferRegistry>,
    key: TransferKey,
}

impl Drop for TransferGuard {
    fn drop(&mut self) {
        self.registry.remove(self.key);
    }
}

/// drain one request's `RequestUpdate` stream (only populated when
/// `RequestMode::InterceptLog` is set), updating `registry` as transfer
/// progress arrives. mirrors reliquary's `gate::track_transfer`.
pub async fn track_transfer(
    registry: Rc<TransferRegistry>,
    mut rx: irpc::channel::mpsc::Receiver<RequestUpdate>,
    key: TransferKey,
    peer_id: String,
    mut blake3: String,
) {
    // TEMPORARY debug logging - confirms the drain task actually starts and
    // whether the update stream ever yields anything at all.
    debug!(
        "transfer track: draining updates key={:?} peer={} blake3={}",
        key, peer_id, blake3
    );
    let mut guard: Option<TransferGuard> = None;
    while let Ok(Some(update)) = rx.recv().await {
        match update {
            RequestUpdate::Started(started) => {
                if !started.hash.to_string().is_empty() {
                    blake3 = started.hash.to_string();
                }
                debug!(
                    "transfer track: started key={:?} size={}",
                    key, started.size
                );
                registry.upsert(
                    key,
                    ActiveTransfer {
                        peer_id: peer_id.clone(),
                        blake3: blake3.clone(),
                        bytes_sent: 0,
                        total_size: started.size,
                        started_at: Instant::now(),
                    },
                );
                guard = Some(TransferGuard {
                    registry: registry.clone(),
                    key,
                });
            }
            RequestUpdate::Progress(progress) => {
                debug!(
                    "transfer track: progress key={:?} end_offset={}",
                    key, progress.end_offset
                );
                if let Some(entry) = registry.transfers.borrow_mut().get_mut(&key) {
                    entry.bytes_sent = progress.end_offset;
                }
            }
            RequestUpdate::Completed(_) | RequestUpdate::Aborted(_) => {
                debug!("transfer track: finished key={:?}", key);
                break;
            }
        }
    }
    debug!("transfer track: drain loop ended key={:?}", key);
    drop(guard);
}
