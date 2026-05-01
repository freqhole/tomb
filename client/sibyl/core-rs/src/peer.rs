//! peer role: download a sibyl ticket's collection from iroh-blobs,
//! reconstruct chunks in order, and pump them through a callback.
//!
//! the callback shape is intentionally narrow — `FnMut(Chunk)` —
//! so transports can adapt it to whatever delivery mechanism their
//! ui uses (tauri events, postMessage, websocket, in-memory queue).

use std::sync::Arc;

use crate::chunk::Chunk;
use crate::iroh_node::SibylNode;
use crate::ticket::SibylTicket;

/// chunks the peer already has cached and should not be re-emitted.
pub type HaveSet = Vec<u32>;

pub struct SibylPeer;

impl SibylPeer {
    /// fetch chunks for `ticket`, invoking `on_chunk` for each one in
    /// `seq` order. chunks listed in `have` are skipped (already in
    /// opfs).
    ///
    /// resolves when every chunk has been emitted (or skipped). errors
    /// propagate from iroh-blobs download failures.
    ///
    /// implementation outline (phase 2):
    /// 1. parse `ticket.iroh_ticket` → `BlobTicket`
    /// 2. `node.downloader().download_collection(ticket).await?`
    /// 3. iterate the collection's child hashes in order
    /// 4. for each child: read bytes from store → build `Chunk { seq, bytes }`
    /// 5. invoke `on_chunk(chunk)`
    pub async fn request<F>(
        node: Arc<SibylNode>,
        ticket: SibylTicket,
        have: HaveSet,
        mut on_chunk: F,
    ) -> anyhow::Result<()>
    where
        F: FnMut(Chunk) + Send + 'static,
    {
        let _ = (node, ticket, have, &mut on_chunk);
        // todo (phase 2)
        Ok(())
    }
}
