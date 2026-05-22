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
import { Icon } from "../../components/icons/registry";
import { LoadingState, LoadingMoreIndicator } from "../../components/feedback";
import MediaImage from "../../components/media/MediaImage";
import { ContextMenu as KobalteContextMenu } from "@kobalte/core/context-menu";
import type { MenuAction } from "../../components/overlays/ContextMenu";
import { MarqueeText } from "../../components/text/MarqueeText";
import { Modal } from "../../components/modals/Modal";
import {
  mbLookupStatusLabel,
  mbSearchStageLabel,
  parseAlbumMetadata,
  parseMbLookupStatus,
  topCandidate,
  topFolksonomyTags,
  type MbLookupStatus,
} from "../data/albumMetadata";
import {
  groupBadgeClass,
  groupLabel,
  isDone,
  isInFlight,
  MB_STATUS_GROUPS,
  MB_STATUS_GROUP_MEMBERS,
  needsReview,
  statusGroupOf,
  type MbStatusGroup,
} from "../data/mbStatusGroups";
import { useLibraryAlbumsQuery } from "../queries/useLibraryAlbums";
import { useAlbumStatusCounts } from "../queries/useAlbumStatusCounts";
import {
  handleAlbumClick,
  isAlbumSelected,
  toggleAlbumSelection,
  updateAlbumIdList,
  updateAlbumMbLookupStatusMap,
} from "../hooks/albumSelection";
import {
  useInflightJobs,
  getInflightSourcesForAlbum,
  getInflightJobForAlbum,
  getJobProgressMessage,
  useJobProgressMessages,
} from "../hooks/useMbLookupJobs";
import { showBulkReview } from "../review/bulkReviewModal";
import { getClientForRemote } from "../../app/api/client";
import { queryClient } from "../../queryClient";
import { setPageInfo, clearPageInfo } from "../../app/services/pageInfo";
import type { StatusFilter } from "../../app/services/pageInfo";
import type { AlbumSummary } from "../../music/data/types";

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
  // this remote. used by the 9a switching indicator to clear the spinner.
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
      title: "library",
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

// ── LookupConfirmModal ────────────────────────────────────────────────────────
// shown when the user clicks "lookup N" and some filtered rows are already
// confirmed/enriched/skipped. default action ("skip them") only enqueues
// eligible rows; "include all" mirrors the old "lookup all matching" behavior.
function LookupConfirmModal(props: {
  isOpen: boolean;
  eligibleCount: number;
  excludedCount: number;
  onSkipExcluded: () => void;
  onIncludeAll: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onCancel}
      title="lookup albums"
      size="sm"
      fitContent
      scrollBody
      footer={
        <div class="flex items-center justify-end gap-2 px-4 py-3 flex-wrap">
          <button
            type="button"
            onClick={props.onCancel}
            class="px-3 py-1.5 text-sm rounded border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] cursor-pointer bg-transparent"
          >
            cancel
          </button>
          <button
            type="button"
            onClick={props.onIncludeAll}
            class="px-3 py-1.5 text-sm rounded border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] cursor-pointer bg-transparent"
          >
            include all ({props.eligibleCount + props.excludedCount})
          </button>
          <button
            type="button"
            onClick={props.onSkipExcluded}
            class="px-3 py-1.5 text-sm rounded border border-[var(--color-accent-500)]/40 text-[var(--color-accent-500)] hover:bg-[var(--color-accent-500)]/10 cursor-pointer bg-transparent"
          >
            skip them · lookup {props.eligibleCount}
          </button>
        </div>
      }
    >
      <div class="px-4 py-3 text-sm text-[var(--color-text-secondary)]">
        <p>
          {props.excludedCount} album{props.excludedCount === 1 ? " is" : "s are"} already
          confirmed, enriched, or skipped. include them in this lookup, or skip them and only
          re-query the {props.eligibleCount} remaining album{props.eligibleCount === 1 ? "" : "s"}?
        </p>
        <p class="mt-2 text-[var(--color-text-muted)] text-xs">
          "skip them" is the default \u2014 use "include all" to re-run lookup on
          previously-confirmed or skipped rows.
        </p>
      </div>
    </Modal>
  );
}

