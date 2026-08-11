//! the storage-generic store actor: all protocol logic for the opfs blob
//! store, written against `storage::BlobDir`/`BlobFile` so it runs (and is
//! tested) natively as well as on wasm.
//!
//! layout per blob (flat names in one directory):
//!   `<hash-hex>.data`  raw content bytes
//!   `<hash-hex>.obao`  pre-order outboard (64-byte parent pairs); absent
//!                      or empty for single-block-group blobs
//!   `<hash-hex>.meta`  ONLY while partial: json { size, ranges } — the
//!                      persisted bitfield. completion deletes it, so its
//!                      absence marks a complete blob. data/outboard are
//!                      flushed BEFORE the meta delete, so a crash leaves a
//!                      valid partial, never a false complete.
//!   `tags.json`        persistent tags manifest
//!   `import-<n>.tmp`   in-flight stream imports (cleaned at startup)

use std::{
    cell::{Cell, RefCell},
    collections::{BTreeMap, HashMap},
    io,
    ops::Deref,
    rc::Rc,
};

use bao_tree::{
    blake3,
    io::{
        mixed::{traverse_ranges_validated, EncodedItem, ReadBytesAt},
        sync::{Outboard, OutboardMut},
        BaoContentItem, EncodeError, Leaf,
    },
    BaoTree, ChunkNum, ChunkRanges, TreeNode,
};
use bytes::Bytes;
use iroh_blobs::{
    api::{
        blobs::{AddProgressItem, Bitfield, BlobStatus},
        proto::{
            BatchMsg, BatchResponse, BlobStatusMsg, BlobStatusRequest, Command, CreateTagMsg,
            CreateTagRequest, CreateTempTagMsg, DeleteBlobsMsg, DeleteTagsMsg, ExportBaoMsg,
            ExportBaoRequest, ExportRangesItem, ExportRangesMsg, ExportRangesRequest, ImportBaoMsg,
            ImportBaoRequest, ImportByteStreamMsg, ImportByteStreamUpdate, ImportBytesMsg,
            ImportBytesRequest, ListBlobsMsg, ListTagsMsg, ListTempTagsMsg, ObserveMsg,
            ObserveRequest, RenameTagMsg, Scope, SetTagMsg, SetTagRequest, ShutdownMsg, SyncDbMsg,
            WaitIdleMsg,
        },
        tags::TagInfo,
        Tag, TempTag,
    },
    protocol::ChunkRangesExt,
    store::IROH_BLOCK_SIZE,
    BlobFormat, Hash, HashAndFormat,
};
use range_collections::range_set::RangeSetRange;
use serde::{Deserialize, Serialize};
use tokio::sync::watch;
use tracing::{debug, info, trace, warn};
use web_time::Instant;

use super::{
    gc::{GcOptions, ProtectOutcome},
    storage::{BlobDir, BlobFile},
};

/// the api client type. iroh-blobs' own `ApiClient` alias is pub(crate),
/// but it is transparently `irpc::Client<proto::Request>`, which is fully
/// public — so we just spell it out.
pub type StoreClient = irpc::Client<iroh_blobs::api::proto::Request>;

/// spawn a future on the current thread (the actor is strictly
/// single-threaded on both targets).
pub(crate) fn spawn<F: std::future::Future<Output = ()> + 'static>(fut: F) {
    #[cfg(target_family = "wasm")]
    wasm_bindgen_futures::spawn_local(fut);
    #[cfg(not(target_family = "wasm"))]
    {
        tokio::task::spawn_local(fut);
    }
}

// ---------------------------------------------------------------------------
// meta sidecar + tags manifest formats
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
struct PartialMeta {
    size: u64,
    /// present chunk ranges as [start, end) chunk numbers
    ranges: Vec<(u64, u64)>,
}

impl PartialMeta {
    fn from_bitfield(bitfield: &Bitfield) -> Self {
        let mut ranges = Vec::new();
        for r in bitfield.ranges.iter() {
            match r {
                RangeSetRange::Range(r) => ranges.push((r.start.0, r.end.0)),
                RangeSetRange::RangeFrom(r) => ranges.push((r.start.0, u64::MAX)),
            }
        }
        Self {
            size: bitfield.size(),
            ranges,
        }
    }

    fn to_bitfield(&self) -> Bitfield {
        let mut ranges = ChunkRanges::empty();
        for (start, end) in &self.ranges {
            if *end == u64::MAX {
                ranges |= ChunkRanges::from(ChunkNum(*start)..);
            } else {
                ranges |= ChunkRanges::from(ChunkNum(*start)..ChunkNum(*end));
            }
        }
        Bitfield::new(ranges, self.size)
    }
}

#[derive(Serialize, Deserialize, Default)]
struct TagsManifest {
    /// tag name (utf8-lossy of the tag bytes) -> (hash hex, format)
    tags: BTreeMap<String, (String, String)>,
}

fn format_to_str(f: BlobFormat) -> String {
    if f.is_raw() { "raw" } else { "hashseq" }.to_string()
}

fn format_from_str(s: &str) -> BlobFormat {
    if s == "hashseq" {
        BlobFormat::HashSeq
    } else {
        BlobFormat::Raw
    }
}

// ---------------------------------------------------------------------------
// temp tags with batch scopes
// ---------------------------------------------------------------------------
//
// upstream's temp tags carry a `Weak<dyn TagDrop>` so the store notices
// every drop. that trait is crate-private in iroh-blobs 0.103, so an
// out-of-crate store cannot mint drop-tracked tags. the accounting here is
// therefore scope-based:
//
// - batch-scoped tags are tracked: created via CreateTempTag within a
//   Batch, decremented by the batch client's `BatchResponse::Drop`
//   messages, and cleared wholesale when the batch scope ends.
// - GLOBAL-scope tags are NOT tracked (their drops are invisible; listing
//   them forever would make gc protect released blobs indefinitely).
//
// consequence, documented for store users: with gc enabled, in-flight
// imports outside a batch must be protected via the gc protect callback
// (midden already feeds its `active_tags` + `protected_hashes` there).
struct TempTags {
    /// refcounts per batch scope per content
    scopes: HashMap<u64, HashMap<HashAndFormat, usize>>,
    next_scope: u64,
}

impl TempTags {
    fn new() -> Self {
        Self {
            scopes: HashMap::new(),
            next_scope: 0,
        }
    }

    fn create_scope(&mut self) -> u64 {
        self.next_scope += 1;
        let id = self.next_scope;
        self.scopes.insert(id, HashMap::new());
        id
    }

