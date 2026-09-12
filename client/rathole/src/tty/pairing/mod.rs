//! `freqhole-player/1` ALPN handler: pairing handshake + command
//! dispatch, bridging the portable protocol/session types in
//! `ratcore::app::pairing` to a real iroh transport and rathole's real
//! playback backends (rodio via `PlayerCmd`, mpv via `VideoCommand`).
//!
//! mirrors (wire-compatible, not code-shared) cenotaph's
//! `control/playerConnectionHandler.ts` + `control/dispatcher.ts` — see
//! docs/rathole-headless-player-plan.md phase 4.
//!
//! split into submodules (was one large file):
//! - [`state`] — the shared trust/session/connected state + its
//!   `PairingStateReader` impl.
//! - [`endpoint`] — the iroh endpoint/router startup + the alpn
//!   protocol handler (pairing handshake, presence, subscribe, control
//!   command loop framing).
//! - [`import`] — pulling a `MediaRef` from its source peer and
//!   importing it into the local grimoire library (real song/video +
//!   media_blob rows), reusing the same pull/import primitives a
//!   normal upload or file scan uses.
//! - [`dispatch`] — mapping an authorized `PairingCommand` onto
//!   rathole's real `PlayerCmd`/`VideoCommand` backends, and the
//!   `MediaRef` <-> `ratcore::app::QueueEntry` conversions that keep
//!   rathole's own unified play queue (`tty::queue`) as the single
//!   source of truth for what a remote controller sees too.
//!
//! **known simplifications, tracked as follow-ups, not silently
//! skipped:**
//! - no rate limiting on pin redemption attempts yet (cenotaph's
//!   `pairing/rateLimiter.ts` has no rust port here). a real gap for a
//!   6-hex-char (16M combination) pin — worth adding before this ships
//!   for real.
//! - queue/now-playing `MediaRef`s use a synthesized id (a queue
//!   entry's `media_blob_id` or local file path) as a stand-in for
//!   `blake3_hash` (getting the *real* blake3 hash needs an extra
//!   grimoire lookup per row — deferred; a remote controller only
//!   needs a stable identifier for its own dedup/diffing here, not the
//!   real hash).
//! - `replace_queue`/`append_queue`/`play` for **video** items load
//!   the fetched file into mpv but don't yet flip rathole into the
//!   "fullscreen video, suppress console" state from phase 3 — that
//!   transition is still unimplemented pending the console/ssh
//!   decision tracked in the plan doc.
//! - a `replace_queue`/`append_queue` ack's `status` is built directly
//!   from the entries just resolved (accurate immediately), but the
//!   real `music.queue` mutation happens asynchronously once `run.rs`
//!   processes the `AppAction::PairingReplaceQueue`/`PairingAppendQueue`
//!   this dispatch sends - a `get_status` issued in the same instant
//!   from a DIFFERENT connection could theoretically still observe the
//!   pre-mutation queue for one tick. not a real-world concern (same
//!   process, near-instant), but worth knowing about.

mod dispatch;
mod endpoint;
mod import;
mod state;

pub use dispatch::{
    dispatch_pairing_command, queue_entry_to_media_ref, ActiveBackend, DispatchContext,
};
pub use endpoint::{
    PairingDispatchRequest, PairingDispatchRx, PairingDispatchTx, PairingRuntime, PlayerProtocol,
};
pub use state::{
    load_pairing_state, sync_pairing_state_to_persisted, PairingRuntimeState, PairingStateHandle,
    SharedPairingState,
};

/// ALPN identifier. see the "naming disambiguation" note in
/// docs/rathole-headless-player-plan.md — unrelated to grimoire's own,
/// removed, differently-shaped `freqhole-player/1` protocol.
pub const PLAYER_ALPN: &[u8] = b"freqhole-player/1";

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
