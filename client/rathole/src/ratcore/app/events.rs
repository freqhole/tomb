//! action types + portable admin command/response shapes.
//!
//! these are the data the core needs from a shell. shells convert
//! their domain types (e.g. `grimoire::admin_dispatch::registry::AdminCommandInfo`,
//! `grimoire::response::GrimoireResponse`) into these on the seam.

use serde_json::Value as JsonValue;

use super::music::{MusicEvent, SongRow};

/// portable arg for [`AppAction::ServeStart`]. mirrors
/// [`crate::ratcore::slash::ServeKindArg`] but lives here so the
/// app crate has no dependency on slash-parsing types.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServeKindRequest {
    Auto,
    Http,
    P2p,
}

/// dispatch result, transport-agnostic. mirrors the useful subset
/// of `grimoire::response::GrimoireResponse<JsonValue>`.
#[derive(Debug, Clone)]
pub struct DispatchResponse {
    pub success: bool,
    pub message: String,
    pub data: Option<JsonValue>,
}

/// admin command metadata, transport-agnostic. mirrors
/// `grimoire::admin_dispatch::registry::AdminCommandInfo` but owned
/// strings so the web shell can build them at runtime.
///
/// `kind` controls which transport channel is used to dispatch:
/// - [`CommandKind::Admin`] → `freqhole-admin/1` (requires registered admin peer)
/// - [`CommandKind::Public`] → `freqhole/1` proxy_request to `route`
///
/// `args` is a (possibly empty) list of user-supplied arguments. when
/// non-empty, pressing enter on the palette opens an inline form
/// instead of dispatching immediately.
#[derive(Debug, Clone)]
pub struct AdminCommand {
    pub name: String,
    pub request_type: String,
    pub response_type: String,
    pub auth: String,
    pub kind: CommandKind,
    pub args: Vec<ArgSpec>,
}

impl AdminCommand {
    /// constructor for the common admin-channel, no-args case.
    pub fn admin_noargs(name: &str, request_type: &str, response_type: &str) -> Self {
        Self {
            name: name.to_string(),
            request_type: request_type.to_string(),
            response_type: response_type.to_string(),
            auth: "Admin".to_string(),
            kind: CommandKind::Admin,
            args: vec![],
        }
    }

    /// short group label for clustering in the palette, derived from
    /// the first underscore-separated segment of the command name.
    pub fn group(&self) -> &str {
        match self.name.split_once('_') {
            Some((prefix, _)) => prefix,
            None => self.name.as_str(),
        }
    }
}

/// which transport channel a command dispatches over.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandKind {
    /// dispatched via `Transport::admin_dispatch(name, args)` over
    /// the `freqhole-admin/1` ALPN. caller must be a registered
    /// admin peer.
    Admin,
    /// dispatched via `Transport::public_dispatch(route, body)` over
    /// the `freqhole/1` ALPN proxy. anonymous; the route is the
    /// http-style path on the server (e.g. `"/api/knock"`).
    Public { route: String, method: String },
}

/// one input field in a [`AdminCommand`]'s args form.
#[derive(Debug, Clone)]
pub struct ArgSpec {
    /// json field name in the dispatched body.
    pub name: String,
    pub kind: ArgKind,
    pub required: bool,
    /// optional one-line help shown under the field.
    pub help: Option<String>,
}

