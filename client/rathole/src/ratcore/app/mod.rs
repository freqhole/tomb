//! app shell — top-level state container, command list, transport
//! handle. event loops live in shell crates (`tty`, `web`).

pub mod events;
pub mod music;
pub mod state;

pub use events::{
    ActionMenu, ActionMenuOption, AdminCommand, AppAction, ArgKind, ArgSpec, CommandForm,
    CommandKind, DispatchResponse, FieldState, LastDispatch, SelectOption,
};
pub use music::{MusicEvent, MusicMode, MusicState, PlayerState, SongRow};
pub use state::{AppState, EphemeralState, Focus, LocalRef, PersistedState, RemoteEntry, UiPrefs};

use super::transport::{MusicPlayer, Transport};
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
    pub exit: bool,
}

impl App {
    pub fn new(state: AppState, transport: Rc<dyn Transport>, commands: Vec<AdminCommand>) -> Self {
        Self {
            state,
            transport,
            commands,
            player: None,
            exit: false,
        }
    }

    pub fn with_player(mut self, player: Rc<dyn MusicPlayer>) -> Self {
        self.player = Some(player);
        self
    }
}