function AlbumRow(props: {
  album: AlbumSummary;
  remote: Remote;
  index: number;
  /** invoked from the row context menu to enqueue mb+last.fm+audiodb
   *  enrichment for just this album. omitted when admin gating disables
   *  enrichment in the parent table. */
  onEnrich?: (albumId: string) => void;
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
  const lastQueryStage = () => albumMeta().musicbrainz?.last_query?.stage ?? null;
  const selected = () => isAlbumSelected(props.album.album_id);
  const inflight = useInflightJobs();
  const inflightSources = () => {
    inflight(); // subscribe
    return getInflightSourcesForAlbum(props.album.album_id);
  };
  // live mb-search stage caption. depends on both signals so the
  // caption reactively appears/disappears as the job progresses.
  const stages = useJobProgressMessages();
  const mbStageMessage = (): string | null => {
    inflight();
    stages();
    const entry = getInflightJobForAlbum(props.album.album_id, "mb");
    if (!entry) return null;
    return getJobProgressMessage(entry.jobId);
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
  const reviewable = () => needsReview(status());
  const openReview = () => {
    showBulkReview({
      ids: [props.album.album_id],
      currentIndex: 0,
      remote: props.remote,
      onNext: () => {
        /* single-album review — no-op */
      },
      onPrev: () => {
        /* single-album review — no-op */
      },
      onExit: () => {
        /* dismiss only — no global session to tear down */
      },
    });
  };

  // context menu actions: navigate, review (when applicable), single-album
  // lookup, toggle selection, copy id. items are recomputed on each open
  // because `reviewable()` + `selected()` + admin gating (`onEnrich`)
  // change with state.
  const menuActions = (): MenuAction[] => {
    const actions: MenuAction[] = [
      {
        label: "open album page",
        icon: "externalLink",
        onClick: () => {
          window.location.hash = `#/${props.remote.remote_id}/albums/${encodeURIComponent(
            props.album.album_id
          )}`;
        },
      },
    ];
    if (reviewable()) {
      actions.push({
        label: "review candidates",
        icon: "search",
        onClick: () => openReview(),
      });
    }
    if (props.onEnrich) {
      actions.push({
        label: "look up enrichment",
        icon: "database",
        disabled: inflightSources().size > 0,
        onClick: () => props.onEnrich?.(props.album.album_id),
      });
    }
    actions.push({ type: "separator" });
    actions.push({
      label: selected() ? "deselect album" : "select album",
      icon: selected() ? "close" : "check",
      onClick: () => toggleAlbumSelection(props.album.album_id, props.index),
    });
    actions.push({ type: "separator" });
    actions.push({
      label: "copy album id",
      icon: "copy",
      onClick: () => {
        void navigator.clipboard?.writeText(props.album.album_id);
      },
    });
    return actions;
  };

  return (
    <>
      <KobalteContextMenu>
        {/* trigger IS the tr — kobalte forwards a11y attrs onto our
         *  element, layout + selection click handler stay intact. */}
        <KobalteContextMenu.Trigger
          as="tr"
          class="border-b border-[var(--color-border-subtle)] cursor-pointer outline-none"
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
          <td class="px-2 py-1 text-[var(--color-text-primary)] max-w-[260px]">
            <MarqueeText text={props.album.title} />
          </td>
          <td class="px-2 py-1 text-[var(--color-text-secondary)] max-w-[200px]">
            <MarqueeText text={props.album.artist_name} />
          </td>
          <td class="px-2 py-1 text-[var(--color-text-muted)]">
            <MarqueeText text={props.album.release_date ?? ""} />
          </td>
          <td class="px-2 py-1 text-[var(--color-text-muted)] text-right">
            {props.album.song_count}
          </td>
          <td class="px-2 py-1 text-[var(--color-text-muted)] max-w-[200px]">
            <MarqueeText text={genreList()} />
          </td>
          <td class="px-2 py-1 max-w-[220px]">
            <Show
              when={folksonomy().length > 0}
              fallback={<span class="text-[var(--color-text-disabled)]">—</span>}
            >
              <MarqueeText
                text={folksonomy()
                  .map((t) => t.name)
                  .join(" · ")}
                title={folksonomy()
                  .map((t) => `${t.name} (${t.count})`)
                  .join(", ")}
                class="text-[10px] text-[var(--color-text-secondary)]"
              />
            </Show>
          </td>
          <td class="px-2 py-1">
            {/* enrichment column: mb status on row 1, source-availability dots on row 2.
             *  the stacked layout keeps the mb chip visually primary and distinguishes it
             *  from the source dots (which are a different state machine). */}
            <div class="flex flex-col gap-0.5">
              {/* row 1: musicbrainz status chip */}
              <div class="flex flex-wrap items-center gap-1">
                {/* musicbrainz status — primary, uses the rich mb_lookup_status enum */}
                <Show
                  when={inflightSources().has("mb") || isInFlight(status())}
                  fallback={
                    <span
                      class={`inline-block px-1.5 py-0.5 rounded text-[10px] ${groupBadgeClass(statusGroupOf(status()))}`}
                      title={(() => {
                        const base = `musicbrainz: ${mbLookupStatusLabel(status())}`;
                        const stage = lastQueryStage();
                        if (stage && needsReview(status())) {
                          return `${base} · ${mbSearchStageLabel(stage)}`;
                        }
                        return base;
                      })()}
                    >
                      mb: {mbLookupStatusLabel(status())}
                    </span>
                  }
                >
                  <span
                    class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-blue-500/15 text-blue-400"
                    title={
                      status() === "auto_applying"
                        ? "auto-applying enrichment from musicbrainz, last.fm, theaudiodb"
                        : "musicbrainz lookup in flight"
                    }
                  >
                    <span class="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                    {status() === "auto_applying" ? "auto-applying…" : "mb"}
                  </span>
                  {/* live broker-stage caption (snake_case stage name or
                   *  human message). only renders while the mb job is
                   *  actually in flight and has emitted a stage event. */}
                  <Show when={mbStageMessage()}>
                    <span
                      class="text-[9px] text-blue-300/70 italic truncate max-w-[14rem]"
                      title={mbStageMessage() ?? ""}
                    >
                      {mbStageMessage()}
                    </span>
                  </Show>
                </Show>
                {/* diversity-gate sub-badge: shown when needs_review was triggered by
                 *  an album-only cascade stage (many distinct artists, title-only match). */}
                <Show when={status() === "needs_review" && lastQueryStage() === "album_only"}>
                  <span
                    class="inline-block px-1 py-0.5 rounded text-[9px] bg-amber-500/10 text-amber-400/70"
                    title="diversity gate: title-only fallback matched multiple distinct artists — manual review required"
                  >
                    title-only
                  </span>
                </Show>
              </div>
              {/* row 2: source-availability dots (last.fm, theaudiodb).
               *  deliberately non-pill so they can't be confused with the mb chip. */}
              <div class="flex items-center gap-2">
                <SourceDot label="last.fm" state={lastfmState()} />
                <SourceDot label="theaudiodb" state={audiodbState()} />
              </div>
            </div>
          </td>
          <td class="px-2 py-1 text-[var(--color-text-muted)]">
            <MarqueeText text={lastLookup() ?? "—"} />
          </td>
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
                    openReview();
                  }}
                  title="open in review modal"
                >
                  <Icon name="search" size={8} />
                  review
                </button>
              </Show>
              <a
                href={`#/${props.remote.remote_id}/albums/${encodeURIComponent(props.album.album_id)}`}
                class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-secondary)] cursor-pointer bg-transparent no-underline"
                onClick={(e) => {
                  // stop the row's selection click handler from also firing
                  e.stopPropagation();
                }}
                title="open album page"
              >
                album
              </a>
            </div>
          </td>
        </KobalteContextMenu.Trigger>
        <KobalteContextMenu.Portal>
          <KobalteContextMenu.Content class="min-w-48 bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-lg shadow-2xl overflow-hidden z-[1200] origin-top-left">
            <div class="py-1">
              <For each={menuActions()}>
                {(action) => {
                  if (action.type === "separator") {
                    return (
                      <KobalteContextMenu.Separator class="my-1 h-px bg-[var(--color-border-subtle)]" />
                    );
                  }
                  return (
                    <KobalteContextMenu.Item
                      class={`w-full px-4 py-2 text-left flex items-center gap-3 transition-colors body-small outline-none cursor-pointer ${
                        action.disabled
                          ? "text-[var(--color-text-disabled)] cursor-not-allowed opacity-50"
                          : "text-[var(--color-text-primary)] data-[highlighted]:bg-[var(--color-bg-hover)]"
                      }`}
                      onSelect={() => !action.disabled && action.onClick()}
                      disabled={action.disabled}
                      closeOnSelect={true}
                    >
                      <Show when={action.icon}>
                        <Icon name={action.icon!} size={16} color="currentColor" />
                      </Show>
                      <span>{action.label}</span>
                    </KobalteContextMenu.Item>
                  );
                }}
              </For>
            </div>
          </KobalteContextMenu.Content>
        </KobalteContextMenu.Portal>
      </KobalteContextMenu>
    </>
  );
}