    fn end_scope(&mut self, scope: u64) {
        self.scopes.remove(&scope);
    }

    fn create(&mut self, scope: Scope, content: HashAndFormat) -> TempTag {
        let scope_id = scope_to_u64(scope);
        if scope_id != 0 {
            if let Some(scope) = self.scopes.get_mut(&scope_id) {
                *scope.entry(content).or_insert(0) += 1;
            }
        }
        // untracked: dropping this tag does nothing store-side (TagDrop is
        // crate-private — see module comment above)
        TempTag::new(content, None)
    }

    fn drop_one(&mut self, scope_id: u64, content: &HashAndFormat) {
        if let Some(scope) = self.scopes.get_mut(&scope_id) {
            if let Some(count) = scope.get_mut(content) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    scope.remove(content);
                }
            }
        }
    }

    fn list(&self) -> Vec<HashAndFormat> {
        self.scopes
            .values()
            .flat_map(|scope| scope.keys().copied())
            .collect()
    }
}

/// mint a Scope value. the field is crate-private, but Scope is a serde
/// newtype over u64, so serde round-trips construct arbitrary values.
fn u64_to_scope(n: u64) -> Scope {
    serde_json::from_str::<Scope>(&n.to_string()).expect("Scope is a serde newtype over u64")
}

fn scope_to_u64(scope: Scope) -> u64 {
    serde_json::to_string(&scope)
        .ok()
        .and_then(|s| s.parse().ok())
        .expect("Scope serializes to a bare u64")
}

// ---------------------------------------------------------------------------
// task accounting (honest WaitIdle)
// ---------------------------------------------------------------------------

#[derive(Default)]
struct TaskTracker {
    active: Cell<usize>,
    waiters: RefCell<Vec<irpc::channel::oneshot::Sender<()>>>,
}

impl TaskTracker {
    fn begin(self: &Rc<Self>) -> TaskGuard {
        self.active.set(self.active.get() + 1);
        TaskGuard(self.clone())
    }

    fn is_idle(&self) -> bool {
        self.active.get() == 0
    }
}

struct TaskGuard(Rc<TaskTracker>);

impl Drop for TaskGuard {
    fn drop(&mut self) {
        let tracker = &self.0;
        tracker.active.set(tracker.active.get() - 1);
        if tracker.active.get() == 0 {
            let waiters = std::mem::take(&mut *tracker.waiters.borrow_mut());
            for tx in waiters {
                let fut = tx.send(());
                spawn(async move {
                    fut.await.ok();
                });
            }
        }
    }
}

// ---------------------------------------------------------------------------
// entry state
// ---------------------------------------------------------------------------

struct PartialState<F: BlobFile> {
    data: F,
    outboard: F,
    meta: F,
    size: u64,
    bitfield: Bitfield,
}

struct CompleteState<F: BlobFile> {
    size: u64,
    data: F,
    /// None when the blob fits in one block group (empty outboard)
    outboard: Option<F>,
}

enum EntryState<F: BlobFile> {
    Partial(PartialState<F>),
    Complete(CompleteState<F>),
}

impl<F: BlobFile> EntryState<F> {
    fn bitfield(&self) -> Bitfield {
        match self {
            Self::Partial(p) => p.bitfield.clone(),
            Self::Complete(c) => Bitfield::complete(c.size),
        }
    }

    fn size(&self) -> u64 {
        match self {
            Self::Partial(p) => p.size,
            Self::Complete(c) => c.size,
        }
    }
}

struct EntryInner<F: BlobFile> {
    hash: Hash,
    state: watch::Sender<EntryState<F>>,
}

struct Entry<F: BlobFile>(Rc<EntryInner<F>>);

impl<F: BlobFile> Clone for Entry<F> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

impl<F: BlobFile> Entry<F> {
    fn bitfield(&self) -> Bitfield {
        self.0.state.borrow().bitfield()
    }
}

// ---------------------------------------------------------------------------
// bao readers/writers over entry files
// ---------------------------------------------------------------------------

struct DataReader<F: BlobFile>(Entry<F>);

impl<F: BlobFile> ReadBytesAt for DataReader<F> {
    fn read_bytes_at(&self, offset: u64, size: usize) -> io::Result<Bytes> {
        let state = self.0 .0.state.borrow();
        let file = match state.deref() {
            EntryState::Partial(p) => &p.data,
            EntryState::Complete(c) => &c.data,
        };
        Ok(file.read_exact_at(offset, size)?.into())
    }
}

struct OutboardReader<F: BlobFile> {
    hash: blake3::Hash,
    tree: BaoTree,
    entry: Entry<F>,
}

impl<F: BlobFile> Outboard for OutboardReader<F> {
    fn root(&self) -> blake3::Hash {
        self.hash
    }

    fn tree(&self) -> BaoTree {
        self.tree
    }

    fn load(&self, node: TreeNode) -> io::Result<Option<(blake3::Hash, blake3::Hash)>> {
        let Some(offset) = self.tree.pre_order_offset(node) else {
            return Ok(None);
        };
        let state = self.entry.0.state.borrow();
        let buf = match state.deref() {
            EntryState::Partial(p) => p.outboard.read_exact_at(offset * 64, 64)?,
            EntryState::Complete(c) => match &c.outboard {
                Some(f) => f.read_exact_at(offset * 64, 64)?,
                None => {
                    return Err(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "no outboard for single-group blob",
                    ))
                }
            },
        };
        let left: [u8; 32] = buf[..32].try_into().unwrap();
        let right: [u8; 32] = buf[32..].try_into().unwrap();
        Ok(Some((left.into(), right.into())))
    }
}

/// pre-order OutboardMut over a storage file (for import-time computation).
struct FileOutboardMut<'a, F: BlobFile> {
    tree: BaoTree,
    file: &'a F,
}

impl<F: BlobFile> OutboardMut for FileOutboardMut<'_, F> {
    fn save(&mut self, node: TreeNode, pair: &(blake3::Hash, blake3::Hash)) -> io::Result<()> {
        let Some(offset) = self.tree.pre_order_offset(node) else {
            return Ok(());
        };
        let mut buf = [0u8; 64];
        buf[..32].copy_from_slice(pair.0.as_bytes());
        buf[32..].copy_from_slice(pair.1.as_bytes());
        self.file.write_at(offset * 64, &buf)
    }

    fn sync(&mut self) -> io::Result<()> {
        self.file.flush()
    }
}

