//! app state — persisted slice (loaded by shell) plus ephemeral
//! slice (in-memory only).
//!
//! statefile schema is documented in [docs/TUI_PLAN.md](../../../../docs/TUI_PLAN.md) §5.

use ratatui::widgets::ListState;
use serde::{Deserialize, Serialize};

use super::events::LastDispatch;

/// the persisted slice — serialized to whatever the shell uses
/// (toml on tty, localStorage / IndexedDB on web later).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedState {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub active_remote_id: Option<String>,
    #[serde(default)]
    pub ui: UiPrefs,
    #[serde(default)]
    pub remotes: Vec<RemoteEntry>,
}

fn default_schema_version() -> u32 {
    1
}

impl Default for PersistedState {
    fn default() -> Self {
        Self {
            schema_version: 1,
            active_remote_id: None,
            ui: UiPrefs::default(),
            remotes: vec![],
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UiPrefs {
    #[serde(default)]
    pub last_view: Option<String>,
    #[serde(default)]
    pub volume: Option<f32>,
}

/// statefile entry for one saved server connection. mirrors
/// `grimoire::remotez::Remote` field-by-field for the ones rathole
/// uses today; m5 will switch this for `grimoire::remotez::Remote`
/// directly once the remote (p2p) transport lands.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteEntry {
    pub remote_id: String,
    pub name: String,
    /// "app" = local in-process; "midden" = browser-iroh; future
    /// values reserved.
    pub transport: String,
    #[serde(default)]
    pub peer_addr: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub is_active: bool,
    #[serde(default)]
    pub last_connected_at: Option<i64>,
    #[serde(default)]
    pub local_ref: Option<LocalRef>,
}

/// rathole-only side-car for `transport = "app"` entries: where the
/// freqhole-config.toml lives and which user we dispatch admin
/// commands as. tty-only in practice.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalRef {
    pub config_path: std::path::PathBuf,
    pub admin_user_id: String,
    pub admin_username: String,
}

/// which top-level area has focus.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Focus {
    AdminPalette,
}

impl Default for Focus {
    fn default() -> Self {
        Focus::AdminPalette
    }
}

/// in-memory slice. rebuilt on every launch.
pub struct EphemeralState {
    pub focus: Focus,
    pub palette_list: ListState,
    pub last_dispatch: Option<LastDispatch>,
}

impl Default for EphemeralState {
    fn default() -> Self {
        let mut palette_list = ListState::default();
        palette_list.select(Some(0));
        Self {
            focus: Focus::default(),
            palette_list,
            last_dispatch: None,
        }
    }
}

#[derive(Default)]
pub struct AppState {
    pub persisted: PersistedState,
    pub ephemeral: EphemeralState,
}

impl AppState {
    pub fn from_persisted(persisted: PersistedState) -> Self {
        Self {
            persisted,
            ephemeral: EphemeralState::default(),
        }
    }
}