/// shape of an arg's input widget.
#[derive(Debug, Clone)]
pub enum ArgKind {
    /// single-line free text.
    Text { placeholder: String },
    /// multi-line free text. (m1: rendered as text; multi-line edit lands later.)
    LongText { placeholder: String },
    /// integer input. rendered like Text but `build_body` parses as
    /// i64 and emits a JSON Number. blank + optional = field omitted;
    /// blank + required = error. `signed=true` allows a leading '-'.
    /// `min`/`max` clamp at validation time.
    Number {
        placeholder: String,
        signed: bool,
        min: Option<i64>,
        max: Option<i64>,
    },
    /// boolean toggle. rendered as a two-option cycler. always emits
    /// a JSON bool (no "unset" state); use `Option<Bool>` flavor on
    /// the server only when you actually want tri-state, in which
    /// case make the field `required: false` and pre-default it.
    Bool { default: bool },
    /// tri-state boolean: `unset` (drops the field at submit time),
    /// `true`, or `false`. for server fields typed `Option<bool>`
    /// where "absent" means "leave alone". if `required: true`,
    /// `unset` is rejected.
    OptionalBool { default: Option<bool> },
    /// pick from a fixed enum.
    OneOf { choices: Vec<String> },
    /// auto-filled with the local iroh node id; not rendered. used
    /// for endpoints like `/api/knock` that need to know who's calling
    /// before any auth happens.
    HiddenLocalNodeId,
    /// pick a value from another command's response. when the field
    /// is first focused, the form fires `source_command` with the
    /// `source_body` (after substituting `body_from_fields` from
    /// sibling fields' selected values) and walks `data_path`
    /// (dot-separated, `""` = root) to a JSON array. each element's
    /// `value_field` is what gets sent on submit; `label_field` is
    /// what's rendered in the picker.
    ///
    /// `body_from_fields` lets the source body depend on a sibling
    /// field — e.g. `radio_filters_remove` picks a station first,
    /// then fetches `radio_filters_list { station_id: <picked> }`.
    /// when any sibling-derived value would change, the cached
    /// options are dropped on focus and re-fetched.
    SelectFrom {
        source_command: String,
        source_body: serde_json::Value,
        /// (body_key, sibling_field_name) — at fetch time, look up
        /// the sibling's currently-selected value and insert it into
        /// the body under `body_key`.
        body_from_fields: Vec<(String, String)>,
        data_path: String,
        value_field: String,
        label_field: String,
    },
    /// hidden field whose value is auto-derived from a sibling
    /// `SelectFrom` field's currently-selected row. used for things
    /// like `peers_remove` where picking a user row should also
    /// supply that row's `node_id`. not focusable; not rendered as
    /// a wizard step.
    Mirror {
        from_field: String,
        source_row_field: String,
    },
}

/// state of a single field while the form is open.
#[derive(Debug, Clone)]
pub enum FieldState {
    Text {
        buf: String,
        cursor: usize,
    },
    /// multi-line free text. Enter inserts a newline; Tab advances
    /// the wizard. cursor is a byte index into `buf`.
    LongText {
        buf: String,
        cursor: usize,
    },
    /// integer input. shares the same key-handling path as Text but
    /// is parsed as i64 at submit time. `signed` is mirrored from
    /// the spec so the input handler can permit / reject a leading
    /// '-'.
    Number {
        buf: String,
        cursor: usize,
        signed: bool,
    },
    Bool {
        value: bool,
    },
    /// tri-state: `None` = unset (dropped at submit), `Some(true)` /
    /// `Some(false)` = explicit value.
    OptionalBool {
        value: Option<bool>,
    },
    OneOf {
        selected: usize,
    },
    HiddenLocalNodeId,
    /// dynamic-choice picker. `options` is `None` until the source
    /// command returns; `loading` is `true` while the fetch is in
    /// flight; `error` carries the failure message if one occurred.
    SelectFrom {
        options: Option<Vec<SelectOption>>,
        loading: bool,
        error: Option<String>,
        selected: usize,
    },
    /// auto-derived from a sibling SelectFrom row at submit time.
    /// not focusable; doesn't participate in the wizard step list.
    Mirror,
}

/// one row in a [`FieldState::SelectFrom`] picker.
#[derive(Debug, Clone)]
pub struct SelectOption {
    /// the value sent to the server (typically an id).
    pub value: String,
    /// the human-readable label shown in the picker.
    pub label: String,
    /// the full source row, kept around so `Mirror` siblings can
    /// pull other fields off the picked record at submit time.
    pub row: serde_json::Value,
}

impl FieldState {
    /// build the initial field state for an `ArgSpec`.
    pub fn from_spec(spec: &ArgSpec) -> Self {
        match &spec.kind {
            ArgKind::Text { .. } => Self::Text {
                buf: String::new(),
                cursor: 0,
            },
            ArgKind::LongText { .. } => Self::LongText {
                buf: String::new(),
                cursor: 0,
            },
            ArgKind::Number { signed, .. } => Self::Number {
                buf: String::new(),
                cursor: 0,
                signed: *signed,
            },
            ArgKind::Bool { default } => Self::Bool { value: *default },
            ArgKind::OptionalBool { default } => Self::OptionalBool { value: *default },
            ArgKind::OneOf { .. } => Self::OneOf { selected: 0 },
            ArgKind::HiddenLocalNodeId => Self::HiddenLocalNodeId,
            ArgKind::Mirror { .. } => Self::Mirror,
            ArgKind::SelectFrom { .. } => Self::SelectFrom {
                options: None,
                loading: false,
                error: None,
                selected: 0,
            },
        }
    }

