# iroh blob references and file relocation

## status

confirmed against the installed `iroh-blobs` 0.103.1 source and a real, temporary
FsStore reproduction. this is a separate follow-up, not a completed relocation
fix. do not edit the private redb format or delete an existing P2P store to work
around it.

the new storage-migration flow conservatively blocks **move existing files**
when `<data_dir>/freqhole-blobz/blobs.db` exists. it does not inspect that index
and claim every blob is affected. selecting a fresh data folder and changing
the folder for **future fetches only** remain available.

## which store did we implement?

there are two different storage layers:

1. **our canonical-file/metadata layer:** reliquary's
   [`SqliteBlobStore`](../lib/reliquary/rust/src/blobz.rs), backed by
   `reliquary.db`, with managed files under `<data_dir>/blob-files/`.
   `BlobRecord.path` is relative to that managed directory for owned files;
   external records instead hold the caller's path. `path_for()` distinguishes
   those cases. grimoire also keeps `media_blobz.local_path` in its main SQLite
   database.
2. **the transport/verification layer:** upstream
   `iroh_blobs::store::fs::FsStore`, loaded under
   `<data_dir>/freqhole-blobz/`. our
   [`StorageNode`](../lib/reliquary/rust/src/node.rs) wraps that store, adds GC
   protection, and attaches the downloader/transport. it does **not** replace
   upstream FsStore's internal path handling.

[`grimoire::database::storage_node`](../grimoire/src/database.rs) constructs
both layers. updating our SQLite records does not automatically update the
upstream store's metadata.

## where are the absolute paths?

the upstream file `<data_dir>/freqhole-blobz/blobs.db` is a **redb database,
not SQLite**, despite its filename. its `blobs-0` table stores entry state.
complete external entries contain `DataLocation::External(Vec<PathBuf>, size)`.

verified upstream sources for 0.103.1:

