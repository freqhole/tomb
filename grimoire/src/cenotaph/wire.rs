//! `freqhole-player/1` pairing + control protocol — data shapes and pure
//! state transitions (pin/session rotation, trust levels, wire schema
//! (de)serialization).
//!
//! this is a MIRROR, not a shared source, of two other implementations of
//! the exact same wire protocol:
//! - `client/rathole/src/ratcore/app/pairing.rs` (rust) - kept separate
//!   rather than switched to a type-alias of this module because rathole's
//!   copy is also compiled for its wasm32 web shell, which cannot link
//!   grimoire (sqlx/tokio-based, native-only - see rathole's `Cargo.toml`).
//! - `client/spume/src/cenotaph/{control/schema.ts,pairing/{protocol,
//!   playerSession}.ts}` (typescript).
//!
//! keep all three in sync by hand when the wire format changes - same
//! discipline already used for the rust/ts mirror (see rathole's own doc
//! comment on this).
//!
//! this module only holds portable data + pure functions - the actual
//! iroh/tokio accept-loop lives in `super::endpoint`, and the durable
//! trust/invite-code store is `crate::users::UserService` (not
//! reinvented here).

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------
// trust: which controller node ids a player accepts commands from.
// ---------------------------------------------------------------------

/// mirrors grimoire's `UserRole`, minus `"root"` - same set cenotaph's
/// TS side uses. the role a paired controller carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PeerRole {
    Admin,
    Member,
    Viewer,
}

impl PeerRole {
    /// privilege level - lower is more privileged.
    pub fn level(self) -> u8 {
        match self {
            PeerRole::Admin => 10,
            PeerRole::Member => 20,
            PeerRole::Viewer => 30,
        }
    }
}

/// maps grimoire's 4-level role onto this protocol's 3-level `PeerRole` -
/// `Root` has no direct equivalent, so it's treated as `Admin` (the
/// closest/highest level here).
pub fn user_role_to_peer_role(role: crate::users::UserRole) -> PeerRole {
    match role {
        crate::users::UserRole::Root | crate::users::UserRole::Admin => PeerRole::Admin,
        crate::users::UserRole::Member => PeerRole::Member,
        crate::users::UserRole::Viewer => PeerRole::Viewer,
    }
}

/// the invite code a player is currently displaying for pairing - mirrors
/// just enough of grimoire's real `InviteCode` (the durable source of
/// truth) to render the qr/pin and an admin-grant hint.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PairingCode {
    pub code: String,
    pub grants_role: PeerRole,
}

impl PairingCode {
    pub fn is_admin_bootstrap(&self) -> bool {
        self.grants_role == PeerRole::Admin
    }
}

// ---------------------------------------------------------------------
// player session: the singleton, ephemeral "who's allowed to send
// commands right now" session.
// ---------------------------------------------------------------------

/// `"everyone"`: any currently-trusted peer may send commands, no pin
/// needed. `"selected"`: only peers in `allowed_node_ids` may - starts
/// empty (closed by default) and grows from a peer redeeming the
/// session pin, or the settings ui hand-picking known peers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionMode {
    Everyone,
    Selected,
}

const SESSION_IDLE_MS: i64 = 60 * 60 * 1000;

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlayerSession {
    pub mode: SessionMode,
    pub allowed_node_ids: Vec<String>,
    /// unix milliseconds.
    pub last_active_at: i64,
}

impl PlayerSession {
    pub fn fresh() -> Self {
        Self {
            mode: SessionMode::Selected,
            allowed_node_ids: Vec::new(),
            last_active_at: now_ms(),
        }
    }

