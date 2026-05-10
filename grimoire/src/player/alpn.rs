//! `freqhole-player/1` ALPN — remote control surface for a
//! supervised audio player.
//!
//! design: a single bi-directional iroh stream per connection.
//!
//! - **client → host**: a sequence of length-prefixed json
//!   [`PlayerCommand`] frames.
//! - **host → client**: a sequence of length-prefixed json
//!   [`PlayerEvent`] frames, broadcast from the supervised player
//!   the host owns.
//!
//! framing: `[u32 BE len][len bytes utf-8 json]` per frame, identical
//! to `freqhole-radio/1`'s control framing so we can lift those
//! helpers later if useful.
//!
//! gating (admin-only, opt-in):
//!
//! 1. `[remote_player].enabled = true` in `[federation]`
//! 2. peer node_id resolves to a User with `role == Admin`
//! 3. if `[remote_player].allowed_node_ids` is non-empty, peer must
//!    be listed
//!
//! this protocol is intentionally admin-only because it drives the
//! host's actual audio output device. anyone who can hit this ALPN
//! can make sounds come out of someone else's speakers.

use std::sync::Arc;

use iroh::endpoint::{Connection, RecvStream, SendStream};
use iroh::protocol::{AcceptError, ProtocolHandler};
use iroh::PublicKey;
use tokio::sync::broadcast;
use tracing::{debug, info, warn};

use crate::config::get_config;
use crate::error::{ErrorDetail, GrimoireError, GrimoireResult};
use crate::offal::Caller;
use crate::player::control::{PlayerCommand, PlayerEvent};
use crate::player::PlayerController;
use crate::users::UserService;

/// ALPN identifier.
pub const PLAYER_ALPN: &[u8] = b"freqhole-player/1";

/// hard cap on a single command/event frame; matches the default
/// [`crate::config::RemotePlayerConfig::max_message_size_bytes`] but
/// also enforced inline so a malformed peer can't make us allocate
/// gigabytes before config consultation.
const HARD_FRAME_CAP_BYTES: u32 = 4 * 1024 * 1024;

/// protocol handler. clone freely — the inner controller is `Arc`-
/// shared, so every accepted connection drives the same supervised
/// player.
#[derive(Clone)]
pub struct PlayerProtocol {
    controller: Arc<dyn PlayerController>,
}

impl PlayerProtocol {
    pub fn new(controller: Arc<dyn PlayerController>) -> Self {
        Self { controller }
    }
}

impl std::fmt::Debug for PlayerProtocol {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PlayerProtocol").finish_non_exhaustive()
    }
}

impl ProtocolHandler for PlayerProtocol {
    async fn accept(&self, conn: Connection) -> std::result::Result<(), AcceptError> {
        let peer_id = conn.remote_id();
        debug!("[player-p2p] accepted incoming connection from {peer_id}");
        handle_incoming(peer_id, conn, self.controller.clone()).await;
        Ok(())
    }

    async fn shutdown(&self) {
        info!("[player-p2p] shutting down");
    }
}

/// authenticate a peer + drive its single bi-stream.
async fn handle_incoming(
    peer_node_id: PublicKey,
    conn: Connection,
    controller: Arc<dyn PlayerController>,
) {
    let node_id_str = peer_node_id.to_string();
    let node_id_short = node_id_str.get(..16).unwrap_or(&node_id_str).to_string();

    // gate 1: feature must be enabled
    let player_cfg = match get_config()
        .federation
        .as_ref()
        .and_then(|f| f.remote_player.clone())
    {
        Some(cfg) if cfg.enabled => cfg,
        _ => {
            warn!(
                "[player-p2p] rejecting {}: remote_player disabled",
                node_id_short
            );
            conn.close(1u32.into(), b"remote_player disabled");
            return;
        }
    };

    // gate 2: peer must resolve to an admin user
    let caller = match resolve_admin_caller(&node_id_str).await {
        Some(c) => c,
        None => {
            warn!(
                "[player-p2p] rejecting {}: peer is not a registered admin",
                node_id_short
            );
            conn.close(2u32.into(), b"unauthorized");
            return;
        }
    };

    // gate 3: optional explicit allowlist
    if !player_cfg.is_allowed_node(&node_id_str) {
        warn!(
            "[player-p2p] rejecting {}: not in allowed_node_ids",
            node_id_short
        );
        conn.close(3u32.into(), b"node not allowed");
        return;
    }

    info!(
        "[player-p2p] accepted connection from {} (user={})",
        node_id_short, caller.username
    );

    let max_size = player_cfg.max_message_size_bytes();
    let cap = (max_size as u32).min(HARD_FRAME_CAP_BYTES);

    // we expect the client to open one bi-stream per connection.
    // accept exactly the first one, then loop on it. if the client
    // opens more, accept those too — each gets its own task.
    loop {
        match conn.accept_bi().await {
            Ok((send, recv)) => {
                let controller = controller.clone();
                let node_id_short = node_id_short.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_stream(send, recv, controller, &node_id_short, cap).await
                    {
                        warn!("[player-p2p] stream from {node_id_short} ended: {e}");
                    }
                });
            }
            Err(e) => {
                debug!("[player-p2p] connection from {node_id_short} closed: {e}");
                break;
            }
        }
    }
}

