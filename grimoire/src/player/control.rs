//! shared control api: [`PlayerCommand`] and [`PlayerEvent`].
//!
//! these enums are the wire format consumed by every frontend (tauri
//! ipc, iroh ALPN, cli daemon) and produced by every backend (rodio
//! today; possibly a subprocess wrapper later). they derive
//! `Serialize + Deserialize + ZodSchema` so they round-trip cleanly
//! over json _and_ feed the typescript codegen.

use serde::{Deserialize, Serialize};
use zod_gen::ZodSchema as ZodSchemaTrait;
use zod_gen_derive::ZodSchema;

use crate::error::ErrorDetail;

/// commands a frontend can send to the player backend.
///
/// every variant is total — backends respond with a typed
/// [`PlayerEvent::Error`] rather than failing the channel.
///
/// note: `ZodSchema` is implemented manually below because the
/// derive does not honor `#[serde(rename_all = ...)]` (precedent:
/// `FeedItemType`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PlayerCommand {
    /// replace the queue with the given file paths and start
    /// playing from the first one.
    ///
    /// path-based (not bytes-based) per phase-0 decision: rodio
    /// reads files freqhole already knows the location of via
    /// grimoire. paths are wire-encoded as strings so the type
    /// round-trips through json + zod codegen cleanly.
    Load { paths: Vec<String> },

    /// append `paths` to the existing queue without interrupting
    /// the currently-playing track. if the sink is empty, behaves
    /// like a `Load` of just these paths (i.e. starts playing
    /// immediately).
    Enqueue { paths: Vec<String> },

    /// start (or resume) playback of the current queue.
    Play,

    /// pause without losing position.
    Pause,

    /// stop and clear the queue.
    Stop,

    /// advance to the next queued item.
    Next,

    /// go back to the previous item (or restart current if no
    /// previous exists).
    Previous,

    /// seek to absolute position within the current item.
    Seek { ms: u64 },

    /// set output volume in `0.0..=2.0` (1.0 = unity).
    SetVolume { v: f32 },

    /// request a one-shot [`PlayerEvent::State`] emission.
    /// useful for new subscribers to bootstrap their view.
    Status,
}

/// the high-level state the backend can be in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlayerState {
    /// no queue loaded; output sink idle.
    Stopped,
    /// queue loaded, currently decoding + playing.
    Playing,
    /// queue loaded, sink paused.
    Paused,
    /// queue loaded, decoder still warming up.
    Loading,
}

/// events the backend broadcasts to all subscribers.
///
/// every error path emits a typed [`PlayerEvent::Error`] rather
/// than panicking. unexpected backend exits emit
/// [`PlayerEvent::BackendDown`] followed (after a successful
/// restart) by [`PlayerEvent::BackendUp`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PlayerEvent {
    /// the high-level state changed (or was requested via `Status`).
    State { state: PlayerState },

    /// position update. emitted at a low frequency (~4 hz) while
    /// playing.
    Progress { ms: u64, total_ms: u64 },

    /// advanced to a new item in the queue.
    TrackChanged { index: u32, path: String },

    /// the queue was exhausted.
    Ended,

    /// a recoverable error occurred. the backend remains alive;
    /// callers may retry.
    Error { detail: ErrorDetail },

    /// the backend task exited unexpectedly. the supervisor will
    /// attempt to restart it; subsequent
    /// [`PlayerEvent::BackendUp`] indicates success.
    BackendDown { restart_count: u32 },

    /// the backend task is alive (or has just been restarted).
    BackendUp,
}

// ---- manual zod schema impls ----------------------------------------
//
// the derive doesn't see serde's `tag` / `rename_all`, so we hand-roll
// these to match the actual serde wire format. keep in sync if variants
// are added or renamed.

impl ZodSchemaTrait for PlayerState {
    fn zod_schema() -> String {
        r#"z.union([z.literal("stopped"), z.literal("playing"), z.literal("paused"), z.literal("loading")])"#
            .to_string()
    }
}

