# library graph subview

force-directed album graph that lives inside the library view. fans
multiple remotes into one canvas, surfaces tools into the shared
topnav slots, and provides an admin-only bulk-tag mode driven by the
lasso tool.

```
LibraryView
  ├── RemotePicker (single|multi depending on subview + bulk-tag)
  └── <LibraryGraphSubview remotes onLassoAlbums bulkTagMode extraTools/>
        ├── RemoteAlbumsLoader (one per selected remote)
        │     └── useLibraryAlbumsQuery + adaptAlbum → AlbumNodeData[]
        └── createGraphLibraryView({ nodes, searchQuery, paused, ... })
              ├── topNavTools  → topNavRightContent slot
              ├── selectedRelationChips (wrapped w/ counter + auto-pause chip)
              │                 → topNavSecondaryRowContent slot
              └── pane          → AlbumGraphCanvas
```

## key files

- [createGraphLibraryView.tsx](createGraphLibraryView.tsx) — pure
  factory that owns the graph state (tool, relations, selection,
  wire tension, auto-pause) and produces `topNavTools`,
  `selectedRelationChips`, `pane`, plus a small imperative API
  (`fit`, `reset`, `zoomIn`, `zoomOut`) and an `autoPaused` accessor.
- [adaptAlbum.ts](adaptAlbum.ts) — converts `AlbumSummary` (server
  response) into `AlbumNodeData` (canvas input). taxons-first with a
  legacy `genres[]` fallback. node ids are `${remoteId}::${albumId}`
  so the same album on two remotes appears as two distinct nodes.
- [LibraryGraphSubview.tsx](LibraryGraphSubview.tsx) — multi-remote
  shell. owns the `nodesByRemote` map, fans `RemoteAlbumsLoader`
  children out per selected remote, wires action callbacks
  (play/shuffle/queue/favorite) to the source remote for each node,
  and pushes the topnav slots into place.

## how to use the factory

```tsx
import { createGraphLibraryView } from "./createGraphLibraryView";

const graph = createGraphLibraryView({
  nodes, // () => AlbumNodeData[]
  searchQuery, // () => string
  paused: () => !isActive(), // optional — auto-stops sim when offscreen
  onPlay,
  onShuffle,
  onAddToQueue,
  onViewAlbum,
  onViewArtist,
  onToggleFavorite,
  onLassoSelect, // (albums) => void — only fires when >=2
  forceTool: () => (bulkTag() ? "lasso" : null), // lock the tool
  extraTools: <BulkTagToggle />, // optional trailing slot
});

// then render somewhere:
slots.setRightContent(graph.topNavTools);
slots.setSecondaryRowContent(graph.selectedRelationChips);
return graph.pane;
```

## topnav slots

both slots live in [app/shell/topNavSlots.ts](../../../app/shell/topNavSlots.ts):

- `topNavRightContent` — icon cluster on the right edge of the topnav
- `topNavSecondaryRowContent` — chip strip on the topnav's second row

each slot is a single signal; whoever called `setRightContent` /
`setSecondaryRowContent` last owns it. on unmount the owning view
clears the slot it set.

## multi-remote semantics

- node id collisions are intentional: same album on two remotes =
  two nodes (different ids because of the `${remoteId}::` prefix).
- `adaptAlbum` stamps `sourceRemoteId` on every node so action
  callbacks can look up the correct backend.
- `RemoteMusicDataSource(remote).getAlbumSongs(bareAlbumId)` is the
  per-remote bridge for play/shuffle/queue.
- the picker mode flips to `single` when the table subview is active
  or when bulk-tag mode is on (since lasso needs an unambiguous
  target remote).

## admin bulk-tag mode

- gated on `useRemoteIsAdmin(selectedRemote)` and the graph subview.
- entering: forces single-remote, forces lasso tool, surfaces a
  persistent chip in the secondary row.
- exiting: `esc`, the toggle button, the `t` shortcut, switching
  subview, or losing admin status.
- lasso completion (>=2 albums on the same remote) opens
  `TagSelectorModal` seeded with the bare album ids and the resolved
  remote, then invalidates `["library-albums", remote_id]` on save.

## keyboard shortcuts

- `g` — cycle subview (graph ↔ table). always-on.
- `t` — toggle bulk-tag mode (graph + admin only).
- `esc` — exit bulk-tag mode (when active).
- `f` — fit to view (graph only).
- `r` — reset view (graph only).

all shortcuts are ignored while the user is typing into an input,
textarea, or contenteditable element.

## perf cliff: auto-pause

once the merged node list crosses 2000 nodes, the factory starts a
4-second settle timer; when it elapses, the sim auto-pauses until the
user explicitly interacts (any tool change, selection, lasso, zoom,
fit). a "sim paused — drag to wake" chip appears in the secondary row
while auto-paused.

threshold + settle constants live at the top of
`createGraphLibraryView` (`LARGE_GRAPH_THRESHOLD`, `INITIAL_SETTLE_MS`).
