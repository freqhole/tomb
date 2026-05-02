//! host role: drives a [`Transcoder`], publishes each chunk as a
//! raw blob, then assembles the chunk hashes into a [`Collection`]
//! and returns a [`SibylTicket`] wrapping a `BlobTicket` for the
//! collection root.
//!
//! design note: sibyl publishes the *whole* collection once
//! transcoding finishes (rather than streaming a growing collection).
//! a peer that connects mid-transcode sees nothing until the host
//! finishes — adequate for the prototype. phase 5 could switch to a
//! streaming hashseq for live consumers.

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, Result};
use iroh_blobs::format::collection::Collection;
use iroh_blobs::ticket::BlobTicket;
use iroh_blobs::BlobFormat;
use tracing::{debug, info};

use crate::chunk::CodecParams;
use crate::iroh_node::SibylNode;
use crate::ticket::SibylTicket;
use crate::transcode::Transcoder;

/// represents an in-progress hosting session. holding `SibylHost`
/// keeps the ffmpeg child + temp blobs alive; dropping it cancels
/// transcode (chunks already published remain reachable until the
/// `MemStore` is dropped, which happens at app exit).
pub struct SibylHost {
    /// publicly addressable ticket. cloned freely.
    pub ticket: SibylTicket,
}

impl SibylHost {
    /// transcode `input` and host every chunk on `node`. returns once
    /// the source is exhausted and the collection is published.
    ///
    /// the returned `SibylHost` carries the `SibylTicket` you'd hand
    /// to a peer.
    pub async fn host(
        node: Arc<SibylNode>,
        song_id: String,
        input: PathBuf,
        params: CodecParams,
        title: Option<String>,
    ) -> Result<Self> {
        info!(
            "[sibyl-host] starting transcode song_id={song_id} input={:?}",
            input
        );

        let mut transcoder =
            Transcoder::spawn(&input, params).context("failed to spawn ffmpeg transcoder")?;

        let mem_store = node.mem_store();
        let mut collection = Collection::default();

        // pull chunks one at a time; publish each as a raw blob with
        // a sequential name. names are zero-padded so dictionary order
        // matches numeric order — useful for human inspection.
        loop {
            let chunk = match transcoder
                .next_chunk()
                .await
                .context("transcoder failed mid-song")?
            {
                Some(c) => c,
                None => break,
            };

            let bytes = bytes::Bytes::from(chunk.bytes);
            let tag = mem_store
                .add_bytes(bytes)
                .await
                .context("failed to publish chunk to blobs store")?;
            let hash = tag.hash;
            let name = format!("{:08}.mp3", chunk.seq);
            debug!(
                "[sibyl-host] published seq={} frames={} hash={hash}",
                chunk.seq, chunk.frame_count
            );
            collection.push(name, hash);
        }

        // publish the collection itself; root hash is what peers fetch.
        let root_tag = collection
            .store(node.store())
            .await
            .context("failed to store collection root")?;
        let root_hash = root_tag.hash();

        let endpoint = node.endpoint();
        // wait until the endpoint has contacted a relay so the
        // returned addr embeds enough info for remote dial.
        endpoint.online().await;
        let addr = endpoint.addr();

        let blob_ticket = BlobTicket::new(addr, root_hash, BlobFormat::HashSeq);
        let iroh_ticket = blob_ticket.to_string();

        let ticket = SibylTicket {
            song_id: song_id.clone(),
            iroh_ticket,
            params,
            title,
        };

        info!("[sibyl-host] published collection root={root_hash} song_id={song_id}");

        // root_tag drop is fine — collection blobs (chunks + meta + hashseq)
        // are tagged by their own temp tags inside `MemStore`. they stay
        // alive until the `MemStore` is dropped at app exit.
        drop(root_tag);

        Ok(Self { ticket })
    }
}
