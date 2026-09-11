//! shared runtime state — read directly by the ui (a quick lock, never
//! held across an await) and read+written by the alpn handler's
//! `tokio::spawn`'d tasks (which must be `Send`, unlike the
//! `LocalSet`-bound `App`/`EphemeralState`).

use std::sync::{Arc, Mutex};

use crate::ratcore::app::{
    pairing as portable, ConnectedControllerInfo, PairingSnapshot, PersistedState, PlayerSession,
    TrustedController,
};
use crate::ratcore::transport::PairingStateReader;

#[derive(Debug, Clone, Default)]
pub struct PairingRuntimeState {
    pub node_id: Option<String>,
    pub trusted_controllers: Vec<TrustedController>,
    pub session: Option<PlayerSession>,
    pub connected: Vec<ConnectedControllerInfo>,
}

pub type SharedPairingState = Arc<Mutex<PairingRuntimeState>>;

pub fn load_pairing_state(persisted: &PersistedState) -> SharedPairingState {
    // ensure a session (and its pin) exists up front rather than lazily on
    // first mutation/pair attempt - otherwise the pairing screen has no pin
    // to show until someone regenerates one in settings or a client happens
    // to trigger `ensure_active` first, which is a dead end for a brand new
    // device (see docs/rathole-headless-player-plan.md phase 4 UI notes).
    let session = Some(PlayerSession::ensure_active(
        persisted.player_session.clone(),
    ));
    Arc::new(Mutex::new(PairingRuntimeState {
        node_id: None,
        trusted_controllers: persisted.trusted_controllers.clone(),
        session,
        connected: Vec::new(),
    }))
}

/// call before saving the statefile so trust/session changes made by
/// the alpn handler (a different set of tasks than the one that owns
/// `PersistedState`) aren't lost.
pub fn sync_pairing_state_to_persisted(persisted: &mut PersistedState, state: &SharedPairingState) {
    let guard = state.lock().unwrap_or_else(|p| p.into_inner());
    persisted.trusted_controllers = guard.trusted_controllers.clone();
    persisted.player_session = guard.session.clone();
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

/// thin `PairingStateReader` impl wrapping the shared mutex, so `App`
/// can hold it as `Rc<dyn PairingStateReader>` (ratcore's portable
/// trait) without ratcore itself knowing about `Arc<Mutex<...>>`.
pub struct PairingStateHandle(pub SharedPairingState);

impl PairingStateReader for PairingStateHandle {
    fn snapshot(&self) -> PairingSnapshot {
        let guard = self.0.lock().unwrap_or_else(|p| p.into_inner());
        PairingSnapshot {
            node_id: guard.node_id.clone(),
            trusted_controllers: guard.trusted_controllers.clone(),
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

    fn regenerate_admin_pin(&self) {
        let mut guard = self.0.lock().unwrap_or_else(|p| p.into_inner());
        let mut session = PlayerSession::ensure_active(guard.session.take());
        session.regenerate_admin_pin();
        guard.session = Some(session);
    }

    fn regenerate_session_pin(&self) {
        let mut guard = self.0.lock().unwrap_or_else(|p| p.into_inner());
        let mut session = PlayerSession::ensure_active(guard.session.take());
        session.regenerate_session_pin();
        guard.session = Some(session);
    }

    fn remove_controller(&self, node_id: &str) {
        let mut guard = self.0.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(mut session) = guard.session.take() {
            session.leave(node_id);
            guard.session = Some(session);
        }
    }
}
