//! action types + portable admin command/response shapes.
//!
//! these are the data the core needs from a shell. shells convert
//! their domain types (e.g. `grimoire::admin_dispatch::registry::AdminCommandInfo`,
//! `grimoire::response::GrimoireResponse`) into these on the seam.

use serde_json::Value as JsonValue;

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
    /// pick from a fixed enum.
    OneOf { choices: Vec<String> },
    /// auto-filled with the local iroh node id; not rendered. used
    /// for endpoints like `/api/knock` that need to know who's calling
    /// before any auth happens.
    HiddenLocalNodeId,
    /// pick a value from another command's response. when the field
    /// is first focused, the form fires `source_command` once (with
    /// `{}` args) and walks `data_path` (dot-separated, `""` = root)
    /// to a JSON array. each element's `value_field` is what gets
    /// sent on submit; `label_field` is what's rendered in the picker.
    SelectFrom {
        source_command: String,
        data_path: String,
        value_field: String,
        label_field: String,
    },
}

/// state of a single field while the form is open.
#[derive(Debug, Clone)]
pub enum FieldState {
    Text {
        buf: String,
        cursor: usize,
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
}

/// one row in a [`FieldState::SelectFrom`] picker.
#[derive(Debug, Clone)]
pub struct SelectOption {
    /// the value sent to the server (typically an id).
    pub value: String,
    /// the human-readable label shown in the picker.
    pub label: String,
}

impl FieldState {
    /// build the initial field state for an `ArgSpec`.
    pub fn from_spec(spec: &ArgSpec) -> Self {
        match &spec.kind {
            ArgKind::Text { .. } | ArgKind::LongText { .. } => Self::Text {
                buf: String::new(),
                cursor: 0,
            },
            ArgKind::OneOf { .. } => Self::OneOf { selected: 0 },
            ArgKind::HiddenLocalNodeId => Self::HiddenLocalNodeId,
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
        !matches!(self, Self::HiddenLocalNodeId)
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
    /// options for a [`FieldState::SelectFrom`] field arrived from
    /// the source command. `command` + `field_index` identify which
    /// field to populate; the form ignores the message if it has
    /// since closed or moved on.
    SelectFromOptionsReady {
        command: String,
        field_index: usize,
        options: Result<Vec<SelectOption>, String>,
    },
}

/// most recent dispatch result, kept for the detail pane.
#[derive(Debug, Clone)]
pub struct LastDispatch {
    pub command: String,
    pub success: bool,
    pub message: String,
    pub data_pretty: Option<String>,
}
