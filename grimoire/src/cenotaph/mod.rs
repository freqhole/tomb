//! `grimoire::cenotaph` - shared native accept-side implementation of the
//! `freqhole-player/1` pairing + control protocol, used by both rathole
//! (tty shell) and charnel (tauri desktop/mobile) so a single, tested
//! implementation of the protocol/session/import logic backs every
//! native consumer, instead of each reimplementing it from scratch.
//!
//! see docs/cenotaph-migration-plan.md's "front 3" section for the full
//! design writeup and the reasoning behind what did/didn't move here.
//!
//! **wire types are a MIRROR, not a shared source**, of both
//! `client/rathole/src/ratcore/app/pairing.rs` (rust - kept separate
//! because it's also compiled for rathole's wasm32 web shell, which
//! can't link grimoire) and spume's own TypeScript cenotaph
//! implementation. see [`wire`]'s module doc for the full reasoning.
//!
//! what a consumer needs to do:
//! 1. build a [`state::SharedPairingState`] via [`state::new_shared_state`]
//!    (seeded from whatever session it last persisted, if any).
//! 2. create an `mpsc::unbounded_channel::<endpoint::PairingDispatchRequest>()`
//!    and hand the sender half + the state to [`endpoint::PairingRuntime::new`].
//! 3. call `.ensure_started()` once pairing mode is wanted.
//! 4. own the receiver half, translating each authorized [`wire::PlayerCommand`]
//!    into real playback backend calls and replying with a [`wire::CommandAck`]
//!    via the request's own oneshot `reply` sender - this consumer-specific
//!    translation is intentionally NOT part of this module (rathole:
//!    rodio/mpv; charnel: tauri events into spume's playback adapter).
//! 5. call `.broadcast_status()` whenever playback state changes, so
//!    subscribed controllers see live updates.

pub mod endpoint;
pub mod import;
pub mod state;
pub mod wire;

pub use endpoint::{
    PairingDispatchRequest, PairingDispatchRx, PairingDispatchTx, PairingRuntime, PlayerProtocol,
    PLAYER_ALPN,
};
pub use import::{import_pushed_media, ImportedMedia};
pub use state::{ensure_current_pairing_code, PairingRuntimeState, SharedPairingState};
pub use wire::*;
