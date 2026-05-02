# sibyl

prototype player exploring **webcodecs + iroh-blobs + opfs**. forked
from `client/dumb-player/`. see
[`docs/sibyl-webcodecs-iroh-plan.md`](../../docs/sibyl-webcodecs-iroh-plan.md)
for the full design + phase plan.

two surfaces ship from this crate:

- **tauri build** — native shell, plays via `rodio` (webkit2gtk has
  no `AudioDecoder`). uses native iroh.
- **web build** — standalone vite bundle, plays via `webcodecs +
AudioWorklet`. transport via wasm iroh (phase 4, not yet wired).

## prerequisites

- rust toolchain (workspace defaults)
- node 20+ / npm
- `ffmpeg` on PATH (the host transcodes via subprocess)
- for the browser build: `wasm-pack` + (macOS only) llvm via
  `brew install llvm` — needed by `make -C midden-rs build`

## install + run

from `client/sibyl/`:

```bash
npm install

# tauri shell (host + peer, rodio playback)
npm run tauri dev

# browser-only (web build, webcodecs path — phase 4 still wip)
npm run dev:web
```

other useful scripts:

```bash
npm run build          # production tauri bundle
npm run build:web      # production web bundle
npx tsc --noEmit       # type-check the player package + demo app
cargo test -p sibyl-core   # rust unit tests + loopback iroh round-trip
```

## ui flow (tauri)

three panels, top to bottom:

1. **host.** click _pick file_ → ffmpeg transcodes the source to mp3
   chunks and publishes them via iroh-blobs. the status row shows live
   progress (`transcoding… N chunks (~Ns)`). when done, the iroh
   ticket appears in the textbox — _copy_ it for the peer side.
2. **peer.** paste a ticket into the _load + play_ input and click
   _load + play_. the peer downloads the collection, writes each chunk
   to opfs (`/sibyl/songs/<song-id>/chunks/`), and feeds the rodio
   sink. status shows `<id>… N/total (pct%)`. _pause_ / _resume_ /
   volume slider control playback.
3. **cached.** lists everything in opfs (title, chunk count, bytes).
   _play_ re-loads from cache without going to the network. _delete_
   removes one song; _clear all_ drops the whole `/sibyl/` directory.

resume works automatically: re-loading a ticket whose song id is
already (partially) cached replays cached chunks first, then the peer
downloads only the missing seqs.

## packages

| path         | what                                                 |
| ------------ | ---------------------------------------------------- |
| `core-rs/`   | `sibyl-core` rust crate (transcode, iroh host/peer)  |
| `src-tauri/` | tauri shell, single `sibyl_call` ipc command         |
| `player/`    | `@sibyl/player` ts library (transport, opfs, decode) |
| `src/`       | demo app (vite entry, ui glue, disposable)           |
| `midden-rs/` | vendored copy of `client/midden` for phase 4         |

## phase status

- [x] **phase 1–3**: tauri host + peer, opfs cache (later swapped to
      disk-backed `FsStore` + tokio `cache.rs` because webkit2gtk's
      opfs is read-only / spotty), rodio playback, ui panels.
- [x] **playback wiring**: tauri rodio decodes file paths, not chunk
      streams. on `complete` the bootstrap calls `cache_assemble_song`
      (concatenates every cached chunk into `assembled.mp3` via
      atomic rename) and hands the path to `rodio_load`. cached-panel
      _play_ does the same dance.
- [x] **manifest race fix**: `write_manifest` writes to a unique
      `manifest.<nanos>.<tid>.tmp` then `rename`s onto the real path
      so concurrent chunk callbacks can't observe a 0-byte mid-write
      window. `read_manifest` treats empty / partial files as `None`.
      regression-tested in `cache::tests::concurrent_manifest_writes_never_corrupt`
      (40 writers × 50 writes vs 40 readers × 100 reads).
- [x] **log noise**: `Player.emit` and both bootstraps now only
      forward `status` / `complete` / `error` to the logger. ui still
      receives every `progress` / `stats` event via `player.on()` and
      drives `#peer-status` + `#stats` accordingly.
- [x] **phase 4 — wasm iroh transport**. `midden-rs/src/sibyl_transport.rs`
      now exposes `MiddenNode::sibyl_download_chunks(iroh_ticket,
  have_chunks, on_chunk)`. `bootstrap-web.ts` constructs a
      `MiddenNode` at boot, hands it to `makeWasmTransport`, and the
      browser peer downloads + plays without leaving the page. (the
      ticket is decoded js-side via `decodeTicket`; we pass the inner
      `iroh_ticket` to wasm so the wasm crate stays free of any
      sibyl-core dep — easier merge-back into canonical midden.)
      build the wasm before `npm run dev:web`:
      `bash
  cd midden-rs && make build   # wasm-pack --target bundler
  `
- [x] **streaming browser playback**. `sibyl_download_chunks` now
      drains the iroh download stream in a background task and walks
      collection children one-by-one with `await_blob_complete`,
      emitting each chunk to JS as soon as it lands. webcodecs starts
      playing the first chunk while the rest of the song is still in
      flight. (tauri intentionally still waits for the whole file
      because rodio is path-based.)
- [x] **download pause + resume**. `SibylPlayer.pauseDownload()`
      cancels the active transport request without disturbing the
      audio backend, so already-buffered audio keeps playing.
      `resumeDownload()` re-issues the request using the manifest's
      stored `ticket` and the current `chunks_have` list, so iroh
      only re-fetches what's missing. on a fresh page load (or after
      a connection error), the cached-songs panel renders a "resume
      download" button next to any incomplete entry that has a
      stored ticket; clicking calls `loadFromTicket(manifest.ticket)`
      which feeds cached chunks into the decoder first and then
      streams the remainder. _(known limitation: pause sets a JS-side
      cancel flag; the wasm download task continues briefly until
      the next chunk boundary so a few extra bytes may land in the
      iroh memstore. resume re-uses the same ticket so this is
      cheap, but a true cancellation token threaded into
      `sibyl_download_chunks` would be cleaner \u2014 future work.)_
- [ ] **shared midden upstreaming**: `midden-rs/src/sibyl_transport.rs`
      is the only sibyl-only file; `lib.rs` has a single new line
      (`mod sibyl_transport;`). when ready, copy that file into
      canonical `client/midden` + add the same `mod` line.
