//! grimoire event system
//!
//! provides a broadcast channel for internal events that can be
//! subscribed to by consumers (e.g., tauri app for real-time UI updates).

use once_cell::sync::Lazy;
use serde::Serialize;
use tokio::sync::broadcast;

/// events that can be emitted from grimoire
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GrimoireEvent {
    /// a new knock request was created
    KnockCreated {
        id: String,
        username: String,
        node_id: String,
        message: String,
    },
    /// a knock request was processed (accepted/rejected)
    KnockProcessed {
        id: String,
        status: String,
        username: String,
    },
    /// the remote server accepted our knock request.
    /// emitted on the requester's node so the tauri/rathole app can
    /// complete the add-remote flow automatically.
    KnockAccepted {
        /// the server's own peer_addr (node_id) - use to add as remote
        peer_addr: String,
        /// server display name
        server_name: String,
    },
    /// a remote device was linked via passkey browser flow
    ///
    /// emitted after `link_node` registers a new peer node. the tauri app
    /// uses this to show a toast prompting the user to browse the remote.
    DeviceLinked {
        /// the peer_addr (node_id) of the server that accepted the link
        peer_addr: String,
        /// display name of the server
        server_name: String,
    },
    /// a waveform image was generated + linked for a synced song or video
    /// in the background (see `offal::sync::waveform`). clients patch any
    /// queued copies (matched by blake3) so the playerbar and queue rows can
    /// render it without waiting for a refetch.
    WaveformReady {
        kind: WaveformEntityKind,
        /// local song or video id the waveform was linked to
        entity_id: String,
        /// blake3 of the media blob - the stable cross-peer key
        blake3: String,
        /// local media_blobz.id of the waveform image
        waveform_blob_id: String,
    },
}

/// which kind of media a `WaveformReady` event refers to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WaveformEntityKind {
    Song,
    Video,
}

impl WaveformEntityKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Song => "song",
            Self::Video => "video",
        }
    }
}

/// the global event channel
/// uses broadcast so multiple subscribers can receive events
static EVENTS: Lazy<broadcast::Sender<GrimoireEvent>> = Lazy::new(|| {
    let (tx, _) = broadcast::channel(100);
    tx
});

/// emit an event to all subscribers
///
/// safe to call even if no one is listening - events are dropped silently
pub fn emit(event: GrimoireEvent) {
    let _ = EVENTS.send(event);
}

/// subscribe to receive events
///
/// returns a receiver that will get all events emitted after subscription.
/// if you fall behind, older events will be dropped (lagged).
pub fn subscribe() -> broadcast::Receiver<GrimoireEvent> {
    EVENTS.subscribe()
}
