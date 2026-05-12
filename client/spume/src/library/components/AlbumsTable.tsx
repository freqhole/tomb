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
  parseAlbumMetadata,
  parseMbLookupStatus,
  topFolksonomyTags,
  type MbLookupStatus,
} from "../data/albumMetadata";
import { useLibraryAlbumsQuery } from "../queries/useLibraryAlbums";
import {
  handleAlbumClick,
  isAlbumSelected,
  updateAlbumIdList,
  updateAlbumReviewStatusMap,
} from "../hooks/albumSelection";
import { useInflightJobs, getInflightSourcesForAlbum } from "../hooks/useMbLookupJobs";
import { useRemoteIsAdmin } from "../hooks/useRemoteRole";
import { AlbumCandidatesPanel } from "./AlbumCandidatesPanel";
import { LastFmReviewModal } from "./LastFmReviewModal";
import { AudioDbReviewModal } from "./AudioDbReviewModal";
import { getClientForRemote } from "../../app/api/client";
import { queryClient } from "../../queryClient";
import type { AlbumSummary } from "../../music/data/types";

type SortField = "title" | "artist" | "year" | "song_count" | "added_at";

interface AlbumsTableProps {
  remote: Remote;
  /** invoked when the user clicks the header "lookup all matching"
   *  control. fans out to mb + last.fm + theaudiodb in parallel for the
   *  album ids currently visible (post-filter). */
  onEnrichAllMatching?: (albumIds: string[]) => void;
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

  // auto-confirm controls (admin bulk action)
  const [minConfidence, setMinConfidence] = createSignal(0.9);
  const [minGap, setMinGap] = createSignal(0.15);
  type AutoConfirmState =
    | { kind: "idle" }
    | { kind: "running" }
    | {
        kind: "done";
        confirmed: number;
        skipped: number;
        errors: number;
      }
    | { kind: "error"; message: string };
  const [autoConfirm, setAutoConfirm] = createSignal<AutoConfirmState>({ kind: "idle" });

  // last.fm review modal — hoisted to table scope so it survives row
  // re-mounts when the album list query is invalidated mid-job.
  const [lastfmAlbumId, setLastfmAlbumId] = createSignal<string | null>(null);
  const lastfmAlbum = createMemo(() =>
    lastfmAlbumId() ? (filteredItems().find((a) => a.album_id === lastfmAlbumId()) ?? null) : null
  );

  // theaudiodb review modal — same hoisting reasoning as lastfm above.
  const [audiodbAlbumId, setAudiodbAlbumId] = createSignal<string | null>(null);
  const audiodbAlbum = createMemo(() =>
    audiodbAlbumId() ? (filteredItems().find((a) => a.album_id === audiodbAlbumId()) ?? null) : null
  );