/// std::io::Read over a storage file (for streaming outboard computation).
struct FileReader<'a, F: BlobFile> {
    file: &'a F,
    pos: u64,
    len: u64,
}

impl<F: BlobFile> io::Read for FileReader<'_, F> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let remaining = (self.len - self.pos) as usize;
        if remaining == 0 {
            return Ok(0);
        }
        let n = buf.len().min(remaining);
        let data = self.file.read_exact_at(self.pos, n)?;
        buf[..n].copy_from_slice(&data);
        self.pos += n as u64;
        Ok(n)
    }
}

/// irpc mpsc sender as a bao-tree encoded-item sink.
struct EncodedItemSender<'a>(&'a mut irpc::channel::mpsc::Sender<EncodedItem>);

impl bao_tree::io::mixed::Sender for EncodedItemSender<'_> {
    type Error = irpc::channel::SendError;
    async fn send(&mut self, item: EncodedItem) -> Result<(), Self::Error> {
        self.0.send(item).await
    }
}

// ---------------------------------------------------------------------------
// the actor
// ---------------------------------------------------------------------------

const CHUNK_COPY_SIZE: usize = 1024 * 1024;

fn data_name(hash: &Hash) -> String {
    format!("{}.data", hash.to_hex())
}
fn obao_name(hash: &Hash) -> String {
    format!("{}.obao", hash.to_hex())
}
fn meta_name(hash: &Hash) -> String {
    format!("{}.meta", hash.to_hex())
}

struct Ctx<D: BlobDir> {
    dir: D,
    entries: RefCell<HashMap<Hash, Entry<D::File>>>,
    tags: RefCell<BTreeMap<Tag, HashAndFormat>>,
    temp_tags: RefCell<TempTags>,
    tasks: Rc<TaskTracker>,
    next_import_id: Cell<u64>,
}

impl<D: BlobDir> Ctx<D> {
    fn get(&self, hash: &Hash) -> Option<Entry<D::File>> {
        self.entries.borrow().get(hash).cloned()
    }

    /// open (or create) the partial-backing files for a hash and register
    /// the entry. loads a persisted bitfield when the meta sidecar has one.
    async fn get_or_create_entry(&self, hash: Hash) -> io::Result<Entry<D::File>> {
        if let Some(entry) = self.get(&hash) {
            return Ok(entry);
        }
        let data = self.dir.open(&data_name(&hash)).await?;
        let outboard = self.dir.open(&obao_name(&hash)).await?;
        let meta = self.dir.open(&meta_name(&hash)).await?;
        // resume a persisted partial bitfield if present
        let meta_len = meta.len()?;
        let (size, bitfield) = if meta_len > 0 {
            let bytes = meta.read_exact_at(0, meta_len as usize)?;
            match serde_json::from_slice::<PartialMeta>(&bytes) {
                Ok(pm) => (pm.size, pm.to_bitfield()),
                Err(e) => {
                    warn!("corrupt partial meta for {}: {e} — restarting blob", hash);
                    (0, Bitfield::empty())
                }
            }
        } else {
            (0, Bitfield::empty())
        };
        let entry = Entry(Rc::new(EntryInner {
            hash,
            state: watch::Sender::new(EntryState::Partial(PartialState {
                data,
                outboard,
                meta,
                size,
                bitfield,
            })),
        }));
        self.entries.borrow_mut().insert(hash, entry.clone());
        Ok(entry)
    }

    /// register a known-complete entry from existing files (startup scan).
    /// `has_obao` is precomputed by the caller from a single directory
    /// listing (see `spawn_store`) — this used to re-list the whole
    /// directory per blob via `self.dir.list()`, making the startup scan
    /// O(n^2) in blob count; confirmed as the dominant cost of slow browser
    /// boot at scale via the periodic progress log below.
    async fn register_complete(&self, hash: Hash, has_obao: bool) -> io::Result<()> {
        let data = self.dir.open(&data_name(&hash)).await?;
        let size = data.len()?;
        let outboard = if has_obao {
            Some(self.dir.open(&obao_name(&hash)).await?)
        } else {
            None
        };
        let entry = Entry(Rc::new(EntryInner {
            hash,
            state: watch::Sender::new(EntryState::Complete(CompleteState {
                size,
                data,
                outboard,
            })),
        }));
        self.entries.borrow_mut().insert(hash, entry);
        Ok(())
    }

    /// flip a partial entry to complete: flush data + outboard, then delete
    /// the meta sidecar (ordering guarantees crash safety), dropping the
    /// outboard file entirely when it is empty.
    async fn finish_entry(&self, entry: &Entry<D::File>) -> io::Result<()> {
        // extract what we need under the borrow, flush outside of it
        struct FinishInfo<F: BlobFile> {
            data: F,
            outboard: F,
            size: u64,
        }
        let info = {
            let state = entry.0.state.borrow();
            match state.deref() {
                EntryState::Partial(p) => Some(FinishInfo {
                    data: p.data.clone(),
                    outboard: p.outboard.clone(),
                    size: p.size,
                }),
                EntryState::Complete(_) => None,
            }
        };
        let Some(info) = info else {
            return Ok(()); // already complete
        };
        info.data.flush()?;
        info.outboard.flush()?;
        let obao_len = info.outboard.len()?;
        let has_outboard = obao_len > 0;
        // meta delete LAST — its absence is the "complete" marker
        self.dir.delete(&meta_name(&entry.0.hash)).await?;
        if !has_outboard {
            self.dir.delete(&obao_name(&entry.0.hash)).await?;
        }
        entry.0.state.send_if_modified(|state| {
            if matches!(state, EntryState::Complete(_)) {
                return false;
            }
            *state = EntryState::Complete(CompleteState {
                size: info.size,
                data: info.data,
                outboard: if has_outboard {
                    Some(info.outboard)
                } else {
                    None
                },
            });
            true
        });
        Ok(())
    }

    async fn delete_blob(&self, hash: &Hash) -> io::Result<()> {
        self.entries.borrow_mut().remove(hash);
        self.dir.delete(&data_name(hash)).await?;
        self.dir.delete(&obao_name(hash)).await?;
        self.dir.delete(&meta_name(hash)).await?;
        Ok(())
    }