/// drive one bi-stream: forward incoming commands, stream outgoing
/// events. returns when either direction closes.
async fn handle_stream(
    mut send: SendStream,
    mut recv: RecvStream,
    controller: Arc<dyn PlayerController>,
    node_id_short: &str,
    max_frame_bytes: u32,
) -> Result<(), String> {
    let mut events_rx = controller.subscribe();

    // run command-reader and event-writer concurrently. either side
    // exiting takes the whole stream down.
    let cmd_task = {
        let controller = controller.clone();
        let node_id_short = node_id_short.to_string();
        async move {
            loop {
                match read_frame::<PlayerCommand>(&mut recv, max_frame_bytes).await {
                    Ok(Some(cmd)) => {
                        if let Err(e) = controller.send(cmd).await {
                            warn!("[player-p2p] {node_id_short} send failed: {e}");
                            return Err::<(), String>(format!("controller send failed: {e}"));
                        }
                    }
                    Ok(None) => {
                        debug!("[player-p2p] {node_id_short} clean recv eof");
                        return Ok(());
                    }
                    Err(e) => {
                        return Err(format!("recv error: {e}"));
                    }
                }
            }
        }
    };

    let event_task = async move {
        loop {
            match events_rx.recv().await {
                Ok(ev) => {
                    if let Err(e) = write_frame(&mut send, &ev).await {
                        return Err::<(), String>(format!("write event failed: {e}"));
                    }
                }
                Err(broadcast::error::RecvError::Closed) => {
                    let _ = send.finish();
                    return Ok(());
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    // signal the lag to the client as a structured
                    // error event so it can resync via `Status`.
                    let ev = PlayerEvent::Error {
                        detail: ErrorDetail::new(
                            "event_stream_lagged",
                            "Event Stream Lagged",
                            format!("dropped {n} events; please request status to resync"),
                        ),
                    };
                    if let Err(e) = write_frame(&mut send, &ev).await {
                        return Err(format!("write lag notice failed: {e}"));
                    }
                }
            }
        }
    };

    tokio::select! {
        r = cmd_task => r,
        r = event_task => r,
    }
}

/// resolve a peer node id to an admin caller, or return None.
async fn resolve_admin_caller(node_id: &str) -> Option<Caller> {
    let service = UserService::new();
    match service.get_user_by_peer_node_id(node_id).await {
        crate::response::GrimoireResponse {
            success: true,
            data: Some(user),
            ..
        } if user.role.is_admin() => Some(Caller::new(&user.id, &user.username, user.role)),
        _ => None,
    }
}

/// length-prefixed json frame writer.
pub async fn write_frame<T: serde::Serialize>(
    stream: &mut SendStream,
    msg: &T,
) -> GrimoireResult<()> {
    let body = serde_json::to_vec(msg).map_err(|e| GrimoireError::ProcessingFailed {
        message: format!("player-p2p: serialize failed: {e}"),
    })?;
    let len = body.len() as u32;
    if len > HARD_FRAME_CAP_BYTES {
        return Err(GrimoireError::ProcessingFailed {
            message: format!(
                "player-p2p: outgoing frame too large: {len} > {HARD_FRAME_CAP_BYTES}"
            ),
        });
    }
    stream
        .write_all(&len.to_be_bytes())
        .await
        .map_err(|e| GrimoireError::FederationApiError {
            message: format!("player-p2p: write len failed: {e}"),
        })?;
    stream
        .write_all(&body)
        .await
        .map_err(|e| GrimoireError::FederationApiError {
            message: format!("player-p2p: write body failed: {e}"),
        })?;
    Ok(())
}

/// length-prefixed json frame reader. returns `Ok(None)` on a clean
/// EOF between frames.
pub async fn read_frame<T: serde::de::DeserializeOwned>(
    stream: &mut RecvStream,
    max_bytes: u32,
) -> GrimoireResult<Option<T>> {
    let mut header = [0u8; 4];
    match stream.read_exact(&mut header).await {
        Ok(_) => {}
        Err(e) => {
            let s = e.to_string();
            if s.contains("finished") || s.contains("closed") || s.contains("eof") {
                return Ok(None);
            }
            return Err(GrimoireError::FederationApiError {
                message: format!("player-p2p: read len failed: {e}"),
            });
        }
    }
    let len = u32::from_be_bytes(header);
    if len > max_bytes {
        return Err(GrimoireError::FederationApiError {
            message: format!("player-p2p: incoming frame too large: {len} > {max_bytes}"),
        });
    }
    let mut body = vec![0u8; len as usize];
    stream
        .read_exact(&mut body)
        .await
        .map_err(|e| GrimoireError::FederationApiError {
            message: format!("player-p2p: read body ({len} bytes) failed: {e}"),
        })?;
    let msg = serde_json::from_slice(&body).map_err(|e| GrimoireError::ProcessingFailed {
        message: format!("player-p2p: parse failed: {e}"),
    })?;
    Ok(Some(msg))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// minimal sanity: framing roundtrips over an in-memory buffer
    /// stand-in. iroh streams aren't easy to mock, so we use raw
    /// `tokio::io::duplex` and re-implement the same length-prefix
    /// loop that `read_frame`/`write_frame` use.
    #[tokio::test]
    async fn frame_roundtrip_via_duplex() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let (mut a, mut b) = tokio::io::duplex(4096);

        // write "two events"
        let ev = PlayerEvent::BackendUp;
        let body = serde_json::to_vec(&ev).unwrap();
        a.write_all(&(body.len() as u32).to_be_bytes())
            .await
            .unwrap();
        a.write_all(&body).await.unwrap();
        a.write_all(&(body.len() as u32).to_be_bytes())
            .await
            .unwrap();
        a.write_all(&body).await.unwrap();
        a.shutdown().await.unwrap();

        // mirror of read_frame against a generic AsyncRead
        for _ in 0..2 {
            let mut header = [0u8; 4];
            b.read_exact(&mut header).await.unwrap();
            let len = u32::from_be_bytes(header) as usize;
            let mut buf = vec![0u8; len];
            b.read_exact(&mut buf).await.unwrap();
            let parsed: PlayerEvent = serde_json::from_slice(&buf).unwrap();
            assert!(matches!(parsed, PlayerEvent::BackendUp));
        }
    }
}
