# blob transfer (opfs, no memstore) + sha256/blake3 hygiene + send-to-remote de-duplication — plan

## why this doc exists

spume (browser/wasm client) currently buffers entire audio/video blobs in
memory during p2p transfers, and has scattered sha256/blake3/id field
confusion left over from a legacy sha256-first design. this was raised as
"go verify/fix this," and digging into it revealed the real fix is smaller
and more re-usable than it first looked — **skein already solved the hard
part** (a persistent, disk-backed, worker-hosted midden node) and spume
just never adopted it. this doc is the task list for adopting it, not
inventing anything new.

**ground rule for every phase below: re-wire onto the existing abstraction
(`WorkerMiddenNode`, `OpfsStore`, reliquary's blob store) — do not invent a
parallel mechanism.** if a capability spume needs isn't exposed yet, extend
the existing worker contract (mirroring how every other method there is
shaped), don't build a second path around it.

## key findings (verified by reading the actual code, not assumed)

1. **midden already has a real, tested, OPFS-backed iroh-blobs store**
   (`lib/midden/src/opfs_store/`) — `OpfsStore`, incremental partial-blob
   writes (`<hash>.data`/`.obao`/`.meta`), survives reload, has gc. this is
   NOT a stub — it has its own selftest + persistence selftest
   (`opfs_store_selftest`/`opfs_store_selftest_persistence`, wasm-bindgen
   exposed) and a full native test suite (`opfs_store/tests.rs`).
2. **`MiddenNodeOptions.opfs_store_dir` already opts into it** —
   `build_blobs_store()` in `lib/midden/src/lib.rs` tries `OpfsStore::new()`
   first when a dir is given, falls back to `MemStore` only on error/when
   omitted. **spume's `getMiddenNode()` (`client/spume/src/app/api/client.ts`)
   never sets this field** — that's the entire reason spume is on
   `MemStore` today. Not a missing feature, a missing one-line option.
3. **but setting that option alone won't work for spume as it's wired
   today**, because `FileSystemSyncAccessHandle` (what `OpfsStore` needs
   for real file I/O) **only works inside a dedicated Worker** — a window
   context fails at `open()` (see `lib/midden/src/opfs_store/opfs.rs`'s own
   doc comment). spume currently constructs `MiddenNode` directly on the
   **main thread** (`client.ts`). so the real prerequisite is: **move
   spume's midden node into a worker.**
4. **that migration is not greenfield either — `@freqhole/reliquary/worker`
   already exports a production-proven main-thread facade for exactly
   this**: `WorkerMiddenNode` / `WorkerBiStream` / `WorkerImportSession`
   (`lib/reliquary/ts/src/worker/midden-worker-client.ts`), talking to a
   worker entry via Comlink (`midden-worker-contract.ts`'s `MiddenWorkerApi`).
   **skein already runs this exact setup in production**
   (`skein/loam/src/workers/midden-worker.ts`), including the missing
   piece spume will also need: a `navigator.locks` web-lock
   (`acquireStoreLock()`) so only one tab at a time owns the persistent
   OPFS store, with graceful in-memory fallback for extra tabs.
   spume already depends on `@freqhole/reliquary` (`music/services/storage/blobs.ts`,
   `video/import/localImport.ts` already import from it) — no new
   dependency, just a new import path.
5. **gap check — `WorkerMiddenNode` vs what `WasmTransport.ts`'s
   `MiddenNodeLike` interface actually needs**: mostly a 1:1 match
   (`node_id`, `secret_key`, streams, `import_blob`/`start_import`, every
   `download_verified*` variant). concrete gaps found:
   - `api_request` (required, no `?`) — the worker contract instead calls
     this `proxy_request`/`proxyRequest`. same functionality, different
     name. **rename at the call site, don't add a duplicate method.**
   - `start_blob_server` — not in the worker contract at all. need to
     verify whether it's even still necessary (the node's `BlobsProtocol`
     appears to register itself unconditionally at construction time in
     `create_with_secret_key` — `start_blob_server` may be legacy/no-op by
     now). **verify before assuming a new worker method is needed.**
   - `proxy_admin` / `tune_radio` — real midden wasm-bindgen methods
     spume uses (admin/1 ALPN dispatch, radio broadcast tune-in) that
     skein's worker never needed and so never exposed. **extend
     `MiddenWorkerApi`/`midden-worker-client.ts` with these two**, mirroring
     the exact shape of every other exposed method there — this is
     the _only_ new code this whole plan actually calls for; everything
     else is re-wiring existing pieces.
   - `release_blob` is `void` (sync, fire-and-forget) in `MiddenNodeLike`
     but `Promise<void>` on `WorkerMiddenNode` — trivial call-site fix
     (don't await, or loosen the interface — decide during phase 1).

## non-goals (explicitly out of scope for this plan)

- a full sha256 -> blake3 primary-key migration for the local `songs` IDB
  store. **do not attempt this.** chip away at hygiene around the edges
  (below) without touching `Song.id`'s existing meaning.
- changing charnel/native behavior at all — already confirmed optimal
  (grimoire's own disk-backed `FsStore` iroh-blobs pull, zero JS/IPC
  buffering for sync-to-local). this plan is 100% about the plain-browser
  (wasm) path.
- rewriting `sendToRemote.ts`/`sendVideosToRemote.ts`'s actual sync
  protocol (server-to-server iroh-blobs pull) — already confirmed clean,
  no client buffering. the de-duplication phase below is about the
  _client-side orchestration code_ around them, not the wire protocol.

---

## phase 1 — worker-hosted midden node with persistent OPFS store (spume)

the prerequisite everything else builds on. mirror skein's
`loam/src/workers/midden-worker.ts` as closely as possible — don't
redesign the pattern, port it.

1. add a new worker entry file for spume (e.g.
   `client/spume/src/app/api/middenWorker.ts`), modeled directly on
   skein's `midden-worker.ts`: imports `MiddenNode`/`MiddenNodeOptions`
   from midden's wasm package, exposes a `Comlink`-wrapped API object,
   posts `MIDDEN_WORKER_READY_MESSAGE` after `Comlink.expose()`.
   - reuse skein's single-tab web-lock pattern (`acquireStoreLock()` via
     `navigator.locks.request`) so a second spume tab degrades to
     in-memory instead of fighting over the same OPFS directory.
   - spume-specific ALPNs (`PLAYER_ALPN` etc, currently set via
     `options.extra_alpns` in `client.ts`) need to flow into this worker's
     `init()` the same way skein passes its own ALPNs.
2. extend `@freqhole/reliquary/worker`'s `MiddenWorkerApi` contract +
   `midden-worker-client.ts`'s `WorkerMiddenNode` with the two verified
   gaps: `proxy_admin`/`proxyAdmin` and `tune_radio`/`tuneRadio` (radio's
   streaming chunk callback needs the same `Comlink.proxy()` treatment
   `onProgress`/`onChunk` already get elsewhere in that file). mirror the
   existing methods' shape exactly — same transfer/proxy conventions.
3. verify (don't assume) whether `start_blob_server` is still meaningful
   on current midden, or dead/no-op now that `BlobsProtocol` registers at
   construction. if genuinely needed, add it to the worker contract too;
   if not, delete the `client.ts` call and its `MiddenNodeLike` interface
   entry.
4. rewrite `client/spume/src/app/api/client.ts`'s `getMiddenNode()` to
   construct a `WorkerMiddenNode` (via `WorkerMiddenNode.create(secretKey,
() => new Worker(...))`) instead of calling `MiddenNode.create_with_options`
   directly. persisted-identity load/save logic stays the same (still
   just secret key bytes in IndexedDB) — only the construction call
   changes.
   - set `options.opfs_store_dir` (some stable directory name, e.g.
     `"spume-blob-store"`) — the one line that was always missing.
5. fix the one confirmed naming mismatch: `WasmTransport.ts`'s calls to
   `node.api_request(...)` need to call whatever the migrated node
   actually exposes (`proxy_request`, per the worker contract) — either
   rename the call site or add a thin `api_request` alias on
   `WorkerMiddenNode` that forwards to `proxy_request`. prefer the call-
   site rename (fewer names for the same thing).
6. `release_blob` sync/async mismatch: audit every spume call site of
   `release_blob` and either drop the (previously unused) return value or
   `void`-await it — small, mechanical.
7. full regression pass: `npm run verify` in spume, plus a real manual
   p2p transfer test (send-to-remote between two browser tabs, and a
   plain sync-to-local pull) — this phase changes the load-bearing p2p
   transport for every existing feature (playback, radio, admin, sharing),
   so it needs real exercise, not just typecheck.

**expected outcome of phase 1 alone**: every existing p2p blob transfer
(playback, sync-to-local, send-to-remote, radio) is already writing
incrementally to real OPFS storage instead of being fully buffered in wasm
`MemStore`/JS memory — with **zero changes** to `syncSongToLocal.ts`,
`syncVideoToLocal.ts`, or `WasmTransport.ts`'s download logic. this is the
single highest-value, lowest-new-code phase in this whole plan.

---

## phase 2 — re-wire sync-to-local to stop double-storing

once phase 1 lands, a synced song/video's bytes exist in TWO places on
disk: midden's own OPFS blob store (content-addressed by blake3) AND
spume's own `music/services/opfs/helpers.ts` `audio/` directory
(filename-by-sha256) / `video/services/opfs/helpers.ts` equivalent — because
`syncSongToLocal.ts`/`syncVideoToLocal.ts` still do
`getBlobUrlWithProgress()` -> `fetch().blob()` -> `writeAudioToOPFS()`,
re-copying bytes that are already durably on disk.

1. investigate whether midden can expose a **direct file handle / stream
   for an already-complete local blob** (not a peer download) — check for
   an existing wasm-bindgen method along these lines first (none found in
   this pass's search: only `import_blob`/`import_blob_and_export_bao`
   exist for the _write_ side). if genuinely missing, this is the one
   place a **small, additive** midden API might be warranted — a
   `get_local_blob_bytes(blake3) -> Option<stream>`-shaped method — but
   only after confirming reuse isn't possible some other way (e.g. can
   `OpfsDir`'s own file handles be exposed for a hash already known
   complete via `has_complete_blob`?).
2. if a direct-handle path is feasible: change `syncSongToLocal.ts`
   (browser branch)/`syncVideoToLocal.ts` (P2P branch) to, once a p2p
   download completes into midden's store, read the bytes _once_ — via
   whatever streaming primitive phase 2.1 exposes — directly into spume's
   own OPFS destination, instead of the current
   assemble-whole-Uint8Array-then-Blob-then-second-OPFS-write path.
3. if a direct-handle path is NOT feasible in a reasonable scope: at
   minimum, confirm `getBlobUrlWithProgress`'s internal chunk-accumulation
   (`WasmTransport.ts`'s `chunks: Uint8Array[]` -> one big `Uint8Array`)
   is now reading FROM the OPFS-backed store (cheap, already-persisted
   disk reads) rather than a `MemStore` — this alone bounds _download_
   memory even if the final JS-side re-assembly still happens once for
   the write into spume's own library structure. Document this as an
   accepted, bounded cost (one buffer-sized copy, not the _download_
   itself being memory-resident) rather than silently leaving it unclear.
4. either way: **do not build a second, parallel "streaming sync" code
   path alongside the existing one** — this phase should look like
   deleting the `.blob()`/re-write step, not adding a new function next
   to it.

---

## phase 3 — sha256/blake3/id field hygiene (chip away, no full migration)

scope: touch this ONLY in code already being modified by phases 1/2, plus
a few clearly-bounded, low-risk cleanups called out explicitly below. do
not go rename every existing legit `sha256` usage — see
`/memories/repo/tomb-sha256-vs-blake3-vs-id.md`'s existing standing rule.

1. **naming rule going forward for any code touched in phases 1/2**: a
   field/param that holds a blake3 value must be named `blake3` — never a
   generic `id`, never (even temporarily/as a stand-in) `sha256`. a
   field/param that's a client-side tracking key (song sha256 OR a
   video's own uuid — see `preCacheP2PBlob`'s doc comment for the
   already-correct template) stays named `trackingId`, not `sha256`.
2. re-audit (already done once this session, came back clean) any new
   code phases 1/2 touch for the mislabeling anti-pattern — a real blake3
   value sitting in a field literally named `sha256` (found and fixed
   previously in `mediaRefResolve.ts`; that instance is fine as-is, has a
   correct doc comment explaining the deliberate stand-in — don't touch it
   again without a real reason).
3. **rust struct sha256 requirement**: check whether `sync_song_by_blake3`'s
   request struct (grimoire `offal/sync/song.rs`) still requires a non-empty
   `sha256` field, or already tolerates the empty-string sentinel
   (`mediaRefResolve.ts`'s comment implies this was already fixed — verify
   directly against the current struct/handler, don't assume). if it's
   still effectively required for some code path, that's a candidate to
   relax (`Option<String>` instead of `String`) — but only that one
   route, not a workspace-wide sweep.
4. do NOT touch: `Song.id`'s existing meaning (`sha256` for synced rows, a
   random uuid for locally-created rows), `getSongBySha256`, `by_sha256`
   IDB index, `PlaylistItem.entity_id`'s "song sha256 or video id"
   convention. all of these are pre-existing, working, and out of scope —
   flagged here explicitly so future work doesn't accidentally treat them
   as bugs.

---

## phase 4 — reduce music/video send-to-remote duplication

`sendToRemote.ts` (music) and `sendVideoToRemote.ts` (video) are
structurally near-identical (progress shape, blake3-based skip-existing
probe, per-item sync loop, error classification) but fully duplicated
files, and `SendToRemoteSection.tsx` already has to branch on `p.kind`
with a hand-rolled `progressCounts()` normalizer to paper over the two
shapes (added this session — a real, working shim, but exactly the kind
of "second variation" that should collapse once this phase lands).

1. extract a single generic sender, parameterized over:
   - the per-item sync route (`/api/sync/song-by-blake3` vs
     `/api/sync/video-by-blake3`),
   - the per-item body builder,
   - the progress shape (already unified in spirit by `progressCounts()` —
     promote that to the REAL shape both orchestrators emit, retiring
     `SendProgress`/`SendVideoProgress` as two separate types).
2. once unified, `SendToRemoteSection.tsx`'s `p.kind === "video"` branches
   collapse back to a single code path — delete the `AnyProgress`/
   `progressCounts()` shim added this session (it was a deliberately
   minimal, contained patch given the scope at the time — this phase is
   its intended follow-up, not a permanent second variation).
3. `bulkSendJobs.ts` (this session's new bulk-send registry) already
   isolates album-vs-video iteration behind `startBulkAlbumSend`/
   `startBulkVideoSend` — once phase 4.1 lands, these two collapse into
   one generic `startBulkSend(kind, items, source, dest)` as well.

---

## suggested order / risk notes

phase 1 is the highest-value, most self-contained piece and should go
first — everything else (phase 2, and even phase 3's "was sha256 already
relaxed" question) is easier to verify once the transport layer is
settled. phase 1 is also the riskiest for regressions (it's the load-
bearing p2p transport for the whole app), so it needs real manual
p2p-transfer testing, not just `npm run verify`.

phase 4 (dedup) can happen independently/in parallel with phases 1-3 if
useful — it doesn't depend on the OPFS work at all, it's purely a TS
refactor of already-working code.
