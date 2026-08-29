//! audio playback control surface for freqhole.
//!
//! this module is the **single home** of "how do you control audio
//! playback in freqhole". it exposes:
//!
//! - a typed [`PlayerCommand`] / [`PlayerEvent`] enum pair that
//!   doubles as the wire format for ipc — derived [`zod_gen::ZodSchema`]
//!   so the typescript client picks them up via `client-codegen`.
//! - a [`PlayerController`] trait — the only surface frontends
//!   (tauri commands) ever depend on.
//! - a [`NoopPlayerController`] for tests + headless callers.
//!
//! the actual rodio backend + supervisor live behind the
//! `rodio-playback` cargo feature.
//!
//! design rule: **the shared core has zero knowledge of which
//! frontend is calling it.** nothing in this module imports tauri,
//! iroh, or clap.
//!
//! note: this module previously also exposed a networked
//! `freqhole-player/1` iroh ALPN (remote-control surface, admin-role
//! gated). that layer was removed as dead/half-baked code (no ui, no
//! tests, no config example ever shipped, no docs) - see repo memory
//! `tomb-grimoire-player-alpn-half-baked.md` for the full trace. this
//! module's local-only surface (tauri commands driving the same-host
//! rodio backend) is unaffected and remains the real, load-bearing use.

pub mod control;
pub mod noop;

#[cfg(feature = "rodio-playback")]
pub mod rodio;
#[cfg(feature = "rodio-playback")]
pub mod supervisor;

pub use control::{PlayerCommand, PlayerEvent, PlayerSnapshot, PlayerState, RestartPolicy};
pub use noop::NoopPlayerController;

#[cfg(feature = "rodio-playback")]
pub use supervisor::{spawn_player, RodioController};

use crate::error::GrimoireResult;
use async_trait::async_trait;
use tokio::sync::broadcast;

/// frontend-facing player surface.
///
/// implementations supervise an audio backend (rodio in v1; possibly
/// a subprocess in v2) and broadcast [`PlayerEvent`]s to any number
/// of subscribers.
///
/// callers send commands via [`Self::send`], subscribe to events
/// via [`Self::subscribe`], and read the last-known state cheaply
/// via [`Self::snapshot`].
#[async_trait]
pub trait PlayerController: Send + Sync {
    /// send a command to the backend. returns once the command has
    /// been accepted (queued); the actual effect is observed via
    /// the event stream.
    async fn send(&self, cmd: PlayerCommand) -> GrimoireResult<()>;

    /// subscribe to the backend's event stream. each subscriber
    /// gets its own receiver; events are dropped for slow
    /// consumers (with a `Lagged` event the receiver can observe).
    fn subscribe(&self) -> broadcast::Receiver<PlayerEvent>;

    /// last-known state. cheap (no channel round-trip) and safe to
    /// poll. for authoritative current state, request a `Status`
    /// command and observe the resulting `State` event.
    fn snapshot(&self) -> PlayerSnapshot;
}
