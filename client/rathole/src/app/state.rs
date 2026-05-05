//! app state — persisted slice (loaded from / saved to statefile)
//! plus ephemeral slice (in-memory only).
//!
//! statefile schema is documented in [docs/TUI_PLAN.md](../../../docs/TUI_PLAN.md) §5.

use ratatui::widgets::ListState;
use serde::{Deserialize, Serialize};

use super::persist;

/// the persisted slice — serialized to `<data_dir>/rathole/state.toml`.
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
    /// "app" = local in-process; "wasm"/"http" reserved for m5+/future
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
/// commands as.
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

pub struct LastDispatch {
    pub command: String,
    pub success: bool,
    pub message: String,
    pub data_pretty: Option<String>,
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

pub struct AppState {
    pub persisted: PersistedState,
    pub ephemeral: EphemeralState,
}

impl AppState {
    pub fn load_or_default() -> Self {
        let persisted = persist::load().unwrap_or_else(|e| {
            tracing::warn!("rathole: statefile load failed ({e}); using defaults");
            PersistedState::default()
        });
        Self {
            persisted,
            ephemeral: EphemeralState::default(),
        }
    }

    pub fn save(&self) {
        if let Err(e) = persist::save(&self.persisted) {
            tracing::warn!("rathole: statefile save failed: {e}");
        }
    }
}
