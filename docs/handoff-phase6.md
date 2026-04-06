# handoff: multi-domain media system — phase 6

## status

phases 1–5 are complete. the system can upload files, classify them by domain, generate thumbnails, display them in skein canvas widgets, and fetch thumbnails from canvas peers via P2P. phase 6 is next: domain-specific rendering, file actions (save to disk, snatch from peer), and media playback.

## what's done

### phases 1–2: DB + domain models + ingest pipeline

- migration `022_multi_domain.sql` — 6 domain tables (audioz, photoz, videoz, documentz, filez, collectionz) with junction tables
- domain modules under `grimoire/src/media/` with models + repository for each
- `ingest_file()` service in `grimoire/src/media/ingest.rs` — 8-step pipeline: resolve source → detect mime → classify domain → create blob → write storage → create entity → queue thumbnail job
- `POST /api/upload/file` offal route in `grimoire/src/offal/upload/mod.rs`
- `FileSource::Bytes` (browser upload) and `FileSource::Path` (tauri/CLI, zero-copy)

### phase 2.5: thumbnail processors + metadata extraction

4 job processors under `grimoire/src/jobs/media/`:

- `photo_processor.rs` — image decode + EXIF extraction (kamadak-exif) + WebP conversion + sized thumbnails
- `video_processor.rs` — ffprobe metadata + ffmpeg frame capture at ~10% duration → WebP + thumbnails
- `document_processor.rs` — ImageMagick PDF first-page render → WebP + thumbnails + pdfinfo page count
- `audio_processor.rs` — ffprobe metadata + ffmpeg waveform visualization → WebP + thumbnails

shared helpers in `grimoire/src/jobs/media/mod.rs` (`get_source_bytes`, `get_source_path`, `run_command`, `build_args`, `cleanup_temp_file`).

**important bug fix:** WebP child blobs use `BlobType::Preview` (not `BlobType::Original`) because the `media_blobz` CHECK constraint requires `parent_blob_id IS NULL` for original blobs. all blob_type filters in `thumbnails.rs` and `helpers.rs` include `'preview'` alongside `'original'` and `'waveform'`.

### phase 3: tauri IPC bridge

no new commands — `api_call` IPC routes to `grimoire::offal::dispatch()`. added `POST /api/blobs/thumbnail_data` route with `find_displayable_thumbnail()` that walks the parent-child blob chain (original → WebP preview child → sized thumbnail) and returns base64 data.

### phase 4: skein file widget

- `client/skein/src/widgets/file-utils.ts` — `pickFile()`, `uploadFile()`, `getThumbnailDataUrl()`, `formatFileSize()`
- `client/skein/widgets/file.ts` — full PixiJS widget: empty → pick → upload → store blob ref in automerge doc → render thumbnail + filename/size/domain badge
- registered in `widgets/index.ts`

### phase 5: P2P blob thumbnail fetch

- `getThumbnailDataUrl()` refactored with 3-tier resolution: in-memory cache → local `api_call` → P2P proxy through canvas peers
- P2P fallback uses `p2p_proxy_request` IPC to proxy the same `/api/blobs/thumbnail_data` endpoint through peers — the peer does all chain walking and returns base64
- in-memory `Map<string, string>` cache keyed by `"blobId:size"` avoids redundant fetches
- file widget passes `ctx.canvasStore?.peers()` into the thumbnail fetch

## what's next — phase 6

### 6a: save to disk + snatch from peer

**save to disk:**
- tauri: `dialog.save()` from `@tauri-apps/plugin-dialog` → fetch blob bytes (local `api_call` or P2P `p2p_fetch_blob_verified_by_id`) → write to filesystem via tauri fs plugin
- browser: fetch blob → `blob:` URL → programmatic `<a download>` click

**snatch (add to my library):**
- download full blob from peer via iroh-blobs (`p2p_fetch_blob_verified_by_id` — verified, resumable)
- call `ingest_file()` with `FileSource::Bytes` to create local media_blobz entry + domain entity + trigger thumbnail job
- the widget's automerge doc already has filename, domain, mime, size, blake3 — enough to reconstruct the ingest
- after snatch, thumbnail resolves locally (no more P2P dependency)

### 6b: full-screen image preview

- click handler on loaded photo widget
- DOM overlay adapted from `client/skein/src/widgets/dom-overlay.ts` (currently text-input focused, needs generalization for click-to-dismiss media modal)
- fetch full-res WebP preview blob, display in `<img>` tag

### 6c: video player

- DOM overlay with `<video>` element
- local blobs: `convertFileSrc(local_path)` for `asset://` URL — macOS handles range requests natively, linux uses the asset protocol too (see `tauri.conf.json` assetProtocol scope)
- P2P blobs: download entire blob first via iroh-blobs → `blob:` URL (fine for short clips, large file streaming deferred)

### 6d: simple audio player

- DOM overlay with `<audio controls>` + waveform `<img>` from the audio processor's waveform blob
- same URL resolution as video
- minimal — not a full music player

### 6e: document preview — DEFERRED

user has a custom PDF viewer that uses generated WebP page images. skip for now.

### caching for browser clients

- use OPFS (Origin Private File System) for browser-mode blob caching — same pattern spume uses for local audio in `client/spume/src/music/services/storage/blobs.ts`
- persistent across sessions, doesn't count against Cache API quotas

## key files

