import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AlbumGraphCanvas, type GraphActions } from "../src/components/graph/AlbumGraphCanvas";
import { AlbumDetailPopover } from "../src/components/graph/AlbumDetailPopover";
import { GraphControls, type GraphTool } from "../src/components/graph/GraphControls";
import { RelationLegend } from "../src/components/graph/RelationLegend";
import {
  buildRelationEdges,
  countEdgesByKind,
  RELATION_KINDS,
} from "../src/components/graph/relations";
import type {
  AlbumNodeData,
  GraphEdge,
  RelationKind,
  RelationKindLike,
} from "../src/components/graph/types";
import { Icon, IconNames } from "../src/components/icons/registry";
import { LARGE_GRAPH, MEDIUM_GRAPH, SMALL_GRAPH } from "./mockGraphData";

const ALL_KINDS = RELATION_KINDS.map((r) => r.kind);

// small palette used for newly-defined custom taxon kinds
const CUSTOM_COLOR_PALETTE = [
  "#fb923c",
  "#a3e635",
  "#38bdf8",
  "#f472b6",
  "#facc15",
  "#34d399",
  "#c084fc",
  "#fb7185",
];

interface CustomKind {
  kind: string;
  label: string;
  color: string;
  description?: string;
}

// mock context-menu actions for storybook. mirrors the structure of
// `useAlbumContextMenu` (play / shuffle / queue, view album / artist,
// favorite, add to playlist, share, edit…) without depending on the
// router / data-source contexts the hook itself requires.
function mockMenuActions(album: AlbumNodeData) {
  const log = (label: string) =>
    // eslint-disable-next-line no-console
    console.log(`[ctx-menu] ${label}:`, album.title, "·", album.artistName);
  return [
    { icon: IconNames.play, label: "play album", onClick: () => log("play") },
    { icon: IconNames.shuffle, label: "shuffle album", onClick: () => log("shuffle") },
    { icon: IconNames.queue, label: "add to queue", onClick: () => log("queue") },
    { type: "separator" as const },
    { icon: IconNames.album, label: "view album", onClick: () => log("view album") },
    { icon: IconNames.artist, label: "view artist", onClick: () => log("view artist") },
    { type: "separator" as const },
    {
      icon: album.isFavorite ? IconNames.favorite : IconNames.favoriteOutline,
      label: album.isFavorite ? "remove from favorites" : "add to favorites",
      onClick: () => log("favorite"),
    },
    { icon: IconNames.playlist, label: "add to playlist...", onClick: () => log("playlist") },
    { icon: IconNames.share, label: "share...", onClick: () => log("share") },
    { type: "separator" as const },
    { icon: IconNames.edit, label: "edit info...", onClick: () => log("edit") },
  ];
}

interface DemoProps {
  nodes: AlbumNodeData[];
  defaultKinds?: RelationKind[];
  perGroupFanout?: number;
}

interface CreateSpec {
  kind: string;
  label: string;
  /** optional shared value for the relation (e.g. "rock" for genre) */
  value: string;
  /** color for newly-defined kinds */
  color?: string;
  /** true when the user typed a brand-new taxon key */
  isNew: boolean;
}

interface LassoCreatePanelProps {
  picks: AlbumNodeData[];
  existingKinds: { kind: string; label: string; color: string }[];
  onCreate: (spec: CreateSpec) => void;
  onCancel: () => void;
}

