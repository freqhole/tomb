// AlbumsTable v0 — read-only data table for browsing albums
// across a single remote.
//
// scope (phase 3):
//   - controls section above the table (search, status filter chips, sort)
//   - infinite scroll via `useLibraryAlbumsQuery`
//   - hardcoded columns: cover, title, artist, release_date, song_count,
//     genres, mb_lookup_status, mb_lookup_at, actions placeholder
//   - row carries `remote_id`; admin gating arrives in phase 4
//
// future phases add: selection, bulk-action bar, inline editing, mb lookup.

import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { Icon } from "../../components/icons/registry";
import { LoadingState, LoadingMoreIndicator } from "../../components/feedback";
import MediaImage from "../../components/media/MediaImage";
import {
  MB_LOOKUP_STATUSES,
  mbLookupStatusLabel,
  parseMbLookupStatus,
  type MbLookupStatus,
} from "../data/albumMetadata";
import { useLibraryAlbumsQuery } from "../queries/useLibraryAlbums";
import { handleAlbumClick, isAlbumSelected, updateAlbumIdList } from "../hooks/albumSelection";
import { useInflightJobs } from "../hooks/useMbLookupJobs";
import type { AlbumSummary } from "../../music/data/types";

type SortField = "title" | "artist" | "year" | "song_count" | "added_at";

interface AlbumsTableProps {
  remote: Remote;
  /** invoked when the user clicks the header "lookup mb for all matching"
   *  control. receives the album ids currently visible (post-filter). */
  onMbLookupAllMatching?: (albumIds: string[]) => void;
}

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: "added_at", label: "added" },
  { value: "title", label: "title" },
  { value: "artist", label: "artist" },
  { value: "year", label: "year" },
  { value: "song_count", label: "song count" },
];