    async fn persist_tags(&self) -> io::Result<()> {
        let manifest = TagsManifest {
            tags: self
                .tags
                .borrow()
                .iter()
                .map(|(tag, value)| {
                    (
                        String::from_utf8_lossy(tag.0.as_ref()).to_string(),
                        (value.hash.to_hex().to_string(), format_to_str(value.format)),
                    )
                })
                .collect(),
        };
        let bytes = serde_json::to_vec(&manifest).map_err(io::Error::other)?;
        let file = self.dir.open("tags.json").await?;
        file.truncate(0)?;
        file.write_at(0, &bytes)?;
        file.flush()?;
        Ok(())
    }

    /// import from a fully-written source file (a temp file or in-memory
    /// bytes already written to `source`): compute the outboard by
    /// streaming the file, then copy into the final content-addressed
    /// files. memory: one chunk-group buffer + the outboard file writes.
    async fn import_from_file(
        &self,
        source: &D::File,
        size: u64,
        format: BlobFormat,
        tx: &irpc::channel::mpsc::Sender<AddProgressItem>,
    ) -> io::Result<Hash> {
        let tree = BaoTree::new(size, IROH_BLOCK_SIZE);

        // pass 1: outboard into a temp obao file
        let tmp_obao_id = self.next_import_id.get();
        self.next_import_id.set(tmp_obao_id + 1);
        let tmp_obao_name = format!("import-{tmp_obao_id}.obao.tmp");
        let tmp_obao = self.dir.open(&tmp_obao_name).await?;
        tmp_obao.truncate(0)?;
        let root = bao_tree::io::sync::outboard(
            FileReader {
                file: source,
                pos: 0,
                len: size,
            },
            tree,
            FileOutboardMut {
                tree,
                file: &tmp_obao,
            },
        )?;
        let hash: Hash = root.into();
        tx.send(AddProgressItem::OutboardProgress(size)).await.ok();

        // dedup: if the entry is already complete, drop the temp files
        if let Some(existing) = self.get(&hash) {
            if matches!(existing.0.state.borrow().deref(), EntryState::Complete(_)) {
                self.dir.delete(&tmp_obao_name).await?;
                return Ok(hash);
            }
        }

        // pass 2: copy source -> <hash>.data, temp obao -> <hash>.obao
        let data = self.dir.open(&data_name(&hash)).await?;
        data.truncate(0)?;
        let mut offset = 0u64;
        while offset < size {
            let n = CHUNK_COPY_SIZE.min((size - offset) as usize);
            let chunk = source.read_exact_at(offset, n)?;
            data.write_at(offset, &chunk)?;
            offset += n as u64;
        }
        data.flush()?;

        let obao_len = tmp_obao.len()?;
        let outboard = if obao_len > 0 {
            let obao = self.dir.open(&obao_name(&hash)).await?;
            obao.truncate(0)?;
            let mut offset = 0u64;
            while offset < obao_len {
                let n = CHUNK_COPY_SIZE.min((obao_len - offset) as usize);
                let chunk = tmp_obao.read_exact_at(offset, n)?;
                obao.write_at(offset, &chunk)?;
                offset += n as u64;
            }
            obao.flush()?;
            Some(obao)
        } else {
            None
        };
        self.dir.delete(&tmp_obao_name).await?;
        // no meta sidecar was ever written for this hash on this path,
        // unless a partial pre-existed — remove any stale one
        self.dir.delete(&meta_name(&hash)).await?;

        // register/flip the entry
        let entry = Entry(Rc::new(EntryInner {
            hash,
            state: watch::Sender::new(EntryState::Complete(CompleteState {
                size,
                data,
                outboard,
            })),
        }));
        // if an entry existed (partial), notify its observers via replace
        if let Some(existing) = self.get(&hash) {
            existing.0.state.send_if_modified(|state| {
                *state = EntryState::Complete(CompleteState {
                    size,
                    data: match entry.0.state.borrow().deref() {
                        EntryState::Complete(c) => c.data.clone(),
                        _ => unreachable!(),
                    },
                    outboard: match entry.0.state.borrow().deref() {
                        EntryState::Complete(c) => c.outboard.clone(),
                        _ => unreachable!(),
                    },
                });
                true
            });
        } else {
            self.entries.borrow_mut().insert(hash, entry);
        }
        let _ = format; // format only matters for the temp tag, minted by callers
        Ok(hash)
    }
}

/// spawn the actor over a storage dir; returns the ApiClient to wrap in a
/// Store. scans the directory for persisted blobs (complete + partial) and
/// the tags manifest before accepting commands.
pub async fn spawn_store<D: BlobDir + 'static>(
    dir: D,
    gc: Option<GcOptions>,
) -> io::Result<StoreClient> {
    let ctx = Rc::new(Ctx {
        dir,
        entries: RefCell::new(HashMap::new()),
        tags: RefCell::new(BTreeMap::new()),
        temp_tags: RefCell::new(TempTags::new()),
        tasks: Rc::new(TaskTracker::default()),
        next_import_id: Cell::new(1),
    });

    // startup scan: resume persisted state. logged (count + elapsed) since
    // this runs fresh on every worker boot (no cross-session warm cache
    // like the native FsStore's `has()` pre-check) - unlike the native
    // side, every blob here gets 2-3 real OPFS sync-access-handles opened
    // and held for the worker's whole lifetime, so this is the prime
    // suspect for slow/heavy browser boot at scale.
    let scan_started = Instant::now();
    let names = ctx.dir.list().await?;
    let mut metas = std::collections::HashSet::new();
    let mut obaos = std::collections::HashSet::new();
    for name in &names {
        if let Some(stem) = name.strip_suffix(".meta") {
            metas.insert(stem.to_string());
        }
        if let Some(stem) = name.strip_suffix(".obao") {
            obaos.insert(stem.to_string());
        }
    }
    info!(files = names.len(), "opfs-store: startup scan enumerated directory");
    let mut resumed_complete = 0usize;
    let mut resumed_partial = 0usize;
    for name in &names {
        if name.starts_with("import-") && name.ends_with(".tmp") {
            // leftover in-flight import from a previous session
            ctx.dir.delete(name).await.ok();
            continue;
        }
        if let Some(stem) = name.strip_suffix(".data") {
            let Ok(hash) = stem.parse::<Hash>() else {
                warn!("ignoring non-hash data file: {name}");
                continue;
            };
            if metas.contains(stem) {
                // partial — entry created lazily with its persisted
                // bitfield via get_or_create_entry
                ctx.get_or_create_entry(hash).await?;
                resumed_partial += 1;
                debug!("resumed partial blob {}", stem);
            } else {
                ctx.register_complete(hash, obaos.contains(stem)).await?;
                resumed_complete += 1;
                debug!("resumed complete blob {}", stem);
            }
            // TEMP DIAGNOSTIC (remove after boot-time investigation): periodic
            // progress log to see whether scan time grows linearly or
            // superlinearly with blob count.
            let done = resumed_complete + resumed_partial;
            if done % 500 == 0 {
                info!(
                    done,
                    elapsed_ms = scan_started.elapsed().as_millis(),
                    "opfs-store: startup scan progress"
                );
            }
        }
        if name == "tags.json" {
            let file = ctx.dir.open(name).await?;
            let len = file.len()?;
            if len > 0 {
                let bytes = file.read_exact_at(0, len as usize)?;
                if let Ok(manifest) = serde_json::from_slice::<TagsManifest>(&bytes) {
                    let mut tags = ctx.tags.borrow_mut();
                    for (name, (hash_hex, format)) in manifest.tags {
                        if let Ok(hash) = hash_hex.parse::<Hash>() {
                            tags.insert(
                                Tag::from(name.as_str()),
                                HashAndFormat {
                                    hash,
                                    format: format_from_str(&format),
                                },
                            );
                        }
                    }
                }
            }
        }
    }

    info!(
        complete = resumed_complete,
        partial = resumed_partial,
        elapsed_ms = scan_started.elapsed().as_millis(),
        "opfs-store: startup scan resumed blobs"
    );

    let (tx, rx) = tokio::sync::mpsc::channel::<Command>(32);
    let client: StoreClient = tx.clone().into();

    spawn(actor_loop(rx, ctx, gc));
    Ok(client)
}

