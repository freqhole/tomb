//! translation shim between rathole's portable (wasm+tty shared)
//! `ratcore::app::pairing` wire-mirror types and `grimoire::cenotaph`'s
//! own copy of the same shapes (see `grimoire::cenotaph::wire`'s module
//! doc for why these can't just be the same type - grimoire isn't
//! wasm32-compatible, but `ratcore::app::pairing` is compiled for
//! rathole's web shell too).
//!
//! the actual runtime state (trust/session/connected controllers) now
//! lives in `grimoire::cenotaph::state` - this module just converts at
//! the boundary so rathole's ratatui ui (which only knows about
//! `ratcore`'s own portable types via `PairingStateReader`) can keep
//! working unchanged.

use crate::ratcore::app::{
    pairing as portable, ConnectedControllerInfo, PairingCode, PairingSnapshot, PeerRole,
    PersistedState, PlayerSession,
};
use crate::ratcore::transport::PairingStateReader;

pub use grimoire::cenotaph::SharedPairingState;

fn to_grimoire_mode(mode: portable::SessionMode) -> grimoire::cenotaph::SessionMode {
    match mode {
        portable::SessionMode::Everyone => grimoire::cenotaph::SessionMode::Everyone,
        portable::SessionMode::Selected => grimoire::cenotaph::SessionMode::Selected,
    }
}

fn from_grimoire_mode(mode: grimoire::cenotaph::SessionMode) -> portable::SessionMode {
    match mode {
        grimoire::cenotaph::SessionMode::Everyone => portable::SessionMode::Everyone,
        grimoire::cenotaph::SessionMode::Selected => portable::SessionMode::Selected,
    }
}

fn from_grimoire_role(role: grimoire::cenotaph::PeerRole) -> PeerRole {
    match role {
        grimoire::cenotaph::PeerRole::Admin => PeerRole::Admin,
        grimoire::cenotaph::PeerRole::Member => PeerRole::Member,
        grimoire::cenotaph::PeerRole::Viewer => PeerRole::Viewer,
    }
}

fn to_grimoire_session(session: PlayerSession) -> grimoire::cenotaph::PlayerSession {
    grimoire::cenotaph::PlayerSession {
        mode: to_grimoire_mode(session.mode),
        allowed_node_ids: session.allowed_node_ids,
        last_active_at: session.last_active_at,
    }
}

fn from_grimoire_session(session: grimoire::cenotaph::PlayerSession) -> PlayerSession {
    PlayerSession {
        mode: from_grimoire_mode(session.mode),
        allowed_node_ids: session.allowed_node_ids,
        last_active_at: session.last_active_at,
    }
}

fn from_grimoire_code(code: grimoire::cenotaph::PairingCode) -> PairingCode {
    PairingCode {
        code: code.code,
        grants_role: from_grimoire_role(code.grants_role),
    }
}

fn from_grimoire_connected(
    info: grimoire::cenotaph::ConnectedControllerInfo,
) -> ConnectedControllerInfo {
    ConnectedControllerInfo {
        node_id: info.node_id,
        display_name: info.display_name,
    }
}

/// builds a fresh shared state, seeding the session from whatever was
/// last persisted in the statefile (if anything).
pub fn load_pairing_state(persisted: &PersistedState) -> SharedPairingState {
    let session = persisted.player_session.clone().map(to_grimoire_session);
    grimoire::cenotaph::state::new_shared_state(session)
}

/// call before saving the statefile so session changes made by the alpn
/// handler are reflected. trust itself no longer round-trips through
/// here at all - grimoire's own sqlite writes are already durable
/// per-transaction.
pub fn sync_pairing_state_to_persisted(persisted: &mut PersistedState, state: &SharedPairingState) {
    let snap = grimoire::cenotaph::state::snapshot(state);
    persisted.player_session = snap.session.map(from_grimoire_session);
    persisted.current_pairing_code_hint = snap.current_code.map(|c| c.code);
}

/// thin `PairingStateReader` impl wrapping the shared state, so `App`
/// can hold it as `Rc<dyn PairingStateReader>` (ratcore's portable
/// trait) without ratcore itself knowing about grimoire.
pub struct PairingStateHandle(pub SharedPairingState);

impl PairingStateReader for PairingStateHandle {
    fn snapshot(&self) -> PairingSnapshot {
        let snap = grimoire::cenotaph::state::snapshot(&self.0);
        PairingSnapshot {
            node_id: snap.node_id,
            current_code: snap.current_code.map(from_grimoire_code),
            session: snap.session.map(from_grimoire_session),
            connected: snap
                .connected
                .into_iter()
                .map(from_grimoire_connected)
                .collect(),
        }
    }

    fn set_session_mode(&self, mode: portable::SessionMode) {
        grimoire::cenotaph::state::set_session_mode(&self.0, to_grimoire_mode(mode));
    }

    /// mints a fresh, single-use, `Admin`-granting grimoire invite code,
    /// for bootstrapping a first (or additional) admin. runs as a
    /// spawned task (the trait itself must stay synchronous, see
    /// `PairingStateReader`'s own doc comment).
    fn regenerate_admin_pin(&self) {
        let state = self.0.clone();
        tokio::task::spawn_local(async move {
            grimoire::cenotaph::state::regenerate_admin_pin(&state).await;
        });
    }

    /// mints a fresh, unlimited-while-active, `Member`-granting grimoire
    /// invite code - the plain "new code" button, distinct from the
    /// admin-bootstrap one above.
    fn regenerate_session_pin(&self) {
        let state = self.0.clone();
        tokio::task::spawn_local(async move {
            grimoire::cenotaph::state::regenerate_session_pin(&state).await;
        });
    }

    /// removes `node_id` from the current session's allowlist AND
    /// revokes its grimoire trust outright - "remove" in the ui means
    /// "this device can no longer control me", not just "leave the
    /// current ephemeral session".
    fn remove_controller(&self, node_id: &str) {
        let state = self.0.clone();
        let node_id = node_id.to_string();
        tokio::task::spawn_local(async move {
            grimoire::cenotaph::state::remove_controller(&state, &node_id).await;
        });
    }
}