  // admin gating for the enqueue actions inside the lastfm/audiodb
  // review modals. non-admins can still open the modals to read stored
  // snapshots; the "fetch" button itself is what gets disabled.
  const isRemoteAdmin = useRemoteIsAdmin(() => props.remote);

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
    updateAlbumReviewStatusMap(filteredItems().map((a) => [a.album_id, a.review_status]));
  });

  const loadedCount = () => allItems().length;

  // phase 14.11: rough coverage indicator over the loaded rows.
  // "covered" = enriched OR confirmed; matches what the per-row status
  // badges would call "done". since query_albums doesn't return a server
  // count yet, this is loaded-rows-only — informative, not authoritative.
  const coveredCount = () =>
    allItems().filter((a) => {
      const s = parseMbLookupStatus(a.mb_lookup_status);
      return s === "enriched" || s === "confirmed";
    }).length;
  const coveragePct = () => {
    const n = loadedCount();
    if (n === 0) return 0;
    return Math.round((coveredCount() / n) * 100);
  };

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

  const runAutoConfirm = async () => {
    const ids = filteredItems().map((a) => a.album_id);
    if (ids.length === 0) return;
    setAutoConfirm({ kind: "running" });
    try {
      const client = await getClientForRemote(props.remote);
      const resp = await client.music.autoConfirmMbMatches({
        album_ids: ids,
        min_confidence: minConfidence(),
        min_gap: minGap(),
      });
      if (!resp.success) {
        setAutoConfirm({ kind: "error", message: resp.error.message });
        return;
      }
      const data = resp.data;
      void queryClient.invalidateQueries({
        queryKey: ["library-albums", props.remote.remote_id],
      });
      setAutoConfirm({
        kind: "done",
        confirmed: data.confirmed.length,
        skipped: data.skipped.length,
        errors: data.errors.length,
      });
    } catch (e) {
      setAutoConfirm({ kind: "error", message: (e as Error).message });
    }
  };

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

          {/* count. note: server's `total_count` is currently the page count
           *  (see grimoire/src/music/crud/query.rs query_albums) so we can't
           *  show "loaded of total" reliably yet — just show what's loaded.
           *  TODO: separate COUNT(*) on the server, then restore "of N". */}
          <div class="text-xs text-[var(--color-text-muted)] ml-auto">
            <Show when={loadedCount() > 0} fallback={<span>0 albums</span>}>
              {loadedCount()}
              <Show when={albumsQuery.hasNextPage}>+</Show>
              <Show when={statusFilters().size > 0}> · {filteredItems().length} match filters</Show>
              <span
                class="ml-1.5 text-[var(--color-text-tertiary)]"
                title={`${coveredCount()} of ${loadedCount()} loaded albums are confirmed or enriched`}
              >
                · {coveragePct()}% enriched
              </span>
            </Show>
          </div>

          {/* lookup-all-matching control (header level; works without
           *  selection). fans out to mb + last.fm + theaudiodb. */}
          <Show when={props.onEnrichAllMatching && filteredItems().length > 0}>
            <button
              type="button"
              onClick={() => props.onEnrichAllMatching?.(filteredItems().map((a) => a.album_id))}
              class="flex items-center gap-1 px-2 py-1 text-xs rounded border border-[var(--color-accent-500)]/40 text-[var(--color-accent-500)] hover:bg-[var(--color-accent-500)]/10 cursor-pointer bg-transparent"
              title="enqueue musicbrainz + last.fm + theaudiodb lookups for every matching album"
            >
              <Icon name="search" size={10} />
              lookup all matching
            </button>
          </Show>

          {/* auto-confirm bulk control. confirms top candidate where it
           *  clears confidence + gap thresholds. admin-only on the server
           *  side; non-admins see a 403 surfaced inline. */}
          <Show when={filteredItems().length > 0}>
            <div
              class="flex items-center gap-1 px-2 py-1 text-xs rounded border border-[var(--color-border-subtle)] bg-transparent"
              title="auto-confirm top candidate when it beats the thresholds"
            >
              <span class="text-[var(--color-text-muted)]">conf≥</span>
              <input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={minConfidence()}
                onInput={(e) => setMinConfidence(Number.parseFloat(e.currentTarget.value) || 0)}
                class="w-12 bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded px-1 py-0.5 text-xs text-[var(--color-text-primary)]"
              />
              <span class="text-[var(--color-text-muted)]">gap≥</span>
              <input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={minGap()}
                onInput={(e) => setMinGap(Number.parseFloat(e.currentTarget.value) || 0)}
                class="w-12 bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded px-1 py-0.5 text-xs text-[var(--color-text-primary)]"
              />
              <button
                type="button"
                onClick={runAutoConfirm}
                disabled={autoConfirm().kind === "running"}
                class="px-2 py-0.5 rounded border border-[var(--color-accent-500)]/40 text-[var(--color-accent-500)] hover:bg-[var(--color-accent-500)]/10 cursor-pointer bg-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Show when={autoConfirm().kind === "running"} fallback={<>auto-confirm</>}>
                  running...
                </Show>
              </button>
              <Show when={autoConfirm().kind === "done"}>
                {(() => {
                  const s = autoConfirm() as Extract<AutoConfirmState, { kind: "done" }>;
                  return (
                    <span class="text-[var(--color-text-muted)]">
                      ok {s.confirmed} · skip {s.skipped}
                      <Show when={s.errors > 0}> · err {s.errors}</Show>
                    </span>
                  );
                })()}
              </Show>
              <Show when={autoConfirm().kind === "error"}>
                {(() => {
                  const s = autoConfirm() as Extract<AutoConfirmState, { kind: "error" }>;
                  return (
                    <span class="text-[var(--color-error-500)]" title={s.message}>
                      error
                    </span>
                  );
                })()}
              </Show>
            </div>
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
              <thead class="sticky top-0 bg-black z-10">
                <tr class="text-left text-[var(--color-text-muted)] border-b border-[var(--color-border-subtle)]">
                  <th class="px-2 py-2 w-10"></th>
                  <th class="px-2 py-2 font-medium">title</th>
                  <th class="px-2 py-2 font-medium">artist</th>
                  <th class="px-2 py-2 font-medium w-20">released</th>
                  <th class="px-2 py-2 font-medium w-12 text-right">songs</th>
                  <th class="px-2 py-2 font-medium">genres</th>
                  <th class="px-2 py-2 font-medium">folksonomy</th>
                  <th class="px-2 py-2 font-medium w-40">enrichment</th>
                  <th class="px-2 py-2 font-medium w-24">last lookup</th>
                  <th class="px-2 py-2 font-medium w-28">actions</th>
                </tr>
              </thead>
              <tbody>
                <For each={filteredItems()}>
                  {(album, index) => (
                    <AlbumRow
                      album={album}
                      remote={props.remote}
                      index={index()}
                      onOpenLastFm={() => setLastfmAlbumId(album.album_id)}
                      onOpenAudioDb={() => setAudiodbAlbumId(album.album_id)}
                    />
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
      <Show when={lastfmAlbum()}>
        {(album) => (
          <LastFmReviewModal
            isOpen={true}
            onClose={() => setLastfmAlbumId(null)}
            album={album()}
            remote={props.remote}
            isAdmin={isRemoteAdmin()}
          />
        )}
      </Show>
      <Show when={audiodbAlbum()}>
        {(album) => (
          <AudioDbReviewModal
            isOpen={true}
            onClose={() => setAudiodbAlbumId(null)}
            album={album()}
            remote={props.remote}
            isAdmin={isRemoteAdmin()}
          />
        )}
      </Show>
    </div>
  );
}

