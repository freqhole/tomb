//! sibyl-specific additions to midden. **all sibyl-only changes go
//! in this file** so a `diff client/sibyl/midden-rs client/midden`
//! shows only new files. when ready to merge upstream, copy this
//! file into canonical midden untouched.
//!
//! exports a chunk-streaming wrapper that downloads a sibyl-published
//! collection (a `HashSeq` of mp3 chunks) and emits each child blob
//! to a JS callback. mirrors `sibyl-core::SibylPeer::request` but
//! adapted for the wasm/midden runtime.
//!
//! ticket parsing happens on the JS side — `transport-wasm.ts` calls
//! `decodeTicket(ticketStr)` and passes us the inner `iroh_ticket`
//! string (a plain `iroh_blobs::ticket::BlobTicket`). that keeps this
//! file free of sibyl-core dependencies.

use iroh_blobs::api::downloader::DownloadProgressItem;
use iroh_blobs::hashseq::HashSeq;
use iroh_blobs::ticket::BlobTicket;
use iroh_blobs::HashAndFormat;
use js_sys::{Function as JsFunction, Uint8Array};
use n0_future::StreamExt;
use tracing::{debug, info, warn};
use wasm_bindgen::prelude::*;

use crate::MiddenNode;

#[wasm_bindgen]
impl MiddenNode {
    /// download a sibyl-published collection (a hashseq of mp3 chunks)
    /// from `peer` and invoke `on_chunk(seq, bytes, chunks_total)` per
    /// child blob in declared order.
    ///
    /// `iroh_ticket` is the inner `iroh_blobs::ticket::BlobTicket`
    /// string carried inside a `SibylTicket` envelope. the JS side
    /// already decoded the envelope to extract this.
    ///
    /// `have_chunks` is a sorted list of chunk seq numbers the caller
    /// already has cached locally; matching seqs skip the JS callback
    /// (their bytes are still pulled into MemStore as a side effect of
    /// the underlying hashseq download — iroh-blobs has no per-child
    /// skip, but bandwidth cost is small for resume).
    ///
    /// callback signature: `on_chunk(seq: number, bytes: Uint8Array,
    /// chunks_total: number) -> void`. `chunks_total` is supplied on
    /// every call so the JS player can size its manifest from the
    /// very first chunk.
    pub async fn sibyl_download_chunks(
        &self,
        iroh_ticket: String,
        have_chunks: Vec<u32>,
        on_chunk: &JsFunction,
    ) -> Result<u32, JsError> {
        let blob_ticket: BlobTicket = iroh_ticket
            .parse()
            .map_err(|e| JsError::new(&format!("invalid iroh blob ticket: {e}")))?;
        let (peer_addr, root_hash, _format) = blob_ticket.into_parts();

        info!(
            "[sibyl-wasm] requesting collection root={root_hash} from peer={}",
            &peer_addr.id.to_string()[..16]
        );

        // protect the root hash + (later) child hashes from GC for the
        // entire download → drain lifecycle. without this the periodic
        // GC sweep can wipe entries between download-stream-end and
        // store.get_bytes.
        let root_guard = ProtectScope::new(&self.protected_hashes);
        root_guard.add(root_hash);

        // step 1: kick off the collection download. we do NOT await
        // the entire progress stream up-front — that would force the
        // browser to wait for the whole song to land before any audio
        // started playing. instead we spawn a background task that
        // drains the stream (which is what actually drives downloads
        // forward + surfaces errors), and in the foreground we walk
        // children one-by-one, awaiting each child's completion and
        // emitting it to JS as it lands. this gives the player real
        // streaming playback while bytes are still arriving.
        let progress = self
            .blobs_downloader
            .download(HashAndFormat::hash_seq(root_hash), [peer_addr.id]);
        let stream = progress
            .stream()
            .await
            .map_err(|e| JsError::new(&format!("download stream failed: {e}")))?;

        let error_cell: std::sync::Arc<std::sync::Mutex<Option<String>>> =
            std::sync::Arc::new(std::sync::Mutex::new(None));
        let error_cell_drain = error_cell.clone();
        wasm_bindgen_futures::spawn_local(async move {
            let mut stream = stream;
            while let Some(event) = stream.next().await {
                match &event {
                    DownloadProgressItem::Error(e) => {
                        warn!("[sibyl-wasm] download error: {e:?}");
                        if let Ok(mut slot) = error_cell_drain.lock() {
                            if slot.is_none() {
                                *slot = Some(format!("{e:?}"));
                            }
                        }
                    }
                    DownloadProgressItem::DownloadError => {
                        if let Ok(mut slot) = error_cell_drain.lock() {
                            if slot.is_none() {
                                *slot = Some("download error".to_string());
                            }
                        }
                    }
                    _ => {}
                }
            }
        });

        // step 2: wait for the root hashseq blob's bitfield to report
        // complete in the local store. the download stream may signal
        // end before the chunk processor flushes the final entries
        // into MemStore — same race tomb's `download_verified_streaming`
        // works around with `observe(hash).await_completion()`. without
        // this, `get_bytes(root)` returns a truncated/empty buffer and
        // `HashSeq::try_from` fails with a postcard "encode error".
        await_blob_complete(&self.blobs_store, root_hash, "root").await?;

        // step 3: read the root as a HashSeq directly. we skip
        // `Collection::load` because we don't need the human-readable
        // names — the chunk order is determined by the seq number we
        // attach via `enumerate()` below. (Collection::load also
        // requires the metadata blob, which we'd otherwise have to
        // protect + await separately.)
        let root_bytes = self
            .blobs_store
            .get_bytes(root_hash)
            .await
            .map_err(|e| JsError::new(&format!("read root hashseq: {e}")))?;
        let hash_seq = HashSeq::try_from(root_bytes)
            .map_err(|e| JsError::new(&format!("parse hashseq: {e}")))?;
        // first entry is the collection metadata blob; the actual data
        // children start at index 1.
        let child_hashes: Vec<_> = hash_seq.iter().skip(1).collect();
        let total = child_hashes.len() as u32;
        info!("[sibyl-wasm] collection downloaded: {} chunks", total);

        // protect every child hash from GC for the read loop.
        for h in &child_hashes {
            root_guard.add(*h);
        }

        // step 4: walk children in declared order, await per-child
        // completion (cheap if already complete), emit to JS.
        let have_set: std::collections::HashSet<u32> = have_chunks.into_iter().collect();
        let mut emitted = 0u32;
        for (seq, hash) in child_hashes.iter().enumerate() {
            let seq_u32 = seq as u32;
            if have_set.contains(&seq_u32) {
                debug!("[sibyl-wasm] skip cached seq={seq_u32}");
                continue;
            }
            await_blob_complete(&self.blobs_store, *hash, "child").await?;
            let bytes = self
                .blobs_store
                .get_bytes(*hash)
                .await
                .map_err(|e| JsError::new(&format!("read chunk seq={seq_u32}: {e}")))?;
            let arr = Uint8Array::new_with_length(bytes.len() as u32);
            arr.copy_from(&bytes);
            // arity-3 call: (seq, bytes, chunks_total).
            on_chunk
                .call3(
                    &JsValue::NULL,
                    &JsValue::from_f64(seq_u32 as f64),
                    &arr,
                    &JsValue::from_f64(total as f64),
                )
                .map_err(|e| JsError::new(&format!("on_chunk callback threw: {e:?}")))?;
            emitted += 1;
        }

        // surface any error that the background drain task collected.
        if let Some(e) = error_cell.lock().ok().and_then(|mut s| s.take()) {
            return Err(JsError::new(&format!("verified download failed: {e}")));
        }

        drop(root_guard);
        Ok(emitted)
    }
}

