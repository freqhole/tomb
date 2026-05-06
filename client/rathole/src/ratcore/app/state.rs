//! app state — persisted slice (loaded by shell) plus ephemeral
//! slice (in-memory only).
//!
//! statefile schema is documented in [docs/TUI_PLAN.md](../../../../docs/TUI_PLAN.md) §5.

use ratatui::widgets::ListState;
use serde::{Deserialize, Serialize};

use super::events::{ActionMenu, CommandForm, LastDispatch};

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
    /// modal text input for entering a peer node id (web shell only).
    PeerInput,
    /// inline form for filling in the selected command's args.
    CommandForm,
    /// the last-dispatch output panel — takes focus so arrow keys
    /// scroll instead of moving the palette selection.
    ResultPanel,
    /// pop-up listing per-row actions for the focused result row.
    ResultActionMenu,
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
    /// edit buffer for the peer-input modal.
    pub peer_input: String,
    /// caret position within `peer_input` (in chars, not bytes).
    /// always in `0..=peer_input.chars().count()`.
    pub peer_cursor: usize,
    /// peer addr the current transport is dispatching to (None = not
    /// p2p-connected; e.g. tty LocalTransport or web NoopTransport).
    pub connected_peer: Option<String>,
    /// our own iroh node id, if we have one (web shell only).
    pub local_node_id: Option<String>,
    /// last peer-connect error to surface in the ui (cleared on
    /// successful connect).
    pub peer_error: Option<String>,
    /// in-flight inline form for the selected command's args.
    /// `Some` while `focus == Focus::CommandForm` (or just-finished
    /// with an error to display); `None` otherwise.
    pub form: Option<CommandForm>,
    /// vertical scroll offset (in lines) for the last-dispatch panel.
    /// 0 = top. clamped at render time so it never overflows.
    pub last_dispatch_scroll: u16,
    /// knock id returned by the most recent successful `knock`
    /// dispatch. shown in the header so the user can paste it into
    /// an admin's `freqhole federation accept-knock` command.
    pub last_knock_id: Option<String>,
    /// optional pop-up listing per-row actions for the row currently
    /// under the result-panel cursor.
    pub action_menu: Option<ActionMenu>,
}

impl Default for EphemeralState {
    fn default() -> Self {
        let mut palette_list = ListState::default();
        palette_list.select(Some(0));
        Self {
            focus: Focus::default(),
            palette_list,
            last_dispatch: None,
            peer_input: String::new(),
            peer_cursor: 0,
            connected_peer: None,
            local_node_id: None,
            peer_error: None,
            form: None,
            last_dispatch_scroll: 0,
            last_knock_id: None,
            action_menu: None,
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