    /// true if this field accepts focus / keystrokes.
    pub fn focusable(&self) -> bool {
        !matches!(self, Self::HiddenLocalNodeId | Self::Mirror)
    }
}

/// in-flight inline form for the currently-selected command.
///
/// the form is wizard-style: one focusable field is shown at a
/// time; Enter advances to the next step, Esc / Backspace goes
/// back. after the last field comes a "confirm" step that previews
/// the JSON body before dispatching.
#[derive(Debug, Clone)]
pub struct CommandForm {
    /// name of the command this form is for. used to look the
    /// `AdminCommand` back up in `app.commands` at submit time.
    pub command: String,
    pub fields: Vec<FieldState>,
    /// index into `fields`. always points at a focusable field
    /// (skips `HiddenLocalNodeId`); see `CommandForm::focus_first`.
    pub focused: usize,
    /// when true, the form is on its final "confirm + submit"
    /// step and `focused` should be ignored. Enter submits, Esc
    /// returns to the last field.
    pub confirming: bool,
    pub inflight: bool,
    pub error: Option<String>,
}

impl CommandForm {
    pub fn new(cmd: &AdminCommand) -> Self {
        let fields: Vec<FieldState> = cmd.args.iter().map(FieldState::from_spec).collect();
        let focused = fields.iter().position(FieldState::focusable).unwrap_or(0);
        Self {
            command: cmd.name.clone(),
            fields,
            focused,
            confirming: false,
            inflight: false,
            error: None,
        }
    }

    /// build a form whose fields are pre-filled from the keys of
    /// `prefill`. for each arg whose `name` matches a key in the
    /// JSON object, the corresponding field starts with that value
    /// already filled in:
    ///
    /// - `Text` / `LongText` / `Number` -> string-coerced into `buf`
    /// - `Bool` / `OptionalBool` -> taken from the bool value
    /// - `OneOf` -> matches the string against `choices`; falls back
    ///   to the default selection if no match
    /// - `SelectFrom` -> seeded with a single synthetic option whose
    ///   value matches the prefill (so it doesn't need to round-trip
    ///   the source command before submit)
    ///
    /// unmatched args fall back to `from_spec` defaults.
    pub fn new_with_prefill(cmd: &AdminCommand, prefill: &serde_json::Value) -> Self {
        let prefill = prefill.as_object();
        let fields: Vec<FieldState> = cmd
            .args
            .iter()
            .map(|spec| {
                let Some(obj) = prefill else {
                    return FieldState::from_spec(spec);
                };
                let Some(val) = obj.get(&spec.name) else {
                    return FieldState::from_spec(spec);
                };
                match (&spec.kind, val) {
                    (ArgKind::Text { .. }, _) => {
                        let s = match val {
                            serde_json::Value::String(s) => s.clone(),
                            _ => val.to_string(),
                        };
                        let cursor = s.chars().count();
                        FieldState::Text { buf: s, cursor }
                    }
                    (ArgKind::LongText { .. }, _) => {
                        let s = match val {
                            serde_json::Value::String(s) => s.clone(),
                            _ => val.to_string(),
                        };
                        let cursor = s.chars().count();
                        FieldState::LongText { buf: s, cursor }
                    }
                    (ArgKind::Number { signed, .. }, _) => {
                        let s = match val {
                            serde_json::Value::Number(n) => n.to_string(),
                            serde_json::Value::String(s) => s.clone(),
                            _ => String::new(),
                        };
                        let cursor = s.chars().count();
                        FieldState::Number {
                            buf: s,
                            cursor,
                            signed: *signed,
                        }
                    }
                    (ArgKind::Bool { default }, serde_json::Value::Bool(b)) => {
                        let _ = default;
                        FieldState::Bool { value: *b }
                    }
                    (ArgKind::OptionalBool { .. }, serde_json::Value::Bool(b)) => {
                        FieldState::OptionalBool { value: Some(*b) }
                    }
                    (ArgKind::OneOf { choices }, serde_json::Value::String(s)) => {
                        let selected = choices.iter().position(|c| c == s).unwrap_or(0);
                        FieldState::OneOf { selected }
                    }
                    (
                        ArgKind::SelectFrom {
                            value_field,
                            label_field,
                            ..
                        },
                        _,
                    ) => {
                        // synthesize a single-option list so the user
                        // doesn't have to wait for the source command
                        // to round-trip. label/value come from the
                        // sibling row when possible, else from `val`.
                        let value_str = match val {
                            serde_json::Value::String(s) => s.clone(),
                            other => other.to_string(),
                        };
                        let row = serde_json::Value::Object(obj.clone());
                        let label_str = obj
                            .get(label_field)
                            .and_then(|v| v.as_str().map(str::to_string))
                            .unwrap_or_else(|| {
                                obj.get(value_field)
                                    .and_then(|v| v.as_str().map(str::to_string))
                                    .unwrap_or_else(|| value_str.clone())
                            });
                        FieldState::SelectFrom {
                            options: Some(vec![SelectOption {
                                value: value_str,
                                label: label_str,
                                row,
                            }]),
                            loading: false,
                            error: None,
                            selected: 0,
                        }
                    }
                    _ => FieldState::from_spec(spec),
                }
            })
            .collect();
        let focused = fields.iter().position(FieldState::focusable).unwrap_or(0);
        Self {
            command: cmd.name.clone(),
            fields,
            focused,
            confirming: false,
            inflight: false,
            error: None,
        }
    }

