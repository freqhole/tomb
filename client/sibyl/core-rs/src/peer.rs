//! peer role: parse a [`SibylTicket`], download the collection it
//! references, then read each child blob from the local store in
//! sequence and feed them into a callback as [`Chunk`]s.
//!
//! mirrors the pattern in `client/midden/src/lib.rs::download_verified_streaming`
//! (download → drain progress stream → read bytes from store) but
//! generalized to a hashseq collection rather than a single blob.

use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use futures_util::StreamExt;
use iroh_blobs::api::downloader::DownloadProgressItem;
use iroh_blobs::format::collection::Collection;
use iroh_blobs::ticket::BlobTicket;
use tracing::{debug, info, warn};

use crate::chunk::Chunk;
use crate::iroh_node::SibylNode;
use crate::ticket::SibylTicket;

/// download a sibyl-published collection and emit each chunk via
/// `on_chunk` in sequence order.
///
/// `have_chunks` is a sorted list of chunk seq numbers the caller
/// already has cached locally; those will be skipped (no callback
/// invocation, no store read). other chunks are still downloaded by
/// the underlying downloader because iroh-blobs doesn't expose
/// per-child skip — but the bandwidth cost of re-fetching ~1s mp3
/// chunks during resume is trivial.
pub struct SibylPeer;

impl SibylPeer {
    pub async fn request<F>(
        node: Arc<SibylNode>,
        ticket: &SibylTicket,
        have_chunks: &[u32],
        mut on_chunk: F,
    ) -> Result<()>
    where
        F: FnMut(Chunk) + Send + 'static,
    {
        let blob_ticket: BlobTicket = ticket
            .iroh_ticket
            .parse()
            .context("invalid embedded iroh blob ticket")?;

        let (peer_addr, root_hash, _format) = blob_ticket.into_parts();

        info!(
            "[sibyl-peer] requesting collection root={root_hash} from peer={}",
            peer_addr.id
        );

        // download the entire hashseq + children. iroh-blobs handles
        // discovery of child hashes from the collection root.
        let downloader = node.downloader();
        let progress = downloader.download(
            iroh_blobs::HashAndFormat::hash_seq(root_hash),
            [peer_addr.id],
        );
        let mut stream = progress
            .stream()
            .await
            .context("failed to start download stream")?;

        let mut had_error = false;
        let mut last_error: Option<String> = None;
        while let Some(event) = stream.next().await {
            match event {
                DownloadProgressItem::Error(e) => {
                    had_error = true;
                    last_error = Some(format!("{e:?}"));
                    warn!("[sibyl-peer] download error: {e:?}");
                }
                DownloadProgressItem::DownloadError => {
                    had_error = true;
                    last_error = Some("download error".to_string());
                }
                DownloadProgressItem::PartComplete { .. } => {
                    debug!("[sibyl-peer] part complete");
                }
                _ => {}
            }
        }
        if had_error {
            return Err(anyhow!(
                "verified download failed: {}",
                last_error.unwrap_or_else(|| "unknown".to_string())
            ));
        }

        // collection is now in our local store; load the index.
        let store = node.store();
        let collection = Collection::load(root_hash, store)
            .await
            .context("failed to load collection from store")?;

        info!(
            "[sibyl-peer] collection downloaded: {} chunks",
            collection.len()
        );

        // iterate in declared order. names are "%08d.mp3"; we trust
        // host order rather than parsing the name.
        for (seq, (_name, hash)) in collection.iter().enumerate() {
            let seq_u32 = seq as u32;
            if have_chunks.contains(&seq_u32) {
                debug!("[sibyl-peer] skip cached seq={seq_u32}");
                continue;
            }
            let bytes = store
                .get_bytes(*hash)
                .await
                .with_context(|| format!("failed to read chunk seq={seq_u32} hash={hash}"))?;
            let chunk = Chunk {
                seq: seq_u32,
                bytes: bytes.to_vec(),
                // host writes `frames_per_chunk` (or fewer for the
                // final flush). exact count isn't recoverable from the
                // blob alone; downstream uses chunk.bytes.len() / ~626
                // as an estimate. for now, set the planned value and
                // let the player tolerate short final chunks.
                frame_count: ticket.params.frames_per_chunk,
            };
            on_chunk(chunk);
        }

        Ok(())
    }
}
