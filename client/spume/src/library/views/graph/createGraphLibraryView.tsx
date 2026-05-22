// createGraphLibraryView
//
// shared factory used by both the storybook LibraryGraphView and the
// real LibraryView's graph subview. owns all graph-local state
// (selection, pill toggles, wire click, wire tension, relation
// enablement) and returns three JSX slots:
//   - `topNavTools` — the GraphTopNavTools cluster (drop into TopNav's
//     `rightContent` slot).
//   - `selectedRelationChips` — horizontally-scrollable chip row of the
//     currently-enabled relation kinds (drop into TopNav's
//     `secondaryRowContent` slot).
//   - `pane` — the canvas + floating AlbumDetailPopover wrapper. drop
//     into a flex-1 cell in the main content area.
//
// caller supplies a `nodes` accessor (so the same factory drives both
// the static-mock story and the live, page-streamed real view), a
// `searchQuery` accessor for the topnav search field, and optional
// action callbacks (play/shuffle/queue/view/favorite/lasso).

import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { JSX } from "solid-js";
import { AlbumGraphCanvas, type GraphActions } from "../../../components/graph/AlbumGraphCanvas";
import { AlbumDetailPopover } from "../../../components/graph/AlbumDetailPopover";
import { GraphTopNavTools, type GraphTool } from "../../../components/graph/GraphTopNavTools";
import { Icon } from "../../../components/icons/registry";
import {
  buildRelationEdges,
  countEdgesByKind,
  RELATION_COLOR,
  RELATION_KINDS,
  RELATION_LABEL,
} from "../../../components/graph/relations";
import type { AlbumNodeData, GraphEdge, RelationKindLike } from "../../../components/graph/types";

export interface CreateGraphLibraryViewOpts {
  /** live album set — accessor so the caller can stream pages in. */
  nodes: () => AlbumNodeData[];
  /** search query accessor — drives node-highlight filter. */
  searchQuery: () => string;
  /** album row actions; surfaced via AlbumDetailPopover. */
  onPlay?: (album: AlbumNodeData) => void;
  onShuffle?: (album: AlbumNodeData) => void;
  onAddToQueue?: (album: AlbumNodeData) => void;
  onViewAlbum?: (album: AlbumNodeData) => void;
  onViewArtist?: (album: AlbumNodeData) => void;
  onToggleFavorite?: (album: AlbumNodeData) => void;
  /** fired when the lasso tool completes a selection (>=2 albums). */
  onLassoSelect?: (albums: AlbumNodeData[]) => void;
  /** when true, the sim pauses (canvas is hidden / behind another tab). */
  paused?: () => boolean;
  /** when truthy, locks the tool to the returned value — the user can
   *  no longer flip between pan / lasso. used by admin bulk-tag mode
   *  to keep the lasso active until the user exits that mode. */
  forceTool?: () => GraphTool | null;
  /** optional trailing slot for the topnav tools cluster — see
   *  GraphTopNavTools.extra. e.g. an admin-only bulk-tag toggle. */
  extraTools?: JSX.Element;
}

export interface GraphLibraryView {
  topNavTools: JSX.Element;
  selectedRelationChips: JSX.Element;
  pane: JSX.Element;
  /** live node count accessor — for the bottom-right status chip /
   *  topnav badge in caller-controlled chrome. */
  nodeCount: () => number;
  /** true when the sim is auto-paused after the initial settle of a
   *  large library (nodes >= 2000) and the user hasn't interacted yet.
   *  consumers can use this to render a "sim paused — drag to wake"
   *  chip in their chrome. */
  autoPaused: () => boolean;
  /** imperative API for keyboard shortcuts — fit / reset / zoom. only
   *  available after the canvas mounts. */
  fit: () => void;
  reset: () => void;
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
}

