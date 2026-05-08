//! app shell — top-level state container, command list, transport
//! handle. event loops live in shell crates (`tty`, `web`).

pub mod events;
pub mod music;
pub mod repl;
pub mod state;

pub use events::{
    ActionMenu, ActionMenuOption, AdminCommand, AppAction, ArgKind, ArgSpec, CommandForm,
    CommandKind, DispatchResponse, FieldState, LastDispatch, SelectOption, ServeKindRequest,
};
pub use music::{MusicEvent, MusicMode, MusicState, PlayerState, SongRow};
pub use repl::{ReplState, ReplStatus, ReplStatusLevel};
pub use state::{
    AppState, EphemeralState, Focus, LocalRef, PersistedState, RemoteEntry, ServeBadge, ServeMode,
    UiPrefs,
};

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

    /// indices into [`Self::commands`] visible in the admin palette
    /// given the current `palette_filter`. when the filter is empty
    /// every command is visible (and indices are `0..len`).
    /// case-insensitive substring match against the command name.
    pub fn palette_visible_indices(&self) -> Vec<usize> {
        let filter = self.state.ephemeral.palette_filter.trim().to_lowercase();
        if filter.is_empty() {
            return (0..self.commands.len()).collect();
        }
        self.commands
            .iter()
            .enumerate()
            .filter(|(_, c)| c.name.to_lowercase().contains(&filter))
            .map(|(i, _)| i)
            .collect()
    }

    /// resolve the palette `palette_list` selection (which is an
    /// index into the *filtered* visible list) back to a real index
    /// into [`Self::commands`]. returns `None` if no commands match
    /// the current filter or the selection is out of range.
    pub fn palette_selected_index(&self) -> Option<usize> {
        let visible = self.palette_visible_indices();
        if visible.is_empty() {
            return None;
        }
        let sel = self
            .state
            .ephemeral
            .palette_list
            .selected()
            .unwrap_or(0)
            .min(visible.len() - 1);
        visible.get(sel).copied()
    }
}
