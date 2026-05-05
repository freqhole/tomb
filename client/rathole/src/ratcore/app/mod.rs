//! app shell — top-level state container, command list, transport
//! handle. event loops live in shell crates (`tty`, `web`).

pub mod events;
pub mod state;

pub use events::{AdminCommand, AppAction, DispatchResponse, LastDispatch};
pub use state::{AppState, EphemeralState, Focus, LocalRef, PersistedState, RemoteEntry, UiPrefs};

use super::transport::Transport;
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
    pub exit: bool,
}

impl App {
    pub fn new(state: AppState, transport: Rc<dyn Transport>, commands: Vec<AdminCommand>) -> Self {
        Self {
            state,
            transport,
            commands,
            exit: false,
        }
    }
}