| area | files |
|------|-------|
| ingest pipeline | `grimoire/src/media/ingest.rs` |
| upload handler | `grimoire/src/offal/upload/mod.rs` |
| job processors | `grimoire/src/jobs/media/*.rs` (photo, video, document, audio) |
| blob chain walker | `grimoire/src/blob_data/thumbnails.rs` (`find_displayable_thumbnail`) |
| thumbnail data route | `grimoire/src/offal/media_blobz/mod.rs` (`/api/blobs/thumbnail_data`) |
| blob helpers | `grimoire/src/blob_data/helpers.rs` (`create_image_blob_from_webp_data`) |
| skein file utils | `client/skein/src/widgets/file-utils.ts` |
| file widget | `client/skein/widgets/file.ts` |
| DOM overlay pattern | `client/skein/src/widgets/dom-overlay.ts` |
| widget registry | `client/skein/widgets/index.ts` |
| P2P proxy (tauri) | `charnel/src-tauri/src/p2p_commands.rs` (`p2p_proxy_request`) |
| P2P proxy (grimoire) | `grimoire/src/federation/p2p_client.rs` (`proxy_request`) |
| P2P handler | `grimoire/src/federation/transport/handler.rs` (dispatches `ProxyRequest` to offal) |
| P2P blob fetch | `charnel/src-tauri/src/p2p_commands.rs` (`p2p_fetch_blob_verified_by_id`) |
| asset protocol config | `charnel/src-tauri/tauri.conf.json` (assetProtocol scope) |
| spume blob storage | `client/spume/src/music/services/storage/blobs.ts` (OPFS pattern to reference) |
| spume audio access | `client/spume/src/music/services/storage/audioAccess.ts` (audio URL resolution pattern) |
| spume blob resolver | `client/spume/src/music/services/storage/blobResolver.ts` (P2P blob caching pattern) |
| transport layer | `client-codegen/freqhole-api-client/src/CharnelTransport.ts`, `WasmTransport.ts` |
| planning doc | `docs/multi-domain-media-plan.md` |

## architecture notes

### P2P proxy pattern

the `p2p_proxy_request` IPC command proxies any offal API call through a peer:

```
TypeScript: invoke("p2p_proxy_request", { peerAddr, method, path, body })
  → Rust: grimoire::federation::p2p_client::proxy_request()
  → iroh QUIC stream to peer
  → peer's handler.rs: PeerMessage::ProxyRequest → offal::dispatch()
  → response flows back as PeerMessage::ProxyResponse { status, body }
```

response is `{ status: number, body: string }` where body is a JSON-serialized `GrimoireResponse`.

### blob type hierarchy in media_blobz

```
original (parent_blob_id = NULL)  — the uploaded file itself
  └── preview (parent_blob_id = original)  — WebP conversion for web display
       └── thumbnail (parent_blob_id = preview)  — sized thumbnails (50x50, 200x200)
  └── waveform (parent_blob_id = original)  — audio waveform visualization
       └── thumbnail (parent_blob_id = waveform)  — sized waveform thumbnails
```

CHECK constraint: `(blob_type = 'original' AND parent_blob_id IS NULL) OR (blob_type != 'original' AND parent_blob_id IS NOT NULL)`

### DOM overlay pattern

`dom-overlay.ts` creates `position: fixed` DOM elements over the PixiJS canvas. currently used for text input (input/textarea). for phase 6, generalize for media overlays:

- convert PixiJS coords → screen coords via `container.toGlobal()` + `canvasElement.getBoundingClientRect()`
- create DOM element, position with `position: fixed`, `z-index: 10000`
- append to `document.body`
- current teardown: blur/Enter/Escape. media overlays need click-to-dismiss or close button instead.

### media serving in tauri

- `convertFileSrc(localPath)` converts filesystem paths to `asset://` URLs
- tauri's asset protocol scope in `tauri.conf.json`: `["$HOME/**", "$APPDATA/**", "$APPLOCALDATA/**", "/home/**", "/var/home/**", "/run/flatpak/**", "/tmp/**"]`
- `<audio>` and `<video>` elements can use `asset://` URLs directly with range request support
- no embedded HTTP server needed — the asset protocol handles streaming on all platforms

### canvas peers map

`ctx.canvasStore?.peers()` returns `Record<string, CanvasPeer>` where `CanvasPeer = { nodeId: string, joinedAt: string }`. the `nodeId` is the iroh public key, which is the same as `peerAddr` used by P2P commands.

### shared blob infrastructure assessment

the transport layer (`CharnelTransport`, `WasmTransport`) in `freqhole-api-client` is already shared and handles fetch → Cache API → blob URL. spume's blob caching layer (`blobCache.ts`, `blobResolver.ts`) is heavily coupled to SolidJS + music domain — not extractable. skein uses a purpose-built thin layer in `file-utils.ts` instead. for browser-mode blob persistence, use OPFS (same pattern as spume's `blobs.ts`).

## deferred work

- TypeScript codegen: `cd client-codegen && make all` to pick up `Domain::Media`, `FileUploadResponse`, `GetBlobThumbnailDataRequest`
- browser-mode P2P thumbnail fetch (midden WASM proxy_request not wired for skein yet)
- persistent thumbnail cache (OPFS for browser, blob_data table for tauri)
- file widget re-upload/replace
- browser-mode HTTP upload fallback
- batch upload / drag-and-drop
- migrate existing image widget + profile avatars from data URLs to blob references
- large video streaming via range requests
- cross-domain search
- collection management UI