async fn actor_loop<D: BlobDir + 'static>(
    mut rx: tokio::sync::mpsc::Receiver<Command>,
    ctx: Rc<Ctx<D>>,
    gc: Option<GcOptions>,
) {
    // gc tick: a deadline the loop checks between commands. n0_future's
    // sleep works on both targets; tokio::select! drives it alongside recv.
    let gc_interval = gc.as_ref().map(|g| g.interval);
    let mut gc_sleep = gc_interval.map(|d| Box::pin(n0_future::time::sleep(d)));

    loop {
        let cmd = if let Some(sleep) = gc_sleep.as_mut() {
            tokio::select! {
                cmd = rx.recv() => cmd,
                _ = sleep.as_mut() => {
                    if let Some(gc) = &gc {
                        run_gc_cycle(&ctx, gc).await;
                    }
                    gc_sleep = gc_interval.map(|d| Box::pin(n0_future::time::sleep(d)));
                    continue;
                }
            }
        } else {
            rx.recv().await
        };
        let Some(cmd) = cmd else {
            debug!("opfs-store actor: command channel closed");
            return;
        };
        if handle_command(cmd, &ctx).await.is_break() {
            return;
        }
    }
}

/// one mark/sweep gc cycle, running inside the actor with direct storage
/// access (the public delete api is pub(crate), so gc can't be external).
async fn run_gc_cycle<D: BlobDir + 'static>(ctx: &Rc<Ctx<D>>, gc: &GcOptions) {
    // wait for in-flight tasks (imports/exports) to settle — sweeping
    // under an active export could delete files mid-read
    if !ctx.tasks.is_idle() {
        trace!("opfs-store gc: tasks active, skipping this cycle");
        return;
    }

    let mut live: std::collections::HashSet<Hash> = std::collections::HashSet::new();
    if let Some(cb) = &gc.add_protected {
        match (cb)(&mut live).await {
            ProtectOutcome::Continue => {}
            ProtectOutcome::Abort => {
                debug!("opfs-store gc: protect callback aborted this cycle");
                return;
            }
        }
    }

    // mark: persistent tags + batch temp tags
    let mut roots: Vec<HashAndFormat> = ctx.tags.borrow().values().copied().collect();
    roots.extend(ctx.temp_tags.borrow().list());

    for root in roots {
        if live.insert(root.hash) && !root.format.is_raw() {
            // hashseq: the blob's content is a sequence of 32-byte child
            // hashes — read them straight out of the (complete) data file
            let Some(entry) = ctx.get(&root.hash) else {
                continue;
            };
            let state = entry.0.state.borrow();
            if let EntryState::Complete(c) = state.deref() {
                let size = c.size;
                let mut offset = 0u64;
                while offset + 32 <= size {
                    match c.data.read_exact_at(offset, 32) {
                        Ok(bytes) => {
                            let arr: [u8; 32] = bytes.try_into().unwrap();
                            live.insert(Hash::from_bytes(arr));
                        }
                        Err(e) => {
                            warn!("opfs-store gc: hashseq read failed: {e}");
                            break;
                        }
                    }
                    offset += 32;
                }
            }
        }
    }

    // sweep
    let all: Vec<Hash> = ctx.entries.borrow().keys().copied().collect();
    let mut deleted = 0usize;
    for hash in all {
        if !live.contains(&hash) {
            if let Err(e) = ctx.delete_blob(&hash).await {
                warn!("opfs-store gc: delete failed for {hash}: {e}");
            } else {
                deleted += 1;
            }
        }
    }
    if deleted > 0 {
        debug!(
            "opfs-store gc: deleted {deleted} blobs ({} live)",
            live.len()
        );
    }
}