    /// loads (or creates, or rotates if stale for over an hour) the
    /// singleton session - the caller owns actual persistence, this just
    /// decides what the "current" session should be given whatever was
    /// last persisted.
    pub fn ensure_active(existing: Option<PlayerSession>) -> PlayerSession {
        match existing {
            None => Self::fresh(),
            Some(session) => {
                let stale = now_ms() - session.last_active_at > SESSION_IDLE_MS;
                if stale {
                    PlayerSession {
                        allowed_node_ids: Vec::new(),
                        last_active_at: now_ms(),
                        ..session
                    }
                } else {
                    session
                }
            }
        }
    }

    pub fn touch(&mut self) {
        self.last_active_at = now_ms();
    }

    /// `role` is the peer's role in the base trust store, not session
    /// membership itself - an admin always passes regardless of session
    /// mode/allowlist. omit (`None`) to check plain session membership
    /// only.
    pub fn is_peer_allowed(&self, node_id: &str, role: Option<PeerRole>) -> bool {
        role == Some(PeerRole::Admin)
            || self.mode == SessionMode::Everyone
            || self.allowed_node_ids.iter().any(|id| id == node_id)
    }

    /// same decision as `is_peer_allowed`, but as a reason-carrying status
    /// a client can act on BEFORE ever attempting a real command. `role`
    /// is always a real, known role here (unlike `is_peer_allowed`'s
    /// `Option`) since this is only ever computed for a peer that already
    /// passed the trust check - an untrusted peer gets no presence
    /// response at all, so "untrusted" never needs a variant here.
    pub fn access_status(&self, node_id: &str, role: PeerRole) -> AccessStatus {
        if role == PeerRole::Admin {
            AccessStatus::Admin
        } else if self.is_peer_allowed(node_id, Some(role)) {
            AccessStatus::InSession
        } else {
            AccessStatus::NotInSession
        }
    }

    /// records that `node_id` redeemed the session pin (or was
    /// hand-picked in settings) - adds it to the allowlist.
    pub fn join(&mut self, node_id: &str) {
        if !self.allowed_node_ids.iter().any(|id| id == node_id) {
            self.allowed_node_ids.push(node_id.to_string());
        }
        self.touch();
    }

    /// the settings-ui counterpart to `join` - manually removes a known
    /// peer from the session's allowlist without forgetting its base
    /// trust.
    pub fn leave(&mut self, node_id: &str) {
        self.allowed_node_ids.retain(|id| id != node_id);
        self.touch();
    }

    pub fn set_mode(&mut self, mode: SessionMode) {
        self.mode = mode;
        self.touch();
    }
}

// ---------------------------------------------------------------------
// pairing handshake wire schema.
// ---------------------------------------------------------------------

/// the connecting node's identity comes from the iroh handshake itself
/// (never trust a node id supplied inside the message body). `code` is a
/// real grimoire invite code, not a locally-generated pin.
#[derive(Debug, Clone, Deserialize)]
pub struct PairRequest {
    pub code: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PairResponseReason {
    InvalidCode,
    /// the redeemed code was valid, but the requested `display_name` is
    /// already registered as a different user - the peer should retry
    /// with a different name.
    UsernameTaken,
    RateLimited,
}

#[derive(Debug, Clone, Serialize)]
pub struct PairResponse {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<PairResponseReason>,
}

impl PairResponse {
    pub fn ok() -> Self {
        Self {
            kind: "pair_response",
            ok: true,
            reason: None,
        }
    }
    pub fn err(reason: PairResponseReason) -> Self {
        Self {
            kind: "pair_response",
            ok: false,
            reason: Some(reason),
        }
    }
}

// ---------------------------------------------------------------------
// control command protocol.
// ---------------------------------------------------------------------

/// a piece of media a command references - resolved (possibly fetched
/// from `source_peer_addr` over iroh-blobs) before actual playback.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MediaRef {
    pub source_peer_addr: String,
    pub blake3_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<MediaKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artwork_thumb_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artwork_full_url: Option<String>,
    /// already-transcoded alternates of this video, if the pushing device
    /// already has any on hand. omitted/empty for audio, or when the
    /// source has no renditions.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub available_renditions: Vec<RenditionRef>,
}

