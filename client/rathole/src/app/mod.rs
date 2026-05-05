//! app shell — top-level state, event loop, persistence.

mod events;
mod persist;
mod run;
mod state;

pub use events::AppAction;
pub use state::{AppState, EphemeralState, Focus, PersistedState};

use crate::transport::{LocalTransport, Transport};
use crate::LaunchOpts;
use std::sync::Arc;

pub struct App {
    pub state: AppState,
    pub transport: Arc<dyn Transport>,
    pub _opts: LaunchOpts,
    pub exit: bool,
}

impl App {
    pub async fn new(opts: LaunchOpts) -> color_eyre::Result<Self> {
        let transport: Arc<dyn Transport> = Arc::new(LocalTransport::from_first_root().await?);
        let state = AppState::load_or_default();
        Ok(Self {
            state,
            transport,
            _opts: opts,
            exit: false,
        })
    }

    pub async fn run(self, terminal: ratatui::DefaultTerminal) -> color_eyre::Result<()> {
        run::run_loop(self, terminal).await
    }
}
