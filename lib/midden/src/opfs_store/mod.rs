//! an OPFS-backed iroh-blobs store living entirely OUTSIDE the iroh-blobs
//! crate — see skein/docs/opfs-store-implementation-plan.md phase C.
//!
//! iroh-blobs 0.103 exposes everything a custom store actor needs:
//! `api::proto` is pub (the `Command` enum and the irpc-generated `*Msg`
//! types), `MemStore::from_sender(client)` is plain pub, and the bao-tree
//! traversal helpers work against public traits (`ReadBytesAt` +
//! `Outboard`). so the browser store needs ZERO fork diffs.
//!
//! architecture:
//! - `storage::BlobDir`/`BlobFile` abstract the byte storage: `NativeDir`
//!   (in-memory, `cargo test`) and `opfs::OpfsDir` (sync access handles,
//!   worker-only wasm). ALL protocol/state-machine logic below is generic
//!   over the trait and natively tested in `tests.rs`.
//! - per blob: `<hash>.data` + `<hash>.obao` (pre-order outboard) +, while
//!   partial, a `<hash>.meta` sidecar persisting size + bitfield. the
//!   sidecar doubles as the partial/complete marker: completion deletes it
//!   (write ordering: data/outboard flushed first, so a crash leaves a
//!   valid partial, never a false complete).
//! - partial blobs write INCREMENTALLY to their files (bounded memory for
//!   arbitrarily large downloads); on reload, `<hash>.meta` files are
//!   scanned and entries resume with their persisted bitfields.
//! - imports via ImportByteStream spill chunks to a temp file, compute the
//!   outboard by streaming the file back (memory: one chunk-group buffer +
//!   the outboard itself, ~data/256), then rename into place.
//! - tags persist in `tags.json`; temp tags are drop-tracked (real
//!   `TagDrop` wiring) with batch scopes (`Scope` values are minted via
//!   serde — the field is crate-private but the type is `Deserialize`).
//! - gc: the crate's `run_gc` is private, but its algorithm drives the
//!   store exclusively through the public api — `gc_loop` below reimplements
//!   it (mark from tags + temp tags + protect callback, sweep via delete).

mod actor;
mod gc;
#[cfg(target_family = "wasm")]
mod opfs;
pub mod storage;
#[cfg(all(test, not(target_family = "wasm")))]
mod tests;

use std::ops::Deref;

use iroh_blobs::store::mem::MemStore;

pub use actor::spawn_store;
// ProtectCb/ProtectOutcome are consumed by lib.rs's make_protect_cb, which is
// wasm-only — this re-export is otherwise unused on native (test) builds.
#[allow(unused_imports)]
pub use gc::{GcOptions, ProtectCb, ProtectOutcome};

/// public handle: an iroh-blobs Store backed by the storage-generic actor.
/// wraps MemStore purely for its pub from_sender constructor + Deref<Store>.
pub struct OpfsStore {
    inner: MemStore,
}

impl Deref for OpfsStore {
    type Target = iroh_blobs::api::Store;
    fn deref(&self) -> &Self::Target {
        self.inner.deref()
    }
}

impl OpfsStore {
    /// clone the underlying api Store handle (a cheap client clone). the
    /// actor stays alive as long as any clone exists.
    ///
    /// only called from `build_blobs_store`'s wasm-only branch in lib.rs,
    /// so it is otherwise unused on native builds.
    #[allow(dead_code)]
    pub fn clone_store(&self) -> iroh_blobs::api::Store {
        self.inner.deref().clone()
    }
}

#[cfg(target_family = "wasm")]
impl OpfsStore {
    /// spawn the store actor against an OPFS directory (worker context
    /// required — sync access handles). scans the directory and resumes
    /// complete and partial blobs persisted by earlier sessions.
    pub async fn new(dir_name: &str, gc: Option<GcOptions>) -> Result<Self, String> {
        let dir = opfs::open_store_dir(dir_name)
            .await
            .map_err(|e| e.to_string())?;
        let storage = opfs::OpfsDir::new(dir);
        let client = spawn_store(storage, gc).await.map_err(|e| e.to_string())?;
        Ok(Self {
            inner: MemStore::from_sender(client),
        })
    }
}

#[cfg(not(target_family = "wasm"))]
impl OpfsStore {
    /// native (test) construction over any BlobDir impl.
    pub async fn new_native<D>(storage: D, gc: Option<GcOptions>) -> std::io::Result<Self>
    where
        D: storage::BlobDir + 'static,
    {
        let client = spawn_store(storage, gc).await?;
        Ok(Self {
            inner: MemStore::from_sender(client),
        })
    }
}

// ---------------------------------------------------------------------------
// wasm selftests (driven from the blob worker via loam e2e)
// ---------------------------------------------------------------------------

