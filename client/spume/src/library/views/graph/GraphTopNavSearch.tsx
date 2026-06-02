// graph topnav search — fans out search-suggestions across every online
// remote and merges them into a single flyout. dupes (same display name,
// case-insensitive) within song/artist/album/playlist categories are
// collapsed into one row tracking which remotes contributed it.
//
// per-remote loading status is rendered as a small row of colored pills
// in the input's hint slot so the user can see which peers are still
// answering.
//
// milestone A only: row selection still navigates via TopNavSearch's
// internal handler. milestone B will swap the graph data over to a
// synthetic "search results" subgraph on enter and route selections to
// walker.repivot instead of route navigation. see
// docs/explore-search-and-fixes-plan.md.

import { createMemo, createSignal, createEffect, on, For, Show } from "solid-js";
import type { Remote } from "../../../app/services/storage/schemas/remote";
import { RemoteMusicDataSource } from "../../../music/data/remote/remoteSource";
import { TopNavSearch } from "../../../components/navigation/TopNavSearch";
import type { SearchSuggestion as InputSuggestion } from "../../../components/forms/SearchInput";
import type { SearchSuggestion as APISuggestion } from "../../../music/data/types";
import type { ImageMetadata } from "../../../music/services/storage/types";
import { getRemoteMediaUrl } from "../../../utils/urls";
import { slug } from "../../../components/graph/data/nodeIds";
import { pickRemote } from "../../../app/services/remotePickerState";
import { wakeAllRemotes } from "../../../app/services/remotes/remoteHealth";

type RemoteStatus = "idle" | "loading" | "loaded" | "error";

export interface GraphSearchResultsSnapshot {
  query: string;
  remoteIds: string[];
  resultsByRemote: Map<string, APISuggestion[]>;
}

