// createGraphLibraryView
//
// shared factory used by both the storybook LibraryGraphView and the
// real LibraryView's graph subview. owns all graph-local state
// (selection, pill toggles, wire click, wire tension, relation
// enablement) and returns two JSX slots:
//   - `topNavTools` — the GraphTopNavTools cluster (drop into TopNav's
//     `rightContent` slot).
//   - `pane` — the canvas + floating AlbumDetailPopover wrapper. drop
//     into a flex-1 cell in the main content area.
//
// note: a horizontally-scrollable `selectedRelationChips` row (drag to
// adjust per-kind strength, click to solo, x to remove) used to be
// returned here too. it's been removed alongside the topnav relations
// picker — per-kind strength is now controlled by dragging the
// relation hub nodes directly on the canvas, and which kinds are
// visible is governed by the drilldown state machine in the subview.
//
// caller supplies a `nodes` accessor (so the same factory drives both
// the static-mock story and the live, page-streamed real view), a
// `searchQuery` accessor for the topnav search field, and optional
// action callbacks (play/shuffle/queue/view/favorite/lasso).

import { createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js";
import type { JSX } from "solid-js";
import { GraphCanvas, type GraphActions } from "../../../components/graph/GraphCanvas";
import { AlbumDetailPopover } from "../../../components/graph/AlbumDetailPopover";
import { ArtistDetailPopover } from "../../../components/graph/ArtistDetailPopover";
import { useDetailPanelHide } from "../../../components/graph/useDetailPanelHide";
import { GraphTopNavTools, type GraphTool } from "../../../components/graph/GraphTopNavTools";
import { Icon } from "../../../components/icons/registry";
import { RELATION_KINDS } from "../../../components/graph/relations";
import type {
  AlbumNodeData,
  ArtistNodeData,
  GraphEdge,
  GraphNodeData,
  RelationKindLike,
} from "../../../components/graph/types";
import { nodeKind } from "../../../components/graph/types";
import { isAnyHubId } from "../../../components/graph/hubNodes";
import { artistNodeId } from "./deriveArtistNodes";
import type { RelatedArtistsMap } from "../../queries/useRelatedArtistsByIds";

export interface CreateGraphLibraryViewOpts {
  /** live node set — accessor so the caller can stream pages in. may
   *  include both album and artist nodes when the content-kind
   *  selector enables artist nodes. */
  nodes: () => GraphNodeData[];
  /** resolved last.fm related-artist relationships keyed by source
   *  artist id (in-library targets only). drives the `related_artist`
   *  edge kind. omit / leave empty when artist nodes aren't visible. */
  relatedArtists?: () => RelatedArtistsMap | undefined;
  /** search query accessor — drives node-highlight filter. */
  searchQuery: () => string;
  /** optional topology identity key. when it changes, GraphCanvas
   *  performs a full sim reset instead of preserving prior positions. */
  topologyKey?: () => string | number | undefined;
  /** album row actions; surfaced via AlbumDetailPopover. */
  onPlay?: (album: AlbumNodeData) => void;
  onShuffle?: (album: AlbumNodeData) => void;
  onAddToQueue?: (album: AlbumNodeData) => void;
  onViewAlbum?: (album: AlbumNodeData) => void;
  onViewArtist?: (album: AlbumNodeData) => void;
  /** "open" action on the artist detail popover — navigates to the
   *  dedicated artist page. distinct from the in-graph artist-name
   *  link in the album popover, which only focuses the artist node
   *  on the canvas. */
  onViewArtistNode?: (artist: ArtistNodeData) => void;
  onToggleFavorite?: (album: AlbumNodeData) => void;
  /** opens the album editor modal. callers (e.g. LibraryGraphSubview)
   *  are responsible for gating on admin permission — if undefined,
   *  the popover's edit button is hidden. */
  onEditAlbum?: (album: AlbumNodeData) => void;
  /** opens the artist editor modal. same admin-gating contract as
   *  `onEditAlbum`. */
  onEditArtistNode?: (artist: ArtistNodeData) => void;
  /** clicking the cover tile in the album popover — typically opens
   *  an image carousel modal with the album's image(s). */
  onImageClickAlbum?: (album: AlbumNodeData) => void;
  /** clicking the avatar in the artist popover — typically opens an
   *  image carousel modal with the artist's image(s). */
  onImageClickArtist?: (artist: ArtistNodeData) => void;
  /** toggles favorite state for the currently-shown artist. when
   *  defined alongside `selectedArtistIsFavorite`, the artist popover
   *  renders a heart toggle in its action row. */
  onToggleFavoriteArtist?: (artist: ArtistNodeData, next: boolean) => void;
  /** biography string for the currently-selected artist node. parent
   *  hydrates this (e.g. via getArtist query) on selection change. */
  selectedArtistBio?: () => string | null | undefined;
  /** favorite state for the currently-selected artist node. parent
   *  hydrates this (e.g. via getArtist query) on selection change. */
  selectedArtistIsFavorite?: () => boolean | undefined;
  /** fired when the lasso tool completes a selection (>=2 albums). */
  onLassoSelect?: (albums: AlbumNodeData[]) => void;
  /** when true, the sim pauses (canvas is hidden / behind another tab). */
  paused?: () => boolean;
  /** when truthy, locks the tool to the returned value — the user can
   *  no longer flip between pan / lasso. used by admin bulk-tag mode
   *  to keep the lasso active until the user exits that mode. */
  forceTool?: () => GraphTool | null;
  /** when true, nodes cannot be dragged around the canvas. clicks
   *  still select them. defaults to false (legacy drag-to-move). */
  lockNodes?: boolean;
  /** fires whenever the focused node selection changes. null means
   *  selection cleared (e.g. escape or empty-space click). */
  onSelectionChange?: (node: GraphNodeData | null) => void;
  /** optional trailing slot for the topnav tools cluster — see
   *  GraphTopNavTools.extra. e.g. an admin-only bulk-tag toggle. */
  extraTools?: JSX.Element;
  /** optional custom edge accessor. when provided, the graph uses
   *  this topology directly (legacy edge mode) instead of deriving
   *  edges in the worker from node taxonomies. */
  customEdges?: () => GraphEdge[];
  /** optional set of node ids that are currently loading (fetching
   *  data, crunching async derivations). matching nodes render a
   *  comet-trail spinner around their silhouette, same visual
   *  language as the player-bar play/pause loading ring. */
  loadingNodeIds?: () => Set<string> | null;
  /** optional hover-preview hook. when the user hovers a node, the
   *  parent returns up to ~12 related nodes to peek at without
   *  drilling. the canvas paints them in a ring around the hovered
   *  node with thin spokes. return `[]` (or omit) to disable. */
  getHoverPreview?: (node: GraphNodeData) => GraphNodeData[];
}

export interface GraphLibraryView {
  topNavTools: JSX.Element;
  pane: JSX.Element;
  /** live node count accessor — for the bottom-right status chip /
   *  topnav badge in caller-controlled chrome. */
  nodeCount: () => number;
  /** live edge count accessor — mirror of `nodeCount` for the same
   *  status chip. counts raw graph edges (pre pair-collapse). */
  edgeCount: () => number;
  /** true when the sim is auto-paused after the initial settle of a
   *  large library (nodes >= 2000) and the user hasn't interacted yet.
   *  consumers can use this to render a "sim paused — drag to wake"
   *  chip in their chrome. */
  autoPaused: () => boolean;
  /** imperative API for keyboard shortcuts — fit / reset / zoom. only
   *  available after the canvas mounts. */
  fit: () => void;
  reset: () => void;
  /** full viz reset: clears all node positions and restarts the sim from
   *  scratch without refetching data. same as initial load. */
  fullReset: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /** auto-fit variant for callers that want to refit after streaming
   *  new nodes in. unlike `fit()`, this does NOT flip the
   *  `userInteracted` flag (so the auto-pause still engages on big
   *  libraries) and a no-op when the user has already zoomed/panned
   *  manually — we don't want to yank their viewport. */
  fitIfIdle: () => void;
  /** true once the user has manually zoomed, panned, changed tool,
   *  selected anything, etc. used by callers to gate behaviours that
   *  should defer to the user (e.g. auto-fit after batched node loads). */
  userInteracted: () => boolean;
  /** clear the current album selection (closes the detail popover).
   *  used by the Esc keyboard shortcut in the graph subview. */
  clearSelection: () => void;
  /** id of the currently-selected artist node (or null when no artist
   *  is selected). callers use this to drive per-selection data
   *  fetching (bio, favorite state) that they then feed back via
   *  the `selectedArtistBio` / `selectedArtistIsFavorite` opts. */
  selectedArtistId: () => string | null;
}

export function createGraphLibraryView(opts: CreateGraphLibraryViewOpts): GraphLibraryView {
  const ALL_KINDS = RELATION_KINDS.map((r) => r.kind);
  // per-kind relation strength defaults. previously the in-canvas
  // hub-drag gesture could mutate these at runtime; that ux has been
  // removed, so the worker just receives these constants for the
  // lifetime of the view.
  const defaultRelationStrength = (kind: string): number => {
    if (kind === "artist_album") return 1;
    if (kind === "same_artist") return 1;
    if (kind === "favorite") return 0.82;
    if (kind === "related_artist") return 0.78;
    if (kind === "tag") return 0.22;
    return 0.5;
  };
  const nodes = opts.nodes;

  // big-library cliff: once we cross this threshold the sim eats real
  // cpu on weaker laptops. let it settle for INITIAL_SETTLE_MS then
  // auto-pause until the user explicitly interacts (any tool change,
  // selection, lasso, etc. flips `userInteracted` on).
  const LARGE_GRAPH_THRESHOLD = 2000;
  const INITIAL_SETTLE_MS = 4000;
  const [userInteracted, setUserInteracted] = createSignal(false);
  const [settleElapsed, setSettleElapsed] = createSignal(false);
  let lastTopologyKey = opts.topologyKey?.();
  // start (or reset) the settle timer whenever node count first
  // crosses the threshold while user hasn't touched anything yet.
  createEffect(() => {
    if (userInteracted()) return;
    if (nodes().length < LARGE_GRAPH_THRESHOLD) return;
    setSettleElapsed(false);
    const t = setTimeout(() => setSettleElapsed(true), INITIAL_SETTLE_MS);
    onCleanup(() => clearTimeout(t));
  });
  const autoPaused = createMemo(
    () => nodes().length >= LARGE_GRAPH_THRESHOLD && settleElapsed() && !userInteracted()
  );

  const [enabled, setEnabled] = createSignal<Set<string>>(new Set<string>(ALL_KINDS));
  const [tool, setTool] = createSignal<GraphTool>("pan");
  // when the caller hands us a `forceTool` accessor that returns a
  // non-null value, mirror it into the internal `tool` signal so the
  // canvas always reflects the forced mode. the topnav button is also
  // disabled below in that case.
  createEffect(() => {
    const forced = opts.forceTool?.();
    if (forced) setTool(forced);
  });
  // store only the id of the focused album, then re-derive the full
  // `AlbumNodeData` from `nodes()` on every read. this keeps the popover
  // in sync with the latest query data — e.g. when a favorite toggle
  // optimistically patches `is_favorite` in the library-albums cache,
  // the adapter produces a new node and `selected()` picks it up
  // immediately instead of holding onto the stale click-time snapshot.
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  // selected() narrows to `AlbumNodeData` only — artist nodes are
  // selectable on the canvas (for ring highlight) but never open the
  // detail popover (artist detail UI is reachable elsewhere).
  const selected = createMemo<AlbumNodeData | null>(() => {
    const id = selectedId();
    if (!id) return null;
    const n = nodes().find((n) => n.id === id) ?? null;
    if (!n || nodeKind(n) !== "album") return null;
    return n as AlbumNodeData;
  });
  const setSelected = (node: GraphNodeData | null) => setSelectedId(node?.id ?? null);
  // mirror of `selected()` but for artist nodes — drives the artist
  // detail popover. mutually exclusive with `selected()` because each
  // node has exactly one kind.
  const selectedArtist = createMemo<ArtistNodeData | null>(() => {
    const id = selectedId();
    if (!id) return null;
    const n = nodes().find((n) => n.id === id) ?? null;
    if (!n || nodeKind(n) !== "artist") return null;
    // hub nodes (remote / relation / relation-value triangles) reuse
    // the artist node type for layout but should never open the
    // artist detail popover — their interaction model is click-to-
    // drill + drag-to-set-strength, with no inspector surface.
    if (isAnyHubId((n as ArtistNodeData).artistId)) return null;
    return n as ArtistNodeData;
  });

  let lastSelectionEmitId: string | null | undefined = undefined;
  createEffect(() => {
    if (!opts.onSelectionChange) return;
    const id = selectedId();
    if (!id) {
      if (lastSelectionEmitId !== null) {
        lastSelectionEmitId = null;
        opts.onSelectionChange(null);
      }
      return;
    }
    const n = nodes().find((x) => x.id === id) ?? null;
    if (!n) {
      setSelectedId(null);
      if (lastSelectionEmitId !== null) {
        lastSelectionEmitId = null;
        opts.onSelectionChange(null);
      }
      return;
    }
    if (lastSelectionEmitId === n.id) return;
    lastSelectionEmitId = n.id;
    opts.onSelectionChange(n);
  });
  const [pillEdges, setPillEdges] = createSignal<Map<string, GraphEdge>>(new Map());
  const [wireEdge, setWireEdge] = createSignal<GraphEdge | null>(null);
  const [wireTension, setWireTension] = createSignal(0.44);
  const [api, setApi] = createSignal<GraphActions | null>(null);

  createEffect(() => {
    const key = opts.topologyKey?.();
    if (key === lastTopologyKey) return;
    lastTopologyKey = key;
    // remote/topology switches should feel like a clean graph session.
    setUserInteracted(false);
    setSettleElapsed(false);
    setSelectedId(null);
    setPillEdges(new Map());
    setWireEdge(null);
  });
  // narrow-viewport users can collapse each per-kind detail panel to
  // give the canvas more room. each kind has its own hide signal so
  // collapsing one panel doesn't affect the other (and so each one
  // pops back open the next time a node of its kind is selected).
  const albumPanel = useDetailPanelHide(selected);
  const artistPanel = useDetailPanelHide(selectedArtist);

  const edgeKey = (kind: RelationKindLike, label: string) => `${String(kind)}|${label}`;
  // phase 4: edges are derived inside the graph worker now. GraphCanvas
  // streams the full edge list back via `onEdges`; this signal holds
  // it for ui consumers (kind counts, popovers, status pills). it
  // starts empty until the first worker emission lands.
  const [edges, setEdges] = createSignal<GraphEdge[]>([]);
  // per-kind edge counts — previously consumed by the topnav relations
  // picker. unused now that the picker is gone, but the memo body is
  // cheap and might be useful for an in-canvas hub badge later, so we
  // keep the helper inlined where needed instead of as a top-level
  // memo. (see `countEdgesByKind(edges())` if you need it.)

  createEffect(() => {
    const custom = opts.customEdges;
    if (!custom) return;
    setEdges(custom());
  });

  const relationStrengthConfig = createMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const kind of ALL_KINDS) out[kind] = defaultRelationStrength(kind);
    return out;
  });

  // album/artist split was the old status-chip source. now the chip
  // shows `N nodes · M edges` directly, so this memo is no longer
  // needed (kept as a comment marker in case a future ui surface
  // wants the by-kind breakdown back).

  const canvasEdges = createMemo<GraphEdge[]>(() => {
    const out = Array.from(pillEdges().values());
    const w = wireEdge();
    if (w && !pillEdges().has(edgeKey(w.kind, w.label ?? ""))) out.push(w);
    return out;
  });
  const activeRelations = createMemo<Set<string>>(() => {
    const s = new Set<string>(pillEdges().keys());
    const w = wireEdge();
    if (w) s.add(edgeKey(w.kind, w.label ?? ""));
    return s;
  });

  // search filter — dims any node whose title/artist doesn't contain
  // the (lowercased) query. empty query disables the filter entirely.
  const searchMatches = createMemo<Set<string> | null>(() => {
    const q = opts.searchQuery().trim().toLowerCase();
    if (!q) return null;
    const out = new Set<string>();
    for (const n of nodes()) {
      // search matches both album metadata and artist names. for an
      // album node we look at title + artistName; for an artist node
      // there's just the name field.
      if (nodeKind(n) === "artist") {
        const a = (n as { name?: string }).name?.toLowerCase() ?? "";
        if (a.includes(q)) out.add(n.id);
      } else {
        const album = n as AlbumNodeData;
        const t = (album.title ?? "").toLowerCase();
        const a = (album.artistName ?? "").toLowerCase();
        if (t.includes(q) || a.includes(q)) out.add(n.id);
      }
    }
    return out;
  });
  // single-match search auto-focuses + fits so the user can jump
  // straight to a known album by typing its name.
  createEffect(() => {
    const m = searchMatches();
    if (m && m.size === 1) {
      const onlyId = m.values().next().value;
      const hit = nodes().find((n) => n.id === onlyId) ?? null;
      if (hit) {
        setSelected(hit);
        requestAnimationFrame(() => api()?.fit());
      }
    }
  });

  // carousel: clicked album anchored at index 0; pill toggles append.
  const pillClusterAlbums = createMemo<AlbumNodeData[]>(() => {
    const pills = pillEdges();
    if (pills.size === 0) return [];
    const tuples = new Set<string>(pills.keys());
    const byId = new Map(nodes().map((n) => [n.id, n] as const));
    const ids = new Set<string>();
    for (const ee of edges()) {
      if (tuples.has(`${String(ee.kind)}|${ee.label ?? ""}`)) {
        const s = typeof ee.source === "string" ? ee.source : ee.source.id;
        const t = typeof ee.target === "string" ? ee.target : ee.target.id;
        ids.add(s);
        ids.add(t);
      }
    }
    const out: AlbumNodeData[] = [];
    for (const id of ids) {
      const a = byId.get(id);
      // popover carousel is album-only; an artist node lit up via the
      // `artist_album` edge kind shouldn't appear there.
      if (a && nodeKind(a) === "album") out.push(a as AlbumNodeData);
    }
    out.sort((a, b) => a.title.localeCompare(b.title));
    return out;
  });

  const popInfo = createMemo<{ list: AlbumNodeData[]; source: "edge" | "single" | null }>(() => {
    const pillAlbums = pillClusterAlbums();
    const w = wireEdge();
    if (w) {
      const byId = new Map(nodes().map((n) => [n.id, n] as const));
      const ids = new Set<string>();
      for (const ee of edges()) {
        if (ee.kind === w.kind && ee.label === w.label) {
          const s = typeof ee.source === "string" ? ee.source : ee.source.id;
          const t = typeof ee.target === "string" ? ee.target : ee.target.id;
          ids.add(s);
          ids.add(t);
        }
      }
      const wireList: AlbumNodeData[] = [];
      for (const id of ids) {
        const a = byId.get(id);
        if (a && nodeKind(a) === "album") wireList.push(a as AlbumNodeData);
      }
      wireList.sort((a, b) => a.title.localeCompare(b.title));
      const seen = new Set<string>(wireList.map((a) => a.id));
      const merged = [...wireList];
      for (const a of pillAlbums) if (!seen.has(a.id)) (merged.push(a), seen.add(a.id));
      return { list: merged, source: "edge" };
    }
    const s = selected();
    if (s) {
      const seen = new Set<string>([s.id]);
      const extras: AlbumNodeData[] = [];
      for (const a of pillAlbums) if (!seen.has(a.id)) (extras.push(a), seen.add(a.id));
      return { list: [s, ...extras], source: "single" };
    }
    if (pillAlbums.length > 0) {
      return { list: pillAlbums.slice(), source: "edge" };
    }
    return { list: [], source: null };
  });
  const [popIndex, setPopIndex] = createSignal(0);
  // keep the carousel index pointed at the user's currently-focused
  // album across reactive churn:
  //   - when `selected()` changes (user clicks a different node), snap
  //     to index 0 — that's where the newly-selected album lives in
  //     `popInfo.list` ([selected, ...pillExtras]).
  //   - when `popIndex` changes externally (user clicked the prev/next
  //     carousel buttons), adopt the new index as-is and re-anchor the
  //     remembered `currentId` to whatever album sits there. without
  //     this, the preservation branch below would see `prev.currentId`
  //     pointing at the old position and yank the index right back.
  //   - otherwise try to preserve the album that *was* on screen across
  //     data changes (new pages landing, pill toggles, etc.) by tracking
  //     its id and re-locating it in the new list.
  createEffect(
    (
      prev: { currentId: string | null; selectedId: string | null; lastIndex: number } | undefined
    ) => {
      const info = popInfo();
      const curSel = selected();
      const selectedId = curSel?.id ?? null;
      const curIdx = popIndex();
      if (prev && prev.selectedId !== selectedId) {
        if (curIdx !== 0) setPopIndex(0);
        return { currentId: info.list[0]?.id ?? null, selectedId, lastIndex: 0 };
      }
      if (prev && prev.lastIndex !== curIdx) {
        return {
          currentId: info.list[curIdx]?.id ?? null,
          selectedId,
          lastIndex: curIdx,
        };
      }
      if (prev?.currentId) {
        const newIdx = info.list.findIndex((a) => a.id === prev.currentId);
        if (newIdx >= 0) {
          if (newIdx !== curIdx) setPopIndex(newIdx);
          return { currentId: prev.currentId, selectedId, lastIndex: newIdx };
        }
        if (curIdx !== 0) setPopIndex(0);
        return { currentId: info.list[0]?.id ?? null, selectedId, lastIndex: 0 };
      }
      return {
        currentId: info.list[curIdx]?.id ?? null,
        selectedId,
        lastIndex: curIdx,
      };
    },
    undefined
  );
  const currentSel = createMemo(() => popInfo().list[popIndex()] ?? null);
  const canvasSelectedId = createMemo(() => currentSel()?.id ?? selectedArtist()?.id ?? null);

  // sibling albums for the album currently shown in the popover
  // every other in-library album by the same artist. surfaced as a
  // clickable list at the bottom of AlbumDetailPopover so the user can
  // jump straight to another release without clearing context.
  const sameArtistAlbums = createMemo<AlbumNodeData[]>(() => {
    const cur = currentSel();
    if (!cur) return [];
    const out: AlbumNodeData[] = [];
    for (const n of nodes()) {
      if (nodeKind(n) !== "album") continue;
      const a = n as AlbumNodeData;
      if (a.artistId === cur.artistId) out.push(a);
    }
    out.sort((a, b) => {
      const ya = a.year ?? 0;
      const yb = b.year ?? 0;
      if (ya !== yb) return ya - yb;
      return a.title.localeCompare(b.title);
    });
    return out;
  });

  // artist popover carousel [anchor, ...related].
  //
  // the anchor is the artist the user first selected; it stays stable
  // even as the user pages through the carousel. without this anchor,
  // paging fires `onFocusArtist` which moves `selectedArtist`, which
  // would rebuild this list around the newly-focused artist and snap
  // the carousel back to index 0, the user "loses" their place and
  // can't navigate back to the original. with the anchor, paging is
  // free to walk through related artists without yanking the list.
  //
  // the anchor is re-seeded only when the user selects an artist that
  // isn't already in the current list (treated as "explicitly picked a
  // different anchor" rather than "paged-to from within the popover").
  const [popoverArtistAnchorId, setPopoverArtistAnchorId] = createSignal<string | null>(null);
  const popoverArtistAnchor = createMemo<ArtistNodeData | null>(() => {
    const id = popoverArtistAnchorId();
    if (!id) return null;
    const n = nodes().find((nn) => nn.id === id) ?? null;
    if (!n || nodeKind(n) !== "artist") return null;
    return n as ArtistNodeData;
  });
  const artistPopList = createMemo<ArtistNodeData[]>(() => {
    const anchor = popoverArtistAnchor();
    if (!anchor) return [];
    const seen = new Set<string>([anchor.id]);
    const out: ArtistNodeData[] = [anchor];
    const relSet = opts.relatedArtists?.()?.get(anchor.artistId);
    if (relSet && relSet.size > 0) {
      const byArtistId = new Map<string, ArtistNodeData>();
      for (const n of nodes()) {
        if (nodeKind(n) === "artist") {
          const an = n as ArtistNodeData;
          byArtistId.set(an.artistId, an);
        }
      }
      const related: ArtistNodeData[] = [];
      for (const aid of relSet) {
        const node = byArtistId.get(aid);
        if (node && !seen.has(node.id)) {
          related.push(node);
          seen.add(node.id);
        }
      }
      related.sort((x, y) => x.name.localeCompare(y.name));
      out.push(...related);
    }
    return out;
  });
  const [artistPopIndex, setArtistPopIndex] = createSignal(0);
  // sync anchor + index with `selectedArtist` changes. paging the
  // carousel (which calls onFocusArtist -> setSelectedId) lands here
  // too, but the new selection will already be in the existing list,
  // so we only adjust the index and leave the anchor alone.
  createEffect(() => {
    const sel = selectedArtist();
    untrack(() => {
      if (!sel) {
        // selection cleared (or moved to an album). leave the anchor
        // in place so re-selecting the same artist restores context
        // instantly; clear only when the anchor itself disappeared.
        if (popoverArtistAnchor() == null) setPopoverArtistAnchorId(null);
        return;
      }
      const list = artistPopList();
      const idx = list.findIndex((a) => a.id === sel.id);
      if (idx >= 0) {
        // paged within the current list keep anchor, sync index.
        if (idx !== artistPopIndex()) setArtistPopIndex(idx);
        return;
      }
      // brand new anchor: rebuild around it and reset to 0.
      setPopoverArtistAnchorId(sel.id);
      setArtistPopIndex(0);
    });
  });

  // albums (in-library) that belong to the artist currently shown in
  // the artist popover carousel. when the user pages through related
  // artists, this updates to reflect the focused artist so the album
  // list in the popover always matches.
  const currentArtistAlbums = createMemo<AlbumNodeData[]>(() => {
    const focused = artistPopList()[artistPopIndex()];
    if (!focused) return [];
    const out: AlbumNodeData[] = [];
    for (const n of nodes()) {
      if (nodeKind(n) !== "album") continue;
      const a = n as AlbumNodeData;
      if (a.artistId === focused.artistId) out.push(a);
    }
    out.sort((a, b) => {
      const ya = a.year ?? 0;
      const yb = b.year ?? 0;
      if (ya !== yb) return ya - yb;
      return a.title.localeCompare(b.title);
    });
    return out;
  });

  // pill tap — toggle the relation in the highlight set without
  // disturbing the anchored album in the popover. when the relation
  // is currently active only because the user clicked its wire (so it
  // lives in `wireEdge` rather than `pillEdges`), clearing it means
  // dropping that wire as well — otherwise the pill would visually
  // toggle "off" but the wire would keep it active in `activeRelations`.
  const focusOnRelation = (kind: RelationKindLike, label: string) => {
    const key = edgeKey(kind, label);
    const w = wireEdge();
    const wKey = w ? edgeKey(w.kind, w.label ?? "") : null;
    const cur = pillEdges();
    const next = new Map(cur);
    if (next.has(key)) {
      next.delete(key);
      if (wKey === key) setWireEdge(null);
    } else if (wKey === key) {
      // active only via wireEdge → tapping the pill turns it off.
      setWireEdge(null);
    } else {
      const match = edges().find((e) => e.kind === kind && e.label === label);
      const target: GraphEdge =
        match ??
        ({
          source: currentSel()?.id ?? nodes()[0]?.id ?? "",
          target: currentSel()?.id ?? nodes()[0]?.id ?? "",
          kind,
          weight: 0.5,
          label,
        } as GraphEdge);
      next.set(key, target);
      setEnabled((prev) => {
        if (prev.has(kind as string)) return prev;
        const ns = new Set<string>(prev);
        ns.add(kind as string);
        return ns;
      });
    }
    setPillEdges(next);
    requestAnimationFrame(() => api()?.fit());
  };

  // pill long-press — solo this relation, clearing everything else.
  const soloRelation = (kind: RelationKindLike, label: string) => {
    const key = edgeKey(kind, label);
    const match = edges().find((e) => e.kind === kind && e.label === label);
    const target: GraphEdge =
      match ??
      ({
        source: currentSel()?.id ?? nodes()[0]?.id ?? "",
        target: currentSel()?.id ?? nodes()[0]?.id ?? "",
        kind,
        weight: 0.5,
        label,
      } as GraphEdge);
    setWireEdge(null);
    setPillEdges(new Map([[key, target]]));
    setEnabled(new Set<string>([kind as string]));
    requestAnimationFrame(() => api()?.fit());
  };

  // relation-kind solo (now unused; topnav picker is gone). kept
  // commented as documentation in case a future in-canvas solo gesture
  // wants the same shape.
  // const soloKind = (kind: string) => {
  //   setEnabled(new Set<string>([kind]));
  //   setPillEdges((prev) => {
  //     const next = new Map<string, GraphEdge>();
  //     for (const [k, v] of prev) if (String(v.kind) === kind) next.set(k, v);
  //     return next;
  //   });
  // };

  const topNavTools = (
    <GraphTopNavTools
      tool={tool()}
      onToolChange={(next) => {
        // ignore manual tool changes while a forceTool is active.
        if (opts.forceTool?.()) return;
        setUserInteracted(true);
        setTool(next);
      }}
      onZoomIn={() => {
        setUserInteracted(true);
        api()?.zoomIn();
      }}
      onZoomOut={() => {
        setUserInteracted(true);
        api()?.zoomOut();
      }}
      onFit={() => {
        setUserInteracted(true);
        api()?.fit();
      }}
      wireTension={wireTension()}
      onWireTensionChange={setWireTension}
      extra={opts.extraTools}
    />
  );

  const pane = (
    <div class="flex-1 relative overflow-hidden">
      <GraphCanvas
        nodes={nodes()}
        edges={opts.customEdges ? edges() : undefined}
        topologyKey={opts.topologyKey?.()}
        onEdges={opts.customEdges ? undefined : setEdges}
        relatedArtists={opts.relatedArtists?.()}
        enabledKinds={enabled()}
        relationStrengths={relationStrengthConfig()}
        lockNodes={opts.lockNodes ?? false}
        selectedId={canvasSelectedId()}
        selectedEdges={canvasEdges()}
        tool={tool()}
        edgeCurvature={wireTension() * 0.5}
        searchMatches={searchMatches()}
        loadingNodeIds={opts.loadingNodeIds?.() ?? null}
        getHoverPreview={opts.getHoverPreview}
        paused={(opts.paused?.() ?? false) || autoPaused()}
        onReady={(a) => setApi(a)}
        onUserInteract={() => setUserInteracted(true)}
        quietUpdates={userInteracted()}
        onSelect={(album, _selectOpts) => {
          setUserInteracted(true);
          // graph subview is single-select only; multi-remote scoping
          // happens via remote-hub clicks (see LibraryGraphSubview).
          setSelected(album);
          setWireEdge(null);
        }}
        onEdgeSelect={(edge) => {
          setUserInteracted(true);
          // canvas clears the wire-selection by sending `null` (e.g.
          // the user clicked an empty patch of the graph). drop the
          // transient wireEdge but leave any pill-layered relations
          // alone — those are managed via the panel.
          if (!edge) {
            setWireEdge(null);
            return;
          }
          const key = edgeKey(edge.kind, edge.label ?? "");
          // when the album-detail popover is already open (either via
          // a selected album or one or more layered pills), route the
          // wire click into the toggle-able pill set so the user can
          // un-select it later by clicking the wire again or the
          // matching pill in the panel.
          const popoverOpen = selected() != null || pillEdges().size > 0;
          if (popoverOpen) {
            setPillEdges((prev) => {
              const next = new Map(prev);
              if (next.has(key)) next.delete(key);
              else next.set(key, edge);
              return next;
            });
            setEnabled((prev) => {
              if (prev.has(edge.kind as string)) return prev;
              const ns = new Set<string>(prev);
              ns.add(edge.kind as string);
              return ns;
            });
            return;
          }
          // no popover yet: clicking the same wire again toggles it off.
          const w = wireEdge();
          const wKey = w ? edgeKey(w.kind, w.label ?? "") : null;
          if (wKey === key) {
            setWireEdge(null);
            return;
          }
          setWireEdge(edge);
        }}
        onLassoSelect={
          opts.onLassoSelect
            ? (picks) => {
                setUserInteracted(true);
                // lasso lives at the album layer only — artist nodes
                // filter out so callers (bulk-tag flow) only ever
                // receive album payloads.
                const albums = picks.filter((n) => nodeKind(n) === "album") as AlbumNodeData[];
                if (albums.length >= 2) opts.onLassoSelect!(albums);
              }
            : undefined
        }
        class="absolute inset-0"
      />

      <Show when={popInfo().list.length > 0 && currentSel() && !albumPanel.hidden()}>
        <div class="absolute bottom-3 left-3 z-10 max-w-[min(360px,calc(100%-1.5rem))] pointer-events-auto">
          <button
            type="button"
            onClick={albumPanel.hide}
            title="hide details"
            aria-label="hide details"
            class="absolute -top-2 -right-2 z-10 w-6 h-6 inline-flex items-center justify-center rounded-full border border-white/15 bg-[var(--color-bg-elevated)]/90 backdrop-blur-sm text-white/70 hover:text-white hover:border-white/30 cursor-pointer p-0"
          >
            <Icon name="chevronDown" size={12} />
          </button>
          <AlbumDetailPopover
            albums={popInfo().list}
            index={popIndex()}
            onIndexChange={setPopIndex}
            activeRelations={activeRelations()}
            onRelationClick={focusOnRelation}
            onRelationSolo={soloRelation}
            onPlay={opts.onPlay}
            onShuffle={opts.onShuffle}
            onAddToQueue={opts.onAddToQueue}
            onViewAlbum={opts.onViewAlbum}
            onViewArtist={opts.onViewArtist}
            onSelectArtistById={(artistId) => setSelectedId(artistNodeId(artistId))}
            onToggleFavorite={opts.onToggleFavorite}
            onEdit={opts.onEditAlbum}
            onImageClick={opts.onImageClickAlbum}
            sameArtistAlbums={sameArtistAlbums()}
            onSelectAlbum={(album) => setSelectedId(album.id)}
          />
        </div>
      </Show>

      <Show when={popInfo().list.length > 0 && currentSel() && albumPanel.hidden()}>
        <button
          type="button"
          onClick={albumPanel.restore}
          title="show details"
          class="absolute bottom-3 left-3 z-10 inline-flex items-center gap-1.5 px-2 py-1 rounded border border-white/15 bg-[var(--color-bg-elevated)]/90 backdrop-blur-sm text-[11px] text-white/80 hover:text-white hover:border-white/30 cursor-pointer pointer-events-auto"
        >
          <Icon name="chevronUp" size={12} />
          <span class="text-[var(--color-accent-500,#ff1a9e)] font-medium">
            {popInfo().list.length}
          </span>
          <span class="text-white/60">selected — show details</span>
        </button>
      </Show>

      {/* artist detail popover mutually exclusive with the album
          popover above because each node has exactly one kind. */}
      <Show when={selectedArtist() && artistPopList().length > 0 && !artistPanel.hidden()}>
        <div class="absolute bottom-3 left-3 z-10 max-w-[min(360px,calc(100%-1.5rem))] pointer-events-auto">
          <button
            type="button"
            onClick={artistPanel.hide}
            title="hide details"
            aria-label="hide details"
            class="absolute -top-2 -right-2 z-10 w-6 h-6 inline-flex items-center justify-center rounded-full border border-white/15 bg-[var(--color-bg-elevated)]/90 backdrop-blur-sm text-white/70 hover:text-white hover:border-white/30 cursor-pointer p-0"
          >
            <Icon name="chevronDown" size={12} />
          </button>
          <ArtistDetailPopover
            artists={artistPopList()}
            index={artistPopIndex()}
            onIndexChange={setArtistPopIndex}
            activeRelations={activeRelations()}
            onRelationClick={focusOnRelation}
            onFocusArtist={(a) => setSelectedId(a.id)}
            onEdit={opts.onEditArtistNode}
            onImageClick={opts.onImageClickArtist}
            bio={opts.selectedArtistBio?.() ?? null}
            isFavorite={opts.selectedArtistIsFavorite?.()}
            onToggleFavorite={opts.onToggleFavoriteArtist}
            onViewArtist={opts.onViewArtistNode}
            albums={currentArtistAlbums()}
            onSelectAlbum={(album) => setSelectedId(album.id)}
          />
        </div>
      </Show>

      <Show when={selectedArtist() && artistPopList().length > 0 && artistPanel.hidden()}>
        <button
          type="button"
          onClick={artistPanel.restore}
          title="show details"
          class="absolute bottom-3 left-3 z-10 inline-flex items-center gap-1.5 px-2 py-1 rounded border border-white/15 bg-[var(--color-bg-elevated)]/90 backdrop-blur-sm text-[11px] text-white/80 hover:text-white hover:border-white/30 cursor-pointer pointer-events-auto"
        >
          <Icon name="chevronUp" size={12} />
          <span class="text-[var(--color-accent-500,#ff1a9e)] font-medium">
            {artistPopList().length}
          </span>
          <span class="text-white/60">artist — show details</span>
        </button>
      </Show>

      {/* debug force-tuning panel removed in phase 1 reset (2026-05-26). */}
    </div>
  );

  return {
    topNavTools,
    pane,
    nodeCount: () => nodes().length,
    edgeCount: () => edges().length,
    autoPaused,
    fit: () => {
      setUserInteracted(true);
      api()?.fit();
    },
    reset: () => {
      setUserInteracted(true);
      api()?.reset();
    },
    fullReset: () => {
      setUserInteracted(true);
      api()?.fullReset();
    },
    zoomIn: () => {
      setUserInteracted(true);
      api()?.zoomIn();
    },
    zoomOut: () => {
      setUserInteracted(true);
      api()?.zoomOut();
    },
    fitIfIdle: () => {
      if (userInteracted()) return;
      api()?.fit();
    },
    userInteracted,
    clearSelection: () => {
      setSelected(null);
      // also drop any active edge-wire so escape clears EVERYTHING the
      // user has explicitly highlighted on the canvas in one keystroke
      // (node selection + the connection wire).
      setWireEdge(null);
    },
    selectedArtistId: () => selectedArtist()?.artistId ?? null,
  };
}