impl ZodSchemaTrait for PlayerCommand {
    fn zod_schema() -> String {
        r#"z.discriminatedUnion("kind", [
z.object({ kind: z.literal("load"), paths: z.array(z.string()) }),
z.object({ kind: z.literal("enqueue"), paths: z.array(z.string()) }),
z.object({ kind: z.literal("play") }),
z.object({ kind: z.literal("pause") }),
z.object({ kind: z.literal("stop") }),
z.object({ kind: z.literal("next") }),
z.object({ kind: z.literal("previous") }),
z.object({ kind: z.literal("seek"), ms: z.number() }),
z.object({ kind: z.literal("set_volume"), v: z.number() }),
z.object({ kind: z.literal("status") })
])"#
        .to_string()
    }
}

impl ZodSchemaTrait for PlayerEvent {
    fn zod_schema() -> String {
        // PlayerStateSchema is declared after this in alphabetical order
        // (the codegen sorts), so wrap with z.lazy for the forward ref.
        r#"z.discriminatedUnion("kind", [
z.object({ kind: z.literal("state"), state: z.lazy(() => PlayerStateSchema) }),
z.object({ kind: z.literal("progress"), ms: z.number(), total_ms: z.number() }),
z.object({ kind: z.literal("track_changed"), index: z.number(), path: z.string() }),
z.object({ kind: z.literal("ended") }),
z.object({ kind: z.literal("error"), detail: ErrorDetailSchema }),
z.object({ kind: z.literal("backend_down"), restart_count: z.number() }),
z.object({ kind: z.literal("backend_up") })
])"#
        .to_string()
    }
}

/// last-known state snapshot, cheap to read.
///
/// updated whenever the backend emits a [`PlayerEvent::State`] or
/// [`PlayerEvent::Progress`].
#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema)]
pub struct PlayerSnapshot {
    pub state: Option<PlayerState>,
    pub position_ms: u64,
    pub total_ms: u64,
    pub volume: f32,
    pub queue_len: u32,
    pub current_index: Option<u32>,
}

impl PlayerSnapshot {
    /// applies an event to the snapshot in-place.
    /// returns true if anything visible changed.
    pub fn apply(&mut self, event: &PlayerEvent) -> bool {
        match event {
            PlayerEvent::State { state } => {
                let changed = self.state != Some(*state);
                self.state = Some(*state);
                changed
            }
            PlayerEvent::Progress { ms, total_ms } => {
                let changed = self.position_ms != *ms || self.total_ms != *total_ms;
                self.position_ms = *ms;
                self.total_ms = *total_ms;
                changed
            }
            PlayerEvent::TrackChanged { index, .. } => {
                let changed = self.current_index != Some(*index);
                self.current_index = Some(*index);
                changed
            }
            PlayerEvent::Ended => {
                let changed = self.state != Some(PlayerState::Stopped);
                self.state = Some(PlayerState::Stopped);
                self.position_ms = 0;
                self.current_index = None;
                changed
            }
            PlayerEvent::Error { .. }
            | PlayerEvent::BackendDown { .. }
            | PlayerEvent::BackendUp => false,
        }
    }
}

/// supervisor restart policy.
///
/// applied by the rodio supervisor (phase 2) — captured here so the
/// types live next to the rest of the control surface and don't
/// drift.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ZodSchema)]
pub struct RestartPolicy {
    /// max number of restart attempts within `window_ms`. exceeding
    /// this emits a terminal `BackendDown` and waits for a fresh
    /// command before trying again.
    pub max_restarts: u32,
    /// rolling window for `max_restarts` accounting.
    pub window_ms: u64,
    /// initial backoff between restart attempts.
    pub initial_backoff_ms: u64,
    /// upper bound for the exponential backoff.
    pub max_backoff_ms: u64,
}

