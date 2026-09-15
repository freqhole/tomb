//! `freqhole-player/1` ALPN handler: pairing handshake + command
//! dispatch, bridging `grimoire::cenotaph`'s shared native accept-loop
//! (protocol/session/import) to rathole's real playback backends (rodio
//! via `PlayerCmd`, mpv via `VideoCommand`).
//!
//! mirrors (wire-compatible, not code-shared) cenotaph's
//! `control/playerConnectionHandler.ts` + `control/dispatcher.ts` — see
//! docs/rathole-headless-player-plan.md phase 4 and
//! docs/cenotaph-migration-plan.md's "front 3" section (this module used
//! to own the full accept-loop + import logic itself; both now live in
//! `grimoire::cenotaph`, shared with charnel's own accept-side).
//!
//! split into submodules:
//! - [`state`] — translation shim between `ratcore::app::pairing`'s
//!   portable wire-mirror types (also used by rathole's wasm32 web
//!   shell) and `grimoire::cenotaph`'s own copy of the same shapes, plus
//!   the `PairingStateReader` impl the ratatui ui reads from.
//! - [`dispatch`] — mapping an authorized `PairingCommand` onto
//!   rathole's real `PlayerCmd`/`VideoCommand` backends, and the
//!   `MediaRef` <-> `ratcore::app::QueueEntry` conversions that keep
//!   rathole's own unified play queue (`tty::queue`) as the single
//!   source of truth for what a remote controller sees too. this is the
//!   one piece that's genuinely NOT shareable with charnel (different
//!   playback backends), so it stays here.
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
mod state;

pub use dispatch::{
    dispatch_pairing_command, queue_entry_to_media_ref, ActiveBackend, DispatchContext,
};
pub use grimoire::cenotaph::{
    ensure_current_pairing_code, PairingDispatchRequest, PairingDispatchRx, PairingDispatchTx,
    PairingRuntime, PlayerProtocol, PLAYER_ALPN,
};
pub use state::{
    load_pairing_state, sync_pairing_state_to_persisted, PairingStateHandle, SharedPairingState,
};

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
