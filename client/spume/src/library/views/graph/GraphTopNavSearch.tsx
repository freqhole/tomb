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

type RemoteStatus = "idle" | "loading" | "loaded" | "error";

export interface GraphTopNavSearchProps {
  remotes: () => Remote[];
  onNavigate?: (path: string) => void;
  currentPath?: string;
  navHovered?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

interface AggSuggestion {
  key: string;
  primary: APISuggestion;
  contributingRemoteIds: string[];
  primaryRemoteId: string;
}

const DEBOUNCE_MS = 150;
const PAGE_SIZE = 8;

export function GraphTopNavSearch(props: GraphTopNavSearchProps) {
  const [query, setQuery] = createSignal("");
  const [statuses, setStatuses] = createSignal<Map<string, RemoteStatus>>(new Map());
  const [resultsByRemote, setResultsByRemote] = createSignal<Map<string, APISuggestion[]>>(
    new Map()
  );
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  // generation counter so stale responses can't overwrite newer state.
  let gen = 0;

  const onlineRemotes = createMemo(() => props.remotes().filter((r) => r.is_offline !== true));

  // fan-out fetcher: kicks off one searchSuggestions per online remote, marks
  // each as loading/loaded/error independently and renders partial state.
  const runSearch = (q: string) => {
    gen++;
    const myGen = gen;
    const remotes = onlineRemotes();

    if (q.length < 2) {
      setStatuses(new Map());
      setResultsByRemote(new Map());
      return;
    }

    const initial = new Map<string, RemoteStatus>();
    for (const r of remotes) initial.set(r.remote_id, "loading");
    setStatuses(initial);
    setResultsByRemote(new Map());

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
          setResultsByRemote((prev) => {
            const next = new Map(prev);
            next.set(r.remote_id, res.suggestions ?? []);
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
    return aggregatedSuggestions().map((agg) => {
      const primaryRemote = remoteById.get(agg.primaryRemoteId);
      const baseUrl = primaryRemote?.base_url || "";
      const remoteCount = agg.contributingRemoteIds.length;
      const categoryLabel =
        remoteCount > 1
          ? `${agg.primary.suggestion_type} · ${remoteCount} remotes`
          : agg.primary.suggestion_type || "unknown";
      return {
        id: `${agg.primaryRemoteId}::${agg.primary.entity_id}`,
        text: agg.primary.display,
        category: categoryLabel,
        highlight: agg.primary.highlight,
        images: parseMetadataImages(agg.primary.metadata, baseUrl, agg.primaryRemoteId),
        isFavorite: agg.primary.is_favorite,
        data: agg.primary,
      };
    });
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

  return (
    <div class="flex flex-col">
      <TopNavSearch
        placeholder="search across remotes..."
        onNavigate={props.onNavigate}
        currentPath={props.currentPath}
        navHovered={props.navHovered}
        onExpandedChange={props.onExpandedChange}
        suggestions={inputSuggestions()}
        onSearchChange={setQuery}
        isLoadingSuggestions={[...statuses().values()].some((v) => v === "loading")}
      />
      <Show when={statusHint()}>
        <PerRemoteStatusRow
          remotes={onlineRemotes()}
          statuses={statuses()}
          summary={statusHint()!}
        />
      </Show>
    </div>
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
          const st = props.statuses.get(r.remote_id) ?? "idle";
          const dotClass =
            st === "loading"
              ? "bg-yellow-400 animate-pulse"
              : st === "loaded"
                ? "bg-green-500"
                : st === "error"
                  ? "bg-red-500"
                  : "bg-[var(--color-border-default)]";
          return (
            <span class="inline-flex items-center gap-1" title={`${r.name ?? r.remote_id}: ${st}`}>
              <span class={`inline-block w-1.5 h-1.5 rounded-full ${dotClass}`} />
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
