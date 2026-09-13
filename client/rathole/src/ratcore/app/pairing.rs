//! `freqhole-player/1` pairing + control protocol — portable types,
//! no grimoire/tokio/iroh deps.
//!
//! mirrors (wire-compatible, not code-shared — rust and ts can't share
//! source) cenotaph's real, live implementation:
//! - `lib/cenotaph/ts/src/pairing/{pin,trustStore,playerSession,protocol}.ts`
//! - `lib/cenotaph/ts/src/control/schema.ts`
//!
//! see docs/rathole-headless-player-plan.md phase 4 for the design
//! writeup and the "naming disambiguation" note (this is NOT the old,
//! removed `grimoire::player::alpn` protocol of the same ALPN name).
//!
//! this module only holds the protocol's DATA shapes and pure state
//! transitions (pin/session rotation, trust levels, wire schema
//! (de)serialization) — connecting this to a real iroh transport and a
//! real playback backend is `tty::pairing`'s job, so the logic here
//! stays unit-testable without any network/grimoire dependency, same
//! split as `video_player.rs`'s relationship to `tty::video_player`.

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------
// trust: which controller node ids this player accepts commands from.
// mirrors `pairing/trustStore.ts`.
// ---------------------------------------------------------------------

/// mirrors grimoire's `UserRole`, minus `"root"` — same set cenotaph's
/// TS side uses (`trustStore.ts`'s `PeerRole`). the role a paired
/// controller carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PeerRole {
    Admin,
    Member,
    Viewer,
}

impl PeerRole {
    /// privilege level — lower is more privileged, matching
    /// `trustStore.ts`'s `ROLE_LEVEL` exactly.
    pub fn level(self) -> u8 {
        match self {
            PeerRole::Admin => 10,
            PeerRole::Member => 20,
            PeerRole::Viewer => 30,
        }
    }
}

/// a controller this player has paired with at some point. persisted
/// indefinitely (unlike `PlayerSession`'s ephemeral membership) — the
/// shell owns actual storage (see `tty::pairing::TrustStore`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TrustedController {
    pub node_id: String,
    pub display_name: String,
    pub role: PeerRole,
    /// unix milliseconds.
    pub paired_at: i64,
}

// ---------------------------------------------------------------------
// pairing pin. mirrors `pairing/pin.ts` exactly (6-digit numeric, never
// encoded in the qr - typed in manually as a trust-confirmation step
// after the phone dials the node id from the qr). digits only (not hex)
// so it can be typed on a phone's numeric keypad and read at couch
// distance.
// ---------------------------------------------------------------------

const PIN_LENGTH: usize = 6;
const DIGITS: &[u8] = b"0123456789";

pub fn generate_pin() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..PIN_LENGTH)
        .map(|_| DIGITS[rng.gen_range(0..DIGITS.len())] as char)
        .collect()
}

pub fn is_valid_pin_format(candidate: &str) -> bool {
    candidate.len() == PIN_LENGTH && candidate.chars().all(|c| c.is_ascii_digit())
}

// ---------------------------------------------------------------------
// player session: the singleton, ephemeral "who's allowed to send
// commands right now" session. mirrors `pairing/playerSession.ts`.
// ---------------------------------------------------------------------

/// `"everyone"`: any currently-trusted peer may send commands, no pin
/// needed. `"selected"`: only peers in `allowed_node_ids` may — starts
/// empty (closed by default) and grows from a peer redeeming the
/// session pin, or the settings ui hand-picking known peers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionMode {
    Everyone,
    Selected,
}