function LassoCreatePanel(props: LassoCreatePanelProps) {
  const [mode, setMode] = createSignal<"existing" | "new">("existing");
  const [pickedKind, setPickedKind] = createSignal<string>(props.existingKinds[0]?.kind ?? "genre");
  const [newKey, setNewKey] = createSignal("");
  const [newLabel, setNewLabel] = createSignal("");
  const [value, setValue] = createSignal("");

  const submit = () => {
    if (mode() === "existing") {
      props.onCreate({
        kind: pickedKind(),
        label: pickedKind(),
        value: value().trim(),
        isNew: false,
      });
    } else {
      const slug = newKey()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
      if (!slug) return;
      props.onCreate({
        kind: slug,
        label: newLabel().trim() || slug,
        value: value().trim(),
        isNew: true,
      });
    }
  };

  return (
    <div class="absolute left-1/2 -translate-x-1/2 bottom-6 z-[1150] w-[min(420px,calc(100%-2rem))] p-3 rounded-lg bg-[var(--color-bg-elevated,#1a1a1f)] border border-[var(--color-border,#2a2a32)] shadow-2xl text-sm">
      <div class="flex items-center justify-between mb-2">
        <div class="font-medium">connect {props.picks.length} albums</div>
        <button
          type="button"
          class="opacity-60 hover:opacity-100 text-base leading-none"
          onClick={props.onCancel}
          aria-label="cancel"
        >
          ✕
        </button>
      </div>

      <div class="flex gap-1 mb-3 text-xs">
        <button
          type="button"
          class="px-2 py-1 rounded border"
          classList={{
            "bg-[var(--color-bg-hover,rgba(255,255,255,0.08))] border-[var(--color-border,#2a2a32)]":
              mode() === "existing",
            "bg-transparent border-transparent opacity-60 hover:opacity-100": mode() !== "existing",
          }}
          onClick={() => setMode("existing")}
        >
          existing kind
        </button>
        <button
          type="button"
          class="px-2 py-1 rounded border"
          classList={{
            "bg-[var(--color-bg-hover,rgba(255,255,255,0.08))] border-[var(--color-border,#2a2a32)]":
              mode() === "new",
            "bg-transparent border-transparent opacity-60 hover:opacity-100": mode() !== "new",
          }}
          onClick={() => setMode("new")}
        >
          new taxon key
        </button>
      </div>

      <Show when={mode() === "existing"}>
        <label class="block text-xs text-[var(--color-text-muted,#9aa0aa)] mb-1">
          relation kind
        </label>
        <select
          class="w-full bg-[var(--color-bg,#0e0e12)] border border-[var(--color-border,#2a2a32)] rounded px-2 py-1 mb-3 text-sm"
          value={pickedKind()}
          onChange={(e) => setPickedKind(e.currentTarget.value)}
        >
          {props.existingKinds.map((k) => (
            <option value={k.kind}>{k.label}</option>
          ))}
        </select>
      </Show>

      <Show when={mode() === "new"}>
        <div class="grid grid-cols-2 gap-2 mb-3">
          <div>
            <label class="block text-xs text-[var(--color-text-muted,#9aa0aa)] mb-1">
              key (id)
            </label>
            <input
              type="text"
              placeholder="e.g. vibe"
              class="w-full bg-[var(--color-bg,#0e0e12)] border border-[var(--color-border,#2a2a32)] rounded px-2 py-1 text-sm"
              value={newKey()}
              onInput={(e) => setNewKey(e.currentTarget.value)}
            />
          </div>
          <div>
            <label class="block text-xs text-[var(--color-text-muted,#9aa0aa)] mb-1">
              display label
            </label>
            <input
              type="text"
              placeholder="optional"
              class="w-full bg-[var(--color-bg,#0e0e12)] border border-[var(--color-border,#2a2a32)] rounded px-2 py-1 text-sm"
              value={newLabel()}
              onInput={(e) => setNewLabel(e.currentTarget.value)}
            />
          </div>
        </div>
      </Show>

      <label class="block text-xs text-[var(--color-text-muted,#9aa0aa)] mb-1">
        shared value (optional)
      </label>
      <input
        type="text"
        placeholder='e.g. "late-night drive"'
        class="w-full bg-[var(--color-bg,#0e0e12)] border border-[var(--color-border,#2a2a32)] rounded px-2 py-1 mb-3 text-sm"
        value={value()}
        onInput={(e) => setValue(e.currentTarget.value)}
      />

      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="px-3 py-1 rounded text-sm opacity-70 hover:opacity-100"
          onClick={props.onCancel}
        >
          cancel
        </button>
        <button
          type="button"
          class="px-3 py-1 rounded text-sm bg-[var(--color-accent-500,#ff1a9e)] text-white hover:opacity-90"
          onClick={submit}
        >
          create relation
        </button>
      </div>
    </div>
  );
}

