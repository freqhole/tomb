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

import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { LoadingState, LoadingMoreIndicator } from "../../components/feedback";
import {
  parseAlbumMetadata,
  parseMbLookupStatus,
  topCandidate,
  type MbLookupStatus,
} from "../data/albumMetadata";
import {
  groupLabel,
  isDone,
  MB_STATUS_GROUPS,
  MB_STATUS_GROUP_MEMBERS,
  type MbStatusGroup,
} from "../data/mbStatusGroups";
import { useLibraryAlbumsQuery } from "../queries/useLibraryAlbums";
import { useAlbumStatusCounts } from "../queries/useAlbumStatusCounts";
import { updateAlbumIdList, updateAlbumMbLookupStatusMap } from "../hooks/albumSelection";
import { getClientForRemote } from "../../app/api/client";
import { queryClient } from "../../queryClient";
import { setPageInfo, clearPageInfo } from "../../app/services/pageInfo";
import type { StatusFilter } from "../../app/services/pageInfo";
import type { AlbumSummary } from "../../music/data/types";
import { Icon } from "../../components/icons/registry";
import { AlbumRow } from "./albumsTable/AlbumRow";
import { LookupConfirmModal } from "./albumsTable/LookupConfirmModal";
import { AutoConfirmModal } from "./albumsTable/AutoConfirmModal";

type SortField = "title" | "artist" | "year" | "song_count" | "added_at";

interface AlbumsTableProps {
  remote: Remote;
  /** invoked when the user clicks the header "lookup all matching"
   *  control. fans out to mb + last.fm + theaudiodb in parallel for the
   *  album ids currently visible (post-filter). */
  onEnrichAllMatching?: (albumIds: string[]) => void;
  /** fired once when the album query transitions from loading → data for
   *  the current remote. used by LibraryView's 9a switching indicator to
   *  clear the spinner without polling. */
  onDataReady?: () => void;
}

const SORT_OPTIONS: { value: SortField; label: string; description?: string }[] = [
  { value: "added_at", label: "added", description: "sort by date added" },
  { value: "title", label: "title", description: "sort by album title" },
  { value: "artist", label: "artist", description: "sort by artist name" },
  { value: "year", label: "year", description: "sort by release year" },
  { value: "song_count", label: "song count", description: "sort by song count" },
];