async fn handle_command<D: BlobDir + 'static>(
    cmd: Command,
    ctx: &Rc<Ctx<D>>,
) -> std::ops::ControlFlow<()> {
    trace!("opfs-store command: {:?}", cmd);
    match cmd {
        Command::ImportBytes(ImportBytesMsg {
            inner:
                ImportBytesRequest {
                    data,
                    format,
                    scope,
                },
            tx,
            ..
        }) => {
            let _guard = ctx.tasks.begin();
            if let Err(e) = import_bytes(ctx, data, scope, format, &tx).await {
                warn!("opfs-store import_bytes failed: {e}");
                tx.send(AddProgressItem::Error(io::Error::other(e)))
                    .await
                    .ok();
            }
        }
        Command::ImportByteStream(ImportByteStreamMsg { inner, tx, rx, .. }) => {
            let _guard = ctx.tasks.begin();
            if let Err(e) = import_byte_stream(ctx, inner.scope, inner.format, rx, &tx).await {
                warn!("opfs-store import_byte_stream failed: {e}");
                tx.send(AddProgressItem::Error(io::Error::other(e)))
                    .await
                    .ok();
            }
        }
        Command::ImportBao(ImportBaoMsg {
            inner: ImportBaoRequest { hash, size },
            rx,
            tx,
            ..
        }) => {
            let entry = match ctx.get_or_create_entry(hash).await {
                Ok(e) => e,
                Err(e) => {
                    tx.send(Err(iroh_blobs::api::Error::io(
                        io::ErrorKind::Other,
                        format!("open entry failed: {e}"),
                    )))
                    .await
                    .ok();
                    return std::ops::ControlFlow::Continue(());
                }
            };
            let ctx2 = ctx.clone();
            let guard = ctx.tasks.begin();
            spawn(async move {
                let _guard = guard;
                import_bao(ctx2, entry, size.get(), rx, tx).await;
            });
        }
        Command::ExportBao(ExportBaoMsg {
            inner: ExportBaoRequest { hash, ranges, .. },
            tx,
            ..
        }) => {
            let entry = ctx.get(&hash);
            let guard = ctx.tasks.begin();
            spawn(async move {
                let _guard = guard;
                export_bao(entry, ranges, tx).await;
            });
        }
        Command::ExportRanges(ExportRangesMsg { inner, tx, .. }) => {
            let entry = ctx.get(&inner.hash);
            let guard = ctx.tasks.begin();
            spawn(async move {
                let _guard = guard;
                export_ranges(entry, inner, tx).await;
            });
        }
        Command::Observe(ObserveMsg {
            inner: ObserveRequest { hash },
            tx,
            ..
        }) => {
            let entry = match ctx.get_or_create_entry(hash).await {
                Ok(e) => e,
                Err(e) => {
                    warn!("opfs-store observe: open entry failed: {e}");
                    return std::ops::ControlFlow::Continue(());
                }
            };
            // deliberately NOT task-tracked: observe streams live until
            // the subscriber goes away and would wedge WaitIdle forever
            spawn(observe(entry, tx));
        }
        Command::BlobStatus(BlobStatusMsg {
            inner: BlobStatusRequest { hash },
            tx,
            ..
        }) => {
            let status = match ctx.get(&hash) {
                None => BlobStatus::NotFound,
                Some(entry) => {
                    let bitfield = entry.bitfield();
                    if bitfield.is_complete() {
                        BlobStatus::Complete {
                            size: bitfield.size(),
                        }
                    } else {
                        BlobStatus::Partial {
                            size: bitfield.validated_size(),
                        }
                    }
                }
            };
            tx.send(status).await.ok();
        }
        Command::ListBlobs(ListBlobsMsg { tx, .. }) => {
            let hashes: Vec<Hash> = ctx.entries.borrow().keys().copied().collect();
            let guard = ctx.tasks.begin();
            spawn(async move {
                let _guard = guard;
                for hash in hashes {
                    if tx.send(Ok(hash)).await.is_err() {
                        break;
                    }
                }
            });
        }
        Command::DeleteBlobs(DeleteBlobsMsg { inner, tx, .. }) => {
            let mut result = Ok(());
            for hash in &inner.hashes {
                if let Err(e) = ctx.delete_blob(hash).await {
                    result = Err(iroh_blobs::api::Error::io(
                        io::ErrorKind::Other,
                        format!("delete failed: {e}"),
                    ));
                }
            }
            tx.send(result).await.ok();
        }
        Command::Batch(BatchMsg { tx, rx, .. }) => {
            let scope_id = ctx.temp_tags.borrow_mut().create_scope();
            let ctx2 = ctx.clone();
            spawn(async move {
                handle_batch(ctx2, scope_id, tx, rx).await;
            });
        }
        Command::SetTag(SetTagMsg {
            inner: SetTagRequest { name, value },
            tx,
            ..
        }) => {
            ctx.tags.borrow_mut().insert(name, value);
            let res = ctx.persist_tags().await.map_err(|e| {
                iroh_blobs::api::Error::io(io::ErrorKind::Other, format!("persist tags: {e}"))
            });
            tx.send(res).await.ok();
        }
        Command::CreateTag(CreateTagMsg {
            inner: CreateTagRequest { value },
            tx,
            ..
        }) => {
            let tag = Tag::auto(n0_future::time::SystemTime::now(), |t| {
                ctx.tags.borrow().contains_key(t)
            });
            ctx.tags.borrow_mut().insert(tag.clone(), value);
            let res = match ctx.persist_tags().await {
                Ok(()) => Ok(tag),
                Err(e) => Err(iroh_blobs::api::Error::io(
                    io::ErrorKind::Other,
                    format!("persist tags: {e}"),
                )),
            };
            tx.send(res).await.ok();
        }
        Command::ListTags(ListTagsMsg { inner, tx, .. }) => {
            let tags: Vec<_> = ctx
                .tags
                .borrow()
                .iter()
                .filter(|(tag, value)| {
                    if let Some(from) = &inner.from {
                        if *tag < from {
                            return false;
                        }
                    }
                    if let Some(to) = &inner.to {
                        if *tag >= to {
                            return false;
                        }
                    }
                    (inner.raw && value.format.is_raw())
                        || (inner.hash_seq && value.format.is_hash_seq())
                })
                .map(|(tag, value)| {
                    Ok(TagInfo {
                        name: tag.clone(),
                        hash: value.hash,
                        format: value.format,
                    })
                })
                .collect();
            tx.send(tags).await.ok();
        }
        Command::DeleteTags(DeleteTagsMsg { inner, tx, .. }) => {
            {
                let mut tags = ctx.tags.borrow_mut();
                tags.retain(|tag, _| {
                    if let Some(from) = &inner.from {
                        if tag < from {
                            return true;
                        }
                    }
                    if let Some(to) = &inner.to {
                        if tag >= to {
                            return true;
                        }
                    }
                    false
                });
            }
            let res = ctx.persist_tags().await.map(|_| 0u64).map_err(|e| {
                iroh_blobs::api::Error::io(io::ErrorKind::Other, format!("persist tags: {e}"))
            });
            tx.send(res).await.ok();
        }
        Command::RenameTag(RenameTagMsg { inner, tx, .. }) => {
            let res = {
                let mut tags = ctx.tags.borrow_mut();
                match tags.remove(&inner.from) {
                    Some(value) => {
                        tags.insert(inner.to, value);
                        Ok(())
                    }
                    None => Err(iroh_blobs::api::Error::io(
                        io::ErrorKind::NotFound,
                        "tag not found",
                    )),
                }
            };
            let res = match res {
                Ok(()) => ctx.persist_tags().await.map_err(|e| {
                    iroh_blobs::api::Error::io(io::ErrorKind::Other, format!("persist tags: {e}"))
                }),
                Err(e) => Err(e),
            };
            tx.send(res).await.ok();
        }
        Command::CreateTempTag(CreateTempTagMsg { inner, tx, .. }) => {
            let mut tt = ctx.temp_tags.borrow_mut().create(inner.scope, inner.value);
            if tx.is_rpc() {
                tt.leak();
            }
            tx.send(tt).await.ok();
        }
        Command::ListTempTags(ListTempTagsMsg { tx, .. }) => {
            let tts = ctx.temp_tags.borrow().list();
            tx.send(tts).await.ok();
        }
        Command::SyncDb(SyncDbMsg { tx, .. }) => {
            tx.send(Ok(())).await.ok();
        }
        Command::WaitIdle(WaitIdleMsg { tx, .. }) => {
            if ctx.tasks.is_idle() {
                tx.send(()).await.ok();
            } else {
                ctx.tasks.waiters.borrow_mut().push(tx);
            }
        }
        Command::ClearProtected(cmd) => {
            // our protection lives in the gc protect callback, not in a
            // store-side set — nothing to clear
            cmd.tx.send(Ok(())).await.ok();
        }
        Command::Shutdown(ShutdownMsg { tx, .. }) => {
            debug!("opfs-store shutting down");
            // release entries (and their file handles), then close all
            // cached storage handles — they hold exclusive same-origin
            // locks that would block a successor store over this dir
            ctx.entries.borrow_mut().clear();
            ctx.dir.close_all();
            tx.send(()).await.ok();
            return std::ops::ControlFlow::Break(());
        }
        other => {
            // ImportPath / ExportPath — meaningless in the browser.
            // dropping the msg drops its tx, surfacing a channel error.
            debug!("opfs-store: unsupported command: {:?}", other);
        }
    }
    std::ops::ControlFlow::Continue(())
}