/// see [`MediaRef::available_renditions`]'s doc comment.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RenditionRef {
    pub blake3_hash: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaKind {
    Audio,
    Video,
}

/// commands a trusted, in-session controller sends. `#[serde(tag =
/// "command")]` mirrors the ts schema's `discriminatedUnion("command",
/// ...)` exactly (field names are already snake_case on the wire,
/// matching 1:1). real messages also carry a constant `"type":"control"`
/// envelope field - deserializing here simply ignores it (unknown fields
/// aren't an error), since the top-level dispatch already peeked at
/// `"type"` to route here in the first place.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case")]
pub enum PlayerCommand {
    Play {
        item: MediaRef,
    },
    ReplaceQueue {
        items: Vec<MediaRef>,
    },
    AppendQueue {
        items: Vec<MediaRef>,
    },
    Pause,
    Resume,
    Seek {
        position_ms: u64,
    },
    Skip,
    RemoveFromQueue {
        index: usize,
    },
    ReorderQueue {
        from_index: usize,
        to_index: usize,
    },
    SetVolume {
        volume: f64,
    },
    Stop,
    GetStatus,
    SetAutoDownloadEnabled {
        enabled: bool,
    },
    TuneRadio {
        peer_addr: String,
        #[serde(default)]
        station_id: Option<String>,
    },
    StopRadio,
}

/// short, log-safe summary of a command - `{:?}` on the real value would
/// print every `MediaRef`'s `artwork_thumb_url`/`artwork_full_url` in
/// full, which is routinely a multi-KB (or larger) base64 `data:` url.
pub fn command_summary(command: &PlayerCommand) -> String {
    match command {
        PlayerCommand::Play { item } => format!("Play {{ title: {:?} }}", item.title),
        PlayerCommand::ReplaceQueue { items } => {
            format!("ReplaceQueue {{ count: {} }}", items.len())
        }
        PlayerCommand::AppendQueue { items } => {
            format!("AppendQueue {{ count: {} }}", items.len())
        }
        PlayerCommand::Pause => "Pause".to_string(),
        PlayerCommand::Resume => "Resume".to_string(),
        PlayerCommand::Seek { position_ms } => format!("Seek {{ position_ms: {position_ms} }}"),
        PlayerCommand::Skip => "Skip".to_string(),
        PlayerCommand::RemoveFromQueue { index } => {
            format!("RemoveFromQueue {{ index: {index} }}")
        }
        PlayerCommand::ReorderQueue {
            from_index,
            to_index,
        } => format!("ReorderQueue {{ from_index: {from_index}, to_index: {to_index} }}"),
        PlayerCommand::SetVolume { volume } => format!("SetVolume {{ volume: {volume} }}"),
        PlayerCommand::Stop => "Stop".to_string(),
        PlayerCommand::GetStatus => "GetStatus".to_string(),
        PlayerCommand::SetAutoDownloadEnabled { enabled } => {
            format!("SetAutoDownloadEnabled {{ enabled: {enabled} }}")
        }
        PlayerCommand::TuneRadio {
            peer_addr,
            station_id,
        } => format!("TuneRadio {{ peer_addr: {peer_addr}, station_id: {station_id:?} }}"),
        PlayerCommand::StopRadio => "StopRadio".to_string(),
    }
}

/// a dedicated push-subscription session request - sent once as the
/// first (and only) line on a stream the controller keeps open
/// indefinitely.
#[derive(Debug, Clone, Deserialize)]
pub struct SubscribeRequest;

/// one-shot presence check, answered then the stream closes.
#[derive(Debug, Clone, Deserialize)]
pub struct PresenceQuery;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PresenceState {
    Active,
    Stopped,
}

