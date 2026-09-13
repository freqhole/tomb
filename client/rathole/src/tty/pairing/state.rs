//! shared runtime state — read directly by the ui (a quick lock, never
//! held across an await) and read+written by the alpn handler's
//! `tokio::spawn`'d tasks (which must be `Send`, unlike the
//! `LocalSet`-bound `App`/`EphemeralState`).
//!
//! trust itself (which node_ids are paired, and with what role) lives
//! entirely in grimoire (`UserPeerNode`/`InviteCode`, backed by
//! haruspex's durable sqlite storage) — the same mechanism CLI's
//! `allow_peer` and every other "is this node_id trusted" check in the
//! codebase already uses. this module used to keep its own separate,
//! non-durable `Vec<TrustedController>` here; that's gone. what
//! remains here is genuinely ephemeral/display-only: the currently
//! connected-live controllers, the current session's mode/allowlist,
//! and a cached mirror of the current pairing code (a real grimoire
//! `InviteCode`) for the ui to render without awaiting grimoire on
//! every redraw.

use std::sync::{Arc, Mutex};

use grimoire::users::{UserRole, UserService};

use crate::ratcore::app::{
    pairing as portable, ConnectedControllerInfo, PairingCode, PairingSnapshot, PeerRole,
    PersistedState, PlayerSession,
};
use crate::ratcore::transport::PairingStateReader;

/// maps grimoire's 4-level role onto rathole's 3-level `PeerRole` -
/// `Root` has no direct equivalent here, so it's treated as `Admin`
/// (the closest/highest rathole-native level).
fn user_role_to_peer_role(role: UserRole) -> PeerRole {
    match role {
        UserRole::Root | UserRole::Admin => PeerRole::Admin,
        UserRole::Member => PeerRole::Member,
        UserRole::Viewer => PeerRole::Viewer,
    }
}

#[derive(Debug, Clone, Default)]
pub struct PairingRuntimeState {
    pub node_id: Option<String>,
    /// mirrors the real grimoire `InviteCode` this player is currently
    /// displaying for pairing - refreshed by `ensure_current_pairing_code`.
    pub current_code: Option<PairingCode>,
    pub session: Option<PlayerSession>,
    pub connected: Vec<ConnectedControllerInfo>,
}

pub type SharedPairingState = Arc<Mutex<PairingRuntimeState>>;

pub fn load_pairing_state(persisted: &PersistedState) -> SharedPairingState {
    // ensure a session exists up front rather than lazily on first
    // mutation/pair attempt - otherwise `is_peer_allowed`/settings-ui
    // toggles have nothing to touch until a client happens to trigger
    // `ensure_active` first.
    let session = Some(PlayerSession::ensure_active(
        persisted.player_session.clone(),
    ));
    Arc::new(Mutex::new(PairingRuntimeState {
        node_id: None,
        current_code: None,
        session,
        connected: Vec::new(),
    }))
}

/// call before saving the statefile so session changes made by the
/// alpn handler (a different set of tasks than the one that owns
/// `PersistedState`) aren't lost. trust itself no longer round-trips
/// through here at all - grimoire's own sqlite writes are already
/// durable per-transaction, which is what fixed the original bug this
/// used to work around (see docs/rathole-pairing-invite-code-plan.md).
pub fn sync_pairing_state_to_persisted(persisted: &mut PersistedState, state: &SharedPairingState) {
    let guard = state.lock().unwrap_or_else(|p| p.into_inner());
    persisted.player_session = guard.session.clone();
    persisted.current_pairing_code_hint = guard.current_code.as_ref().map(|c| c.code.clone());
}

pub(super) fn mark_connected(state: &SharedPairingState, info: ConnectedControllerInfo) {
    let mut guard = state.lock().unwrap_or_else(|p| p.into_inner());
    guard.connected.retain(|c| c.node_id != info.node_id);
    guard.connected.push(info);
}

pub(super) fn mark_disconnected(state: &SharedPairingState, node_id: &str) {
    let mut guard = state.lock().unwrap_or_else(|p| p.into_inner());
    guard.connected.retain(|c| c.node_id != node_id);
}