async fn handle_batch<D: BlobDir + 'static>(
    ctx: Rc<Ctx<D>>,
    scope_id: u64,
    tx: irpc::channel::oneshot::Sender<Scope>,
    mut rx: irpc::channel::mpsc::Receiver<BatchResponse>,
) {
    if tx.send(u64_to_scope(scope_id)).await.is_err() {
        ctx.temp_tags.borrow_mut().end_scope(scope_id);
        return;
    }
    loop {
        match rx.recv().await {
            Ok(Some(BatchResponse::Drop(content))) => {
                // client-side drop notification for a batch temp tag
                ctx.temp_tags.borrow_mut().drop_one(scope_id, &content);
            }
            Ok(Some(BatchResponse::Ping)) => {}
            Ok(None) | Err(_) => break,
        }
    }
    ctx.temp_tags.borrow_mut().end_scope(scope_id);
}

/// ImportBytes: the payload is already in memory (that's the api contract)
/// — write it to the data file, then run the shared from-file import.
async fn import_bytes<D: BlobDir + 'static>(
    ctx: &Rc<Ctx<D>>,
    data: Bytes,
    scope: Scope,
    format: BlobFormat,
    tx: &irpc::channel::mpsc::Sender<AddProgressItem>,
) -> io::Result<()> {
    tx.send(AddProgressItem::Size(data.len() as u64)).await.ok();
    let tmp_id = ctx.next_import_id.get();
    ctx.next_import_id.set(tmp_id + 1);
    let tmp_name = format!("import-{tmp_id}.tmp");
    let tmp = ctx.dir.open(&tmp_name).await?;
    tmp.truncate(0)?;
    let mut offset = 0usize;
    while offset < data.len() {
        let end = (offset + CHUNK_COPY_SIZE).min(data.len());
        tmp.write_at(offset as u64, &data[offset..end])?;
        offset = end;
    }
    drop(data);
    tx.send(AddProgressItem::CopyDone).await.ok();
    let size = tmp.len()?;
    let hash = ctx.import_from_file(&tmp, size, format, tx).await?;
    ctx.dir.delete(&tmp_name).await?;
    let tt = ctx
        .temp_tags
        .borrow_mut()
        .create(scope, HashAndFormat { hash, format });
    tx.send(AddProgressItem::Done(tt)).await.ok();
    Ok(())
}

/// ImportByteStream: chunks spill straight to a temp file — the full
/// payload never exists in memory.
async fn import_byte_stream<D: BlobDir + 'static>(
    ctx: &Rc<Ctx<D>>,
    scope: Scope,
    format: BlobFormat,
    mut rx: irpc::channel::mpsc::Receiver<ImportByteStreamUpdate>,
    tx: &irpc::channel::mpsc::Sender<AddProgressItem>,
) -> io::Result<()> {
    let tmp_id = ctx.next_import_id.get();
    ctx.next_import_id.set(tmp_id + 1);
    let tmp_name = format!("import-{tmp_id}.tmp");
    let tmp = ctx.dir.open(&tmp_name).await?;
    tmp.truncate(0)?;
    let mut offset = 0u64;
    loop {
        match rx.recv().await {
            Ok(Some(ImportByteStreamUpdate::Bytes(chunk))) => {
                tmp.write_at(offset, &chunk)?;
                offset += chunk.len() as u64;
                tx.send(AddProgressItem::CopyProgress(offset)).await.ok();
            }
            Ok(Some(ImportByteStreamUpdate::Done)) => break,
            Ok(None) | Err(_) => {
                ctx.dir.delete(&tmp_name).await.ok();
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "byte stream ended unexpectedly",
                ));
            }
        }
    }
    tx.send(AddProgressItem::Size(offset)).await.ok();
    tx.send(AddProgressItem::CopyDone).await.ok();
    let hash = ctx.import_from_file(&tmp, offset, format, tx).await?;
    ctx.dir.delete(&tmp_name).await?;
    let tt = ctx
        .temp_tags
        .borrow_mut()
        .create(scope, HashAndFormat { hash, format });
    tx.send(AddProgressItem::Done(tt)).await.ok();
    Ok(())
}

fn chunk_range(leaf: &Leaf) -> ChunkRanges {
    let start = ChunkNum::chunks(leaf.offset);
    let end = ChunkNum::chunks(leaf.offset + leaf.data.len() as u64);
    (start..end).into()
}