/// answers "would a real command from this specific caller be accepted
/// right now" - computed via `PlayerSession::access_status`, the exact
/// same logic real command dispatch uses, just surfaced ahead of time so
/// a client (e.g. spume's Add Remote modal) can decide whether to show a
/// pairing-pin form for an already-trusted remote without first firing
/// off a real command and reading its rejection reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AccessStatus {
    /// always allowed, regardless of session membership.
    Admin,
    /// trusted and already joined into the current session (or the
    /// session is in `Everyone` mode) - allowed.
    InSession,
    /// trusted, but hasn't joined the current session yet - needs to
    /// redeem the session pin before commands will be accepted.
    NotInSession,
}

#[derive(Debug, Clone, Serialize)]
pub struct PresenceAnnouncement {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub state: PresenceState,
    /// only ever set on a direct `PresenceQuery` reply (per-caller) -
    /// always `None` on the unprompted broadcast pushed to `subscribe`
    /// streams, since that push has no single caller to compute it for.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub access: Option<AccessStatus>,
}

impl PresenceAnnouncement {
    pub fn new(state: PresenceState) -> Self {
        Self {
            kind: "presence",
            state,
            access: None,
        }
    }

    /// the direct, per-caller reply to a `PresenceQuery` - same as `new`,
    /// plus the caller's own `AccessStatus`.
    pub fn for_caller(state: PresenceState, access: AccessStatus) -> Self {
        Self {
            kind: "presence",
            state,
            access: Some(access),
        }
    }
}

/// what the player reports back - either in reply to a command, or
/// pushed unprompted to every subscribed stream. the shared
/// queue/auto_download/volume/recently_played fields are factored into
/// one struct here (`StatusCommon`) rather than repeated per-variant
/// like the zod schema does, since rust enums don't support shared
/// fields directly - flattened back onto the wire so the actual JSON
/// still matches zod's flat-object shape.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StatusCommon {
    pub queue: Vec<MediaRef>,
    pub auto_download_enabled: bool,
    pub volume: f64,
    pub recently_played: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum PlayerStatus {
    NowPlaying {
        item: Box<MediaRef>,
        position_ms: u64,
        server_time_ms: u64,
        #[serde(flatten)]
        common: StatusCommon,
    },
    Paused {
        position_ms: u64,
        #[serde(flatten)]
        common: StatusCommon,
    },
    Buffering {
        #[serde(flatten)]
        common: StatusCommon,
    },
    Stopped {
        #[serde(flatten)]
        common: StatusCommon,
    },
    Error {
        message: String,
        #[serde(flatten)]
        common: StatusCommon,
    },
}

/// wraps a `PlayerStatus` with the constant `"type":"status"` envelope
/// field the zod schema requires.
#[derive(Debug, Clone, Serialize)]
pub struct PlayerStatusMessage {
    #[serde(rename = "type")]
    pub kind: &'static str,
    #[serde(flatten)]
    pub status: PlayerStatus,
}

