//! host role: drive a [`crate::transcode::Transcoder`] to completion,
//! adding each chunk as a blob and assembling them into a collection.
//! emits a [`crate::ticket::SibylTicket`] suitable for handing to a
//! peer out of band.

use std::path::PathBuf;
use std::sync::Arc;

use crate::chunk::CodecParams;
use crate::iroh_node::SibylNode;
use crate::ticket::SibylTicket;

pub struct SibylHost {
    // todo (phase 2): real fields
    //   node: Arc<SibylNode>,
    //   cancel: tokio_util::sync::CancellationToken,
    //   join: tokio::task::JoinHandle<()>,
}

impl SibylHost {
    /// spawn the transcoder + iroh-blobs publisher in a background
    /// task. returns immediately with a ticket peers can use.
    ///
    /// implementation outline (phase 2):
    /// 1. spawn `Transcoder::spawn(input, params)`
    /// 2. create an iroh-blobs collection builder
    /// 3. for each chunk, `node.store().add_bytes(chunk.bytes)`
    ///    and append the resulting hash to the collection
    /// 4. on completion (or first chunk, depending on iroh-blobs
    ///    semantics) finalize the collection → root hash
    /// 5. wrap in a `BlobTicket`, encode into `SibylTicket`
    pub async fn host(
        node: Arc<SibylNode>,
        song_id: String,
        input: PathBuf,
        params: CodecParams,
        title: Option<String>,
    ) -> anyhow::Result<(Self, SibylTicket)> {
        let _ = (node, &input);
        // placeholder ticket; replaced in phase 2.
        let ticket = SibylTicket {
            song_id,
            iroh_ticket: String::new(),
            params,
            title,
        };
        Ok((Self {}, ticket))
    }

    pub fn cancel(self) {
        // todo (phase 2): self.cancel.cancel(); let join finish.
    }
}