/// receive verified bao content into a partial entry, writing leaves and
/// parents INCREMENTALLY to the entry's files (bounded memory) and
/// persisting the bitfield to the meta sidecar; flips to Complete when the
/// bitfield fills.
async fn import_bao<D: BlobDir + 'static>(
    ctx: Rc<Ctx<D>>,
    entry: Entry<D::File>,
    size: u64,
    mut stream: irpc::channel::mpsc::Receiver<BaoContentItem>,
    tx: irpc::channel::oneshot::Sender<iroh_blobs::api::Result<()>>,
) {
    entry.0.state.send_if_modified(|state| {
        if let EntryState::Partial(p) = state {
            p.size = size;
        }
        false
    });
    let tree = BaoTree::new(size, IROH_BLOCK_SIZE);
    loop {
        let item = match stream.recv().await {
            Ok(Some(item)) => item,
            Ok(None) => break,
            Err(e) => {
                warn!("opfs-store import_bao stream error: {e:?}");
                break;
            }
        };
        let mut io_error: Option<io::Error> = None;
        let mut completed = false;
        entry.0.state.send_if_modified(|state| {
            let EntryState::Partial(partial) = state else {
                return false; // already complete
            };
            let result: io::Result<bool> = (|| {
                match &item {
                    BaoContentItem::Parent(parent) => {
                        if let Some(offset) = tree.pre_order_offset(parent.node) {
                            let mut pair = [0u8; 64];
                            pair[..32].copy_from_slice(parent.pair.0.as_bytes());
                            pair[32..].copy_from_slice(parent.pair.1.as_bytes());
                            partial.outboard.write_at(offset * 64, &pair)?;
                        }
                        Ok(false)
                    }
                    BaoContentItem::Leaf(leaf) => {
                        partial.data.write_at(leaf.offset, &leaf.data)?;
                        let added = chunk_range(leaf);
                        let update = partial.bitfield.update(&Bitfield::new(added, size));
                        // persist the bitfield so a reload resumes here
                        let meta_bytes =
                            serde_json::to_vec(&PartialMeta::from_bitfield(&partial.bitfield))
                                .map_err(io::Error::other)?;
                        partial.meta.truncate(0)?;
                        partial.meta.write_at(0, &meta_bytes)?;
                        if update.new_state().complete {
                            completed = true;
                        }
                        Ok(update.changed())
                    }
                }
            })();
            match result {
                Ok(changed) => changed,
                Err(e) => {
                    io_error = Some(e);
                    false
                }
            }
        });
        if let Some(e) = io_error {
            warn!("opfs-store import_bao write failed: {e}");
            tx.send(Err(iroh_blobs::api::Error::io(
                io::ErrorKind::Other,
                format!("storage write failed: {e}"),
            )))
            .await
            .ok();
            return;
        }
        if completed {
            if let Err(e) = ctx.finish_entry(&entry).await {
                warn!("opfs-store: completing blob failed: {e}");
                tx.send(Err(iroh_blobs::api::Error::io(
                    io::ErrorKind::Other,
                    format!("finalize failed: {e}"),
                )))
                .await
                .ok();
                return;
            }
        }
    }
    tx.send(Ok(())).await.ok();
}

/// stream a verified bao encoding of the requested ranges.
async fn export_bao<F: BlobFile>(
    entry: Option<Entry<F>>,
    ranges: ChunkRanges,
    mut sender: irpc::channel::mpsc::Sender<EncodedItem>,
) {
    let Some(entry) = entry else {
        let err = EncodeError::Io(io::Error::new(io::ErrorKind::NotFound, "hash not found"));
        sender.send(err.into()).await.ok();
        return;
    };
    let size = entry.0.state.borrow().size();
    let data = DataReader(entry.clone());
    let outboard = OutboardReader {
        hash: entry.0.hash.into(),
        tree: BaoTree::new(size, IROH_BLOCK_SIZE),
        entry,
    };
    let mut tx = EncodedItemSender(&mut sender);
    traverse_ranges_validated(data, outboard, &ranges, &mut tx)
        .await
        .ok();
}

/// stream raw byte ranges (unverified reads gated by the bitfield).
async fn export_ranges<F: BlobFile>(
    entry: Option<Entry<F>>,
    cmd: ExportRangesRequest,
    tx: irpc::channel::mpsc::Sender<ExportRangesItem>,
) {
    let Some(entry) = entry else {
        let err = io::Error::new(io::ErrorKind::NotFound, "hash not found");
        tx.send(ExportRangesItem::Error(err.into())).await.ok();
        return;
    };
    let bitfield = entry.bitfield();
    let data = DataReader(entry);
    let size = bitfield.size();
    for range in cmd.ranges.iter() {
        let range = match range {
            RangeSetRange::Range(r) => size.min(*r.start)..size.min(*r.end),
            RangeSetRange::RangeFrom(r) => size.min(*r.start)..size,
        };
        let requested = ChunkRanges::bytes(range.start..range.end);
        if !bitfield.ranges.is_superset(&requested) {
            tx.send(ExportRangesItem::Error(
                io::Error::other(format!(
                    "missing range: {requested:?}, present: {bitfield:?}"
                ))
                .into(),
            ))
            .await
            .ok();
            return;
        }
        let bs = 1024;
        let mut offset = range.start;
        loop {
            let end: u64 = (offset + bs).min(range.end);
            let chunk_size = (end - offset) as usize;
            match data.read_bytes_at(offset, chunk_size) {
                Ok(bytes) => {
                    if tx
                        .send(
                            Leaf {
                                offset,
                                data: bytes,
                            }
                            .into(),
                        )
                        .await
                        .is_err()
                    {
                        return;
                    }
                }
                Err(e) => {
                    tx.send(ExportRangesItem::Error(e.into())).await.ok();
                    return;
                }
            }
            offset = end;
            if offset >= range.end {
                break;
            }
        }
    }
}

/// stream bitfield snapshots: current state immediately, then on change.
async fn observe<F: BlobFile>(entry: Entry<F>, tx: irpc::channel::mpsc::Sender<Bitfield>) {
    let mut receiver = entry.0.state.subscribe();
    let value = receiver.borrow().bitfield();
    if tx.send(value).await.is_err() {
        return;
    }
    loop {
        tokio::select! {
            _ = tx.closed() => return,
            res = receiver.changed() => {
                if res.is_err() {
                    return; // sender dropped
                }
            }
        }
        let value = receiver.borrow().bitfield();
        if tx.send(value).await.is_err() {
            return;
        }
    }
}