export function createGraphLibraryView(opts: CreateGraphLibraryViewOpts): GraphLibraryView {
  const ALL_KINDS = RELATION_KINDS.map((r) => r.kind);
  const nodes = opts.nodes;

  // big-library cliff: once we cross this threshold the sim eats real
  // cpu on weaker laptops. let it settle for INITIAL_SETTLE_MS then
  // auto-pause until the user explicitly interacts (any tool change,
  // selection, lasso, etc. flips `userInteracted` on).
  const LARGE_GRAPH_THRESHOLD = 2000;
  const INITIAL_SETTLE_MS = 4000;
  const [userInteracted, setUserInteracted] = createSignal(false);
  const [settleElapsed, setSettleElapsed] = createSignal(false);
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
  const [selected, setSelected] = createSignal<AlbumNodeData | null>(null);
  const [pillEdges, setPillEdges] = createSignal<Map<string, GraphEdge>>(new Map());
  const [wireEdge, setWireEdge] = createSignal<GraphEdge | null>(null);
  const [wireTension, setWireTension] = createSignal(0.44);
  const [api, setApi] = createSignal<GraphActions | null>(null);
  // narrow-viewport users can collapse the album-detail panel to give
  // the canvas more room. resets to false whenever selection changes
  // so opening a new album always shows the full panel.
  const [popHidden, setPopHidden] = createSignal(false);
  createEffect(() => {
    selected();
    setPopHidden(false);
  });

  const edgeKey = (kind: RelationKindLike, label: string) => `${String(kind)}|${label}`;
  const edges = createMemo<GraphEdge[]>(() => buildRelationEdges(nodes()));
  const counts = createMemo(() => countEdgesByKind(edges()));

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
      const t = (n.title ?? "").toLowerCase();
      const a = (n.artistName ?? "").toLowerCase();
      if (t.includes(q) || a.includes(q)) out.add(n.id);
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
      if (a) out.push(a);
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
        if (a) wireList.push(a);
      }
      wireList.sort((a, b) => a.title.localeCompare(b.title));
      const seen = new Set<string>(wireList.map((a) => a.id));
      const merged = [...wireList, ...pillAlbums.filter((a) => !seen.has(a.id))];
      return { list: merged, source: "edge" };
    }
    const s = selected();
    if (s) {
      const extras = pillAlbums.filter((a) => a.id !== s.id);
      return { list: [s, ...extras], source: "single" };
    }
    if (pillAlbums.length > 0) return { list: pillAlbums, source: "edge" };
    return { list: [], source: null };
  });
  const [popIndex, setPopIndex] = createSignal(0);
  // keep the carousel index pointed at the user's currently-focused
  // album across reactive churn:
  //   - when `selected()` changes (user clicks a different node), snap
  //     to index 0 — that's where the newly-selected album lives in
  //     `popInfo.list` ([selected, ...pillExtras]).
  //   - otherwise try to preserve the album that *was* on screen across
  //     data changes (new pages landing, pill toggles, etc.) by tracking
  //     its id and re-locating it in the new list.
  createEffect((prev: { currentId: string | null; selectedId: string | null } | undefined) => {
    const info = popInfo();
    const curSel = selected();
    const selectedId = curSel?.id ?? null;
    if (prev && prev.selectedId !== selectedId) {
      setPopIndex(0);
      return { currentId: info.list[0]?.id ?? null, selectedId };
    }
    const curId = info.list[popIndex()]?.id ?? null;
    if (prev?.currentId) {
      const newIdx = info.list.findIndex((a) => a.id === prev.currentId);
      if (newIdx >= 0) {
        if (newIdx !== popIndex()) setPopIndex(newIdx);
        return { currentId: prev.currentId, selectedId };
      }
      setPopIndex(0);
    }
    return { currentId: curId, selectedId };
  }, undefined);
  const currentSel = createMemo(() => popInfo().list[popIndex()] ?? null);
  const canvasSelectedId = createMemo(() => currentSel()?.id ?? null);

  const closeSelection = () => {
    setSelected(null);
    setPillEdges(new Map());
    setWireEdge(null);
  };

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

  // relation-kind solo (from the topnav picker)
  const soloKind = (kind: string) => {
    setEnabled(new Set<string>([kind]));
    setPillEdges((prev) => {
      const next = new Map<string, GraphEdge>();
      for (const [k, v] of prev) if (String(v.kind) === kind) next.set(k, v);
      return next;
    });
  };

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
      relations={{
        enabled: enabled(),
        counts: counts(),
        onToggle: (kind, next) => {
          setEnabled((prev) => {
            const ns = new Set<string>(prev);
            if (next) ns.add(kind);
            else ns.delete(kind);
            return ns;
          });
        },
        onSolo: soloKind,
        onSelectAll: () => setEnabled(new Set<string>(ALL_KINDS)),
        onDeselectAll: () => setEnabled(new Set<string>()),
        // chips are surfaced via the topnav second row; suppress the
        // inline ones in the picker so they aren't shown twice.
        hideActiveChips: true,
      }}
      extra={opts.extraTools}
    />
  );

  const selectedRelationChips = (
    <div class="flex gap-1.5 overflow-x-auto overflow-y-hidden no-scrollbar">
      <For each={RELATION_KINDS.filter((r) => enabled().has(r.kind))}>
        {(meta) => {
          const color = RELATION_COLOR[meta.kind];
          const label = RELATION_LABEL[meta.kind];
          return (
            <span
              class="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded text-[11px] leading-none whitespace-nowrap border backdrop-blur-sm"
              style={{
                color,
                "border-color": `${color}55`,
                "background-color": `${color}1a`,
                "background-image": "linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0.55))",
              }}
            >
              <button
                type="button"
                onClick={() => soloKind(meta.kind)}
                title={`solo ${label}`}
                class="bg-transparent border-none p-0 m-0 cursor-pointer text-current"
              >
                {label}
              </button>
              <button
                type="button"
                onClick={() =>
                  setEnabled((prev) => {
                    const ns = new Set<string>(prev);
                    ns.delete(meta.kind);
                    return ns;
                  })
                }
                title={`hide ${label}`}
                class="bg-transparent border-none p-0 ml-0.5 cursor-pointer text-current opacity-60 hover:opacity-100 leading-none"
              >
                ×
              </button>
            </span>
          );
        }}
      </For>
    </div>
  );

  const pane = (
    <div class="flex-1 relative overflow-hidden">
      <AlbumGraphCanvas
        nodes={nodes()}
        edges={edges()}
        enabledKinds={enabled()}
        selectedId={canvasSelectedId()}
        selectedEdges={canvasEdges()}
        tool={tool()}
        edgeCurvature={wireTension() * 0.5}
        searchMatches={searchMatches()}
        paused={(opts.paused?.() ?? false) || autoPaused()}
        onReady={(a) => setApi(a)}
        onUserInteract={() => setUserInteracted(true)}
        quietUpdates={userInteracted()}
        onSelect={(album) => {
          setUserInteracted(true);
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
            ? (albums) => {
                setUserInteracted(true);
                if (albums.length >= 2) opts.onLassoSelect!(albums as AlbumNodeData[]);
              }
            : undefined
        }
        class="absolute inset-0"
      />

      <Show when={popInfo().list.length > 0 && currentSel() && !popHidden()}>
        <div class="absolute bottom-3 left-3 z-10 max-w-[min(360px,calc(100%-1.5rem))] pointer-events-auto">
          <button
            type="button"
            onClick={() => setPopHidden(true)}
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
            onClose={closeSelection}
            onRelationClick={focusOnRelation}
            onRelationSolo={soloRelation}
            onPlay={opts.onPlay}
            onShuffle={opts.onShuffle}
            onAddToQueue={opts.onAddToQueue}
            onViewAlbum={opts.onViewAlbum}
            onViewArtist={opts.onViewArtist}
            onToggleFavorite={opts.onToggleFavorite}
          />
        </div>
      </Show>

      <Show when={popInfo().list.length > 0 && currentSel() && popHidden()}>
        <button
          type="button"
          onClick={() => setPopHidden(false)}
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

      {/* bottom-right status chip — shows graph size + current selection. */}
      <div class="absolute bottom-3 right-3 z-10 pointer-events-none">
        <div class="px-2 py-1 rounded bg-[var(--color-bg-elevated)]/85 backdrop-blur-sm border border-white/10 text-[11px] text-white/70 leading-tight whitespace-nowrap">
          <span class="text-white/90 font-medium">{nodes().length}</span>
          <span class="text-white/50"> albums</span>
          <Show when={popInfo().list.length > 0}>
            <span class="text-white/30 mx-1.5">·</span>
            <span class="text-[var(--color-accent-500,#ff1a9e)] font-medium">
              {popInfo().list.length}
            </span>
            <span class="text-white/50"> selected</span>
          </Show>
        </div>
      </div>
    </div>
  );

  return {
    topNavTools,
    selectedRelationChips,
    pane,
    nodeCount: () => nodes().length,
    autoPaused,
    fit: () => {
      setUserInteracted(true);
      api()?.fit();
    },
    reset: () => {
      setUserInteracted(true);
      api()?.reset();
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
  };
}