    /// indices of focusable fields, in order. used by the wizard
    /// to figure out "first" / "last" / "step n of m".
    pub fn focusable_indices(&self) -> Vec<usize> {
        self.fields
            .iter()
            .enumerate()
            .filter(|(_, f)| f.focusable())
            .map(|(i, _)| i)
            .collect()
    }

    /// step number (1-based) of the currently focused field, plus
    /// the total number of focusable fields. when `confirming`,
    /// returns `(total + 1, total + 1)` to mean "the confirm step".
    pub fn step(&self) -> (usize, usize) {
        let order = self.focusable_indices();
        let total = order.len();
        if self.confirming {
            return (total + 1, total + 1);
        }
        let pos = order
            .iter()
            .position(|&i| i == self.focused)
            .map(|p| p + 1)
            .unwrap_or(1);
        (pos, total)
    }

    /// true iff the focused field is the last focusable one. used
    /// by the wizard to know that Enter should advance to the
    /// confirm step rather than wrapping to the first field.
    pub fn is_last_focusable(&self) -> bool {
        let order = self.focusable_indices();
        order.last().map(|&i| i == self.focused).unwrap_or(true)
    }

    /// true iff the focused field is the first focusable one. used
    /// to know that Backspace at step 1 should cancel rather than
    /// wrapping to the last field.
    pub fn is_first_focusable(&self) -> bool {
        let order = self.focusable_indices();
        order.first().map(|&i| i == self.focused).unwrap_or(true)
    }

    /// move focus to the next focusable field, wrapping.
    pub fn focus_next(&mut self) {
        let n = self.fields.len();
        if n == 0 {
            return;
        }
        for offset in 1..=n {
            let idx = (self.focused + offset) % n;
            if self.fields[idx].focusable() {
                self.focused = idx;
                return;
            }
        }
    }

    /// move focus to the previous focusable field, wrapping.
    pub fn focus_prev(&mut self) {
        let n = self.fields.len();
        if n == 0 {
            return;
        }
        for offset in 1..=n {
            let idx = (self.focused + n - offset) % n;
            if self.fields[idx].focusable() {
                self.focused = idx;
                return;
            }
        }
    }
}