export interface GraphTopNavSearchProps {
  remotes: () => Remote[];
  onNavigate?: (path: string) => void;
  currentPath?: string;
  navHovered?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** is the parent currently rendering this query as a search subgraph?
   *  controls (a) the footer button label ("showing in graph" vs "press
   *  return to explore") and (b) whether row clicks repivot the walker
   *  instead of route-navigating. when undefined, treated as false. */
  isShowingInGraph?: () => boolean;
  /** called when the user asks to render the current per-remote suggestion
   *  results as a synthetic graph (via Enter or the footer button). the
   *  parent owns the search-mode lifecycle; this just hands it the
   *  latest snapshot. returning true / void is fine — no return contract. */
  onShowInGraph?: (snapshot: GraphSearchResultsSnapshot) => void;
  /** called when the user clears the input or asks to leave search-mode.
   *  the parent should drop the search subgraph and restore the default
   *  library graph. */
  onExitGraphSearch?: () => void;
  /** row-click interceptor used while `isShowingInGraph()` is true. the
   *  parent maps the suggestion to a node id and repivots the walker.
   *  returning true tells TopNavSearch to suppress its default route nav. */
  onSelectInGraph?: (s: APISuggestion, primaryRemoteId: string) => boolean | Promise<boolean>;
}

interface AggSuggestion {
  key: string;
  primary: APISuggestion;
  contributingRemoteIds: string[];
  primaryRemoteId: string;
}

const DEBOUNCE_MS = 150;
const PAGE_SIZE = 8;

interface RemotePageState {
  /** highest page successfully loaded; 0 = nothing yet */
  loadedPage: number;
  /** whether the most recent response said `has_next` */
  hasMore: boolean;
  /** whether a follow-up page request is currently in flight */
  loadingMore: boolean;
}

export function GraphTopNavSearch(props: GraphTopNavSearchProps) {
  const [query, setQuery] = createSignal("");
  const [statuses, setStatuses] = createSignal<Map<string, RemoteStatus>>(new Map());
  const [resultsByRemote, setResultsByRemote] = createSignal<Map<string, APISuggestion[]>>(
    new Map()
  );
  const [pageState, setPageState] = createSignal<Map<string, RemotePageState>>(new Map());
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  // generation counter so stale responses can't overwrite newer state.
  let gen = 0;

  // local (`is_charnel_managed`) remote is in-process and shouldn't be
  // skipped by the offline flag — keep it in the fan-out unconditionally
  // so the user always sees their local library in cross-remote results.
  const onlineRemotes = createMemo(() =>
    props.remotes().filter((r) => r.is_charnel_managed || r.is_offline !== true)
  );

  // fan-out fetcher: kicks off one searchSuggestions per online remote, marks
  // each as loading/loaded/error independently and renders partial state.
  const runSearch = (q: string) => {
    gen++;
    const myGen = gen;
    const remotes = onlineRemotes();

    if (q.length < 2) {
      setStatuses(new Map());
      setResultsByRemote(new Map());
      setPageState(new Map());
      return;
    }

    // opportunistic wake-up: any remote currently flagged offline gets a
    // background probe with backoff/dedupe. results flow into the
    // reactive remote list and `runSearch` re-runs on the next query.
    wakeAllRemotes();

    const initial = new Map<string, RemoteStatus>();
    for (const r of remotes) initial.set(r.remote_id, "loading");
    setStatuses(initial);
    setResultsByRemote(new Map());
    setPageState(new Map());

    for (const r of remotes) {
      const ds = new RemoteMusicDataSource(r);
      void (async () => {
        try {
          if (!ds.searchSuggestions) {
            if (gen !== myGen) return;
            setStatuses((prev) => {
              const next = new Map(prev);
              next.set(r.remote_id, "idle");
              return next;
            });
            return;
          }
          const res = await ds.searchSuggestions({
            field: "all",
            partial: q,
            page: 1,
            page_size: PAGE_SIZE,
          });
          if (gen !== myGen) return;
          const suggestions = res.suggestions ?? [];
          setResultsByRemote((prev) => {
            const next = new Map(prev);
            next.set(r.remote_id, suggestions);
            return next;
          });
          setPageState((prev) => {
            const next = new Map(prev);
            next.set(r.remote_id, {
              loadedPage: 1,
              hasMore: !!res.has_next,
              loadingMore: false,
            });
            return next;
          });
          setStatuses((prev) => {
            const next = new Map(prev);
            next.set(r.remote_id, "loaded");
            return next;
          });
        } catch (e) {
          if (gen !== myGen) return;
          console.debug(`[graph-search] ${r.remote_id} failed:`, e);
          setStatuses((prev) => {
            const next = new Map(prev);
            next.set(r.remote_id, "error");
            return next;
          });
        }
      })();
    }
  };

  // ---- pagination ---------------------------------------------------

  /**
   * load the next page from every remote that still reports `has_more`
   * and isn't already loading. results append to the existing list so
   * the aggregation memo picks them up automatically.
   */
  const loadMore = () => {
    const q = query();
    if (q.length < 2) return;
    const myGen = gen;
    const remotes = onlineRemotes();
    const pages = pageState();

    const candidates = remotes.filter((r) => {
      const ps = pages.get(r.remote_id);
      return ps && ps.hasMore && !ps.loadingMore;
    });
    if (candidates.length === 0) return;

    // mark all candidates as loading-more in one snapshot.
    setPageState((prev) => {
      const next = new Map(prev);
      for (const r of candidates) {
        const ps = next.get(r.remote_id);
        if (ps) next.set(r.remote_id, { ...ps, loadingMore: true });
      }
      return next;
    });

    for (const r of candidates) {
      const ds = new RemoteMusicDataSource(r);
      const ps = pages.get(r.remote_id)!;
      const nextPage = ps.loadedPage + 1;
      void (async () => {
        try {
          if (!ds.searchSuggestions) return;
          const res = await ds.searchSuggestions({
            field: "all",
            partial: q,
            page: nextPage,
            page_size: PAGE_SIZE,
          });
          if (gen !== myGen) return;
          const suggestions = res.suggestions ?? [];
          setResultsByRemote((prev) => {
            const next = new Map(prev);
            const existing = next.get(r.remote_id) ?? [];
            next.set(r.remote_id, existing.concat(suggestions));
            return next;
          });
          setPageState((prev) => {
            const next = new Map(prev);
            next.set(r.remote_id, {
              loadedPage: nextPage,
              hasMore: !!res.has_next,
              loadingMore: false,
            });
            return next;
          });
        } catch (e) {
          if (gen !== myGen) return;
          console.debug(`[graph-search] ${r.remote_id} loadMore failed:`, e);
          // clear loadingMore so the user can retry by scrolling again,
          // but stop further attempts on this remote until the query
          // changes (avoids tight error loops).
          setPageState((prev) => {
            const next = new Map(prev);
            const cur = next.get(r.remote_id);
            if (cur) next.set(r.remote_id, { ...cur, hasMore: false, loadingMore: false });
            return next;
          });
        }
      })();
    }
  };

  const hasMoreAcrossRemotes = createMemo(() => {
    for (const ps of pageState().values()) if (ps.hasMore) return true;
    return false;
  });

  const isLoadingAny = createMemo(() => {
    for (const v of statuses().values()) if (v === "loading") return true;
    for (const ps of pageState().values()) if (ps.loadingMore) return true;
    return false;
  });

  // debounce input → fan-out
  createEffect(
    on(query, (q) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => runSearch(q), DEBOUNCE_MS);
    })
  );

  // ---- aggregation ---------------------------------------------------

  const aggregatedSuggestions = createMemo<AggSuggestion[]>(() => {
    const byKey = new Map<string, AggSuggestion>();
    const ordered: AggSuggestion[] = [];
    for (const r of onlineRemotes()) {
      const list = resultsByRemote().get(r.remote_id) ?? [];
      for (const s of list) {
        // dedup key: aggregate songs/artists/albums/playlists by display slug;
        // taxons (genre/mood/etc.) stay per-remote so the user can see which
        // remote each one belongs to.
        const isTaxon =
          s.suggestion_type !== "song" &&
          s.suggestion_type !== "artist" &&
          s.suggestion_type !== "album" &&
          s.suggestion_type !== "playlist";
        const key = isTaxon
          ? `${s.suggestion_type}::${r.remote_id}::${slug(s.display)}`
          : `${s.suggestion_type}::${slug(s.display)}`;
        const existing = byKey.get(key);
        if (existing) {
          if (!existing.contributingRemoteIds.includes(r.remote_id)) {
            existing.contributingRemoteIds.push(r.remote_id);
          }
        } else {
          const agg: AggSuggestion = {
            key,
            primary: s,
            primaryRemoteId: r.remote_id,
            contributingRemoteIds: [r.remote_id],
          };
          byKey.set(key, agg);
          ordered.push(agg);
        }
      }
    }
    return ordered;
  });

  // map to SearchInputSuggestion (the shape TopNavSearch expects).
  const inputSuggestions = createMemo<InputSuggestion[]>(() => {
    const remoteById = new Map(props.remotes().map((r) => [r.remote_id, r]));
    const nameFor = (id: string) => remoteById.get(id)?.name ?? id;
    return aggregatedSuggestions().map((agg) => {
      const primaryRemote = remoteById.get(agg.primaryRemoteId);
      const baseUrl = primaryRemote?.base_url || "";
      const remoteCount = agg.contributingRemoteIds.length;
      const names = agg.contributingRemoteIds.map(nameFor);
      const detailLabel = remoteCount > 1 ? `${remoteCount} remotes` : names[0];
      const detailTitle = remoteCount > 1 ? names.join(", ") : names[0];
      return {
        id: `${agg.primaryRemoteId}::${agg.primary.entity_id}`,
        text: agg.primary.display,
        category: agg.primary.suggestion_type || "unknown",
        categoryDetail: { label: detailLabel, title: detailTitle },
        highlight: agg.primary.highlight,
        images: parseMetadataImages(agg.primary.metadata, baseUrl, agg.primaryRemoteId),
        isFavorite: agg.primary.is_favorite,
        data: agg.primary,
      };
    });
  });

  // side-table from suggestion id -> contributing remote ids, used by
  // remoteIdFor to detect multi-remote results that need disambiguation.
  const contributorsById = createMemo(() => {
    const out = new Map<string, string[]>();
    for (const agg of aggregatedSuggestions()) {
      out.set(`${agg.primaryRemoteId}::${agg.primary.entity_id}`, agg.contributingRemoteIds);
    }
    return out;
  });

  // ---- per-remote status hint ---------------------------------------

  const statusHint = createMemo<string | null>(() => {
    if (query().length < 2) return null;
    const sts = statuses();
    if (sts.size === 0) return null;
    let loading = 0;
    let loaded = 0;
    let errored = 0;
    for (const v of sts.values()) {
      if (v === "loading") loading++;
      else if (v === "loaded") loaded++;
      else if (v === "error") errored++;
    }
    const total = sts.size;
    const errBit = errored > 0 ? `, ${errored} error` : "";
    if (loading > 0) return `searching ${loaded}/${total} remotes...${errBit}`;
    return `searched ${loaded}/${total} remotes${errBit}`;
  });

  // suggestion.id is `${primaryRemoteId}::${entity_id}` (see inputSuggestions).
  // when an aggregated suggestion came from multiple remotes, prompt the
  // user to pick one via the global remote-picker modal. returning null
  // aborts navigation (user cancelled).
  const remoteIdFor = async (s: InputSuggestion): Promise<string | null | undefined> => {
    const id = s.id ?? "";
    const contributors = contributorsById().get(id);
    if (!contributors || contributors.length === 0) {
      return id.split("::")[0] || undefined;
    }
    if (contributors.length === 1) return contributors[0];
    const remoteById = new Map(props.remotes().map((r) => [r.remote_id, r]));
    const options = contributors.map((rid) => remoteById.get(rid)).filter((r): r is Remote => !!r);
    if (options.length === 0) return undefined;
    const picked = await pickRemote(options, {
      title: "open on which remote?",
      message: `"${s.text}" was found on ${options.length} remotes.`,
    });
    return picked ? picked.remote_id : null;
  };

  // ---- search-mode handoff ----------------------------------------------

  /** snapshot the current per-remote results into the shape
   *  buildSearchGraph expects. computed lazily on submit so we don't
   *  pay for it on every keystroke. */
  const captureSnapshot = (): GraphSearchResultsSnapshot => {
    const q = query();
    const map = new Map<string, APISuggestion[]>();
    const ids: string[] = [];
    for (const r of onlineRemotes()) {
      const list = resultsByRemote().get(r.remote_id);
      if (list && list.length > 0) {
        ids.push(r.remote_id);
        map.set(r.remote_id, list);
      }
    }
    return { query: q, remoteIds: ids, resultsByRemote: map };
  };

  const hasAnyResults = createMemo(() => {
    for (const list of resultsByRemote().values()) {
      if (list.length > 0) return true;
    }
    return false;
  });

  /** unified entry point for Enter + row-click. always replaces the
   *  parent's search-mode snapshot with the latest results, so
   *  re-typing + Enter while already in search-mode swaps the graph
   *  in one keystroke instead of two. explicit exit is handled by
   *  the hint click + clear-input effect below. */
  const triggerShowInGraph = (): boolean => {
    if (query().length < 2) return false;
    if (!hasAnyResults()) return false;
    props.onShowInGraph?.(captureSnapshot());
    return true;
  };

  /** when search-mode is active, intercept row clicks and let the
   *  parent repivot the walker. when search-mode is NOT active, a
   *  row click (or Enter on a highlighted row) instead transitions
   *  into search-mode — same effect as clicking the hint or pressing
   *  Enter without a highlight. consistent UX across all three
   *  entry points. */
  const onSelectOverride = async (s: InputSuggestion): Promise<boolean> => {
    if (!props.isShowingInGraph?.()) {
      return triggerShowInGraph();
    }
    const data = s.data as APISuggestion | undefined;
    if (!data) return false;
    const primary = (s.id ?? "").split("::")[0];
    if (!primary) return false;
    return Boolean(await props.onSelectInGraph?.(data, primary));
  };

  // exit search-mode when the input is cleared. the parent gets a
  // chance to restore the default library graph without an extra
  // re-render cycle.
  createEffect(
    on(
      () => query(),
      (q) => {
        if (q.length < 2 && props.isShowingInGraph?.()) {
          props.onExitGraphSearch?.();
        }
      }
    )
  );

  // hint shown between the input and the suggestions flyout (same
  // visual slot as other search inputs' "press return to filter X"
  // hint). clicking it has the same effect as Enter / footer button.
  const hintOverride = () => {
    if (query().length < 2) return null;
    if (!hasAnyResults()) return null;
    return {
      message: props.isShowingInGraph?.()
        ? "← exit search graph (or clear input)"
        : "press return (or click) to explore results in graph →",
      onClick: () => {
        if (props.isShowingInGraph?.()) {
          props.onExitGraphSearch?.();
        } else {
          triggerShowInGraph();
        }
      },
    };
  };

  return (
    <TopNavSearch
      placeholder="search across remotes..."
      onNavigate={props.onNavigate}
      currentPath={props.currentPath}
      navHovered={props.navHovered}
      onExpandedChange={props.onExpandedChange}
      suggestions={inputSuggestions()}
      onSearchChange={setQuery}
      isLoadingSuggestions={isLoadingAny()}
      hasMoreSuggestions={hasMoreAcrossRemotes()}
      onLoadMoreSuggestions={loadMore}
      remoteIdFor={remoteIdFor}
      onSelectOverride={onSelectOverride}
      onSubmit={() => triggerShowInGraph()}
      hintOverride={hintOverride}
      footerContent={
        <Show when={statusHint()}>
          <PerRemoteStatusRow
            remotes={onlineRemotes()}
            statuses={statuses()}
            summary={statusHint()!}
          />
        </Show>
      }
    />
  );
}