#[cfg(target_family = "wasm")]
pub async fn selftest() -> Result<String, String> {
    use bao_tree::ChunkRanges;
    use bytes::Bytes;
    use iroh_blobs::api::blobs::BlobStatus;

    let run_id = (js_sys::Math::random() * 1e9) as u64;

    // deterministic ~1.5MB payload (multiple block groups => real outboard)
    let size = 1_500_000usize;
    let mut data = vec![0u8; size];
    for (i, b) in data.iter_mut().enumerate() {
        *b = ((i * 31 + 7) % 256) as u8;
    }
    let data = Bytes::from(data);

    // store 1: import via ImportBytes, read back via ExportBao
    let store = OpfsStore::new(&format!("opfs-store-spike-{run_id}-a"), None).await?;
    let tag = store
        .blobs()
        .add_bytes(data.clone())
        .temp_tag()
        .await
        .map_err(|e| format!("add_bytes failed: {e:?}"))?;
    let hash = tag.hash();

    let back = store
        .blobs()
        .get_bytes(hash)
        .await
        .map_err(|e| format!("get_bytes failed: {e:?}"))?;
    if back != data {
        return Err(format!(
            "round trip mismatch: sent {} bytes, got {}",
            data.len(),
            back.len()
        ));
    }

    let status = store
        .blobs()
        .status(hash)
        .await
        .map_err(|e| format!("status failed: {e:?}"))?;
    if !matches!(status, BlobStatus::Complete { size: s } if s == size as u64) {
        return Err(format!("unexpected status: {status:?}"));
    }

    // wire-format round trip: export a verified bao stream from store 1,
    // import it into a fresh store 2 (exercises ImportBao's incremental
    // file writes + partial -> complete flip), read back and compare.
    let bao = store
        .blobs()
        .export_bao(hash, ChunkRanges::all())
        .bao_to_vec()
        .await
        .map_err(|e| format!("export_bao failed: {e:?}"))?;

    let store2 = OpfsStore::new(&format!("opfs-store-spike-{run_id}-b"), None).await?;
    store2
        .blobs()
        .import_bao_bytes(hash, ChunkRanges::all(), Bytes::from(bao.clone()))
        .await
        .map_err(|e| format!("import_bao_bytes failed: {e:?}"))?;
    let back2 = store2
        .blobs()
        .get_bytes(hash)
        .await
        .map_err(|e| format!("get_bytes (store 2) failed: {e:?}"))?;
    if back2 != data {
        return Err("store-2 round trip mismatch after bao import".to_string());
    }

    Ok(format!(
        "opfs store selftest OK: {} bytes, hash {}, bao stream {} bytes, both stores verified",
        size,
        hash.to_hex(),
        bao.len()
    ))
}

/// persistence selftest: import into a store, shut it down (releasing the
/// OPFS locks), open a SECOND store over the SAME directory, and prove the
/// blob is listed, complete, and byte-identical — i.e. blobs survive a
/// reload without re-import. worker context required.
#[cfg(target_family = "wasm")]
pub async fn selftest_persistence() -> Result<String, String> {
    use bytes::Bytes;
    use iroh_blobs::api::blobs::BlobStatus;
    use n0_future::StreamExt;

    let run_id = (js_sys::Math::random() * 1e9) as u64;
    let dir_name = format!("opfs-store-persist-{run_id}");

    let size = 300_000usize;
    let mut data = vec![0u8; size];
    for (i, b) in data.iter_mut().enumerate() {
        *b = ((i * 13 + 3) % 256) as u8;
    }
    let data = Bytes::from(data);

    // store 1: import + a persistent tag (so gc in a later session would
    // keep it), then shut down cleanly
    let store = OpfsStore::new(&dir_name, None).await?;
    let tag = store
        .blobs()
        .add_bytes(data.clone())
        .temp_tag()
        .await
        .map_err(|e| format!("add_bytes failed: {e:?}"))?;
    let hash = tag.hash();
    store
        .tags()
        .set(iroh_blobs::api::Tag::from("persist-test"), hash)
        .await
        .map_err(|e| format!("set tag failed: {e:?}"))?;
    store
        .shutdown()
        .await
        .map_err(|e| format!("shutdown failed: {e:?}"))?;

    // store 2 over the same directory: the blob must be there
    let store2 = OpfsStore::new(&dir_name, None).await?;
    let status = store2
        .blobs()
        .status(hash)
        .await
        .map_err(|e| format!("status (store 2) failed: {e:?}"))?;
    if !matches!(status, BlobStatus::Complete { size: s } if s == size as u64) {
        return Err(format!("blob did not survive reload: {status:?}"));
    }
    let back = store2
        .blobs()
        .get_bytes(hash)
        .await
        .map_err(|e| format!("get_bytes (store 2) failed: {e:?}"))?;
    if back != data {
        return Err("bytes differ after reload".to_string());
    }
    // the persistent tag must have survived too
    let mut tags = store2
        .tags()
        .list()
        .await
        .map_err(|e| format!("tags list failed: {e:?}"))?;
    let mut found = false;
    while let Some(t) = tags.next().await {
        let t = t.map_err(|e| format!("tag entry failed: {e:?}"))?;
        if t.hash == hash {
            found = true;
        }
    }
    if !found {
        return Err("persistent tag did not survive reload".to_string());
    }

    Ok(format!(
        "opfs store persistence selftest OK: {} bytes + tag survived a store restart (hash {})",
        size,
        hash.to_hex()
    ))
}