impl PlayerStatusMessage {
    pub fn new(status: PlayerStatus) -> Self {
        Self {
            kind: "status",
            status,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandAckReason {
    Untrusted,
    InvalidCommand,
    NotInSession,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandAck {
    // never deserialized (see command_ack_kind's doc comment) - a `&'static
    // str` field can't borrow from an arbitrary (non-'static) deserializer
    // input, so this always reconstructs the constant instead.
    #[serde(rename = "type", skip_deserializing, default = "command_ack_kind")]
    pub kind: &'static str,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<CommandAckReason>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<PlayerStatus>,
}

fn command_ack_kind() -> &'static str {
    "command_ack"
}

impl CommandAck {
    pub fn ok(status: PlayerStatus) -> Self {
        Self {
            kind: "command_ack",
            ok: true,
            reason: None,
            status: Some(status),
        }
    }
    pub fn err(reason: CommandAckReason) -> Self {
        Self {
            kind: "command_ack",
            ok: false,
            reason: Some(reason),
            status: None,
        }
    }
}

/// peek at an incoming ndjson line's `"type"` field without committing to
/// a specific schema yet.
pub fn peek_line_type(line: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    value
        .get("type")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
}

/// a controller currently connected on a live stream (paired + actively
/// holding a command/subscribe stream open) - distinct from grimoire's
/// durable trust (paired at some point, may not be connected right now,
/// see `crate::users::UserPeerNode`) and from
/// `PlayerSession.allowed_node_ids` (in the current session, may not be
/// connected right now either).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ConnectedControllerInfo {
    pub node_id: String,
    pub display_name: String,
}

/// portable read-only snapshot of a running `PairingRuntime`'s state -
/// consumers (rathole's ratatui ui, a future charnel settings panel)
/// build their own display model from this.
#[derive(Debug, Clone, Default)]
pub struct PairingSnapshot {
    /// this device's own iroh node id, once the `freqhole-player/1`
    /// endpoint has started (`None` before it's finished starting up).
    pub node_id: Option<String>,
    pub current_code: Option<PairingCode>,
    pub session: Option<PlayerSession>,
    pub connected: Vec<ConnectedControllerInfo>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_active_creates_a_fresh_session_when_none_exists() {
        let session = PlayerSession::ensure_active(None);
        assert!(session.allowed_node_ids.is_empty());
        assert_eq!(session.mode, SessionMode::Selected);
    }

    #[test]
    fn ensure_active_keeps_a_fresh_session_as_is() {
        let mut session = PlayerSession::fresh();
        session.join("peer-a");
        let kept = PlayerSession::ensure_active(Some(session.clone()));
        assert_eq!(kept, session);
    }

    #[test]
    fn ensure_active_rotates_a_stale_session() {
        let mut stale = PlayerSession::fresh();
        stale.join("peer-a");
        stale.last_active_at = now_ms() - SESSION_IDLE_MS - 1;
        let rotated = PlayerSession::ensure_active(Some(stale.clone()));
        assert!(rotated.allowed_node_ids.is_empty());
    }

    #[test]
    fn join_then_leave_round_trips_membership() {
        let mut session = PlayerSession::fresh();
        assert!(!session.is_peer_allowed("peer-a", None));
        session.join("peer-a");
        assert!(session.is_peer_allowed("peer-a", None));
        session.leave("peer-a");
        assert!(!session.is_peer_allowed("peer-a", None));
    }

    #[test]
    fn join_is_idempotent() {
        let mut session = PlayerSession::fresh();
        session.join("peer-a");
        session.join("peer-a");
        assert_eq!(session.allowed_node_ids, vec!["peer-a".to_string()]);
    }

    #[test]
    fn admin_role_always_allowed_regardless_of_session_mode() {
        let session = PlayerSession::fresh();
        assert!(session.is_peer_allowed("stranger", Some(PeerRole::Admin)));
        assert!(!session.is_peer_allowed("stranger", Some(PeerRole::Viewer)));
        assert!(!session.is_peer_allowed("stranger", None));
    }

    #[test]
    fn everyone_mode_allows_any_peer() {
        let mut session = PlayerSession::fresh();
        session.set_mode(SessionMode::Everyone);
        assert!(session.is_peer_allowed("anyone", None));
    }

    #[test]
    fn role_levels_match_grimoire_convention() {
        assert!(PeerRole::Admin.level() < PeerRole::Member.level());
        assert!(PeerRole::Member.level() < PeerRole::Viewer.level());
    }

    #[test]
    fn access_status_admin_always_in_regardless_of_session_membership() {
        let session = PlayerSession::fresh();
        assert_eq!(
            session.access_status("stranger", PeerRole::Admin),
            AccessStatus::Admin
        );
    }

    #[test]
    fn access_status_trusted_member_not_yet_joined() {
        let session = PlayerSession::fresh();
        assert_eq!(
            session.access_status("peer-a", PeerRole::Member),
            AccessStatus::NotInSession
        );
    }

    #[test]
    fn access_status_trusted_member_after_joining() {
        let mut session = PlayerSession::fresh();
        session.join("peer-a");
        assert_eq!(
            session.access_status("peer-a", PeerRole::Member),
            AccessStatus::InSession
        );
    }

    #[test]
    fn access_status_everyone_mode_treats_any_member_as_in_session() {
        let mut session = PlayerSession::fresh();
        session.set_mode(SessionMode::Everyone);
        assert_eq!(
            session.access_status("anyone", PeerRole::Viewer),
            AccessStatus::InSession
        );
    }

    #[test]
    fn peek_line_type_reads_the_envelope_kind() {
        assert_eq!(
            peek_line_type(r#"{"type":"pair_request","pin":"abc123"}"#),
            Some("pair_request".to_string())
        );
        assert_eq!(peek_line_type("not json"), None);
        assert_eq!(peek_line_type(r#"{"no_type":true}"#), None);
    }

    #[test]
    fn player_command_deserializes_ignoring_the_redundant_type_field() {
        let line = r#"{"type":"control","command":"seek","position_ms":1500}"#;
        let cmd: PlayerCommand = serde_json::from_str(line).expect("should parse");
        match cmd {
            PlayerCommand::Seek { position_ms } => assert_eq!(position_ms, 1500),
            other => panic!("wrong variant: {other:?}"),
        }
    }

    #[test]
    fn player_command_play_deserializes_media_ref() {
        let line = r#"{"type":"control","command":"play","item":{"source_peer_addr":"abc","blake3_hash":"def","kind":"audio","title":"a song"}}"#;
        let cmd: PlayerCommand = serde_json::from_str(line).expect("should parse");
        match cmd {
            PlayerCommand::Play { item } => {
                assert_eq!(item.source_peer_addr, "abc");
                assert_eq!(item.blake3_hash, "def");
                assert_eq!(item.kind, Some(MediaKind::Audio));
                assert_eq!(item.title.as_deref(), Some("a song"));
            }
            other => panic!("wrong variant: {other:?}"),
        }
    }

    #[test]
    fn command_ack_wire_shape_matches_cenotaph_schema() {
        let ack = CommandAck::err(CommandAckReason::NotInSession);
        let json = serde_json::to_value(&ack).unwrap();
        assert_eq!(json["type"], "command_ack");
        assert_eq!(json["ok"], false);
        assert_eq!(json["reason"], "not_in_session");
        assert!(json.get("status").is_none());
    }

    #[test]
    fn player_status_message_wire_shape_matches_cenotaph_schema() {
        let msg = PlayerStatusMessage::new(PlayerStatus::Stopped {
            common: StatusCommon {
                queue: vec![],
                auto_download_enabled: true,
                volume: 0.8,
                recently_played: vec!["hash1".into()],
            },
        });
        let json = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["type"], "status");
        assert_eq!(json["state"], "stopped");
        assert_eq!(json["auto_download_enabled"], true);
        assert_eq!(json["volume"], 0.8);
        assert_eq!(json["recently_played"][0], "hash1");
        // flatten shouldn't leave a nested "common" key behind.
        assert!(json.get("common").is_none());
    }

    #[test]
    fn pair_response_wire_shape_matches_cenotaph_schema() {
        let ok = serde_json::to_value(PairResponse::ok()).unwrap();
        assert_eq!(ok["type"], "pair_response");
        assert_eq!(ok["ok"], true);
        assert!(ok.get("reason").is_none());

        let err = serde_json::to_value(PairResponse::err(PairResponseReason::InvalidCode)).unwrap();
        assert_eq!(err["reason"], "invalid_code");
    }

    #[test]
    fn pair_request_deserializes_ignoring_the_type_field() {
        let line = r#"{"type":"pair_request","code":"123456","display_name":"phone"}"#;
        let req: PairRequest = serde_json::from_str(line).expect("should parse");
        assert_eq!(req.code, "123456");
        assert_eq!(req.display_name, "phone");
    }
}