/// background-task → ui-loop messages.
#[derive(Debug)]
pub enum AppAction {
    /// user asked the shell to start a `freqhole serve` subprocess.
    /// shells (tty) translate to a real spawn; web ignores. carries
    /// the kind selected on the slash command (`/serve`, `/http`,
    /// `/p2p`).
    ServeStart { kind: ServeKindRequest },
    /// user asked the shell to stop the running serve subprocess.
    ServeStop,
    /// result of an admin dispatch fired from the palette.
    AdminDispatchResult {
        command: String,
        response: DispatchResponse,
    },
    /// result of a peer-connect attempt fired from the peer-input
    /// modal. on success the shell has already swapped the app's
    /// transport; on failure the error message is surfaced in the ui.
    PeerConnectResult {
        peer_addr: String,
        error: Option<String>,
    },
    /// our own iroh node id became known (web shell, after
    /// `MiddenNode::create()` resolves).
    LocalNodeReady { node_id: String },
    /// remote `/api/hello` response landed. populates the top-bar
    /// remote name and (eventually) saves to the remotes store.
    /// `peer_addr` identifies which remote the info is for so a
    /// stale reply doesn't clobber a newer connect.
    RemoteHello {
        peer_addr: String,
        name: Option<String>,
        version: Option<String>,
        description: Option<String>,
    },
    /// list of saved remotes loaded from storage. populates the
    /// remotes-list view ([`crate::ratcore::app::Focus::RemoteList`]).
    RemotesLoaded {
        remotes: Vec<crate::ratcore::app::RemoteEntry>,
    },
    /// options for a [`FieldState::SelectFrom`] field arrived from
    /// the source command. `command` + `field_index` identify which
    /// field to populate; the form ignores the message if it has
    /// since closed or moved on.
    SelectFromOptionsReady {
        command: String,
        field_index: usize,
        options: Result<Vec<SelectOption>, String>,
    },
    /// search results for the music view arrived. `query` is the
    /// query they were issued for, used to ignore stale responses
    /// when the user has since edited the box.
    MusicSearchResults {
        query: String,
        result: Result<Vec<SongRow>, String>,
    },
    /// player backend emitted an event (state change, progress tick,
    /// track-changed, error, etc.).
    MusicEvent(MusicEvent),
    /// a playlist/album/etc. was fetched in the background and the
    /// ui loop should now populate the queue + start progressive
    /// blob resolution. used by the web shell to avoid holding a
    /// `&mut App` borrow across the network await.
    CollectionLoaded { songs: Vec<SongRow> },
    /// a playlist/album/etc. (or a single song) was fetched in the
    /// background to be appended to the existing queue. unlike
    /// [`CollectionLoaded`] this does not interrupt the currently
    /// playing track or reset `current`. paths have already been
    /// sent to the player via `PlayerCmd::Enqueue` by the spawn that
    /// emitted this event.
    CollectionEnqueued { songs: Vec<SongRow> },
    /// the user pressed `f` (or activated the heart in the player
    /// row) — flip favorite status for `target_id`. shell calls
    /// `Transport::toggle_favorite` and then sends a [`FavoriteResult`]
    /// back so the ui can update the heart glyph.
    ToggleFavorite {
        target_type: String,
        target_id: String,
    },
    /// reply from a [`ToggleFavorite`] (or initial [`Transport::is_favorited`]
    /// query) — the ui consumes this to update [`MusicState::current_favorited`]
    /// when `target_id` matches the now-playing song.
    ///
    /// `silent` is set when this is a passive on-track-change refresh
    /// rather than a user-initiated toggle. shells should not surface
    /// a status-line message in that case.
    FavoriteResult {
        target_type: String,
        target_id: String,
        result: Result<bool, String>,
        #[allow(dead_code)]
        silent: bool,
    },
}

/// most recent dispatch result, kept for the detail pane.
#[derive(Debug, Clone)]
pub struct LastDispatch {
    pub command: String,
    pub success: bool,
    pub message: String,
    pub data_pretty: Option<String>,
    /// when `data` is a JSON array of objects, each row is captured
    /// here so the result pane can offer per-row actions. empty
    /// otherwise.
    pub rows: Vec<serde_json::Value>,
    /// current row cursor when `rows` is non-empty.
    pub cursor: usize,
}

/// pop-up overlay listing per-row actions available against the
/// currently-focused row in the result panel.
#[derive(Debug, Clone)]
pub struct ActionMenu {
    /// the list-command whose result row this menu was opened from.
    pub source_command: String,
    /// the JSON row the user picked.
    pub row: serde_json::Value,
    pub options: Vec<ActionMenuOption>,
    pub selected: usize,
}

#[derive(Debug, Clone)]
pub struct ActionMenuOption {
    /// human-readable label, e.g. "get", "delete".
    pub label: String,
    /// command name to open a form for.
    pub target_command: String,
}
