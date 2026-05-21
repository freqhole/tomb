// library view — top-level view for the music library across all remotes.
// hosts the upcoming albums force-graph viz + data-table.
//
// phase 1 scope: route shell + view switcher.
// phase 2: remote picker (single-select) wired to a `selectedRemoteId`
//          signal that subviews can read.

import { createEffect, createSignal, Match, onCleanup, Show, Switch } from "solid-js";
import { Icon } from "../../components/icons/registry";
import { RemotePicker } from "../../components/forms/RemotePicker";
import { useRemoteSelection } from "../../components/forms/useRemoteSelection";
import { AlbumsTable } from "../components/AlbumsTable";
import { AlbumBulkActionBar } from "../components/AlbumBulkActionBar";
import { MbProgressStrip } from "../components/MbProgressStrip";
import { useAlbumSelectionLifecycle, useSelectedAlbumIds } from "../hooks/albumSelection";
import { useRemoteIsAdmin } from "../hooks/useRemoteRole";
import { enqueueAlbumEnrichment } from "../hooks/useMbLookupJobs";
import { startBulkEnrichmentReview } from "../../music/hooks/bulkEnrichmentReview";
import { getClientForRemote } from "../../app/api/client";
import { connectToRemote } from "../../app/services/remotes/connectionProgress";
import { queryClient } from "../../queryClient";
import { toast } from "../../components/feedback/Toast";
import { BulkEditAlbumsModal } from "../../components/modals/BulkEditAlbumsModal";
import { TagSelectorModal } from "../../components/modals/TagSelectorModal";
import type { Remote } from "../../app/services/storage/schemas/remote";

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
  const [subview, setSubview] = createSignal<LibrarySubview>("table");

  // view-local remote selection (encapsulates resource + default effect + memos)
  const { remotes, selectedRemoteIds, setSelectedRemoteIds, selectedRemoteId, selectedRemote } =
    useRemoteSelection();

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

  // selection lifecycle (clear on route change + esc, ctrl/cmd-a select-all).
  useAlbumSelectionLifecycle();
  const selectedAlbumIds = useSelectedAlbumIds();

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

  const isRemoteAdmin = useRemoteIsAdmin(selectedRemote);

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

  return (
    <div class="flex flex-col h-full">
      {/* header — leaves room on the left for the floating topnav button */}
      <div class="flex items-center justify-end gap-4 px-4 pt-3 pb-2 wide:pl-[140px] flex-wrap">
        <div class="flex items-center gap-2">
          <MbProgressStrip />
        </div>

        <div class="flex items-center gap-3 flex-wrap">
          {/* remote picker (single-select for phase 2) */}
          <Show when={(remotes() ?? []).length > 0}>
            <RemotePicker
              remotes={remotes() ?? []}
              value={selectedRemoteIds()}
              onChange={setSelectedRemoteIds}
              mode="single"
              layout="inline"
            />
          </Show>

          {/* view switcher */}
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
        </div>
      </div>

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
        <Switch>
          <Match when={subview() === "graph"}>
            <GraphPlaceholder />
          </Match>
          <Match when={subview() === "table"}>
            <TablePlaceholder
              remote={selectedRemote()}
              onEnrichAllMatching={triggerEnrichment}
              onDataReady={() => setSwitchingToName(null)}
            />
          </Match>
        </Switch>
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

      {/* tag selector modal */}
      <Show when={showTagSelectorModal() && selectedRemote() && tagSelectorAlbumIds().length > 0}>
        <TagSelectorModal
          albumIds={tagSelectorAlbumIds()}
          remote={selectedRemote()!}
          onClose={() => {
            setShowTagSelectorModal(false);
            setTagSelectorAlbumIds([]);
          }}
          onSave={() => {
            void queryClient.invalidateQueries({
              queryKey: ["library-albums", selectedRemote()!.remote_id],
            });
          }}
        />
      </Show>
    </div>
  );
}

function GraphPlaceholder() {
  return (
    <div class="flex flex-col items-center justify-center h-full gap-2 text-[var(--color-text-disabled)]">
      <Icon name="share" size={32} />
      <p class="text-sm m-0">graph viz coming soon</p>
      <p class="text-xs m-0">force-directed albums graph driven by folksonomy tags</p>
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