type SourceBadgeState = "missing" | "ok" | "error" | "inflight";

// SourceDot: tiny colored circle + label for last.fm / theaudiodb availability.
// deliberately non-pill (no background box) so it can't be confused with the mb chip.
function SourceDot(props: { label: string; state: SourceBadgeState }) {
  const tooltip = () => {
    switch (props.state) {
      case "inflight":
        return `${props.label}: looking up…`;
      case "ok":
        return `${props.label}: fetched`;
      case "error":
        return `${props.label}: error (see modal)`;
      case "missing":
        return `${props.label}: not fetched`;
    }
  };
  return (
    <span
      class="inline-flex items-center gap-0.5 text-[9px] text-[var(--color-text-disabled)]"
      title={tooltip()}
    >
      <span
        class="inline-block w-1.5 h-1.5 rounded-full"
        classList={{
          "bg-blue-400 animate-pulse": props.state === "inflight",
          "bg-emerald-500": props.state === "ok",
          "bg-rose-500": props.state === "error",
          "bg-[var(--color-border-subtle)]": props.state === "missing",
        }}
      />
      {props.label}
    </span>
  );
}

// confirmation modal for the bulk auto-confirm action. lets the user
// tweak min-confidence + min-gap thresholds and shows a live count of
// how many of the currently-loaded + filtered albums would be eligible
// at those thresholds, plus a preview list of the actual matches.
// server-side eligibility is the source of truth; the modal numbers are
// just an estimate based on candidate metadata already loaded on the
// client.
interface AutoConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  minConfidence: number;
  minGap: number;
  setMinConfidence: (v: number) => void;
  setMinGap: (v: number) => void;
  eligibleStats: {
    totalLoaded: number;
    withCandidates: number;
    eligibleByStatus: number;
    meetsConfidence: number;
    meetsGap: number;
    meetsBoth: number;
    matched: {
      albumId: string;
      title: string;
      artist: string;
      score: number;
      gap: number;
      mbTitle: string;
      primaryType: string | null;
    }[];
  };
  onConfirm: () => Promise<void> | void;
  running: boolean;
}