impl Default for RestartPolicy {
    /// 5 restarts in 30s, 100ms..=2s exponential backoff.
    fn default() -> Self {
        Self {
            max_restarts: 5,
            window_ms: 30_000,
            initial_backoff_ms: 100,
            max_backoff_ms: 2_000,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_apply_state() {
        let mut snap = PlayerSnapshot::default();
        assert!(snap.apply(&PlayerEvent::State {
            state: PlayerState::Playing
        }));
        assert_eq!(snap.state, Some(PlayerState::Playing));
        // re-applying the same state reports no change
        assert!(!snap.apply(&PlayerEvent::State {
            state: PlayerState::Playing
        }));
    }

    #[test]
    fn snapshot_apply_progress() {
        let mut snap = PlayerSnapshot::default();
        assert!(snap.apply(&PlayerEvent::Progress {
            ms: 1234,
            total_ms: 60_000,
        }));
        assert_eq!(snap.position_ms, 1234);
        assert_eq!(snap.total_ms, 60_000);
    }

    #[test]
    fn snapshot_apply_ended_resets_position() {
        let mut snap = PlayerSnapshot {
            state: Some(PlayerState::Playing),
            position_ms: 4000,
            current_index: Some(2),
            ..Default::default()
        };
        assert!(snap.apply(&PlayerEvent::Ended));
        assert_eq!(snap.state, Some(PlayerState::Stopped));
        assert_eq!(snap.position_ms, 0);
        assert!(snap.current_index.is_none());
    }

    #[test]
    fn restart_policy_defaults_are_sensible() {
        let p = RestartPolicy::default();
        assert!(p.max_restarts >= 1);
        assert!(p.window_ms > p.initial_backoff_ms);
        assert!(p.max_backoff_ms >= p.initial_backoff_ms);
    }

    #[test]
    fn command_roundtrip_via_json() {
        let cmd = PlayerCommand::Load {
            paths: vec!["/tmp/a.mp3".to_string(), "/tmp/b.mp3".to_string()],
        };
        let s = serde_json::to_string(&cmd).expect("serialize");
        let back: PlayerCommand = serde_json::from_str(&s).expect("deserialize");
        match back {
            PlayerCommand::Load { paths } => assert_eq!(paths.len(), 2),
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn event_roundtrip_via_json() {
        let ev = PlayerEvent::Error {
            detail: ErrorDetail::new("decode_failed", "Decode Failed", "bad bytes"),
        };
        let s = serde_json::to_string(&ev).expect("serialize");
        let back: PlayerEvent = serde_json::from_str(&s).expect("deserialize");
        match back {
            PlayerEvent::Error { detail } => assert_eq!(detail.error_type, "decode_failed"),
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    /// guards against drift between serde's wire format and the manual
    /// `ZodSchema` impls. if you add or rename a variant, update both
    /// the serde derive _and_ the literal strings in `zod_schema()`,
    /// then update this test.
    #[test]
    fn wire_format_matches_manual_zod_literals() {
        // PlayerCommand: snake_case discriminator on `kind`
        assert_eq!(
            serde_json::to_string(&PlayerCommand::Play).unwrap(),
            r#"{"kind":"play"}"#
        );
        assert_eq!(
            serde_json::to_string(&PlayerCommand::SetVolume { v: 0.5 }).unwrap(),
            r#"{"kind":"set_volume","v":0.5}"#
        );

        // PlayerState: bare snake_case
        assert_eq!(
            serde_json::to_string(&PlayerState::Stopped).unwrap(),
            r#""stopped""#
        );

        // PlayerEvent: snake_case discriminator on `kind`
        assert_eq!(
            serde_json::to_string(&PlayerEvent::Ended).unwrap(),
            r#"{"kind":"ended"}"#
        );
        assert_eq!(
            serde_json::to_string(&PlayerEvent::BackendDown { restart_count: 3 }).unwrap(),
            r#"{"kind":"backend_down","restart_count":3}"#
        );
    }
}