export function AlbumsTable(props: AlbumsTableProps) {
  const [searchInput, setSearchInput] = createSignal("");
  const [debouncedSearch, setDebouncedSearch] = createSignal<string | undefined>(undefined);
  const [statusFilters, setStatusFilters] = createSignal<Set<MbLookupStatus>>(new Set());
  const [sortField, setSortField] = createSignal<SortField>("added_at");
  const [sortDirection, setSortDirection] = createSignal<"asc" | "desc">("desc");

  // simple debounce on the search input
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  const onSearchInput = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      setDebouncedSearch(value.trim() || undefined);
    }, 250);
  };

  const remoteAccessor = () => props.remote;
  const sortByAccessor = () => sortField() as string;

  const albumsQuery = useLibraryAlbumsQuery({
    remote: remoteAccessor,
    search: debouncedSearch,
    sortBy: sortByAccessor,
    sortDirection: sortDirection,
  });

  const allItems = createMemo<AlbumSummary[]>(() => {
    const pages = albumsQuery.data?.pages ?? [];
    return pages.flatMap((p) => p.items);
  });

  // status filtering happens client-side over loaded rows. coarse but fine
  // for v0 — server-side filter follows later when the schema settles.
  const filteredItems = createMemo<AlbumSummary[]>(() => {
    const active = statusFilters();
    if (active.size === 0) return allItems();
    return allItems().filter((a) => active.has(parseMbLookupStatus(a.mb_lookup_status)));
  });

  // keep the selection range list aligned with the visible rows.
  createEffect(() => {
    updateAlbumIdList(filteredItems().map((a) => a.album_id));
  });

  const totalCount = () => albumsQuery.data?.pages?.[0]?.total ?? 0;
  const loadedCount = () => allItems().length;

  const toggleStatus = (status: MbLookupStatus) => {
    setStatusFilters((prev) => {
      const next = new Set<MbLookupStatus>(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const clearStatusFilters = () => setStatusFilters(new Set<MbLookupStatus>());

  const toggleSortDirection = () => setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));

  // load-more sentinel: trigger when scrolled near bottom.
  let scrollEl: HTMLDivElement | undefined;
  const onScroll = () => {
    if (!scrollEl) return;
    if (!albumsQuery.hasNextPage || albumsQuery.isFetchingNextPage) return;
    const remaining = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
    if (remaining < 400) {
      albumsQuery.fetchNextPage();
    }
  };

  return (
    <div class="flex flex-col h-full min-h-0">
      {/* controls */}
      <div class="flex flex-col gap-2 px-4 py-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]">
        <div class="flex items-center gap-3 flex-wrap">
          {/* search */}
          <div class="flex items-center gap-2 bg-[var(--color-bg-elevated)] rounded px-2 py-1 min-w-[200px] flex-1 max-w-md">
            <Icon name="search" size={12} />
            <input
              type="text"
              placeholder="search title, artist..."
              value={searchInput()}
              onInput={(e) => onSearchInput(e.currentTarget.value)}
              class="bg-transparent border-none outline-none text-sm text-[var(--color-text-primary)] flex-1 placeholder:text-[var(--color-text-muted)]"
            />
            <Show when={searchInput().length > 0}>
              <button
                type="button"
                class="bg-transparent border-none cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] p-0"
                onClick={() => onSearchInput("")}
                aria-label="clear search"
              >
                <Icon name="close" size={12} />
              </button>
            </Show>
          </div>

          {/* sort */}
          <div class="flex items-center gap-1 text-xs">
            <span class="text-[var(--color-text-muted)]">sort:</span>
            <select
              value={sortField()}
              onChange={(e) => setSortField(e.currentTarget.value as SortField)}
              class="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)]"
            >
              <For each={SORT_OPTIONS}>
                {(opt) => <option value={opt.value}>{opt.label}</option>}
              </For>
            </select>
            <button
              type="button"
              onClick={toggleSortDirection}
              title={`sort ${sortDirection() === "asc" ? "ascending" : "descending"}`}
              aria-label="toggle sort direction"
              class="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded px-2 py-1 cursor-pointer text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            >
              <Icon name={sortDirection() === "asc" ? "arrowUp" : "arrowDown"} size={10} />
            </button>
          </div>

          {/* count */}
          <div class="text-xs text-[var(--color-text-muted)] ml-auto">
            <Show when={loadedCount() > 0} fallback={<span>0 albums</span>}>
              {loadedCount()} of {totalCount() || loadedCount()} loaded
              <Show when={statusFilters().size > 0}> · {filteredItems().length} match filters</Show>
            </Show>
          </div>

          {/* lookup-all-matching control (header level; works without
           *  selection). */}
          <Show when={props.onMbLookupAllMatching && filteredItems().length > 0}>
            <button
              type="button"
              onClick={() => props.onMbLookupAllMatching?.(filteredItems().map((a) => a.album_id))}
              class="flex items-center gap-1 px-2 py-1 text-xs rounded border border-[var(--color-accent-500)]/40 text-[var(--color-accent-500)] hover:bg-[var(--color-accent-500)]/10 cursor-pointer bg-transparent"
              title="enqueue a musicbrainz lookup for every matching album"
            >
              <Icon name="search" size={10} />
              lookup all matching
            </button>
          </Show>
        </div>

        {/* status filter chips */}
        <div class="flex items-center gap-1 flex-wrap text-xs">
          <span class="text-[var(--color-text-muted)] mr-1">mb status:</span>
          <For each={MB_LOOKUP_STATUSES}>
            {(status) => (
              <button
                type="button"
                onClick={() => toggleStatus(status)}
                class="px-2 py-0.5 rounded-full border transition-colors cursor-pointer"
                classList={{
                  "bg-[var(--color-accent-500)]/15 text-[var(--color-accent-500)] border-[var(--color-accent-500)]/40":
                    statusFilters().has(status),
                  "bg-transparent text-[var(--color-text-muted)] border-[var(--color-border-subtle)] hover:text-[var(--color-text-primary)]":
                    !statusFilters().has(status),
                }}
              >
                {mbLookupStatusLabel(status)}
              </button>
            )}
          </For>
          <Show when={statusFilters().size > 0}>
            <button
              type="button"
              onClick={clearStatusFilters}
              class="px-2 py-0.5 rounded-full border border-transparent cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            >
              clear
            </button>
          </Show>
        </div>
      </div>

      {/* table */}
      <div ref={scrollEl} onScroll={onScroll} class="flex-1 overflow-auto min-h-0">
        <Show when={!albumsQuery.isLoading} fallback={<LoadingState text="loading albums..." />}>
          <Show
            when={filteredItems().length > 0}
            fallback={
              <div class="flex items-center justify-center h-32 text-sm text-[var(--color-text-disabled)]">
                no albums match
              </div>
            }
          >
            <table class="w-full text-xs border-collapse">
              <thead class="sticky top-0 bg-[var(--color-bg-base)] z-10">
                <tr class="text-left text-[var(--color-text-muted)] border-b border-[var(--color-border-subtle)]">
                  <th class="px-2 py-2 w-10"></th>
                  <th class="px-2 py-2 font-medium">title</th>
                  <th class="px-2 py-2 font-medium">artist</th>
                  <th class="px-2 py-2 font-medium w-20">released</th>
                  <th class="px-2 py-2 font-medium w-12 text-right">songs</th>
                  <th class="px-2 py-2 font-medium">genres</th>
                  <th class="px-2 py-2 font-medium w-32">mb status</th>
                  <th class="px-2 py-2 font-medium w-24">last lookup</th>
                  <th class="px-2 py-2 font-medium w-16">actions</th>
                </tr>
              </thead>
              <tbody>
                <For each={filteredItems()}>
                  {(album, index) => (
                    <AlbumRow album={album} remote={props.remote} index={index()} />
                  )}
                </For>
              </tbody>
            </table>
            <Show when={albumsQuery.isFetchingNextPage}>
              <LoadingMoreIndicator isLoading={true} />
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
}

function AlbumRow(props: { album: AlbumSummary; remote: Remote; index: number }) {
  const status = () => parseMbLookupStatus(props.album.mb_lookup_status);
  const lastLookup = () => {
    const ts = props.album.mb_lookup_at;
    if (!ts) return null;
    const d = new Date(ts * 1000);
    return d.toISOString().slice(0, 10);
  };
  const genreList = () => (props.album.genres ?? []).map((g) => g.name).join(", ");
  const selected = () => isAlbumSelected(props.album.album_id);
  const inflight = useInflightJobs();

  return (
    <tr
      class="border-b border-[var(--color-border-subtle)] cursor-pointer"
      classList={{
        "bg-[var(--color-accent-500)]/10": selected(),
        "hover:bg-[var(--color-bg-hover)]": !selected(),
      }}
      onClick={(e) => handleAlbumClick(props.album.album_id, props.index, e)}
      data-album-id={props.album.album_id}
      data-remote-id={props.remote.remote_id}
    >
      <td class="px-2 py-1">
        <div class="w-8 h-8 rounded overflow-hidden bg-[var(--color-bg-elevated)]">
          <MediaImage
            images={props.album.images}
            alt={props.album.title}
            size="xs"
            domainType="album"
          />
        </div>
      </td>
      <td class="px-2 py-1 text-[var(--color-text-primary)] max-w-[260px] truncate">
        {props.album.title}
      </td>
      <td class="px-2 py-1 text-[var(--color-text-secondary)] max-w-[200px] truncate">
        {props.album.artist_name}
      </td>
      <td class="px-2 py-1 text-[var(--color-text-muted)]">{props.album.release_date ?? ""}</td>
      <td class="px-2 py-1 text-[var(--color-text-muted)] text-right">{props.album.song_count}</td>
      <td class="px-2 py-1 text-[var(--color-text-muted)] max-w-[200px] truncate">{genreList()}</td>
      <td class="px-2 py-1">
        <Show
          when={inflight().has(props.album.album_id)}
          fallback={
            <span
              class="inline-block px-1.5 py-0.5 rounded text-[10px]"
              classList={{
                "bg-emerald-500/15 text-emerald-400":
                  status() === "Confirmed" || status() === "Enriched",
                "bg-amber-500/15 text-amber-400":
                  status() === "NeedsReview" || status() === "Candidates",
                "bg-blue-500/15 text-blue-400":
                  status() === "Queued" ||
                  status() === "Searching" ||
                  status() === "FetchingDetail",
                "bg-rose-500/15 text-rose-400":
                  status() === "Error" || status() === "NoMatch" || status() === "Rejected",
                "bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)]":
                  status() === "NotAttempted",
              }}
            >
              {mbLookupStatusLabel(status())}
            </span>
          }
        >
          <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-blue-500/15 text-blue-400">
            <span class="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            looking up…
          </span>
        </Show>
      </td>
      <td class="px-2 py-1 text-[var(--color-text-muted)]">{lastLookup() ?? "—"}</td>
      <td class="px-2 py-1 text-[var(--color-text-disabled)] text-[10px]">
        {/* admin actions land in phase 4+ */}—
      </td>
    </tr>
  );
}
