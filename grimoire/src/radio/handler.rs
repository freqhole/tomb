//! per-connection radio handler — drives the encoder loop and pushes chunks.
//!
//! phase 0: one inbound connection = one ffmpeg pipeline = one listener.
//! phase 1 will replace this with a `subscribe(broadcaster)` loop so many
//! listeners share a single encoder.

use crate::error::GrimoireResult;
use crate::radio::encoder::Encoder;
use crate::radio::playlist::pick_random_song;
use crate::radio::protocol::write_chunk;
use iroh::endpoint::Connection;
use tracing::{info, warn};

/// run the radio loop on a freshly-accepted connection until the peer
/// disconnects or an error occurs.
///
/// errors during chunk write usually mean the peer went away — we log and
/// return; the iroh Router will tear down the connection.
pub async fn handle_connection(conn: Connection) {
    let peer_id = conn.remote_id();
    info!("[radio-handler] new listener: {peer_id}");

    if let Err(e) = run_loop(&conn).await {
        warn!("[radio-handler] listener {peer_id} disconnected: {e}");
    }

    info!("[radio-handler] listener gone: {peer_id}");
}

async fn run_loop(conn: &Connection) -> GrimoireResult<()> {
    // open the audio uni stream once; reuse it across track transitions so
    // MSE sees the new init segment as part of the same logical stream.
    let mut send = conn.open_uni().await.map_err(|e| {
        crate::error::GrimoireError::FederationApiError {
            message: format!("radio: failed to open uni stream: {e}"),
        }
    })?;

    loop {
        let track = pick_random_song().await?;
        info!("[radio-handler] now playing: {} ({})", track.title, track.song_id);

        let mut encoder = Encoder::start(&track.local_path)?;

        while let Some(chunk) = encoder.next_chunk().await? {
            write_chunk(&mut send, &chunk).await?;
        }

        info!("[radio-handler] track finished: {}", track.title);
        // loop picks the next song; the new encoder emits its own init chunk,
        // and the client soft-resets MSE on the init flag.
    }
}