function PerRemoteStatusRow(props: {
  remotes: Remote[];
  statuses: Map<string, RemoteStatus>;
  summary: string;
}) {
  return (
    <div class="px-3 py-1 text-[10px] text-[var(--color-text-muted)] flex items-center gap-2 flex-wrap">
      <span>{props.summary}</span>
      <For each={props.remotes}>
        {(r) => {
          // status() is a reactive accessor so the dot re-renders when the
          // Map snapshot changes (the For row callback only runs once per item).
          const status = () => props.statuses.get(r.remote_id) ?? "idle";
          const dotClass = () => {
            const st = status();
            return st === "loading"
              ? "bg-yellow-400 animate-pulse"
              : st === "loaded"
                ? "bg-green-500"
                : st === "error"
                  ? "bg-red-500"
                  : "bg-[var(--color-border-default)]";
          };
          return (
            <span
              class="inline-flex items-center gap-1"
              title={`${r.name ?? r.remote_id}: ${status()}`}
            >
              <span class={`inline-block w-1.5 h-1.5 rounded-full ${dotClass()}`} />
              <span class="opacity-70">{r.name ?? r.remote_id}</span>
            </span>
          );
        }}
      </For>
    </div>
  );
}

function parseMetadataImages(
  metadata: any,
  baseUrl: string,
  remoteId?: string
): ImageMetadata[] | undefined {
  if (!metadata?.images) return undefined;
  try {
    const raw = typeof metadata.images === "string" ? JSON.parse(metadata.images) : metadata.images;
    if (!Array.isArray(raw) || raw.length === 0) return undefined;
    return raw.map((img: any) => ({
      remote_blob_id: img.media_blob_id,
      remote_url: getRemoteMediaUrl(baseUrl, img.media_blob_id),
      remote_server_id: remoteId,
      is_primary: !!img.is_primary,
      blob_type: "thumbnail" as const,
    }));
  } catch {
    return undefined;
  }
}
