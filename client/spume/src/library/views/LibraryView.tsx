// library view — top-level view for the music library across all remotes.
// hosts the upcoming albums force-graph viz + data-table.
//
// phase 1 scope: route shell + view switcher.
// phase 2: remote picker (single-select) wired to a `selectedRemoteId`
//          signal that subviews can read.

import { createEffect, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { Icon } from "../../components/icons/registry";
import { RemotePicker } from "../../components/forms/RemotePicker";
import { useRemoteSelection } from "../../components/forms/useRemoteSelection";
import { AlbumsTable } from "../components/AlbumsTable";
import { AlbumBulkActionBar } from "../components/AlbumBulkActionBar";
import { MbProgressStrip } from "../components/MbProgressStrip";
import { useAlbumSelectionLifecycle, useSelectedAlbumIds } from "../hooks/albumSelection";
import { useRemoteIsAdmin } from "../hooks/useRemoteRole";
import { enqueueAlbumEnrichment, rehydrateInflightForRemote } from "../hooks/useMbLookupJobs";
import { startBulkEnrichmentReview } from "../../music/hooks/bulkEnrichmentReview";
import { getClientForRemote } from "../../app/api/client";
import { connectToRemote } from "../../app/services/remotes/connectionProgress";
import { queryClient } from "../../queryClient";
import { toast } from "../../components/feedback/Toast";
import { BulkEditAlbumsModal } from "../../components/modals/BulkEditAlbumsModal";
import { TagSelectorModal } from "../../components/modals/TagSelectorModal";
import { LibraryGraphSubview } from "./graph/LibraryGraphSubview";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { useTopNavSlots } from "../../app/shell/topNavSlots";
import { isNarrowViewport } from "../../config/breakpoints";

type LibrarySubview = "graph" | "table";

const SUBVIEWS: { id: LibrarySubview; label: string; icon: Parameters<typeof Icon>[0]["name"] }[] =
  [
    { id: "graph", label: "graph", icon: "share" },
    { id: "table", label: "table", icon: "list" },
  ];

// after 2s of a remote switch without confirmed data, escalate to the
// ConnectionProgressModal so the user can see what's happening.
const SLOW_SWITCH_MS = 2000;

export function LibraryView() {
  const [subview, setSubview] = createSignal<LibrarySubview>("graph");

  // viewport tracking — on narrow we relocate the remote picker +
  // subview switcher into the topnav and collapse the segmented
  // graph/table control into a single toggle icon button.
  const [isNarrow, setIsNarrow] = createSignal(isNarrowViewport());
  onMount(() => {
    const onResize = () => setIsNarrow(isNarrowViewport());
    window.addEventListener("resize", onResize);
    onCleanup(() => window.removeEventListener("resize", onResize));
  });

  // narrow-mode topnav slot ownership. wide mode keeps the cluster
  // floating over the canvas (graph) / above the table (table).
  const slots = useTopNavSlots();

  // view-local remote selection (encapsulates resource + default effect + memos)
  const {
    remotes,
    selectedRemoteIds,
    setSelectedRemoteIds,
    selectedRemoteId,
    selectedRemote,
    selectedRemotes,
  } = useRemoteSelection();

  // deferred view of `selectedRemotes` for the graph subview.
  //
  // toggling several remotes in quick succession on a large library
  // would otherwise kick off a fresh graph rebuild for each change
  // and lock the ui mid-toggle. pure time-debounce is the wrong tool
  // here: 1.5s is short enough that a thoughtful user trips it
  // mid-selection, but long enough that quick clicks feel unresponsive.
  //
  // instead: commit when the user *leaves* the picker (pointer leaves
  // AND focus leaves), with a long safety-net timer in case they hover
  // forever. while the pointer is over the picker (`pickerActive`) we
  // hold off entirely. once they leave, a short 250ms quiet window
  // catches stray pointermoves before committing.
  //
  // the first non-empty value still comes through immediately so the
  // initial mount isn't artificially delayed.
  const GRAPH_REMOTE_LEAVE_MS = 250;
  const GRAPH_REMOTE_MAX_HOLD_MS = 8000;
  const [debouncedSelectedRemotes, setDebouncedSelectedRemotes] = createSignal<Remote[]>([]);
  const [pickerActive, setPickerActive] = createSignal(false);
  let graphRemotesPrimed = false;
  let leaveTimer: ReturnType<typeof setTimeout> | null = null;
  let maxHoldTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingRemotes: Remote[] | null = null;

  const clearTimers = () => {
    if (leaveTimer) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
    if (maxHoldTimer) {
      clearTimeout(maxHoldTimer);
      maxHoldTimer = null;
    }
  };

  const commitPending = () => {
    clearTimers();
    if (pendingRemotes !== null) {
      setDebouncedSelectedRemotes(pendingRemotes);
      pendingRemotes = null;
    }
  };

  createEffect(() => {
    const next = selectedRemotes();
    if (!graphRemotesPrimed) {
      setDebouncedSelectedRemotes(next);
      if (next.length > 0) graphRemotesPrimed = true;
      return;
    }
    pendingRemotes = next;
    // arm the safety-net cap once per pending change.
    if (!maxHoldTimer) {
      maxHoldTimer = setTimeout(() => {
        maxHoldTimer = null;
        commitPending();
      }, GRAPH_REMOTE_MAX_HOLD_MS);
    }
    // if pointer/focus already left the picker, the leave-window
    // timer is the gating one; otherwise we wait for leave to fire.
    if (!pickerActive()) {
      if (leaveTimer) clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => {
        leaveTimer = null;
        commitPending();
      }, GRAPH_REMOTE_LEAVE_MS);
    } else if (leaveTimer) {
      // user is back in the picker — cancel any pending leave commit.
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
  });

  // when the user leaves the picker, schedule a short quiet-window
  // commit. re-entering the picker cancels it.
  createEffect(() => {
    const active = pickerActive();
    if (active) {
      if (leaveTimer) {
        clearTimeout(leaveTimer);
        leaveTimer = null;
      }
      return;
    }
    if (pendingRemotes === null) return;
    if (leaveTimer) clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => {
      leaveTimer = null;
      commitPending();
    }, GRAPH_REMOTE_LEAVE_MS);
  });

  onCleanup(clearTimers);

  // helpers for the picker host wrappers below: track pointer + focus
  // presence so the commit can wait until the user actually walks away.
  // `flyoutInside` covers the portalled overflow flyout/modal whose
  // chips live outside the wrapper element.
  let pointerInside = false;
  let focusInside = false;
  let flyoutInside = false;
  const recomputeActive = () => setPickerActive(pointerInside || focusInside || flyoutInside);
  const pickerHostHandlers = {
    onPointerEnter: () => {
      pointerInside = true;
      recomputeActive();
    },
    onPointerLeave: () => {
      pointerInside = false;
      recomputeActive();
    },
    onFocusIn: () => {
      focusInside = true;
      recomputeActive();
    },
    onFocusOut: (e: FocusEvent) => {
      // focusout fires before focusin on the new target — defer so
      // intra-picker focus moves don't briefly drop `focusInside`.
      const host = e.currentTarget as HTMLElement | null;
      queueMicrotask(() => {
        focusInside = !!host && !!document.activeElement && host.contains(document.activeElement);
        recomputeActive();
      });
    },
    onFlyoutActiveChange: (active: boolean) => {
      flyoutInside = active;
      recomputeActive();
    },
  };

  // 9a: in-pane loading indicator that appears immediately on remote switch
  // and escalates to the ConnectionProgressModal after SLOW_SWITCH_MS.
  const [switchingToName, setSwitchingToName] = createSignal<string | null>(null);
  let prevRemoteId: string | null = null;
  let switchTimerRef: ReturnType<typeof setTimeout> | null = null;

  createEffect(() => {
    const newId = selectedRemoteId();
    onCleanup(() => {
      if (switchTimerRef) {
        clearTimeout(switchTimerRef);
        switchTimerRef = null;
      }
    });
    if (prevRemoteId !== null && newId !== null && prevRemoteId !== newId) {
      const stashedPrev = prevRemoteId;
      setSwitchingToName(selectedRemote()?.name ?? null);
      switchTimerRef = setTimeout(async () => {
        switchTimerRef = null;
        setSwitchingToName(null);
        const result = await connectToRemote(newId);
        if (!result.success && !result.cancelled) {
          // remote seems offline — revert selection
          setSelectedRemoteIds(new Set(stashedPrev ? [stashedPrev] : []));
        }
      }, SLOW_SWITCH_MS);
    }
    prevRemoteId = newId;
  });

  // when switching back to the table subview from graph multi-select,
  // narrow the remote set to a single entry so the (single-target)
  // table view isn't confused by multiple selected remotes. preserves
  // whichever the underlying memo picked as the "primary".
  createEffect(() => {
    if (subview() !== "table") return;
    const ids = selectedRemoteIds();
    if (ids.size <= 1) return;
    const primary = selectedRemoteId();
    if (primary) setSelectedRemoteIds(new Set([primary]));
  });

  // selection lifecycle (clear on route change + esc, ctrl/cmd-a select-all).
  // scoped to the table sub-view; the graph view has its own keyboard
  // shortcuts (f / r / esc) and shouldn't surface the album bulk-action
  // bar when the user hits ctrl/cmd-a.
  useAlbumSelectionLifecycle(() => subview() === "table");
  const selectedAlbumIds = useSelectedAlbumIds();

  // p8 page-reload rehydration: whenever the selected remote changes
  // (including the initial mount after a hard refresh), reconnect to
  // any in-flight enrichment jobs the server is currently running.
  // `rehydrateInflightForRemote` is idempotent — duplicate calls for
  // an already-watched remote are no-ops.
  createEffect(() => {
    const remote = selectedRemote();
    if (!remote) return;
    rehydrateInflightForRemote(remote);
  });

  // bulk-action modal state
  const [bulkEditMode, setBulkEditMode] = createSignal<"metadata" | "disc">("metadata");
  const [showBulkEditModal, setShowBulkEditModal] = createSignal(false);
  // snapshot of selected album ids at the moment the modal opens — the
  // modal must NOT be reactive to live selection changes, otherwise an
  // incidental selection-clear (eg. cache invalidation) yanks the modal
  // out from under the user mid-edit. cleared on close.
  const [bulkEditAlbumIds, setBulkEditAlbumIds] = createSignal<string[]>([]);
  const [showTagSelectorModal, setShowTagSelectorModal] = createSignal(false);
  const [tagSelectorAlbumIds, setTagSelectorAlbumIds] = createSignal<string[]>([]);
  // when the tag modal is opened by a graph-lasso bulk-tag flow, the
  // target remote may not be `selectedRemote()` (e.g. we narrowed for
  // bulk-tag but then the user changed selection). pin it explicitly
  // for the duration the modal is open.
  const [tagSelectorRemote, setTagSelectorRemote] = createSignal<Remote | null>(null);

  // ---- admin bulk-tag mode (phase 5) ----------------------------------
  // graph-only, admin-only mode that locks the canvas into lasso and
  // routes lasso completions into the TagSelectorModal. when entering,
  // we narrow the remote selection to a single remote (prefer the
  // currently primary one) so the resulting tags target a single
  // backend unambiguously.
  const [bulkTagMode, setBulkTagMode] = createSignal(false);

  const isRemoteAdmin = useRemoteIsAdmin(selectedRemote);

  const enterBulkTagMode = () => {
    if (!isRemoteAdmin()) return;
    if (subview() !== "graph") return;
    // narrow to a single remote so lasso completions have an
    // unambiguous target. prefer the current primary.
    const primary = selectedRemoteId();
    if (primary && selectedRemoteIds().size > 1) {
      setSelectedRemoteIds(new Set([primary]));
    }
    setBulkTagMode(true);
  };
  const exitBulkTagMode = () => setBulkTagMode(false);
  const toggleBulkTagMode = () => (bulkTagMode() ? exitBulkTagMode() : enterBulkTagMode());

  // auto-exit if admin status is revoked or we leave the graph subview.
  createEffect(() => {
    if (!bulkTagMode()) return;
    if (!isRemoteAdmin() || subview() !== "graph") setBulkTagMode(false);
  });

  // keyboard: `t` toggles bulk-tag mode, `esc` exits, `g` cycles the
  // subview (graph <-> table). only active when the user isn't typing
  // into an input. `t`/`esc` are additionally gated on the graph
  // subview being active + admin.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "g") {
        e.preventDefault();
        setSubview((cur) => (cur === "graph" ? "table" : "graph"));
        return;
      }
      if (subview() !== "graph") return;
      if (e.key === "t") {
        if (!isRemoteAdmin()) return;
        e.preventDefault();
        toggleBulkTagMode();
      } else if (e.key === "Escape" && bulkTagMode()) {
        e.preventDefault();
        exitBulkTagMode();
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  const triggerEnrichment = (albumIds: string[]) => {
    if (albumIds.length === 0) return;
    const remote = selectedRemote();
    if (!remote) return;
    void enqueueAlbumEnrichment(remote, albumIds);
  };

  // phase 14.9 / phase 11 slice 1: enqueue bulk enrichment + open the
  // bulk-review wizard. albums that are already terminally reviewed
  // (`mb_lookup_status='enriched'` / `'skipped'`) are still allowed
  // through so the user can re-open the wizard for one without an
  // intervening toast.
  const triggerReview = (albumIds: string[]) => {
    if (albumIds.length === 0) return;
    const remote = selectedRemote();
    if (!remote) return;
    void startBulkEnrichmentReview(remote, albumIds);
  };

  // bulk "mark done": flips `mb_lookup_status='enriched'` on every
  // selected album without going through the review wizard. used when
  // the user has already curated the metadata externally (or just
  // wants the row off the "needs review" pile).
  const markSelectedDone = async (albumIds: string[]) => {
    if (albumIds.length === 0) return;
    const remote = selectedRemote();
    if (!remote) return;
    let client;
    try {
      client = await getClientForRemote(remote);
    } catch (err) {
      toast.error(`failed to reach remote: ${(err as Error).message}`);
      return;
    }
    let ok = 0;
    let failed = 0;
    for (const id of albumIds) {
      try {
        const resp = await client.music.setMbLookupStatus({
          album_id: id,
          status: "enriched",
        });
        if (resp.success) ok += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    void queryClient.invalidateQueries({
      queryKey: ["library-albums", remote.remote_id],
    });
    if (failed > 0) {
      toast.error(`marked ${ok} done, ${failed} failed`);
    } else {
      toast.success(`marked ${ok} album${ok === 1 ? "" : "s"} done`);
    }
  };

  // bulk skip: flips `mb_lookup_status='skipped'` on selected albums
  // so they are excluded from future bulk lookups.
  const skipSelected = async (albumIds: string[]) => {
    if (albumIds.length === 0) return;
    const remote = selectedRemote();
    if (!remote) return;
    let client;
    try {
      client = await getClientForRemote(remote);
    } catch (err) {
      toast.error(`failed to reach remote: ${(err as Error).message}`);
      return;
    }
    let ok = 0;
    let failed = 0;
    for (const id of albumIds) {
      try {
        const resp = await client.music.setMbLookupStatus({ album_id: id, status: "skipped" });
        if (resp.success) ok += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    void queryClient.invalidateQueries({ queryKey: ["library-albums", remote.remote_id] });
    if (failed > 0) toast.error(`skipped ${ok}, ${failed} failed`);
    else toast.success(`skipped ${ok} album${ok === 1 ? "" : "s"} from future lookups`);
  };

  // bulk un-skip: resets `mb_lookup_status='not_attempted'` for albums
  // that were previously skipped, re-entering them into the lookup queue.
  const unskipSelected = async (albumIds: string[]) => {
    if (albumIds.length === 0) return;
    const remote = selectedRemote();
    if (!remote) return;
    let client;
    try {
      client = await getClientForRemote(remote);
    } catch (err) {
      toast.error(`failed to reach remote: ${(err as Error).message}`);
      return;
    }
    let ok = 0;
    let failed = 0;
    for (const id of albumIds) {
      try {
        const resp = await client.music.setMbLookupStatus({
          album_id: id,
          status: "not_attempted",
        });
        if (resp.success) ok += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    void queryClient.invalidateQueries({ queryKey: ["library-albums", remote.remote_id] });
    if (failed > 0) toast.error(`un-skipped ${ok}, ${failed} failed`);
    else
      toast.success(
        `un-skipped ${ok} album${ok === 1 ? "" : "s"} — they'll appear in future lookups`
      );
  };

  // header cluster (mb progress strip + remote picker + view switcher).
  // in graph mode this floats over the canvas like the topnav; in
  // table mode it takes its own row above the body.
  const headerCluster = (
    <>
      <div class="flex items-center gap-2">
        <MbProgressStrip />
      </div>

      <div class="flex items-center gap-3 flex-wrap">
        {/* remote picker — multi-select in graph subview so the user
         *  can fan a single graph out across remotes; single-select in
         *  the table subview (table writes go to one remote). bulk-tag
         *  mode also forces single so lasso targets are unambiguous. */}
        <Show when={(remotes() ?? []).length > 0}>
          <div
            onPointerEnter={pickerHostHandlers.onPointerEnter}
            onPointerLeave={pickerHostHandlers.onPointerLeave}
            onFocusIn={pickerHostHandlers.onFocusIn}
            onFocusOut={pickerHostHandlers.onFocusOut}
          >
            <RemotePicker
              remotes={remotes() ?? []}
              value={selectedRemoteIds()}
              onChange={setSelectedRemoteIds}
              mode={subview() === "graph" && !bulkTagMode() ? "multi" : "single"}
              layout="inline"
              onActiveChange={pickerHostHandlers.onFlyoutActiveChange}
            />
          </div>
        </Show>

        {/* view switcher — segmented control on wide; single icon
         *  toggle on narrow (clicking flips to the other subview).
         *  the narrow variant shows the *target* icon so the affordance
         *  reads as "switch to X" rather than "currently X". */}
        <Show
          when={!isNarrow()}
          fallback={(() => {
            const other = () => SUBVIEWS.find((s) => s.id !== subview())!;
            return (
              <button
                type="button"
                class="inline-flex items-center justify-center p-2 rounded-md bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] cursor-pointer"
                title={`switch to ${other().label}`}
                aria-label={`switch to ${other().label}`}
                onClick={() => setSubview(other().id)}
              >
                <Icon name={other().icon} size={14} />
              </button>
            );
          })()}
        >
          <div
            class="inline-flex items-center gap-1 p-1 rounded-md bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)]"
            role="tablist"
            aria-label="library view"
          >
            {SUBVIEWS.map((opt) => (
              <button
                type="button"
                role="tab"
                aria-selected={subview() === opt.id}
                class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors border-none cursor-pointer"
                classList={{
                  "bg-[var(--color-accent-500)]/15 text-[var(--color-accent-500)]":
                    subview() === opt.id,
                  "bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]":
                    subview() !== opt.id,
                }}
                onClick={() => setSubview(opt.id)}
              >
                <Icon name={opt.icon} size={12} />
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </Show>
      </div>
    </>
  );

  // narrow-mode topnav: relocate the remote picker + subview toggle
  // into the topnav's rightContent slot. on wide we leave the slot
  // untouched (graph subview manages it; table subview leaves it
  // empty). this runs as parent's createEffect — parent effects fire
  // before child effects on initial mount, so when graph subview
  // mounts and runs its own slot effect afterwards it will skip
  // rightContent on narrow (see LibraryGraphSubview).
  createEffect(() => {
    if (!isNarrow()) {
      // wide: relinquish the slot so the graph subview can claim it.
      slots.setRightContent(undefined);
      return;
    }
    const other = SUBVIEWS.find((s) => s.id !== subview())!;
    slots.setRightContent(
      <div class="flex items-center gap-2 flex-wrap">
        <Show when={(remotes() ?? []).length > 0}>
          <div
            onPointerEnter={pickerHostHandlers.onPointerEnter}
            onPointerLeave={pickerHostHandlers.onPointerLeave}
            onFocusIn={pickerHostHandlers.onFocusIn}
            onFocusOut={pickerHostHandlers.onFocusOut}
          >
            <RemotePicker
              remotes={remotes() ?? []}
              value={selectedRemoteIds()}
              onChange={setSelectedRemoteIds}
              mode={subview() === "graph" && !bulkTagMode() ? "multi" : "single"}
              layout="inline"
              onActiveChange={pickerHostHandlers.onFlyoutActiveChange}
            />
          </div>
        </Show>
        <button
          type="button"
          class="inline-flex items-center justify-center p-2 rounded-md bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] cursor-pointer"
          title={`switch to ${other.label}`}
          aria-label={`switch to ${other.label}`}
          onClick={() => setSubview(other.id)}
        >
          <Icon name={other.icon} size={14} />
        </button>
      </div>
    );
  });

  return (
    <div class="flex flex-col h-full">
      {/* header — leaves room on the left for the floating topnav button.
       *  in graph mode the cluster is rendered as an overlay inside the
       *  subview body instead (see below) so the canvas reaches full
       *  height. on narrow viewports the entire cluster lives in the
       *  topnav (see createEffect below) so neither in-pane variant
       *  renders. */}
      <Show when={subview() !== "graph" && !isNarrow()}>
        <div class="flex items-center justify-end gap-4 px-4 pt-3 pb-2 wide:pl-[140px] flex-wrap">
          {headerCluster}
        </div>
      </Show>

      {/* 9a: in-pane indicator while the first query for a new remote is
       *  in-flight. clears itself via onDataReady below or after the
       *  connection modal escalates and succeeds. */}
      <Show when={switchingToName()}>
        <div class="flex items-center gap-2 px-4 py-2 text-xs text-[var(--color-text-secondary)] border-b border-[var(--color-border-subtle)]">
          <div class="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
          switching to {switchingToName()}…
        </div>
      </Show>

      {/* subview body */}
      <div class="flex-1 min-h-0 overflow-hidden relative">
        {/* graph-mode floating header — sits over the canvas like the
         *  topnav, freeing the full pane for the graph itself. on
         *  narrow viewports the cluster has been promoted into the
         *  topnav itself, so we skip the overlay. */}
        <Show when={subview() === "graph" && !isNarrow()}>
          <div class="absolute top-2 right-3 z-20 flex items-center justify-end gap-4 flex-wrap max-w-[calc(100%-1rem)] pointer-events-auto">
            {headerCluster}
          </div>
        </Show>
        <Switch>
          <Match when={subview() === "graph"}>
            <LibraryGraphSubview
              remotes={debouncedSelectedRemotes()}
              isActive={() => subview() === "graph"}
              bulkTagMode={bulkTagMode}
              onLassoAlbums={(remote, ids) => {
                if (ids.length === 0) return;
                setTagSelectorRemote(remote);
                setTagSelectorAlbumIds(ids);
                setShowTagSelectorModal(true);
              }}
              /* note: the top-nav `tag` button is now the tag filter
                 picker (rendered inside LibraryGraphSubview). admins
                 still enter the lasso bulk-tag flow with the `t`
                 keyboard shortcut (`esc` exits). */
            />
          </Match>
          <Match when={subview() === "table"}>
            <TablePlaceholder
              remote={selectedRemote()}
              onEnrichAllMatching={triggerEnrichment}
              onDataReady={() => setSwitchingToName(null)}
            />
          </Match>
        </Switch>
        {/* bulk-action bar belongs to the table sub-view; hide it on
            graph so a leftover selection (e.g. from a prior table
            session) doesn't pop the toolbar over the canvas. */}
        <Show when={subview() === "table"}>
          <AlbumBulkActionBar
            isAdmin={isRemoteAdmin()}
            onEnrich={() => triggerEnrichment(selectedAlbumIds())}
            onReview={() => triggerReview(selectedAlbumIds())}
            onMarkDone={() => void markSelectedDone(selectedAlbumIds())}
            onEditMetadata={() => {
              const ids = selectedAlbumIds();
              if (ids.length === 0) return;
              setBulkEditAlbumIds(ids);
              setBulkEditMode("metadata");
              setShowBulkEditModal(true);
            }}
            onSetDiscNumber={() => {
              const ids = selectedAlbumIds();
              if (ids.length === 0) return;
              setBulkEditAlbumIds(ids);
              setBulkEditMode("disc");
              setShowBulkEditModal(true);
            }}
            onManageTags={() => {
              const ids = selectedAlbumIds();
              if (ids.length === 0) return;
              setTagSelectorAlbumIds(ids);
              setShowTagSelectorModal(true);
            }}
            onSkip={() => void skipSelected(selectedAlbumIds())}
            onUnskip={() => void unskipSelected(selectedAlbumIds())}
          />
        </Show>
      </div>

      {/* bulk edit albums modal — wrapped in Show so it remounts fresh
          (clears prior form state) for each open. modal-visibility only
          depends on `showBulkEditModal` + remote presence — NOT on the
          live selection — because cache invalidations etc. can clear
          selection mid-edit and we don't want that to dismiss the modal. */}
      <Show when={showBulkEditModal() && selectedRemote() && bulkEditAlbumIds().length > 0}>
        <BulkEditAlbumsModal
          isOpen={true}
          onClose={() => {
            setShowBulkEditModal(false);
            setBulkEditAlbumIds([]);
          }}
          albumIds={bulkEditAlbumIds()}
          remote={selectedRemote()!}
          mode={bulkEditMode()}
          onSuccess={() => {
            void queryClient.invalidateQueries({
              queryKey: ["library-albums", selectedRemote()!.remote_id],
            });
          }}
        />
      </Show>

      {/* tag selector modal — shared by table bulk-edit AND graph
          lasso bulk-tag flows. when opened from the lasso flow we pin
          the target remote via `tagSelectorRemote` so changing the
          picker mid-edit doesn't yank the modal's backend out from
          under it. */}
      <Show
        when={
          showTagSelectorModal() &&
          (tagSelectorRemote() ?? selectedRemote()) &&
          tagSelectorAlbumIds().length > 0
        }
      >
        <TagSelectorModal
          albumIds={tagSelectorAlbumIds()}
          remote={(tagSelectorRemote() ?? selectedRemote())!}
          onClose={() => {
            setShowTagSelectorModal(false);
            setTagSelectorAlbumIds([]);
            setTagSelectorRemote(null);
          }}
          onSave={() => {
            const r = tagSelectorRemote() ?? selectedRemote();
            if (!r) return;
            void queryClient.invalidateQueries({
              queryKey: ["library-albums", r.remote_id],
            });
          }}
        />
      </Show>
    </div>
  );
}

function TablePlaceholder(props: {
  remote: Remote | undefined;
  onEnrichAllMatching?: (ids: string[]) => void;
  onDataReady?: () => void;
}) {
  return (
    <Show
      when={props.remote}
      fallback={
        <div
          class="h-full flex items-center justify-center text-[var(--color-text-disabled)] text-xs"
          data-testid="library-table-placeholder"
        >
          <span>select a remote to load albums</span>
        </div>
      }
    >
      {(r) => (
        <AlbumsTable
          remote={r()}
          onEnrichAllMatching={props.onEnrichAllMatching}
          onDataReady={props.onDataReady}
        />
      )}
    </Show>
  );
}