function AutoConfirmModal(props: AutoConfirmModalProps) {
  const PREVIEW_LIMIT = 50;
  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title="auto-confirm musicbrainz matches"
      size="md"
      disableBackdropClose={props.running}
      fitContent
      scrollBody
      footer={
        <div class="flex items-center justify-end gap-2 px-4 py-3">
          <button
            type="button"
            onClick={props.onClose}
            disabled={props.running}
            class="px-3 py-1.5 text-sm rounded border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] cursor-pointer bg-transparent disabled:opacity-50 disabled:cursor-not-allowed"
          >
            cancel
          </button>
          <button
            type="button"
            onClick={() => void props.onConfirm()}
            disabled={props.running || props.eligibleStats.meetsBoth === 0}
            class="px-3 py-1.5 text-sm rounded border border-[var(--color-accent-500)]/40 text-[var(--color-accent-500)] hover:bg-[var(--color-accent-500)]/10 cursor-pointer bg-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              props.eligibleStats.meetsBoth === 0
                ? "no albums in the current filter would be confirmed at these thresholds"
                : `confirm ${props.eligibleStats.meetsBoth} albums`
            }
          >
            <Show
              when={props.running}
              fallback={<>confirm {props.eligibleStats.meetsBoth} matches</>}
            >
              running…
            </Show>
          </button>
        </div>
      }
    >
      <div class="flex flex-col gap-4 px-4 py-3 text-sm text-[var(--color-text-secondary)]">
        <p class="text-[var(--color-text-muted)]">
          confirm the top musicbrainz candidate for every reviewable album in the current filter
          where both thresholds below are met. drag the sliders to preview the match list, then
          commit.
        </p>
        <div class="flex flex-col gap-3">
          <label class="flex flex-col gap-1">
            <div class="flex items-center justify-between">
              <span class="text-[var(--color-text-primary)] text-xs font-medium">
                min confidence
              </span>
              <span class="text-[var(--color-text-primary)] tabular-nums text-xs">
                {props.minConfidence.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={props.minConfidence}
              onInput={(e) => props.setMinConfidence(Number.parseFloat(e.currentTarget.value) || 0)}
              class="w-full accent-[var(--color-accent-500)]"
            />
            <span class="text-[10px] text-[var(--color-text-muted)] leading-snug">
              how strong the top candidate must be on its own (0.00–1.00). higher = fewer false
              positives. 0.90 is a safe default.
            </span>
          </label>
          <label class="flex flex-col gap-1">
            <div class="flex items-center justify-between">
              <span class="text-[var(--color-text-primary)] text-xs font-medium">min gap</span>
              <span class="text-[var(--color-text-primary)] tabular-nums text-xs">
                {props.minGap.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={props.minGap}
              onInput={(e) => props.setMinGap(Number.parseFloat(e.currentTarget.value) || 0)}
              class="w-full accent-[var(--color-accent-500)]"
            />
            <span class="text-[10px] text-[var(--color-text-muted)] leading-snug">
              how far ahead of the runner-up the top must be (0.00–1.00). guards against near-ties
              between similarly-scored releases. 0.15 is a safe default.
            </span>
          </label>
        </div>
        <div class="rounded border border-[var(--color-border-subtle)] p-3 flex flex-col gap-1 text-xs">
          <div class="flex justify-between">
            <span class="text-[var(--color-text-muted)]">albums in current filter</span>
            <span>{props.eligibleStats.totalLoaded}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-[var(--color-text-muted)]">with candidates</span>
            <span>{props.eligibleStats.withCandidates}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-[var(--color-text-muted)]">in reviewable status</span>
            <span>{props.eligibleStats.eligibleByStatus}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-[var(--color-text-muted)]">meets confidence threshold</span>
            <span>{props.eligibleStats.meetsConfidence}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-[var(--color-text-muted)]">meets gap threshold</span>
            <span>{props.eligibleStats.meetsGap}</span>
          </div>
          <div class="flex justify-between font-medium text-[var(--color-text-primary)] mt-1 pt-1 border-t border-[var(--color-border-subtle)]">
            <span>would auto-confirm</span>
            <span>{props.eligibleStats.meetsBoth}</span>
          </div>
        </div>
        <Show when={props.eligibleStats.matched.length > 0}>
          <div class="flex flex-col gap-1">
            <div class="flex items-center justify-between text-xs">
              <span class="text-[var(--color-text-primary)] font-medium">matches preview</span>
              <Show when={props.eligibleStats.matched.length > PREVIEW_LIMIT}>
                <span class="text-[var(--color-text-muted)]">
                  showing {PREVIEW_LIMIT} of {props.eligibleStats.matched.length}
                </span>
              </Show>
            </div>
            <div class="rounded border border-[var(--color-border-subtle)] max-h-64 overflow-y-auto divide-y divide-[var(--color-border-subtle)]">
              <For each={props.eligibleStats.matched.slice(0, PREVIEW_LIMIT)}>
                {(m) => (
                  <div class="flex items-center gap-3 px-3 py-1.5 text-xs hover:bg-[var(--color-bg-elevated)]">
                    <div class="flex-1 min-w-0">
                      <div class="truncate text-[var(--color-text-primary)]">
                        {m.artist} — {m.title}
                      </div>
                      <div class="truncate text-[10px] text-[var(--color-text-muted)]">
                        mb: {m.mbTitle}
                        <Show when={m.primaryType}> · {m.primaryType}</Show>
                      </div>
                    </div>
                    <div class="shrink-0 flex items-center gap-2 tabular-nums text-[10px] text-[var(--color-text-secondary)]">
                      <span title="top candidate confidence">conf {m.score.toFixed(2)}</span>
                      <span title="confidence gap to runner-up">gap {m.gap.toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </Modal>
  );
}