function AlbumRow(props: {
  album: AlbumSummary;
  remote: Remote;
  index: number;
  onOpenLastFm: () => void;
  onOpenAudioDb: () => void;
}) {
  const status = () => parseMbLookupStatus(props.album.mb_lookup_status);
  const lastLookup = () => {
    const ts = props.album.mb_lookup_at;
    if (!ts) return null;
    const d = new Date(ts * 1000);
    return d.toISOString().slice(0, 10);
  };
  const genreList = () => (props.album.genres ?? []).map((g) => g.name).join(", ");
  const albumMeta = () => parseAlbumMetadata(props.album.metadata);
  const folksonomy = () => topFolksonomyTags(albumMeta(), 5);
  const selected = () => isAlbumSelected(props.album.album_id);
  const inflight = useInflightJobs();
  const inflightSources = () => {
    inflight(); // subscribe
    return getInflightSourcesForAlbum(props.album.album_id);
  };
  const lastfmState = (): SourceBadgeState => {
    if (inflightSources().has("lastfm")) return "inflight";
    const lf = albumMeta().lastfm;
    if (!lf) return "missing";
    if (lf.error) return "error";
    if (lf.fetched_at) return "ok";
    return "missing";
  };
  const audiodbState = (): SourceBadgeState => {
    if (inflightSources().has("audiodb")) return "inflight";
    const ad = albumMeta().audiodb;
    if (!ad) return "missing";
    if (ad.error) return "error";
    if (ad.fetched_at) return "ok";
    return "missing";
  };
  const [expanded, setExpanded] = createSignal(false);
  const reviewable = () =>
    status() === "candidates" || status() === "needs_review" || status() === "confirmed";

  return (
    <>
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
        <td class="px-2 py-1 text-[var(--color-text-muted)] text-right">
          {props.album.song_count}
        </td>
        <td class="px-2 py-1 text-[var(--color-text-muted)] max-w-[200px] truncate">
          {genreList()}
        </td>
        <td class="px-2 py-1 max-w-[220px]">
          <Show
            when={folksonomy().length > 0}
            fallback={<span class="text-[var(--color-text-disabled)]">—</span>}
          >
            <div class="flex flex-wrap gap-1">
              <For each={folksonomy()}>
                {(t) => (
                  <span
                    class="inline-block px-1.5 py-0.5 rounded text-[10px] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]"
                    title={`${t.name} (${t.count})`}
                  >
                    {t.name}
                  </span>
                )}
              </For>
            </div>
          </Show>
        </td>
        <td class="px-2 py-1">
          <div class="flex flex-wrap items-center gap-1">
            {/* musicbrainz status — primary, uses the rich mb_lookup_status enum */}
            <Show
              when={inflightSources().has("mb")}
              fallback={
                <span
                  class="inline-block px-1.5 py-0.5 rounded text-[10px]"
                  title={`musicbrainz: ${mbLookupStatusLabel(status())}`}
                  classList={{
                    "bg-emerald-500/15 text-emerald-400":
                      status() === "confirmed" || status() === "enriched",
                    "bg-amber-500/15 text-amber-400":
                      status() === "needs_review" || status() === "candidates",
                    "bg-blue-500/15 text-blue-400":
                      status() === "queued" ||
                      status() === "searching" ||
                      status() === "fetching_detail",
                    "bg-rose-500/15 text-rose-400":
                      status() === "error" || status() === "no_match" || status() === "rejected",
                    "bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)]":
                      status() === "not_attempted",
                  }}
                >
                  mb: {mbLookupStatusLabel(status())}
                </span>
              }
            >
              <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-blue-500/15 text-blue-400">
                <span class="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                mb
              </span>
            </Show>
            <SourceBadge label="lf" title="last.fm" state={lastfmState()} />
            <SourceBadge label="ad" title="theaudiodb" state={audiodbState()} />
          </div>
        </td>
        <td class="px-2 py-1 text-[var(--color-text-muted)]">{lastLookup() ?? "—"}</td>
        <td class="px-2 py-1 text-[10px]">
          <div class="flex flex-col gap-1">
            <Show
              when={reviewable()}
              fallback={<span class="text-[var(--color-text-disabled)]">—</span>}
            >
              <button
                type="button"
                class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-secondary)] cursor-pointer bg-transparent"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((p) => !p);
                }}
                title={expanded() ? "hide candidates" : "review candidates"}
              >
                <Icon name={expanded() ? "arrowUp" : "arrowDown"} size={8} />
                review
              </button>
            </Show>
            <button
              type="button"
              class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-secondary)] cursor-pointer bg-transparent"
              onClick={(e) => {
                e.stopPropagation();
                props.onOpenLastFm();
              }}
              title="view last.fm raw data"
            >
              last.fm
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-secondary)] cursor-pointer bg-transparent"
              onClick={(e) => {
                e.stopPropagation();
                props.onOpenAudioDb();
              }}
              title="view theaudiodb raw data"
            >
              audiodb
            </button>
          </div>
        </td>
      </tr>
      <Show when={expanded() && reviewable()}>
        <tr class="border-b border-[var(--color-border-subtle)]">
          <td colspan={10} class="p-0">
            <AlbumCandidatesPanel album={props.album} remote={props.remote} />
          </td>
        </tr>
      </Show>
    </>
  );
}

type SourceBadgeState = "missing" | "ok" | "error" | "inflight";

function SourceBadge(props: { label: string; title: string; state: SourceBadgeState }) {
  const tooltip = () => {
    switch (props.state) {
      case "inflight":
        return `${props.title}: looking up…`;
      case "ok":
        return `${props.title}: fetched`;
      case "error":
        return `${props.title}: error (see modal)`;
      case "missing":
        return `${props.title}: not fetched`;
    }
  };
  return (
    <span
      class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]"
      title={tooltip()}
      classList={{
        "bg-blue-500/15 text-blue-400": props.state === "inflight",
        "bg-emerald-500/15 text-emerald-400": props.state === "ok",
        "bg-rose-500/15 text-rose-400": props.state === "error",
        "bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)]": props.state === "missing",
      }}
    >
      <Show when={props.state === "inflight"}>
        <span class="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
      </Show>
      {props.label}
    </span>
  );
}
