# skein P2P handoff summary

## what this is

a summary of completed work on skein's P2P canvas sharing feature, intended to bootstrap a new conversation thread for continuing development.

## project context

skein is a collaborative infinite canvas built with PixiJS + automerge-repo, living in `tomb/client/skein/`. it's part of the freqhole monorepo. the full development guide is at `tomb/.github/copilot-instructions.md` and the detailed P2P plan is at `tomb/docs/skein-p2p-plan.md`.

## what's been built (phases A–C: complete ✅)

### phase A — identity

- `src/p2p/identity.ts` — lazy midden (iroh WASM) init, persisted identity in `skein-meta` IndexedDB, `getStoredIdentity()`, `ensureIdentity()`, `onIdentityChange()` subscription
- `src/storage/meta-db.ts` — shared IndexedDB helpers
- profile widget displays real iroh node ID, friends widget validates 64-char hex node IDs
- tauri midden stub at `src/p2p/midden-stub.ts` + vite alias

### phase B — iroh network adapter

- **midden v0.2.0** (Rust/WASM at `tomb/client/midden/`) — `BiStream` with length-delimited read/write, `open_bi()`, `accept()`, `create_with_alpns()`, dual-ALPN registration (`freqhole/1` + `iroh/automerge-repo/1`)
- `src/p2p/iroh-network-adapter.ts` — full automerge-repo `NetworkAdapter` subclass with CBOR encoding, accept loop, per-peer read loops, deferred midden init gated on identity. 32 unit tests.
- wired into `SkeinRouter`'s Repo in `src/standalone/boot.ts` alongside `BroadcastChannelNetworkAdapter`

### phase C — share strings, join flow, share UI, reconnection

- `src/p2p/share-string.ts` — `encodeShareString()`, `decodeShareString()`, `shareFragment()`. base64 JSON `{ n: nodeId, d: docId }`. 14 tests.
- `widgets/narthex/join-canvas.ts` — narthex palette widget for pasting share strings. 8 tests.
- `src/canvas/share-dialog.ts` — `@pixi/ui` `Dialog` modal with DOM `<input readonly>` overlays for native text selection, copy buttons with "copied!" feedback
- `src/canvas/toolbar.ts` — "share" button (conditional, non-accent color), `onShare` callback threaded through `InitCanvasOptions` → `ToolbarOptions`
- `src/canvas/canvas-doc.ts` — `CanvasPeer` interface, `peers: Record<string, CanvasPeer>` field on `CanvasDocument`
- `src/canvas/canvas-store.ts` — `peers()` and `addPeer(nodeId)` methods
- `src/standalone/boot.ts` — full orchestration:
  - `joinCanvasFromNarthex()` — decode share string → ensureIdentity → addPeer → create canvas-card → stash `pendingPeerNodeId` → navigate
  - `registerAndReconnectPeers()` — called after every `navigateToCanvas()`: writes self into doc, writes pending join peer, reads all peers, calls `addPeer()` for each (filters out self)
  - `onHashChange()` detects `#share/<base64>` URLs
  - `window.__skein.share()` console helper still works
- URL fragment sharing: `#share/<base64>` auto-detected and processed

### key architectural decisions

- **peer list lives in the canvas document** — each shared canvas has a `peers` record in its automerge CRDT doc. replicates to all participants automatically. used for reconnection on reload.
- **`pendingPeerNodeId` handoff** — `joinCanvasFromNarthex` stashes the remote peer's nodeId on the router; `navigateToCanvas` picks it up after canvas init completes. this replaced a `requestAnimationFrame` approach that raced with async canvas initialization.
- **friends widget is the global address book** — stores known peers globally, separate from per-canvas peer lists.
- **DOM inputs are the one DOM exception** — everything else in skein is pure PixiJS. text fields use DOM `<input>` overlays (see `src/widgets/dom-overlay.ts` pattern) for native selection/clipboard.

## test status

- **192 unit tests across 15 files — all passing**
- **typecheck clean** (`tsc --noEmit`)
- **manual two-browser test verified**: create canvas in browser A → share → join in browser B → cursors and state sync → reload either side → sync re-establishes

## what's next (from the plan)

### phase D: access control

protects shared canvases. without this, any peer with a share string has full read/write access.

- add permission fields to `CanvasDocument`: `sharingLevel`, `owner`, `acl`
- enforce viewer role (accept sync but reject changes from viewer peers)
- sharing level dropdown in canvas property tray (private / friends / invite-only / public)
- role assignment UI (owner sets editor/viewer per peer)
- default new canvases to private

### phase E: remote canvas cards + narthex UI

- visual distinction for remote canvas-cards (shared badge, peer name)
- connection status indicator on remote cards (online / syncing / offline)
- cached metadata display, lazy connection checking

### phase F: notifications + permission requests

- permission request protocol over `skein/1` ALPN
- notification UI, approve/deny, "auto-approve friends" setting

### other items worth considering

- **Playwright e2e tests** for two-browser sync (config exists at `playwright.config.ts`, test harness at `test-harness.html` + `src/dev/test-bootstrap.ts`, existing e2e tests in `tests/`)
- **presence across iroh** — cursors already work via automerge ephemeral messages, but presence reconnection after reload could be more robust
- **samod option** — embedding Rust automerge-repo in midden for better performance (deferred optimization, tracked in plan)
- **automerge compaction** — documents grow over time, needs a strategy for production use

## key files to read first

| file | what it does |
|------|-------------|
| `docs/skein-p2p-plan.md` | full plan with all phases, decisions, and status |
| `src/standalone/boot.ts` | `SkeinRouter` — navigation, join flow, reconnection orchestration |
| `src/p2p/iroh-network-adapter.ts` | automerge-repo ↔ iroh bridge |
| `src/p2p/identity.ts` | iroh identity management (lazy midden init) |
| `src/p2p/share-string.ts` | share string encode/decode |
| `src/canvas/canvas-doc.ts` | `CanvasDocument` type (includes `peers` field) |
| `src/canvas/canvas-store.ts` | typed mutations on canvas doc (includes `addPeer()`) |
| `src/canvas/share-dialog.ts` | share modal (`@pixi/ui` Dialog + DOM inputs) |
| `src/canvas/toolbar.ts` | toolbar with share button |
| `src/canvas/init.ts` | `initCanvas()` — canvas lifecycle entry point |