export function AlbumsTable(props: AlbumsTableProps) {
  // search comes from `?q=` in the url, driven by the topnav search bar
  // (see TopNavSearch -> handleSearchSubmit). reading via useSearchParams
  // keeps it reactive across hash-route changes.
  const [searchParams] = useSearchParams();
  const debouncedSearch = () => {
    const q = searchParams.q;
    const v = Array.isArray(q) ? q[0] : q;
    return v?.trim() || undefined;
  };
  const [statusFilters, setStatusFilters] = createSignal<StatusFilter[]>([]);
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
  // controls the auto-confirm confirmation modal. opens when the user
  // clicks the header button; runs `runAutoConfirm` only after they
  // confirm again from inside the modal.
  const [autoConfirmModalOpen, setAutoConfirmModalOpen] = createSignal(false);

  // admin gating used to live here for the lastfm/audiodb peek modals;
  // those modals moved into the bulk review flow, so the hook isn't
  // needed at table scope anymore.

  const remoteAccessor = () => props.remote;
  const sortByAccessor = () => sortField() as string;

  const albumsQuery = useLibraryAlbumsQuery({
    remote: remoteAccessor,
    search: debouncedSearch,
    sortBy: sortByAccessor,
    sortDirection: sortDirection,
  });

  const statusCountsQuery = useAlbumStatusCounts({
    remote: remoteAccessor,
    search: debouncedSearch,
  });

  // signal to LibraryView that the first batch of data has arrived for
  // this remote. used by the switching indicator to clear the spinner.
  createEffect(() => {
    if (!albumsQuery.isLoading && albumsQuery.data) {
      props.onDataReady?.();
    }
  });

  const allItems = createMemo<AlbumSummary[]>(() => {
    const pages = albumsQuery.data?.pages ?? [];
    return pages.flatMap((p) => p.items);
  });

  // status filtering happens client-side over loaded rows.
  // filters are MbStatusGroup values; filteredItems expands each group to its
  // enum members so rows match if their status belongs to any selected group.
  const filteredItems = createMemo<AlbumSummary[]>(() => {
    const filters = statusFilters();
    if (filters.length === 0) return allItems();
    const includeGroups = new Set(
      filters.filter((f) => f.mode === "include").map((f) => f.value as MbStatusGroup)
    );
    const excludeGroups = new Set(
      filters.filter((f) => f.mode === "exclude").map((f) => f.value as MbStatusGroup)
    );
    // expand each group to its enum members for matching
    const includeStatuses = new Set<string>();
    const excludeStatuses = new Set<string>();
    for (const g of includeGroups) {
      for (const s of MB_STATUS_GROUP_MEMBERS[g] ?? []) includeStatuses.add(s);
    }
    for (const g of excludeGroups) {
      for (const s of MB_STATUS_GROUP_MEMBERS[g] ?? []) excludeStatuses.add(s);
    }
    return allItems().filter((a) => {
      const s = parseMbLookupStatus(a.mb_lookup_status) as string;
      if (includeStatuses.size > 0 && !includeStatuses.has(s)) return false;
      if (excludeStatuses.has(s)) return false;
      return true;
    });
  });

  // keep the selection range list aligned with the visible rows.
  createEffect(() => {
    updateAlbumIdList(filteredItems().map((a) => a.album_id));
    updateAlbumMbLookupStatusMap(filteredItems().map((a) => [a.album_id, a.mb_lookup_status]));
  });

  const loadedCount = () => allItems().length;

  // coverage: use real server total when available; fall back to loaded-row count.
  // "covered" = isDone (confirmed | enriched).
  const serverTotal = () => statusCountsQuery.data?.total ?? 0;
  const coveredCount = () =>
    statusCountsQuery.data?.byGroup.done ??
    allItems().filter((a) => isDone(parseMbLookupStatus(a.mb_lookup_status))).length;

  // statuses that don't need re-lookup: user explicitly skipped, or
  // already done (confirmed | enriched). used to split filteredItems into
  // eligible (need lookup) vs excluded (already done/skipped).
  const isSkippable = (s: string | null | undefined) =>
    isDone(parseMbLookupStatus(s)) || s === "skipped";
  const eligibleRows = () => filteredItems().filter((a) => !isSkippable(a.mb_lookup_status));
  const excludedRows = () => filteredItems().filter((a) => isSkippable(a.mb_lookup_status));

  // lookup confirmation modal: opened when some filtered rows are already
  // confirmed/enriched/skipped. lets the user choose whether to include
  // them anyway or skip them (default).
  const [lookupConfirmOpen, setLookupConfirmOpen] = createSignal(false);
  const coveragePct = () => {
    const n = serverTotal() > 0 ? serverTotal() : loadedCount();
    if (n === 0) return 0;
    return Math.round((coveredCount() / n) * 100);
  };

  const toggleStatus = (status: MbLookupStatus) => {
    // legacy single-arg toggle: flip presence as include filter.
    setStatusFilters((prev) => {
      const exists = prev.find((f) => f.value === status);
      if (exists) return prev.filter((f) => f.value !== status);
      return [...prev, { value: status, mode: "include" }];
    });
  };
  const addStatusFilter = (value: string) => {
    setStatusFilters((prev) => {
      if (prev.some((f) => f.value === value)) return prev;
      return [...prev, { value: value as MbLookupStatus, mode: "include" }];
    });
  };
  const removeStatusFilter = (value: string) => {
    setStatusFilters((prev) => prev.filter((f) => f.value !== value));
  };
  const toggleStatusMode = (value: string) => {
    setStatusFilters((prev) =>
      prev.map((f) =>
        f.value === value ? { ...f, mode: f.mode === "include" ? "exclude" : "include" } : f
      )
    );
  };
  const clearStatusFilters = () => setStatusFilters([]);

  const toggleSortDirection = () => setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
  void toggleStatus; // legacy chip toggle; topnav status picker uses add/remove/toggle helpers below
  void toggleSortDirection;

  // wire pageInfo so the topnav surfaces search / sort / status filters
  // for the library/table view, matching the pattern used by
  // AlbumsView / SongsView / etc.
  // status chip options: group-based, sourced from server counts.
  // in_flight is included in counts but hidden from selectable chips (transient,
  // no user value as a filter target — they already see the spinner on each row).
  const statusOptionsWithCounts = createMemo(() => {
    const counts = statusCountsQuery.data;
    return MB_STATUS_GROUPS.filter((g) => g !== "in_flight").map((g) => ({
      value: g,
      label: groupLabel(g),
      count: counts?.byGroup[g],
    }));
  });
  createEffect(() => {
    setPageInfo({
      // title matches the "albums" view-selector option so the topnav
      // flyout highlights the right entry while we're in table mode.
      title: "albums",
      count: filteredItems().length,
      sortFields: SORT_OPTIONS,
      sortBy: sortField(),
      sortDirection: sortDirection(),
      defaultSortBy: "added_at",
      defaultSortDirection: "desc",
      onSortChange: (field, direction) => {
        setSortField(field as SortField);
        setSortDirection(direction);
      },
      statusFilterOptions: statusOptionsWithCounts(),
      selectedStatusFilters: statusFilters(),
      statusFilterLabel: "mb status filters",
      onAddStatusFilter: addStatusFilter,
      onRemoveStatusFilter: removeStatusFilter,
      onToggleStatusFilterMode: toggleStatusMode,
      onClearStatusFilters: clearStatusFilters,
    });
  });
  onMount(() => {
    onCleanup(() => clearPageInfo());
  });

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

  // pre-flight stats for the auto-confirm modal. computed against the
  // currently-loaded + filtered album set, so the user sees an estimate
  // of what the bulk action will do before they commit. eligibility =
  // mb_lookup_status is `candidates`/`needs_review`, AND the top
  // candidate beats both thresholds. albums already in `confirmed` /
  // `enriched` are skipped server-side regardless.
  const autoConfirmStats = createMemo(() => {
    const items = filteredItems();
    let totalLoaded = items.length;
    let withCandidates = 0;
    let eligibleByStatus = 0;
    let meetsConfidence = 0;
    let meetsGap = 0;
    let meetsBoth = 0;
    const conf = minConfidence();
    const gap = minGap();
    const matched: {
      albumId: string;
      title: string;
      artist: string;
      score: number;
      gap: number;
      mbTitle: string;
      primaryType: string | null;
    }[] = [];
    for (const a of items) {
      const st = parseMbLookupStatus(a.mb_lookup_status);
      const reviewable = st === "candidates" || st === "needs_review";
      const meta = parseAlbumMetadata(a.metadata);
      const cands = meta.musicbrainz?.candidates ?? [];
      if (cands.length > 0) withCandidates += 1;
      if (!reviewable || cands.length === 0) continue;
      eligibleByStatus += 1;
      const top = topCandidate(meta);
      if (!top) continue;
      const score = top.local_confidence ?? 0;
      const sorted = [...cands].sort(
        (a, b) => (b.local_confidence ?? 0) - (a.local_confidence ?? 0)
      );
      const second = sorted[1]?.local_confidence ?? 0;
      const localGap = score - second;
      const okConf = score >= conf;
      const okGap = localGap >= gap;
      if (okConf) meetsConfidence += 1;
      if (okGap) meetsGap += 1;
      if (okConf && okGap) {
        meetsBoth += 1;
        matched.push({
          albumId: a.album_id,
          title: a.title,
          artist: a.artist_name,
          score,
          gap: localGap,
          mbTitle: top.title ?? "—",
          primaryType: top.primary_type ?? null,
        });
      }
    }
    // sort highest-confidence first so the user sees the strongest
    // matches at the top of the preview list.
    matched.sort((a, b) => b.score - a.score);
    return {
      totalLoaded,
      withCandidates,
      eligibleByStatus,
      meetsConfidence,
      meetsGap,
      meetsBoth,
      matched,
    };
  });

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
      {/* slim toolbar — search / sort / status filters live in the
       *  topnav now; this strip just shows counts + the bulk action
       *  buttons that operate over the entire filtered set. */}
      <div class="flex items-center gap-3 flex-wrap px-4 py-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]">
        {/* count. note: server's `total_count` is currently the page count
         *  (see grimoire/src/music/crud/query.rs query_albums) so we can't
         *  show "loaded of total" reliably yet — just show what's loaded.
         *  TODO: separate COUNT(*) on the server, then restore "of N". */}
        <div class="text-xs text-[var(--color-text-muted)]">
          <Show when={loadedCount() > 0} fallback={<span>0 albums</span>}>
            {loadedCount()}
            <Show when={albumsQuery.hasNextPage}>+</Show>
            <Show when={statusFilters().length > 0}> · {filteredItems().length} match filters</Show>
            <span
              class="ml-1.5 text-[var(--color-text-tertiary)]"
              title={`${coveredCount()} of ${loadedCount()} loaded albums are confirmed or enriched`}
            >
              · {coveragePct()}% enriched
            </span>
          </Show>
        </div>

        {/* lookup N control (header level; works without selection).
         *  fans out to mb + last.fm + theaudiodb for eligible rows only.
         *  confirmed/enriched/skipped rows are excluded by default;
         *  a modal lets the user opt to include them. */}
        <Show when={props.onEnrichAllMatching}>
          {(() => {
            const eligible = eligibleRows();
            const excluded = excludedRows();
            const skipCounts = () => {
              let skipped = 0;
              let confirmed = 0;
              let enriched = 0;
              for (const a of excluded) {
                const s = a.mb_lookup_status ?? "not_attempted";
                if (s === "skipped") skipped++;
                else if (s === "confirmed") confirmed++;
                else if (s === "enriched") enriched++;
              }
              return { skipped, confirmed, enriched };
            };
            const titleText = () => {
              const ex = excluded;
              if (ex.length === 0)
                return "enqueue musicbrainz + last.fm + theaudiodb lookups for every matching album";
              const sc = skipCounts();
              const parts: string[] = [];
              if (sc.confirmed > 0) parts.push(`${sc.confirmed} confirmed`);
              if (sc.enriched > 0) parts.push(`${sc.enriched} enriched`);
              if (sc.skipped > 0) parts.push(`${sc.skipped} skipped`);
              return `${eligible.length} eligible · ${parts.join(", ")} will be skipped by default`;
            };
            return (
              <button
                type="button"
                disabled={eligible.length === 0}
                onClick={() => {
                  if (excluded.length === 0) {
                    props.onEnrichAllMatching?.(eligible.map((a) => a.album_id));
                  } else {
                    setLookupConfirmOpen(true);
                  }
                }}
                class="flex items-center gap-1 px-2 py-1 text-xs rounded border border-[var(--color-accent-500)]/40 text-[var(--color-accent-500)] hover:bg-[var(--color-accent-500)]/10 cursor-pointer bg-transparent ml-auto disabled:opacity-40 disabled:cursor-not-allowed"
                title={titleText()}
              >
                <Icon name="search" size={10} />
                lookup {eligible.length}
              </button>
            );
          })()}
        </Show>

        {/* auto-confirm bulk control. confirms top candidate where it
         *  clears confidence + gap thresholds. admin-only on the server
         *  side; non-admins see a 403 surfaced inline. opens a
         *  confirmation modal that lets the user tweak thresholds and
         *  preview how many albums would be affected before firing. */}
        <Show when={filteredItems().length > 0}>
          <button
            type="button"
            onClick={() => setAutoConfirmModalOpen(true)}
            disabled={autoConfirm().kind === "running"}
            class="flex items-center gap-1 px-2 py-1 text-xs rounded border border-[var(--color-accent-500)]/40 text-[var(--color-accent-500)] hover:bg-[var(--color-accent-500)]/10 cursor-pointer bg-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            title="auto-confirm top mb candidate when confidence + gap thresholds are met"
          >
            <Show when={autoConfirm().kind === "running"} fallback={<>auto-confirm…</>}>
              running…
            </Show>
          </button>
          <Show when={autoConfirm().kind === "done"}>
            {(() => {
              const s = autoConfirm() as Extract<AutoConfirmState, { kind: "done" }>;
              return (
                <span class="text-xs text-[var(--color-text-muted)]">
                  last run: ok {s.confirmed} · skip {s.skipped}
                  <Show when={s.errors > 0}> · err {s.errors}</Show>
                </span>
              );
            })()}
          </Show>
          <Show when={autoConfirm().kind === "error"}>
            {(() => {
              const s = autoConfirm() as Extract<AutoConfirmState, { kind: "error" }>;
              return (
                <span class="text-xs text-[var(--color-error-500)]" title={s.message}>
                  auto-confirm error
                </span>
              );
            })()}
          </Show>
        </Show>
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
                      onEnrich={
                        props.onEnrichAllMatching
                          ? (id) => props.onEnrichAllMatching?.([id])
                          : undefined
                      }
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
      <AutoConfirmModal
        isOpen={autoConfirmModalOpen()}
        onClose={() => setAutoConfirmModalOpen(false)}
        minConfidence={minConfidence()}
        minGap={minGap()}
        setMinConfidence={setMinConfidence}
        setMinGap={setMinGap}
        eligibleStats={autoConfirmStats()}
        onConfirm={async () => {
          await runAutoConfirm();
          setAutoConfirmModalOpen(false);
        }}
        running={autoConfirm().kind === "running"}
      />
      {/* lookup confirmation modal: shown when some filtered rows are
       *  already confirmed/enriched/skipped. default action skips them. */}
      <LookupConfirmModal
        isOpen={lookupConfirmOpen()}
        eligibleCount={eligibleRows().length}
        excludedCount={excludedRows().length}
        onSkipExcluded={() => {
          setLookupConfirmOpen(false);
          props.onEnrichAllMatching?.(eligibleRows().map((a) => a.album_id));
        }}
        onIncludeAll={() => {
          setLookupConfirmOpen(false);
          props.onEnrichAllMatching?.(filteredItems().map((a) => a.album_id));
        }}
        onCancel={() => setLookupConfirmOpen(false)}
      />
    </div>
  );
}