- [`store/fs.rs`](https://docs.rs/crate/iroh-blobs/0.103.1/source/src/store/fs.rs):
  `FsStore::load()` uses `root.join("blobs.db")`; imports persist
  `ImportSource::External` as `DataLocation::External`.
- [`store/fs/meta/tables.rs`](https://docs.rs/crate/iroh-blobs/0.103.1/source/src/store/fs/meta/tables.rs):
  the `blobs-0` redb table maps hashes to `EntryState`.
- [`store/fs/import.rs`](https://docs.rs/crate/iroh-blobs/0.103.1/source/src/store/fs/import.rs):
  `import_path_impl()` requires an absolute path. above the configured
  inline-data threshold, `TryReference` keeps an external path; it is not a
  hardlink operation.
- [`store/fs/entry_state.rs`](https://docs.rs/crate/iroh-blobs/0.103.1/source/src/store/fs/entry_state.rs):
  merging two external entries combines, sorts, and deduplicates their paths.
  it does not remove a stale old path.
- [`store/fs/bao_file.rs`](https://docs.rs/crate/iroh-blobs/0.103.1/source/src/store/fs/bao_file.rs):
  opening an external entry selects `paths.into_iter().next()` and opens that
  path. it does not try the remaining paths if the first one is missing.

not every blob is external: small imports can be inline, and owned blobs have
their data in the store. the move problem applies to affected external entries,
not to all content indiscriminately.

some comments in [`blobz/blake3.rs`](../grimoire/src/blobz/blake3.rs) speculate
about hardlinks/cross-device reference imports. those comments are misleading
for this installed version and should be corrected with the actual fix.

## verified reproduction

the test
`upstream_reference_paths_survive_reopen_and_reimport_does_not_replace_them`
in [storage migration tests](../grimoire/src/storage_migration/tests.rs):

1. creates a 1 MiB file named `a-old.flac` in a temporary directory.
2. imports it with `TryReference`, syncs and shuts down the real FsStore.
3. renames it to `z-new.flac`, then reopens the store.
4. verifies that reading the original hash fails.
5. imports the new path for the same hash, syncs/shuts down, and reopens again.
6. verifies that reading still fails: the missing `a-old.flac` remains first.

run:

```sh
cargo test -p grimoire --lib --no-default-features \
  storage_migration::tests::upstream_reference_paths_survive_reopen_and_reimport_does_not_replace_them
```

this proves the local store behavior, including persistence across reopen. it
does not claim that a real Pi transfer or every existing library has been
examined. an open/cached file handle can also temporarily hide a stale path
until the store is reopened.

## existing paths needing an audit

| surface | current evidence | follow-up |
| --- | --- | --- |
| data-directory move | changes the root of managed media and copies the transport store | relocate external references, not just SQLite paths |
| fetched-directory migration | moves external media while keeping the transport store in place | replace old references before deleting source files |
| move scanned directory | [`move_dir.rs`](../grimoire/src/music/scanner/move_dir.rs) already re-imports new paths when `refresh_blobs_store` is enabled | successful re-import is not proof the old path was removed; test both lexical path orders |
| reorganize music/video | [`reorganize_library.rs`](../grimoire/src/maintenance/reorganize_library.rs) moves files and calls `relocate_blob()` | audit the transport index as well as `media_blobz` and the reliquary mirror |
| tag embedding/content changes | reorganization can rewrite bytes and change the content hash | retire the old hash/reference correctly, not merely change the SQL row |
| removable disk remounts | the same file can appear at a different mount path | distinguish offline, remapped, and genuinely missing references |
| mobile container relocation | startup repairs stale config/media paths | determine which upstream transport entries need repair too |
| managed blob adoption/export | [`node.rs`](../lib/reliquary/rust/src/node.rs), [`blobz.rs`](../lib/reliquary/rust/src/blobz.rs), and [`snatch.rs`](../lib/reliquary/rust/src/snatch.rs) move/adopt/export data | verify ownership and reference handoffs, including GC protection |
| manual moves/deletes and rescans | files can disappear without our move helper | detect stale references and report/repair them without inventing success |

these are audit targets, not a claim that every row is already broken.
`relocate_blob()` updates our SQL metadata/mirror; it is not itself an upstream
FsStore reference-replacement operation.

## work needed

### 1. establish the desired contract

- decide whether the long-term source of truth is our canonical blob store,
  a path resolver keyed by content hash, or explicit upstream reference paths.
- preserve reference-only storage by default; do not silently double large media
  collections by changing imports to copy mode.
- define how multiple legitimate paths for one hash are handled: removing one
  stale reference must not remove another owner's valid reference.
- decide how missing media differs from corrupt bytes or a disconnected disk.

### 2. provide a supported reference-relocation primitive

prefer a supported upstream API or a deliberately maintained adapter/change,
not direct edits to private redb tables. the operation must:

- enumerate/inspect the relevant external references.
- replace/remove a particular old reference, not append an alternative and
  assume the reader will find it.
- verify the new path's bytes/hash before committing.
- invalidate cached readers where needed.
- persist atomically and survive process restart.
- preserve tags, inline/owned data, outboards, partial transfers, and GC roots.
- fail explicitly if an actively served/downloaded blob cannot be relocated.

upstream reader fallback across existing paths would improve resilience, but
would not by itself give us a full relocation/ownership/cleanup contract.

### 3. wire all file-moving callers

use one shared contract across grimoire and reliquary. sequence each move as:
copy without clobbering, verify, commit our metadata **and** transport references,
prove a reopened store can read the blob, then delete the old file. integrate
that with the durable storage-migration journal and recovery states.

for external media edits, explicitly rehash and reconcile old/new hashes. do
not assume same filename or similar filesize means identical bytes.

### 4. repair existing installations without losing data

- build a read-only audit/report first.
- match affected hashes to verified canonical/external files.
- dry-run the repair, preserve a recovery copy, and make it resumable.
- do not delete the whole transport store: it may contain owned/inline content,
  tags and partial downloads that are not safely reconstructible elsewhere.
- only remove the conservative move gate once migration and repair are tested.

### 5. regression matrix

test both lexical path orders, same-volume rename and cross-volume copy,
identical/different-name collisions, multiple owners of one hash, inline/owned/
external blobs, restarts at every cutover stage, active readers, missing disks,
remounts, GC, partial downloads, and content-changing tag edits.

finish with a real verified P2P transfer **after source removal and store
reopen**, not just `has(hash)`, SQL inspection, or a successful re-import.