function GraphDemo(props: DemoProps) {
  const [enabled, setEnabled] = createSignal<Set<string>>(
    new Set<string>(props.defaultKinds ?? ALL_KINDS)
  );
  const [tool, setTool] = createSignal<GraphTool>("pan");
  const [selected, setSelected] = createSignal<AlbumNodeData | null>(null);
  // pill-driven relation highlights, keyed by `"kind|label"`. lets the
  // user layer multiple relation highlights on top of each other (e.g.
  // "tag: indie" + "genre: punk") by toggling pills in the popover.
  // these never affect which album is shown in the popover — they only
  // add highlights on the canvas.
  const [pillEdges, setPillEdges] = createSignal<Map<string, GraphEdge>>(new Map());
  // wire-click-driven focus edge. when set, the popover switches to a
  // cluster carousel of all albums sharing this edge's (kind, label).
  const [wireEdge, setWireEdge] = createSignal<GraphEdge | null>(null);
  const edgeKey = (kind: RelationKindLike, label: string) => `${String(kind)}|${label}`;
  // canvas highlights: union of pill toggles + the wire-click edge.
  const canvasEdges = createMemo<GraphEdge[]>(() => {
    const out = Array.from(pillEdges().values());
    const w = wireEdge();
    if (w && !pillEdges().has(edgeKey(w.kind, w.label ?? ""))) out.push(w);
    return out;
  });
  // pills that should render in toggled-on state — the wire-click edge
  // also pulses its pill so the user can find the source of the
  // currently focused cluster.
  const activeRelations = createMemo<Set<string>>(() => {
    const s = new Set(pillEdges().keys());
    const w = wireEdge();
    if (w) s.add(edgeKey(w.kind, w.label ?? ""));
    return s;
  });
  const [relationsOpen, setRelationsOpen] = createSignal(true);
  const [ctxMenu, setCtxMenu] = createSignal<{ x: number; y: number; album: AlbumNodeData } | null>(
    null
  );
  const [api, setApi] = createSignal<GraphActions | null>(null);
  // wire tension drives edge curvature directly — 0 = straight,
  // 1 = max sag. mapped to a useful curvature range when handed to the
  // canvas (full curvature of 1 reads as too noodly).
  const [wireTension, setWireTension] = createSignal(0.44);

  // user-defined taxon kinds + custom edges they create via lasso
  const [customKinds, setCustomKinds] = createSignal<CustomKind[]>([]);
  const [customEdges, setCustomEdges] = createSignal<GraphEdge[]>([]);
  const [lassoPicks, setLassoPicks] = createSignal<AlbumNodeData[]>([]);
  const [creating, setCreating] = createSignal(false);

  const edges = createMemo<GraphEdge[]>(() => [
    ...buildRelationEdges(props.nodes, { perGroupFanout: props.perGroupFanout }),
    ...customEdges(),
  ]);
  const counts = createMemo(() => countEdgesByKind(edges()));
  const customColorMap = createMemo<Record<string, string>>(() =>
    Object.fromEntries(customKinds().map((k) => [k.kind, k.color]))
  );

  // carousel: derive the list of albums currently "selected" from the
  // strongest signal active (wire-click > lasso > single click). pill
  // toggles never *swap* the focused album, but they DO extend the
  // carousel: any extra albums brought in by a pill toggle get appended
  // after whatever's already in the list so the user can page through
  // related albums without losing their anchor.
  const pillClusterAlbums = createMemo<AlbumNodeData[]>(() => {
    const pills = pillEdges();
    if (pills.size === 0) return [];
    const tuples = new Set(pills.keys());
    const byId = new Map(props.nodes.map((n) => [n.id, n] as const));
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
  const popInfo = createMemo<{
    list: AlbumNodeData[];
    source: "edge" | "lasso" | "single" | null;
  }>(() => {
    if (creating()) return { list: [], source: null };
    const pillAlbums = pillClusterAlbums();
    const w = wireEdge();
    if (w) {
      const byId = new Map(props.nodes.map((n) => [n.id, n] as const));
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
      // append pill-cluster albums that aren't already in the wire cluster
      const seen = new Set(wireList.map((a) => a.id));
      const merged = [...wireList, ...pillAlbums.filter((a) => !seen.has(a.id))];
      return { list: merged, source: "edge" };
    }
    if (lassoPicks().length > 0) {
      return { list: lassoPicks(), source: "lasso" };
    }
    const s = selected();
    if (s) {
      // keep the clicked album anchored at index 0; pill cluster albums
      // fill out the rest of the carousel.
      const extras = pillAlbums.filter((a) => a.id !== s.id);
      return { list: [s, ...extras], source: "single" };
    }
    // no explicit selection — if the user toggled pills with nothing
    // else focused, fall back to showing the pill cluster as the list.
    if (pillAlbums.length > 0) return { list: pillAlbums, source: "edge" };
    return { list: [], source: null };
  });
  const [popIndex, setPopIndex] = createSignal(0);
  // when the list changes, try to preserve the currently focused album
  // by re-locating it in the new list. only fall back to index 0 when
  // the previous album isn't present anymore.
  createEffect((prev: { source: string; currentId: string | null } | undefined) => {
    const info = popInfo();
    const curId = info.list[popIndex()]?.id ?? null;
    if (prev) {
      const targetId = prev.currentId;
      if (targetId) {
        const newIdx = info.list.findIndex((a) => a.id === targetId);
        if (newIdx >= 0) {
          if (newIdx !== popIndex()) setPopIndex(newIdx);
          return { source: info.source ?? "none", currentId: targetId };
        }
      }
      // album gone — reset
      setPopIndex(0);
    }
    return { source: info.source ?? "none", currentId: curId };
  }, undefined);
  const currentSel = createMemo(() => popInfo().list[popIndex()] ?? null);
  const canvasSelectedId = createMemo(() => {
    const info = popInfo();
    if (info.source === "lasso") return null;
    return currentSel()?.id ?? null;
  });
  // helper: a taxon pill in the popover toggles its relation on/off in
  // the pill highlight map. lighting up a new kind also enables it in
  // the relation legend so the wires are actually visible. crucially
  // this does NOT touch `selected`, `lassoPicks`, or `wireEdge` — the
  // popover stays anchored on the same album(s) the user was browsing.
  const focusOnRelation = (kind: RelationKindLike, label: string) => {
    const key = edgeKey(kind, label);
    const cur = pillEdges();
    const next = new Map(cur);
    if (next.has(key)) {
      next.delete(key);
    } else {
      const match = edges().find((e) => e.kind === kind && e.label === label);
      const target: GraphEdge =
        match ??
        ({
          source: currentSel()?.id ?? props.nodes[0]?.id ?? "",
          target: currentSel()?.id ?? props.nodes[0]?.id ?? "",
          kind,
          weight: 0.5,
          label,
        } as GraphEdge);
      next.set(key, target);
      setEnabled((prev) => {
        if (prev.has(kind as string)) return prev;
        const ns = new Set(prev);
        ns.add(kind as string);
        return ns;
      });
    }
    setPillEdges(next);
    // fit on the next frame so the canvas has reconciled the new edge
    // selection before zooming.
    requestAnimationFrame(() => api()?.fit());
  };

  // helper: long-press on a pill clears every other active relation and
  // keeps only this one — mirrors the "solo" gesture in the relations
  // panel. also clears any wire-click focus so the soloed pill is the
  // sole highlight.
  const soloRelation = (kind: RelationKindLike, label: string) => {
    const key = edgeKey(kind, label);
    const match = edges().find((e) => e.kind === kind && e.label === label);
    const target: GraphEdge =
      match ??
      ({
        source: currentSel()?.id ?? props.nodes[0]?.id ?? "",
        target: currentSel()?.id ?? props.nodes[0]?.id ?? "",
        kind,
        weight: 0.5,
        label,
      } as GraphEdge);
    setEnabled((prev) => {
      if (prev.has(kind as string)) return prev;
      const ns = new Set(prev);
      ns.add(kind as string);
      return ns;
    });
    setWireEdge(null);
    setPillEdges(new Map([[key, target]]));
    requestAnimationFrame(() => api()?.fit());
  };

  // auto-fit the view after the relation set changes — once the layout
  // has had a moment to reheat & re-settle, snap to the new bounds.
  // skipFirstFit guards against fitting before the canvas has any
  // simulated positions yet (the ready callback handles the initial view).
  let skipFirstFit = true;
  createEffect(() => {
    // depend on enabled() so this fires on every toggle
    enabled();
    if (skipFirstFit) {
      skipFirstFit = false;
      return;
    }
    const t = window.setTimeout(() => api()?.fit(), 600);
    onCleanup(() => window.clearTimeout(t));
  });

  // close context menu on outside click / scroll / escape
  const onDocPointer = (ev: PointerEvent) => {
    const menu = ctxMenu();
    if (!menu) return;
    const target = ev.target as HTMLElement | null;
    if (target?.closest("[data-graph-ctx-menu]")) return;
    setCtxMenu(null);
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      setCtxMenu(null);
      setCreating(false);
    }
  };
  if (typeof document !== "undefined") {
    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onDocPointer, true);
      document.removeEventListener("keydown", onKey);
    });
  }

  return (
    <div class="fixed inset-0 bg-[var(--color-bg,#0e0e12)] text-[var(--color-text,#e6e6e6)] overflow-hidden">
      <div class="absolute inset-0">
        <AlbumGraphCanvas
          nodes={props.nodes}
          edges={edges()}
          enabledKinds={enabled()}
          tool={tool()}
          selectedId={canvasSelectedId()}
          selectedEdges={canvasEdges()}
          relationColors={customColorMap()}
          edgeCurvature={wireTension() * 0.5}
          onReady={(a) => setApi(a)}
          onSelect={(a) => {
            // a single-node click clears any prior multi-selection so the
            // carousel collapses to just this one album
            setLassoPicks([]);
            setPillEdges(new Map());
            setWireEdge(null);
            // mock data is album-only, so the canvas only ever emits
            // AlbumNodeData here.
            setSelected((a as AlbumNodeData | null) ?? null);
          }}
          onEdgeSelect={(e) => {
            setLassoPicks([]);
            setSelected(null);
            // a wire click resets pill toggles and pins the popover to the
            // clicked edge's cluster.
            setPillEdges(new Map());
            setWireEdge(e ?? null);
            if (e) requestAnimationFrame(() => api()?.fit());
          }}
          onLassoSelect={(picks) => {
            // eslint-disable-next-line no-console
            console.log("lasso selected", picks.length, "albums");
            if (picks.length >= 2) {
              setLassoPicks(picks as AlbumNodeData[]);
              setCreating(true);
            }
          }}
          onNodeContextMenu={(album, x, y) => {
            setCtxMenu({ album: album as AlbumNodeData, x, y });
          }}
        />
      </div>

      {/* controls + relations (top-right). no fixed width so the button row
          can size to its contents and not clip on the right edge. */}
      <div class="absolute top-2 right-3 max-w-[calc(100%-1rem)]">
        <GraphControls
          tool={tool()}
          onToolChange={(t) => {
            setTool(t);
            // switching into lasso should clear prior focus so dimming
            // doesn't fight the upcoming multi-selection
            if (t === "lasso") {
              setSelected(null);
              setPillEdges(new Map());
              setWireEdge(null);
            }
          }}
          onZoomIn={() => api()?.zoomIn()}
          onZoomOut={() => api()?.zoomOut()}
          onFit={() => api()?.fit()}
          wireTension={wireTension()}
          onWireTensionChange={(v) => setWireTension(v)}
          relationsOpen={relationsOpen()}
          onToggleRelations={() => setRelationsOpen((v) => !v)}
          onSelectAllRelations={() =>
            setEnabled(new Set<string>([...ALL_KINDS, ...customKinds().map((k) => k.kind)]))
          }
          onDeselectAllRelations={() => setEnabled(new Set())}
          relationsContent={
            <RelationLegend
              enabled={enabled()}
              counts={counts()}
              extraKinds={customKinds()}
              onToggle={(k, next) => {
                const s = new Set(enabled());
                if (next) s.add(k);
                else s.delete(k);
                setEnabled(s);
              }}
              onSolo={(k) => setEnabled(new Set<string>([k]))}
            />
          }
        />
      </div>

      {/* selected album(s) popover — carousels through lasso picks, all
          albums sharing a clicked connection, or a single click. docked
          near the bottom-right with breathing room so it doesn't clip. */}
      <Show when={currentSel()}>
        <div class="absolute bottom-3 right-3 max-h-[calc(100vh-5rem)]">
          <AlbumDetailPopover
            albums={popInfo().list}
            index={popIndex()}
            onIndexChange={setPopIndex}
            onRelationClick={(kind, label) => focusOnRelation(kind, label)}
            onRelationSolo={(kind, label) => soloRelation(kind, label)}
            activeRelations={activeRelations()}
            onPlay={(a) =>
              // eslint-disable-next-line no-console
              console.log("[popover] play", a.title)
            }
            onShuffle={(a) =>
              // eslint-disable-next-line no-console
              console.log("[popover] shuffle", a.title)
            }
            onAddToQueue={(a) =>
              // eslint-disable-next-line no-console
              console.log("[popover] queue", a.title)
            }
            onViewAlbum={(a) =>
              // eslint-disable-next-line no-console
              console.log("[popover] view album", a.title)
            }
            onViewArtist={(a) =>
              // eslint-disable-next-line no-console
              console.log("[popover] view artist", a.artistName)
            }
            onToggleFavorite={(a) =>
              // eslint-disable-next-line no-console
              console.log("[popover] favorite toggle", a.title)
            }
          />
        </div>
      </Show>

      {/* lasso-creation panel — pops up after lasso selects 2+ albums */}
      <Show when={creating() && lassoPicks().length >= 2}>
        <LassoCreatePanel
          picks={lassoPicks()}
          existingKinds={[
            ...RELATION_KINDS.map((r) => ({
              kind: r.kind as string,
              label: r.label,
              color: r.color,
            })),
            ...customKinds(),
          ]}
          onCancel={() => setCreating(false)}
          onCreate={(spec) => {
            // 1) if a brand-new kind, register it (+ color) and enable it
            let allKinds = customKinds();
            if (spec.isNew) {
              const color =
                spec.color ?? CUSTOM_COLOR_PALETTE[allKinds.length % CUSTOM_COLOR_PALETTE.length];
              const meta: CustomKind = {
                kind: spec.kind,
                label: spec.label || spec.kind,
                color,
                description: "user-defined relation",
              };
              allKinds = [...allKinds, meta];
              setCustomKinds(allKinds);
              setEnabled(new Set<string>([...enabled(), spec.kind]));
            } else {
              // ensure the chosen kind is visible
              if (!enabled().has(spec.kind)) {
                setEnabled(new Set<string>([...enabled(), spec.kind]));
              }
            }
            // 2) build edges as a chain across the picks (cheap, scales)
            const picks = lassoPicks();
            const sorted = [...picks].sort((a, b) => a.id.localeCompare(b.id));
            const newEdges: GraphEdge[] = [];
            for (let i = 0; i < sorted.length - 1; i++) {
              newEdges.push({
                source: sorted[i].id,
                target: sorted[i + 1].id,
                kind: spec.kind,
                weight: 0.8,
                label: spec.value || undefined,
              });
            }
            setCustomEdges([...customEdges(), ...newEdges]);
            setCreating(false);
            setLassoPicks([]);
            // drop back to pan tool so the user can immediately explore
            setTool("pan");
          }}
        />
      </Show>

      {/* node count footer */}
      <div class="absolute bottom-2 left-2 text-[11px] text-[var(--color-text-muted,#9aa0aa)] bg-[var(--color-bg-elevated,#1a1a1f)] border border-[var(--color-border,#2a2a32)] rounded px-2 py-1">
        {props.nodes.length} albums · {edges().length} edges
      </div>

      {/* floating context menu */}
      <Show when={ctxMenu()}>
        {(menu) => (
          <div
            data-graph-ctx-menu
            class="fixed z-[1200] min-w-48 bg-[var(--color-bg-elevated,#1a1a1f)] border border-[var(--color-border,#2a2a32)] rounded-lg shadow-2xl overflow-hidden py-1"
            style={{
              left: `${Math.min(menu().x, window.innerWidth - 220)}px`,
              top: `${Math.min(menu().y, window.innerHeight - 280)}px`,
            }}
          >
            <div class="px-3 py-2 border-b border-[var(--color-border,#2a2a32)]">
              <div class="text-sm font-medium truncate">{menu().album.title}</div>
              <div class="text-xs text-[var(--color-text-muted,#9aa0aa)] truncate">
                {menu().album.artistName}
              </div>
            </div>
            {mockMenuActions(menu().album).map((action) =>
              "type" in action && action.type === "separator" ? (
                <div class="my-1 h-px bg-[var(--color-border,#2a2a32)]" />
              ) : (
                <button
                  type="button"
                  class="w-full px-3 py-2 text-left flex items-center gap-2 text-sm hover:bg-[var(--color-bg-hover,rgba(255,255,255,0.06))]"
                  onClick={() => {
                    (action as { onClick: () => void }).onClick();
                    setCtxMenu(null);
                  }}
                >
                  <Icon name={(action as { icon: string }).icon as any} size={16} />
                  <span>{(action as { label: string }).label}</span>
                </button>
              )
            )}
          </div>
        )}
      </Show>
    </div>
  );
}

