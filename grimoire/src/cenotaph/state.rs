//! shared runtime state for a `freqhole-player/1` accept-side endpoint -
//! read directly by a consumer's own UI/settings surface, and
//! read+written by the endpoint's accept-loop tasks (which must be
//! `Send`).
//!
//! trust itself (which node_ids are paired, and with what role) lives
//! entirely in `crate::users` (`UserPeerNode`/`InviteCode`, backed by
//! haruspex's durable sqlite storage) - the same mechanism every other
//! "is this node_id trusted" check in the codebase already uses. what
//! lives here is genuinely ephemeral/display-only: the currently
//! connected-live controllers, the current session's mode/allowlist, and
//! a cached mirror of the current pairing code for a UI to render
//! without awaiting a query on every redraw.

use std::sync::{Arc, Mutex};

use tracing::warn;

use super::wire::{
    user_role_to_peer_role, ConnectedControllerInfo, PairingCode, PairingSnapshot, PeerRole,
    PlayerSession, SessionMode,
};
use crate::users::{UserRole, UserService};

#[derive(Debug, Clone, Default)]
pub struct PairingRuntimeState {
    pub node_id: Option<String>,
    /// mirrors the real grimoire `InviteCode` a player is currently
    /// displaying for pairing - refreshed by `ensure_current_pairing_code`.
    pub current_code: Option<PairingCode>,
    pub session: Option<PlayerSession>,
    pub connected: Vec<ConnectedControllerInfo>,
}

pub type SharedPairingState = Arc<Mutex<PairingRuntimeState>>;

/// builds a fresh shared state, seeding the session from `persisted`
/// (whatever a consumer last saved, if anything) - a session is ensured
/// up front rather than lazily on first mutation, so settings-ui
/// toggles/`is_peer_allowed` checks always have something to touch.
pub fn new_shared_state(persisted_session: Option<PlayerSession>) -> SharedPairingState {
    let session = Some(PlayerSession::ensure_active(persisted_session));
    Arc::new(Mutex::new(PairingRuntimeState {
        node_id: None,
        current_code: None,
        session,
        connected: Vec::new(),
    }))
}

/// a plain, cloned snapshot of the current state - consumers build their
/// own display model from this.
pub fn snapshot(state: &SharedPairingState) -> PairingSnapshot {
    let guard = state.lock().unwrap_or_else(|p| p.into_inner());
    PairingSnapshot {
        node_id: guard.node_id.clone(),
        current_code: guard.current_code.clone(),
        session: guard.session.clone(),
        connected: guard.connected.clone(),
    }
}

pub fn mark_connected(state: &SharedPairingState, info: ConnectedControllerInfo) {
    let mut guard = state.lock().unwrap_or_else(|p| p.into_inner());
    guard.connected.retain(|c| c.node_id != info.node_id);
    guard.connected.push(info);
}

pub fn mark_disconnected(state: &SharedPairingState, node_id: &str) {
    let mut guard = state.lock().unwrap_or_else(|p| p.into_inner());
    guard.connected.retain(|c| c.node_id != node_id);
}

/// ensures `state.current_code` reflects a real, currently-valid grimoire
/// invite code: reuses `hint` (the code string last persisted by the
/// caller) if grimoire still reports it valid, otherwise mints a fresh
/// one. the very first code a player ever generates grants `Admin`
/// (single-use - bootstraps the first paired device); every one after
/// that grants `Member` (unlimited-while-active - the common
/// household-pairing case).
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
        warn!(
            target: "cenotaph",
            message = %resp.message,
            "failed to generate a player-pairing invite code"
        );
    }
}

pub fn set_session_mode(state: &SharedPairingState, mode: SessionMode) {
    let mut guard = state.lock().unwrap_or_else(|p| p.into_inner());
    let mut session = PlayerSession::ensure_active(guard.session.take());
    session.set_mode(mode);
    guard.session = Some(session);
}

/// mints a fresh, single-use, `Admin`-granting grimoire invite code, for
/// bootstrapping a first (or additional) admin.
pub async fn regenerate_admin_pin(state: &SharedPairingState) {
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
            warn!(target: "cenotaph", message = %resp.message, "failed to generate admin pairing code")
        }
    }
}

/// mints a fresh, unlimited-while-active, `Member`-granting grimoire
/// invite code - the plain "new code" button, distinct from the
/// admin-bootstrap one above.
pub async fn regenerate_session_pin(state: &SharedPairingState) {
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
            warn!(target: "cenotaph", message = %resp.message, "failed to generate session pairing code")
        }
    }
}

/// removes `node_id` from the current session's allowlist AND revokes
/// its grimoire trust outright - "remove" means "this device can no
/// longer control me", not just "leave the current ephemeral session".
pub async fn remove_controller(state: &SharedPairingState, node_id: &str) {
    {
        let mut guard = state.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(mut session) = guard.session.take() {
            session.leave(node_id);
            guard.session = Some(session);
        }
    }
    let service = UserService::new();
    if let Some(user) = service.get_user_by_peer_node_id(node_id).await.data {
        let _ = service.remove_peer_node(&user.id, node_id).await;
    }
}
