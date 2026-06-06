// graph topnav search — fans out search-suggestions across every online
// remote and merges them into a single flyout. dupes (same display name,
// case-insensitive) within song/artist/album/playlist categories are
// collapsed into one row tracking which remotes contributed it.
//
// per-remote loading status is rendered as a small row of colored pills
// in the input's hint slot so the user can see which peers are still
// answering.
//
// row click / enter-on-highlighted-row hands the picked suggestion +
// its primary remote off to `onPivotToSuggestion`. the parent maps it
// to a library node id and repivots the existing library walker —
// there is no separate search subgraph.

import { createMemo, createSignal, createEffect, on, For, Show } from "solid-js";
import type { Remote } from "../../../app/services/storage/schemas/remote";
import { RemoteMusicDataSource } from "../../../music/data/remote/remoteSource";
import { localDataSource } from "../../../music/data/local/localSource";
import type { MusicDataSource } from "../../../music/data/types";
import { TopNavSearch } from "../../../components/navigation/TopNavSearch";
import type { SearchSuggestion as InputSuggestion } from "../../../components/forms/SearchInput";
import type { SearchSuggestion as APISuggestion } from "../../../music/data/types";
import type { ImageMetadata } from "../../../music/services/storage/types";
import { getRemoteMediaUrl } from "../../../utils/urls";
import { slug } from "../../../components/graph/data/nodeIds";
import { routes } from "../../../music/utils/routing";
import { pickRemote } from "../../../app/services/remotePickerState";
import { wakeAllRemotes } from "../../../app/services/remotes/remoteHealth";
import { getLocalLibraryName } from "../../../app/services/storage/db";

// sentinel id for the local indexeddb library. matches `buildRouteFor`'s
// convention in `music/utils/routing.ts`, so `routes.albumOn(LOCAL_REMOTE_ID, ...)`
// produces `/local/albums/...` correctly.
export const LOCAL_REMOTE_ID = "local";

type RemoteStatus = "idle" | "loading" | "loaded" | "error";

export interface GraphTopNavSearchProps {
  remotes: () => Remote[];
  onNavigate?: (path: string) => void;
  currentPath?: string;
  navHovered?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** picked-suggestion sink. row click or Enter-on-highlighted-row
   *  hands the parent the chosen suggestion, the remote it should be
   *  looked up on, and the full current aggregated suggestion list
   *  (each entry paired with its primary remote) so the parent can
   *  pin every hit on the graph in addition to pivoting to the pick.
   *  returning true tells the underlying input to suppress its
   *  default route-nav (we always handle the pivot ourselves). */
  onPivotToSuggestion?: (
    s: APISuggestion,
    primaryRemoteId: string,
    all: Array<{ s: APISuggestion; remoteId: string }>
  ) => boolean | Promise<boolean>;
  /** fires when the query input transitions from non-empty to empty
   *  (user cleared it via backspace, escape-clear, or collapse). lets
   *  the parent reset graph state (drop pins, repivot to root, etc.). */
  onSearchCleared?: () => void;
}

interface AggSuggestion {
  key: string;
  primary: APISuggestion;
  contributingRemoteIds: string[];
  primaryRemoteId: string;
  /** per-remote suggestion data keyed by remote id. each remote may
   *  store the same logical item under a different entity_id, so this
   *  lets the picker pick the right id for navigation. */
  contributors: Map<string, APISuggestion>;
}

// uniform handle for everything we fan a search out to: real remotes
// plus the synthetic local indexeddb library. `id` doubles as the key
// in result/status/page-state maps and as the remote-id stamped onto
// suggestion ids (so `routes.albumOn(id, ...)` resolves correctly for
// both real remotes and the local sentinel).
interface SearchTarget {
  id: string;
  label: string;
  ds: MusicDataSource;
}

