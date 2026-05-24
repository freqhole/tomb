//! app state — persisted slice (loaded by shell) plus ephemeral
//! slice (in-memory only).
//!
//! statefile schema is documented in [docs/TUI_PLAN.md](../../../../docs/TUI_PLAN.md) §5.

use serde::{Deserialize, Serialize};

use super::events::{ActionMenu, CommandForm, LastDispatch};
use super::music::MusicState;
use super::repl::ReplState;

/// portable view-layer representation of the serve subprocess state.
/// shells translate their concrete monitor types into this; views
/// read it to render the http/p2p header badges.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ServeBadge {
    /// which mode is currently running (or last attempted).
    pub mode: ServeMode,
    /// is the child alive right now?
    pub running: bool,
    /// pid of the running child, when known. for ui display only.
    pub pid: Option<u32>,
    /// most recent exit-code or spawn-error message, surfaced in
    /// the header tooltip / repl when the user asks.
    pub last_message: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum ServeMode {
    #[default]
    None,
    Auto,
    Http,
    P2p,
}

impl ServeMode {
    pub fn label(self) -> &'static str {
        match self {
            Self::None => "",
            Self::Auto => "serve",
            Self::Http => "http",
            Self::P2p => "p2p",
        }
    }
}

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
    /// big-banner landing screen — the default startup view.
    /// the slash repl is reachable via ctrl-k from here so the
    /// user can `/commands`, `/music`, `/peer`, etc.
    Landing,
    AdminPalette,
    /// modal text input for entering a peer node id (web shell only).
    PeerInput,
    /// list of saved remotes (web shell only). selecting a row
    /// switches the active transport; `a` opens [`Focus::PeerInput`]
    /// to add a new one; `d` deletes the highlighted entry.
    RemoteList,
    /// inline form for filling in the selected command's args.
    CommandForm,
    /// the last-dispatch output panel — takes focus so arrow keys
    /// scroll instead of moving the palette selection.
    ResultPanel,
    /// pop-up listing per-row actions for the focused result row.
    ResultActionMenu,
    /// music search + results + now-playing view.
    MusicView,
    /// the bottom `/` slash-command prompt.
    Repl,
    /// the global player row chrome (focusable transport buttons).
    PlayerRow,
}

impl Default for Focus {
    fn default() -> Self {
        Focus::Landing
    }
}

/// in-memory slice. rebuilt on every launch.
pub struct EphemeralState {
    pub focus: Focus,
    pub last_dispatch: Option<LastDispatch>,
    /// edit buffer for the peer-input modal.
    pub peer_input: String,
    /// caret position within `peer_input` (in chars, not bytes).
    /// always in `0..=peer_input.chars().count()`.
    pub peer_cursor: usize,
    /// peer addr the current transport is dispatching to (None = not
    /// p2p-connected; e.g. tty LocalTransport or web NoopTransport).
    pub connected_peer: Option<String>,
    /// human-friendly name of the connected remote, fetched from
    /// `/api/hello` after a successful connect. shown in the top bar
    /// in place of the raw node id when present.
    pub remote_name: Option<String>,
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
    /// state for the music search + playback view.
    pub music: MusicState,
    /// state for the bottom `/` slash-command repl.
    pub repl: ReplState,
    /// which control in the player row is selected (cycled via
    /// arrow keys). only meaningful when `focus == Focus::PlayerRow`.
    pub player_row_cursor: usize,
    /// focus to return to when leaving the player row.
    pub player_row_return_focus: Option<Focus>,
    /// when true, render a confirm-quit overlay; y/enter quits, n/esc
    /// cancels.
    pub pending_quit: bool,
    /// rows for the remotes-list view ([`Focus::RemoteList`]). loaded
    /// from the shell's storage on demand. portable shape so both
    /// shells can populate it.
    pub remotes_view: Vec<RemoteEntry>,
    /// cursor index into [`Self::remotes_view`].
    pub remotes_view_cursor: usize,
    /// snapshot of any in-tui-spawned `freqhole serve` subprocess.
    /// shells (tty for now) push updates whenever a serve child is
    /// started, exits, or is reaped on a tick. views read this to
    /// render the http/p2p badges in the top bar.
    pub serve: ServeBadge,
    /// snapshot of the most recent grimoire job-progress event.
    /// rendered as a small `{kind} {pct}%` badge in the top bar.
    /// cleared on a matching `JobSessionComplete`.
    pub jobs_status: Option<JobsStatus>,
    /// number of pending knock requests known to the local node.
    /// surfaces a small bell-style indicator on the right of the
    /// top bar. fed by the same grimoire event channel that drives
    /// `jobs_status`.
    pub pending_knocks: u32,
    /// username of a pending knock when exactly one is known.
    /// used by the header indicator to show who knocked.
    pub pending_knock_username: Option<String>,
    /// most recent scan session status for `/scan` monitor reopen.
    pub scan_status: Option<ScanStatus>,
    /// if set, `/scan abort confirm` must match this session id.
    pub scan_abort_confirm_for: Option<String>,
}

/// minimal portable view of an in-flight job session for the
/// header badge. populated from `GrimoireEvent::JobProgress` by
/// the shell.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct JobsStatus {
    /// short label for the job kind (e.g. "scan", "fetch").
    pub kind: String,
    /// 0..=100 progress estimate.
    pub percent: u8,
    /// total jobs in the session (for the "x / y" summary).
    pub jobs_total: u32,
    /// jobs still pending.
    pub jobs_pending: u32,
}

/// in-memory status for the most recent `/scan` session.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ScanStatus {
    pub session_id: String,
    pub jobs_total: u32,
    pub jobs_pending: u32,
    pub percent: u8,
    pub active: bool,
}

impl Default for EphemeralState {
    fn default() -> Self {
        Self {
            focus: Focus::default(),
            last_dispatch: None,
            peer_input: String::new(),
            peer_cursor: 0,
            connected_peer: None,
            remote_name: None,
            local_node_id: None,
            peer_error: None,
            form: None,
            last_dispatch_scroll: 0,
            last_knock_id: None,
            action_menu: None,
            music: MusicState::new(),
            repl: ReplState::default(),
            player_row_cursor: 0,
            player_row_return_focus: None,
            pending_quit: false,
            remotes_view: Vec::new(),
            remotes_view_cursor: 0,
            serve: ServeBadge::default(),
            jobs_status: None,
            pending_knocks: 0,
            pending_knock_username: None,
            scan_status: None,
            scan_abort_confirm_for: None,
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