const SESSION_IDLE_MS: i64 = 60 * 60 * 1000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlayerSession {
    pub pin: String,
    pub mode: SessionMode,
    pub allowed_node_ids: Vec<String>,
    /// one-shot: the next successful pin redemption grants the
    /// `Admin` role regardless of the trust store already having
    /// members — set by "regenerate admin pairing code".
    pub admin_grant_pending: bool,
    /// unix milliseconds.
    pub last_active_at: i64,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl PlayerSession {
    pub fn fresh() -> Self {
        Self {
            pin: generate_pin(),
            mode: SessionMode::Selected,
            allowed_node_ids: Vec::new(),
            admin_grant_pending: false,
            last_active_at: now_ms(),
        }
    }

    /// loads (or creates, or rotates if stale for over an hour, or the
    /// persisted pin no longer matches the current format - e.g. an
    /// old hex pin left over from before the numeric-only switch)
    /// the singleton session. mirrors `ensureActiveSession` — the
    /// shell owns actual persistence, this just decides what the
    /// "current" session should be given whatever was last persisted.
    pub fn ensure_active(existing: Option<PlayerSession>) -> PlayerSession {
        match existing {
            None => Self::fresh(),
            Some(session) => {
                let stale = now_ms() - session.last_active_at > SESSION_IDLE_MS;
                let bad_format = !is_valid_pin_format(&session.pin);
                if stale || bad_format {
                    PlayerSession {
                        pin: generate_pin(),
                        allowed_node_ids: Vec::new(),
                        admin_grant_pending: false,
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
    /// membership itself — an admin always passes regardless of
    /// session mode/allowlist. omit (`None`) to check plain session
    /// membership only.
    pub fn is_peer_allowed(&self, node_id: &str, role: Option<PeerRole>) -> bool {
        role == Some(PeerRole::Admin)
            || self.mode == SessionMode::Everyone
            || self.allowed_node_ids.iter().any(|id| id == node_id)
    }

    /// records that `node_id` redeemed the session pin (or was
    /// hand-picked in settings) — adds it to the allowlist and
    /// consumes any pending one-time admin grant.
    pub fn join(&mut self, node_id: &str) {
        if !self.allowed_node_ids.iter().any(|id| id == node_id) {
            self.allowed_node_ids.push(node_id.to_string());
        }
        self.admin_grant_pending = false;
        self.touch();
    }

    /// the settings-ui counterpart to `join` — manually removes a
    /// known peer from the session's allowlist without forgetting its
    /// base trust.
    pub fn leave(&mut self, node_id: &str) {
        self.allowed_node_ids.retain(|id| id != node_id);
        self.touch();
    }

    pub fn set_mode(&mut self, mode: SessionMode) {
        self.mode = mode;
        self.touch();
    }

    /// mint a fresh one-time pin that grants `Admin` on its next
    /// redemption — for bootstrapping a first (or additional) admin
    /// without an existing one.
    pub fn regenerate_admin_pin(&mut self) {
        self.pin = generate_pin();
        self.admin_grant_pending = true;
        self.touch();
    }

    /// rotate the pin without granting admin — a plain "new code"
    /// button, distinct from the admin-bootstrap one above.
    pub fn regenerate_session_pin(&mut self) {
        self.pin = generate_pin();
        self.touch();
    }
}

// ---------------------------------------------------------------------
// pairing handshake wire schema. mirrors `pairing/protocol.ts`.
// ---------------------------------------------------------------------

/// the connecting node's identity comes from the iroh handshake itself
/// (never trust a node id supplied inside the message body).
#[derive(Debug, Clone, Deserialize)]
pub struct PairRequest {
    pub pin: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PairResponseReason {
    InvalidPin,
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
// control command protocol. mirrors `control/schema.ts`.
// ---------------------------------------------------------------------

/// a piece of media a command references — resolved (possibly fetched
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
    /// already-transcoded alternates of this video, if the pushing
    /// device already has any on hand - lets rathole pull one of these
    /// instead of the (possibly much larger) original, and skip its own
    /// redundant transcode of an already-compatible file. omitted/empty
    /// for audio, or when the source has no renditions.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub available_renditions: Vec<RenditionRef>,
}

/// see [`MediaRef::available_renditions`]'s doc comment - mirrors
/// cenotaph's `RenditionRefSchema` (`control/schema.ts`) field-for-field.
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
/// "command")]` mirrors `PlayerCommandSchema`'s `discriminatedUnion(
/// "command", ...)` exactly (field names are already snake_case on
/// the wire, matching 1:1). the real messages also carry a constant
/// `"type":"control"` envelope field, which real controllers (spume)
/// still send — deserializing here simply ignores it (unknown fields
/// aren't an error) since the top-level dispatch already peeked at
/// `"type"` to route here in the first place (see `tty::pairing`).
#[derive(Debug, Clone, Deserialize)]
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

/// a dedicated push-subscription session request — sent once as the
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

#[derive(Debug, Clone, Serialize)]
pub struct PresenceAnnouncement {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub state: PresenceState,
}

impl PresenceAnnouncement {
    pub fn new(state: PresenceState) -> Self {
        Self {
            kind: "presence",
            state,
        }
    }
}

/// what the player reports back — either in reply to a command, or
/// pushed unprompted to every subscribed stream. mirrors
/// `PlayerStatusSchema`'s `discriminatedUnion("state", ...)`; the
/// shared queue/auto_download/volume/recently_played fields are
/// factored into one struct here (`StatusCommon`) rather than
/// repeated per-variant like the zod schema does, since rust enums
/// don't support shared fields directly — flattened back onto the
/// wire so the actual JSON still matches zod's flat-object shape.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct StatusCommon {
    pub queue: Vec<MediaRef>,
    pub auto_download_enabled: bool,
    pub volume: f64,
    pub recently_played: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
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
/// field zod's schema requires — kept as a separate wrapper rather
/// than baked into every `PlayerStatus` variant, since serde's
/// internally-tagged enums don't support a shared constant field
/// directly. `#[serde(flatten)]` on a field whose type is itself an
/// internally-tagged enum is well-supported for *serialization*
/// (this type is send-only; rathole is the player, so it only ever
/// needs to emit these, never parse them back).
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandAckReason {
    Untrusted,
    InvalidCommand,
    NotInSession,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommandAck {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<CommandAckReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<PlayerStatus>,
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

/// peek at an incoming ndjson line's `"type"` field without committing
/// to a specific schema yet — mirrors the connection handler's own
/// `isPairRequestLine`/`isSubscribeRequest`/etc. string-check approach
/// in `playerConnectionHandler.ts` rather than fighting serde's nested
/// internally-tagged-enum support for a top-level envelope that mixes
/// several unrelated shapes under one `"type"` field.
pub fn peek_line_type(line: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    value
        .get("type")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
}

// ---------------------------------------------------------------------
// portable read-only snapshot for the pairing view. the real
// trust/session/connected state lives behind a shell-specific,
// possibly-thread-shared store (tty: `Arc<Mutex<...>>`, since the alpn
// handler's tasks are `Send` unlike the rest of the ratatui app) - see
// `ratcore::transport::PairingStateReader`.
// ---------------------------------------------------------------------

/// a controller currently connected on a live stream (paired +
/// actively holding a command/subscribe stream open) - distinct from
/// `TrustedController` (paired at some point, may not be connected
/// right now) and from `PlayerSession.allowed_node_ids` (in the
/// current session, may not be connected right now either).
#[derive(Debug, Clone, PartialEq)]
pub struct ConnectedControllerInfo {
    pub node_id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Default)]
pub struct PairingSnapshot {
    /// this device's own iroh node id, once the `freqhole-player/1`
    /// endpoint has started (`None` before `ensure_started()` / while
    /// it's still starting up).
    pub node_id: Option<String>,
    pub trusted_controllers: Vec<TrustedController>,
    pub session: Option<PlayerSession>,
    pub connected: Vec<ConnectedControllerInfo>,
}

// ---------------------------------------------------------------------
// pairing VIEW navigation state (portable ui state, lives on
// `EphemeralState` like `MusicState`/`VideoState`). separate from
// `PairingSnapshot` above (the live protocol data) - this is purely
// "where's the cursor / which sub-focus" bookkeeping.
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PairingViewMode {
    #[default]
    Overview,
    Settings,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PairingDownloadProgress {
    /// 0-based index of the item currently downloading within the
    /// batch this progress belongs to.
    pub item_index: usize,
    /// total number of items in the batch (queue push, or 1 for a
    /// single `play` command).
    pub item_count: usize,
    pub bytes: u64,
    /// from the `MediaRef`'s own `size_bytes` - not always known.
    pub total_bytes: Option<u64>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct PairingViewState {
    pub mode: PairingViewMode,
    /// pre-rendered qr text (unicode half-blocks) - computed by the
    /// shell once the node id is known, since `ratcore` doesn't itself
    /// depend on the `qrcode` crate (see `tty::qr::render_qr_unicode`).
    pub qr_text: Option<String>,
    pub connected_cursor: usize,
    pub settings_cursor: usize,
    /// node_id pending a "press y to confirm removal" prompt in the
    /// connected-controllers list.
    pub pending_remove_confirm: Option<String>,
    pub last_error: Option<String>,
    /// live progress for a queue push / play command currently
    /// fetching media from the controller's source peer - `None` when
    /// nothing is downloading. pushed by `tty::pairing`'s dispatch via
    /// `AppAction::PairingDownloadProgress`.
    pub download_progress: Option<PairingDownloadProgress>,
    /// true while the audio-output-device picker overlay (opened from
    /// the "audio output device" settings row) is showing.
    pub device_picker_open: bool,
    /// cursor into `MusicState::output_devices` while the picker is open.
    pub device_picker_cursor: usize,
    /// resolved local file paths for the currently-playing song's
    /// artwork, priority-ordered (see `SongRow::art_blob_ids`) - only
    /// the first is rendered today, but kept as a list so a future art
    /// carousel just rotates through it instead of re-plumbing
    /// resolution. populated by `AppAction::SongArtResolved`; cleared
    /// when the queue advances to a video entry or goes idle.
    pub art_paths: Vec<String>,
    /// framebuffer mode only: the mpv path last sent via
    /// `VideoCommand::ShowImage` for the qr/art display, so the tick
    /// loop only re-sends when it actually changes (avoids flicker/
    /// reload every tick it re-checks).
    pub framebuffer_shown_path: Option<String>,
    /// mirrors `grimoire::config::PlayerPairingConfig::enabled` -
    /// `ratcore` can't depend on grimoire directly (wasm builds don't
    /// link it), so the tty shell reads the real config once at
    /// startup and after every settings-screen toggle, and keeps this
    /// copy in sync. only used for rendering the settings row's label.
    pub autostart_enabled: bool,
    /// mirrors `grimoire::config::PlayerPairingConfig::image_mode` -
    /// same portable-mirror reasoning as `autostart_enabled`.
    pub image_mode: ImageMode,
    /// mirrors `grimoire::config::ControlSocketConfig::enabled` - same
    /// portable-mirror reasoning as `autostart_enabled`. toggling this
    /// only persists the config (takes effect on next launch, see
    /// `grimoire::config::set_control_socket_enabled`'s doc comment) -
    /// it does not live start/stop the listener.
    pub control_socket_enabled: bool,
    /// mirrors `grimoire::config::MediaConfig::transcode_video_enabled` -
    /// same portable-mirror reasoning as `autostart_enabled`. mpv (the
    /// only thing that ever plays a video here) always plays the
    /// original imported file directly, never a rendition - this only
    /// controls whether background `TranscodeVideo` jobs run at all,
    /// which exist purely to serve OTHER clients (e.g. a browser's
    /// html5 `<video>`) that can't handle the source codec/container.
    /// off is a good default on modest hardware (raspberry pi) where
    /// that background ffmpeg work can audibly compete with playback.
    pub transcode_video_enabled: bool,
}

/// portable mirror of `grimoire::config::ImageDisplayMode` - see
/// `PairingViewState::image_mode`'s doc comment for why this can't
/// just be the grimoire type directly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ImageMode {
    #[default]
    Terminal,
    Framebuffer,
}

impl PairingViewState {
    pub fn new() -> Self {
        Self::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pin_is_six_digits() {
        for _ in 0..20 {
            let pin = generate_pin();
            assert!(is_valid_pin_format(&pin), "bad pin: {pin}");
        }
    }

    #[test]
    fn rejects_malformed_pins() {
        assert!(!is_valid_pin_format("12345")); // too short
        assert!(!is_valid_pin_format("1234567")); // too long
        assert!(!is_valid_pin_format("12345g")); // non-digit
        assert!(!is_valid_pin_format("abcdef")); // hex letters no longer valid
    }

    #[test]
    fn ensure_active_creates_a_fresh_session_when_none_exists() {
        let session = PlayerSession::ensure_active(None);
        assert!(is_valid_pin_format(&session.pin));
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
        assert_ne!(rotated.pin, stale.pin);
        assert!(rotated.allowed_node_ids.is_empty());
        assert!(!rotated.admin_grant_pending);
    }

    #[test]
    fn ensure_active_rotates_a_legacy_hex_pin() {
        // simulates a session persisted before the hex -> numeric pin switch.
        let mut legacy = PlayerSession::fresh();
        legacy.pin = "0b3b50".to_string();
        let rotated = PlayerSession::ensure_active(Some(legacy.clone()));
        assert_ne!(rotated.pin, legacy.pin);
        assert!(is_valid_pin_format(&rotated.pin));
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
    fn regenerate_admin_pin_sets_pending_grant_and_rotates_pin() {
        let mut session = PlayerSession::fresh();
        let old_pin = session.pin.clone();
        session.regenerate_admin_pin();
        assert_ne!(session.pin, old_pin);
        assert!(session.admin_grant_pending);
    }

    #[test]
    fn join_consumes_pending_admin_grant() {
        let mut session = PlayerSession::fresh();
        session.regenerate_admin_pin();
        session.join("peer-a");
        assert!(!session.admin_grant_pending);
    }

    #[test]
    fn role_levels_match_grimoire_convention() {
        assert!(PeerRole::Admin.level() < PeerRole::Member.level());
        assert!(PeerRole::Member.level() < PeerRole::Viewer.level());
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

        let err = serde_json::to_value(PairResponse::err(PairResponseReason::InvalidPin)).unwrap();
        assert_eq!(err["reason"], "invalid_pin");
    }

    #[test]
    fn pair_request_deserializes_ignoring_the_type_field() {
        let line = r#"{"type":"pair_request","pin":"abc123","display_name":"phone"}"#;
        let req: PairRequest = serde_json::from_str(line).expect("should parse");
        assert_eq!(req.pin, "abc123");
        assert_eq!(req.display_name, "phone");
    }
}