/// wait for a blob's bitfield to report complete in the local store.
/// mirrors the post-download barrier in tomb's `download_verified_streaming`.
async fn await_blob_complete(
    store: &iroh_blobs::api::Store,
    hash: iroh_blobs::Hash,
    label: &str,
) -> Result<(), JsError> {
    match store.observe(hash).await {
        Ok(bf) if bf.is_complete() => Ok(()),
        Ok(_) => match store.observe(hash).await_completion().await {
            Ok(_) => Ok(()),
            Err(e) => {
                warn!("[sibyl-wasm] {label} bitfield never completed: {e:?}");
                Err(JsError::new(&format!(
                    "{label} bitfield never completed: {e:?}"
                )))
            }
        },
        Err(e) => {
            warn!("[sibyl-wasm] {label} observe failed: {e:?}");
            Err(JsError::new(&format!("{label} observe failed: {e:?}")))
        }
    }
}

/// RAII guard that adds hashes to a shared protected-set and removes
/// every hash it added when dropped. mirrors midden's `ProtectGuard`
/// but supports growing the protected set across the download → drain
/// boundary (collection root + all child hashes).
struct ProtectScope<'a> {
    protected: &'a std::sync::Arc<std::sync::Mutex<std::collections::HashSet<iroh_blobs::Hash>>>,
    added: std::cell::RefCell<Vec<iroh_blobs::Hash>>,
}

impl<'a> ProtectScope<'a> {
    fn new(
        protected: &'a std::sync::Arc<
            std::sync::Mutex<std::collections::HashSet<iroh_blobs::Hash>>,
        >,
    ) -> Self {
        Self {
            protected,
            added: std::cell::RefCell::new(Vec::new()),
        }
    }

    fn add(&self, hash: iroh_blobs::Hash) {
        if let Ok(mut set) = self.protected.lock() {
            if set.insert(hash) {
                self.added.borrow_mut().push(hash);
            }
        }
    }
}

impl<'a> Drop for ProtectScope<'a> {
    fn drop(&mut self) {
        if let Ok(mut set) = self.protected.lock() {
            for h in self.added.borrow().iter() {
                set.remove(h);
            }
        }
    }
}
