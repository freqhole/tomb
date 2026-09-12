//! app shell — top-level state container, command list, transport
//! handle. event loops live in shell crates (`tty`, `web`).

pub mod events;
pub mod music;
pub mod pairing;
pub mod queue;
pub mod repl;
pub mod state;
pub mod video;
pub mod video_player;

pub use events::{
    ActionMenu, ActionMenuOption, AdminCommand, AppAction, ArgKind, ArgSpec, CommandForm,
    CommandKind, DispatchResponse, FieldState, LastDispatch, SelectOption, ServeKindRequest,
};
pub use music::{MusicEvent, MusicMode, MusicState, PlayerState, SongRow};
pub use pairing::{
    CommandAck, CommandAckReason, ConnectedControllerInfo, ImageMode, MediaKind, MediaRef,
    PairRequest, PairResponse, PairResponseReason, PairingDownloadProgress, PairingSnapshot,
    PairingViewMode, PairingViewState, PeerRole, PlayerCommand as PairingCommand, PlayerSession,
    PlayerStatus, PlayerStatusMessage, PresenceAnnouncement, PresenceQuery, PresenceState,
    SessionMode, StatusCommon, SubscribeRequest, TrustedController,
};
pub use queue::{QueueEntry, QueuedVideoRow};
pub use repl::{ReplState, ReplStatus, ReplStatusLevel};
pub use state::{
    AppState, EphemeralState, Focus, JobsStatus, LocalRef, PendingRemoteEntry, PersistedState,
    RadioPlaybackState, RemoteEntry, ScanStatus, ServeBadge, ServeMode, UiPrefs,
};
pub use video::{RenditionRow, SeriesRow, VideoMode, VideoRow, VideoState};
pub use video_player::{
    AudioDeviceInfo, VideoCommand, VideoEvent, VideoPlaybackState, VideoPlayerState,
};

use super::transport::{MusicPlayer, PairingStateReader, Transport, VideoPlayer};
use std::rc::Rc;

/// portable app shell. shells construct this with a transport,
/// command list, and persisted state, then drive their own event
/// loop against it.
///
/// uses `Rc<dyn Transport>` because wasm `Transport` impls are not
/// `Send`/`Sync` (browser apis are single-threaded). the tty event
/// loop runs on the current thread too, so this is fine for both.
pub struct App {
    pub state: AppState,
    pub transport: Rc<dyn Transport>,
    pub commands: Vec<AdminCommand>,
    /// optional audio backend. `None` on shells without playback
    /// support (web today). the music view degrades to read-only
    /// browse mode when this is `None`.
    pub player: Option<Rc<dyn MusicPlayer>>,
    /// optional video/image backend (mpv, linux tty only). `None` on
    /// shells without it — video browsing/editing still works, just
    /// without an in-app way to actually play a video or show a
    /// still image full screen.
    pub video_player: Option<Rc<dyn VideoPlayer>>,
    /// optional `--player`/`/player` pairing-state reader (tty only,
    /// and only once pairing mode has been entered at least once -
    /// see `tty::pairing::PairingRuntime`). `None` means the pairing
    /// view has nothing live to render yet.
    pub pairing: Option<Rc<dyn PairingStateReader>>,
    pub exit: bool,
}

impl App {
    pub fn new(state: AppState, transport: Rc<dyn Transport>, commands: Vec<AdminCommand>) -> Self {
        Self {
            state,
            transport,
            commands,
            player: None,
            video_player: None,
            pairing: None,
            exit: false,
        }
    }

    pub fn with_player(mut self, player: Rc<dyn MusicPlayer>) -> Self {
        self.player = Some(player);
        self
    }

    pub fn with_video_player(mut self, video_player: Rc<dyn VideoPlayer>) -> Self {
        self.video_player = Some(video_player);
        self
    }

    pub fn with_pairing(mut self, pairing: Rc<dyn PairingStateReader>) -> Self {
        self.pairing = Some(pairing);
        self
    }
}