const DEBOUNCE_MS = 150;
const PAGE_SIZE = 16;

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

  // fire onSearchCleared when query goes from non-empty to empty.
  // skips the initial "" so we don't trigger a reset on mount.
  let lastQueryNonEmpty = false;
  createEffect(() => {
    const q = query();
    if (q.length > 0) {
      lastQueryNonEmpty = true;
    } else if (lastQueryNonEmpty) {
      lastQueryNonEmpty = false;
      props.onSearchCleared?.();
    }
  });
  const [statuses, setStatuses] = createSignal<Map<string, RemoteStatus>>(new Map());
  const [resultsByRemote, setResultsByRemote] = createSignal<Map<string, APISuggestion[]>>(
    new Map()
  );
  const [pageState, setPageState] = createSignal<Map<string, RemotePageState>>(new Map());
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  // generation counter so stale responses can't overwrite newer state.
  let gen = 0;

  // per-remote search timeout. dead/stuck remotes shouldn't hold up the
  // ui indefinitely, but warming-up peers need enough budget to respond
  // on first hit. 8s is the rough p2p cold-handshake worst case before
  // we mark "error" and move on.
  const SEARCH_TIMEOUT_MS = 8_000;

  // race a promise against a timeout. if the timeout wins, the original
  // promise is abandoned (its result is ignored). used to bound per-
  // remote search latency so a single slow peer can't stall the ui.
  function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("search timed out")), ms);
      p.then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          reject(e);
        }
      );
    });
  }

  // search targets: the local indexeddb library is always included
  // first, followed by every entry in `props.remotes()` regardless of
  // its last-known `is_offline` flag. truly dead peers are bounded by
  // the per-request timeout below; a warming-up peer gets a real
  // chance to answer the first query instead of being pre-filtered out.
  const searchTargets = createMemo<SearchTarget[]>(() => {
    const out: SearchTarget[] = [
      { id: LOCAL_REMOTE_ID, label: getLocalLibraryName(), ds: localDataSource },
    ];
    for (const r of props.remotes()) {
      // defense in depth: skip any remote that happens to share the local
      // sentinel id (shouldn't happen in practice but would shadow local).
      if (r.remote_id === LOCAL_REMOTE_ID) continue;
      out.push({ id: r.remote_id, label: r.name ?? r.remote_id, ds: new RemoteMusicDataSource(r) });
    }
    return out;
  });

  // fan-out fetcher: kicks off one searchSuggestions per remote, marks
  // each as loading/loaded/error independently and renders partial state.
  const runSearch = (q: string) => {
    gen++;
    const myGen = gen;
    const targets = searchTargets();

    if (q.length < 2) {
      setStatuses(new Map());
      setResultsByRemote(new Map());
      setPageState(new Map());
      return;
    }

    // opportunistic wake-up: any remote currently flagged offline gets a
    // forced probe so its is_offline flag clears as soon as it answers.
    // does not block this search — we already include offline remotes in
    // the fan-out and let the per-request timeout bound stuck peers.
    wakeAllRemotes({ force: true });

    const initial = new Map<string, RemoteStatus>();
    for (const t of targets) initial.set(t.id, "loading");
    setStatuses(initial);
    setResultsByRemote(new Map());
    setPageState(new Map());

    for (const t of targets) {
      const ds = t.ds;
      void (async () => {
        try {
          if (!ds.searchSuggestions) {
            if (gen !== myGen) return;
            setStatuses((prev) => {
              const next = new Map(prev);
              next.set(t.id, "idle");
              return next;
            });
            return;
          }
          const res = await withTimeout(
            ds.searchSuggestions({
              field: "all",
              partial: q,
              page: 1,
              page_size: PAGE_SIZE,
            }),
            SEARCH_TIMEOUT_MS
          );
          if (gen !== myGen) return;
          const suggestions = res.suggestions ?? [];
          setResultsByRemote((prev) => {
            const next = new Map(prev);
            next.set(t.id, suggestions);
            return next;
          });
          setPageState((prev) => {
            const next = new Map(prev);
            next.set(t.id, {
              loadedPage: 1,
              hasMore: !!res.has_next,
              loadingMore: false,
            });
            return next;
          });
          setStatuses((prev) => {
            const next = new Map(prev);
            next.set(t.id, "loaded");
            return next;
          });
        } catch (e) {
          if (gen !== myGen) return;
          console.debug(`[graph-search] ${t.id} failed:`, e);
          setStatuses((prev) => {
            const next = new Map(prev);
            next.set(t.id, "error");
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
    const targets = searchTargets();
    const pages = pageState();

    const candidates = targets.filter((t) => {
      const ps = pages.get(t.id);
      return ps && ps.hasMore && !ps.loadingMore;
    });
    if (candidates.length === 0) return;

    // mark all candidates as loading-more in one snapshot.
    setPageState((prev) => {
      const next = new Map(prev);
      for (const t of candidates) {
        const ps = next.get(t.id);
        if (ps) next.set(t.id, { ...ps, loadingMore: true });
      }
      return next;
    });

    for (const t of candidates) {
      const ds = t.ds;
      const ps = pages.get(t.id)!;
      const nextPage = ps.loadedPage + 1;
      void (async () => {
        try {
          if (!ds.searchSuggestions) return;
          const res = await withTimeout(
            ds.searchSuggestions({
              field: "all",
              partial: q,
              page: nextPage,
              page_size: PAGE_SIZE,
            }),
            SEARCH_TIMEOUT_MS
          );
          if (gen !== myGen) return;
          const suggestions = res.suggestions ?? [];
          setResultsByRemote((prev) => {
            const next = new Map(prev);
            const existing = next.get(t.id) ?? [];
            next.set(t.id, existing.concat(suggestions));
            return next;
          });
          setPageState((prev) => {
            const next = new Map(prev);
            next.set(t.id, {
              loadedPage: nextPage,
              hasMore: !!res.has_next,
              loadingMore: false,
            });
            return next;
          });
        } catch (e) {
          if (gen !== myGen) return;
          console.debug(`[graph-search] ${t.id} loadMore failed:`, e);
          // clear loadingMore so the user can retry by scrolling again,
          // but stop further attempts on this remote until the query
          // changes (avoids tight error loops).
          setPageState((prev) => {
            const next = new Map(prev);
            const cur = next.get(t.id);
            if (cur) next.set(t.id, { ...cur, hasMore: false, loadingMore: false });
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
    for (const t of searchTargets()) {
      const list = resultsByRemote().get(t.id) ?? [];
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
          ? `${s.suggestion_type}::${t.id}::${slug(s.display)}`
          : `${s.suggestion_type}::${slug(s.display)}`;
        const existing = byKey.get(key);
        if (existing) {
          if (!existing.contributingRemoteIds.includes(t.id)) {
            existing.contributingRemoteIds.push(t.id);
          }
          if (!existing.contributors.has(t.id)) {
            existing.contributors.set(t.id, s);
          }
        } else {
          const agg: AggSuggestion = {
            key,
            primary: s,
            primaryRemoteId: t.id,
            contributingRemoteIds: [t.id],
            contributors: new Map([[t.id, s]]),
          };
          byKey.set(key, agg);
          ordered.push(agg);
        }
      }
    }
    // cross-remote rank merge. each remote's page is already ordered
    // by its own fts rank (mapped into `confidence`), but appending
    // them per-remote leaves the list grouped by remote. sort the
    // dedup'd aggregate by confidence desc so the top hits across all
    // remotes float up regardless of arrival order. this memo re-runs
    // whenever any remote's results arrive, so the list reorders as
    // partial results stream in.
    //
    // caveat: `confidence` is computed per-remote from local fts
    // rank, so cross-remote comparisons are only loosely meaningful.
    // a follow-up could normalize per remote (e.g. divide by that
    // remote's top row) or fold in `count`; for now naive desc-sort
    // is a clear improvement over per-remote grouping.
    ordered.sort((a, b) => (b.primary.confidence ?? 0) - (a.primary.confidence ?? 0));
    return ordered;
  });

  // map to SearchInputSuggestion (the shape TopNavSearch expects).
  const inputSuggestions = createMemo<InputSuggestion[]>(() => {
    const targetById = new Map(searchTargets().map((t) => [t.id, t]));
    const remoteById = new Map(props.remotes().map((r) => [r.remote_id, r]));
    const nameFor = (id: string) => targetById.get(id)?.label ?? id;
    return aggregatedSuggestions().map((agg) => {
      // for the local sentinel, there's no base_url — leave it empty so
      // image helpers fall back to local blob resolution paths.
      const primaryRemote = remoteById.get(agg.primaryRemoteId);
      const baseUrl = primaryRemote?.base_url || "";
      const remoteCount = agg.contributingRemoteIds.length;
      const names = agg.contributingRemoteIds.map(nameFor);
      const detailLabel = remoteCount > 1 ? `${remoteCount} libraries` : names[0];
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

  // side-table from suggestion id -> per-remote suggestion data,
  // used by remoteIdFor to detect multi-remote results that need
  // disambiguation AND to navigate using the picked remote's own
  // entity_id (which can differ from the primary remote's id).
  const contributorsById = createMemo(() => {
    const out = new Map<string, Map<string, APISuggestion>>();
    for (const agg of aggregatedSuggestions()) {
      out.set(`${agg.primaryRemoteId}::${agg.primary.entity_id}`, agg.contributors);
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
    if (loading > 0) return `searching ${loaded}/${total} libraries...${errBit}`;
    return `searched ${loaded}/${total} libraries${errBit}`;
  });

  // suggestion.id is `${primaryRemoteId}::${entity_id}` (see inputSuggestions).
  // when an aggregated suggestion came from multiple remotes, prompt the
  // user to pick one via the global remote-picker modal. returning null
  // aborts navigation (user cancelled). the local sentinel is not
  // selectable via the picker (it's a synthetic target), so if local is
  // the only contributor we return it directly; if local is one of
  // several contributors we let the user pick among real remotes only,
  // and fall back to local if they cancel without options.
  const remoteIdFor = async (
    s: InputSuggestion
  ): Promise<string | { remoteId: string; data?: APISuggestion } | null | undefined> => {
    const id = s.id ?? "";
    const contributors = contributorsById().get(id);
    const contributorIds = contributors ? Array.from(contributors.keys()) : [];
    if (contributorIds.length === 0) {
      return id.split("::")[0] || undefined;
    }
    if (contributorIds.length === 1) {
      const only = contributorIds[0];
      return { remoteId: only, data: contributors!.get(only) };
    }
    const remoteById = new Map(props.remotes().map((r) => [r.remote_id, r]));
    const options = contributorIds
      .filter((rid) => rid !== LOCAL_REMOTE_ID)
      .map((rid) => remoteById.get(rid))
      .filter((r): r is Remote => !!r);
    if (options.length === 0) {
      // local-only contributor (or every real remote is missing) —
      // route to local without prompting.
      if (contributorIds.includes(LOCAL_REMOTE_ID)) {
        return { remoteId: LOCAL_REMOTE_ID, data: contributors!.get(LOCAL_REMOTE_ID) };
      }
      return undefined;
    }
    const picked = await pickRemote(options, {
      title: "open on which remote?",
      message: `"${s.text}" was found on ${options.length} remote${options.length === 1 ? "" : "s"}.`,
    });
    if (!picked) return null;
    return { remoteId: picked.remote_id, data: contributors!.get(picked.remote_id) };
  };

  // ---- pivot handoff ----------------------------------------------------

  const hasAnyResults = createMemo(() => {
    for (const list of resultsByRemote().values()) {
      if (list.length > 0) return true;
    }
    return false;
  });

  /** highest-confidence suggestion across every remote, paired with
   *  the remote it lives on. used by Enter-with-no-highlight to do
   *  something useful instead of nothing. */
  const topSuggestion = (): { s: APISuggestion; remoteId: string } | null => {
    let best: { s: APISuggestion; remoteId: string } | null = null;
    for (const t of searchTargets()) {
      const list = resultsByRemote().get(t.id);
      if (!list) continue;
      for (const s of list) {
        if (!best || s.confidence > best.s.confidence) {
          best = { s, remoteId: t.id };
        }
      }
    }
    return best;
  };

  /** row click or Enter on a highlighted row. taxons (genre/tag/mood/
   *  style/era/label) are intercepted and handed to the parent for a
   *  solo graph pivot. everything else (artist/album/song/playlist)
   *  falls through to the base topnav's default route navigation so
   *  it lands on the entity's detail view, same as elsewhere in the
   *  app. */
  const onSelectOverride = async (s: InputSuggestion): Promise<boolean> => {
    const data = s.data as APISuggestion | undefined;
    if (!data) return false;
    // FEDERATION-COMPAT-LEGACY-GENRE-TYPE: accept legacy "genre" wire
    // value from peers that haven't upgraded past the rename.
    if (data.suggestion_type !== "taxon" && data.suggestion_type !== "genre") return false;
    const primary = (s.id ?? "").split("::")[0];
    if (!primary) return false;
    return Boolean(await props.onPivotToSuggestion?.(data, primary, []));
  };

  /** build the detail-view route for a non-taxon suggestion. mirrors
   *  the switch in base TopNavSearch.handleSelect so Enter-on-no-
   *  highlight on the graph view routes non-taxon top hits to the
   *  same place a click would. */
  const detailRouteFor = (s: APISuggestion, remoteId: string): string | null => {
    const meta = (s.metadata ?? {}) as { album_id?: string };
    switch (s.suggestion_type) {
      case "song":
        return meta.album_id ? routes.albumOn(remoteId, meta.album_id) : null;
      case "artist":
        return routes.artistOn(remoteId, s.entity_id);
      case "album":
        return routes.albumOn(remoteId, s.entity_id);
      case "playlist":
        return routes.playlistOn(remoteId, s.entity_id);
      default:
        return null;
    }
  };

  /** Enter with no highlighted row. pivots the graph to the top hit
   *  if it's a taxon; otherwise navigates to that hit's detail view. */
  const onSubmit = (): boolean => {
    if (query().length < 2) return false;
    const top = topSuggestion();
    if (!top) return false;
    // FEDERATION-COMPAT-LEGACY-GENRE-TYPE: legacy "genre" also pivots.
    if (top.s.suggestion_type === "taxon" || top.s.suggestion_type === "genre") {
      void props.onPivotToSuggestion?.(top.s, top.remoteId, []);
      return true;
    }
    const route = detailRouteFor(top.s, top.remoteId);
    if (!route) return false;
    props.onNavigate?.(route);
    return true;
  };

  // hint shown between the input and the suggestions flyout: gentle
  // nudge that Enter / click will jump the walker to a suggestion.
  const hintOverride = () => {
    if (query().length < 2) return null;
    if (!hasAnyResults()) return null;
    return {
      message: "press return (or click a row) to pivot the graph →",
      onClick: () => {
        onSubmit();
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
      onSubmit={onSubmit}
      hintOverride={hintOverride}
      footerContent={
        <Show when={statusHint()}>
          <PerRemoteStatusRow
            targets={searchTargets()}
            statuses={statuses()}
            summary={statusHint()!}
          />
        </Show>
      }
    />
  );
}

function PerRemoteStatusRow(props: {
  targets: SearchTarget[];
  statuses: Map<string, RemoteStatus>;
  summary: string;
}) {
  return (
    <div class="px-3 py-1 text-[10px] text-[var(--color-text-muted)] flex items-center gap-2 flex-wrap">
      <span>{props.summary}</span>
      <For each={props.targets}>
        {(t) => {
          // status() is a reactive accessor so the dot re-renders when the
          // Map snapshot changes (the For row callback only runs once per item).
          const status = () => props.statuses.get(t.id) ?? "idle";
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
            <span class="inline-flex items-center gap-1" title={`${t.label}: ${status()}`}>
              <span class={`inline-block w-1.5 h-1.5 rounded-full ${dotClass()}`} />
              <span class="opacity-70">{t.label}</span>
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