const meta = {
  title: "Graph/AlbumGraphCanvas",
  component: GraphDemo,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof GraphDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Small_22Nodes_AllRelations: Story = {
  name: "small (22 nodes · all relations)",
  args: { nodes: SMALL_GRAPH, defaultKinds: ALL_KINDS },
};

export const Small_GenreOnly: Story = {
  name: "small (22 nodes · genre only)",
  args: { nodes: SMALL_GRAPH, defaultKinds: ["genre"] },
};

export const Small_GenresTagsArtists: Story = {
  name: "small (22 nodes · genres + tags + artists)",
  args: {
    nodes: SMALL_GRAPH,
    defaultKinds: ["genre", "tag", "same_artist"],
  },
};

export const Medium_200Nodes: Story = {
  name: "medium (200 nodes · all relations)",
  args: { nodes: MEDIUM_GRAPH, defaultKinds: ALL_KINDS, perGroupFanout: 2 },
};

export const Medium_RelatedArtistsOnly: Story = {
  name: "medium (200 nodes · related artists only)",
  args: {
    nodes: MEDIUM_GRAPH,
    defaultKinds: ["related_artist"],
  },
};

export const Large_2000Nodes: Story = {
  name: "large (2000 nodes · all relations, fanout=1)",
  args: { nodes: LARGE_GRAPH, defaultKinds: ALL_KINDS, perGroupFanout: 1 },
};

export const Mobile_Narrow: Story = {
  name: "mobile (200 nodes, narrow viewport)",
  args: { nodes: MEDIUM_GRAPH, defaultKinds: ALL_KINDS, perGroupFanout: 2 },
  parameters: { viewport: { defaultViewport: "iphone6" } },
};