/// ensures `state.current_code` reflects a real, currently-valid
/// grimoire invite code: reuses `hint` (the code string last persisted,
/// see `PersistedState::current_pairing_code_hint`) if grimoire still
/// reports it valid, otherwise mints a fresh one. the very first code
/// this player ever generates grants `Admin` (single-use - bootstraps
/// the first paired device); every one after that grants `Member`
/// (unlimited-while-active - the common household-pairing case).
/// called once at startup (see `tty::run`) and again any time the
/// displayed code needs re-validating.
pub async fn ensure_current_pairing_code(state: &SharedPairingState, hint: Option<String>) {
    let service = UserService::new();

    if let Some(code) = &hint {
        let resp = service.check_invite_code(code).await;
        if let Some(invite) = resp.data.filter(|_| resp.success) {
            let mut guard = state.lock().unwrap_or_else(|p| p.into_inner());
            guard.current_code = Some(PairingCode {
                code: invite.code,
                grants_role: user_role_to_peer_role(invite.grants_role),
            });
            return;
        }
    }

    let has_peers = service.has_peer_nodes().await;
    let (role, max_uses) = if has_peers {
        (UserRole::Member, 0) // 0 = unlimited while active
    } else {
        (UserRole::Admin, 1) // bootstrap: exactly one admin redemption
    };
    let resp = service.create_player_pairing_code(role, max_uses, 6).await;
    if let Some(invite) = resp.data.filter(|_| resp.success) {
        let mut guard = state.lock().unwrap_or_else(|p| p.into_inner());
        guard.current_code = Some(PairingCode {
            code: invite.code,
            grants_role: user_role_to_peer_role(role),
        });
    } else {
        tracing::warn!(
            target: "player_protocol",
            message = %resp.message,
            "failed to generate a player-pairing invite code"
        );
    }
}

/// thin `PairingStateReader` impl wrapping the shared mutex, so `App`
/// can hold it as `Rc<dyn PairingStateReader>` (ratcore's portable
/// trait) without ratcore itself knowing about `Arc<Mutex<...>>` or
/// grimoire.
pub struct PairingStateHandle(pub SharedPairingState);

impl PairingStateReader for PairingStateHandle {
    fn snapshot(&self) -> PairingSnapshot {
        let guard = self.0.lock().unwrap_or_else(|p| p.into_inner());
        PairingSnapshot {
            node_id: guard.node_id.clone(),
            current_code: guard.current_code.clone(),
            session: guard.session.clone(),
            connected: guard.connected.clone(),
        }
    }

    fn set_session_mode(&self, mode: portable::SessionMode) {
        let mut guard = self.0.lock().unwrap_or_else(|p| p.into_inner());
        let mut session = PlayerSession::ensure_active(guard.session.take());
        session.set_mode(mode);
        guard.session = Some(session);
    }

    /// mints a fresh, single-use, `Admin`-granting grimoire invite code,
    /// for bootstrapping a first (or additional) admin. runs as a
    /// spawned task (the trait itself must stay synchronous, see
    /// `PairingStateReader`'s own doc comment) - same "fire off an
    /// async task that updates the shared state when done" pattern
    /// `PairingRuntime::ensure_started` already uses.
    fn regenerate_admin_pin(&self) {
        let state = self.0.clone();
        tokio::task::spawn_local(async move {
            let service = UserService::new();
            let resp = service
                .create_player_pairing_code(UserRole::Admin, 1, 6)
                .await;
            match resp.data.filter(|_| resp.success) {
                Some(invite) => {
                    let mut guard = state.lock().unwrap_or_else(|p| p.into_inner());
                    guard.current_code = Some(PairingCode {
                        code: invite.code,
                        grants_role: PeerRole::Admin,
                    });
                }
                None => {
                    tracing::warn!(target: "player_protocol", message = %resp.message, "failed to generate admin pairing code")
                }
            }
        });
    }

    /// mints a fresh, unlimited-while-active, `Member`-granting
    /// grimoire invite code - the plain "new code" button, distinct
    /// from the admin-bootstrap one above.
    fn regenerate_session_pin(&self) {
        let state = self.0.clone();
        tokio::task::spawn_local(async move {
            let service = UserService::new();
            let resp = service
                .create_player_pairing_code(UserRole::Member, 0, 6)
                .await;
            match resp.data.filter(|_| resp.success) {
                Some(invite) => {
                    let mut guard = state.lock().unwrap_or_else(|p| p.into_inner());
                    guard.current_code = Some(PairingCode {
                        code: invite.code,
                        grants_role: PeerRole::Member,
                    });
                }
                None => {
                    tracing::warn!(target: "player_protocol", message = %resp.message, "failed to generate session pairing code")
                }
            }
        });
    }

    /// removes `node_id` from the current session's allowlist AND
    /// revokes its grimoire trust outright - "remove" in the ui means
    /// "this device can no longer control me", not just "leave the
    /// current ephemeral session".
    fn remove_controller(&self, node_id: &str) {
        {
            let mut guard = self.0.lock().unwrap_or_else(|p| p.into_inner());
            if let Some(mut session) = guard.session.take() {
                session.leave(node_id);
                guard.session = Some(session);
            }
        }
        let node_id = node_id.to_string();
        tokio::task::spawn_local(async move {
            let service = UserService::new();
            if let Some(user) = service.get_user_by_peer_node_id(&node_id).await.data {
                let _ = service.remove_peer_node(&user.id, &node_id).await;
            }
        });
    }
}
