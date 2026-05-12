// library view — top-level view for the music library across all remotes.
// hosts the upcoming albums force-graph viz + data-table.
//
// phase 1 scope: route shell + view switcher.
// phase 2: remote picker (single-select) wired to a `selectedRemoteId`
//          signal that subviews can read.

import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  Match,
  Show,
  Switch,
} from "solid-js";
import { Icon } from "../../components/icons/registry";
import { RemotePicker } from "../../components/forms/RemotePicker";
import { AlbumsTable } from "../components/AlbumsTable";
import { AlbumBulkActionBar } from "../components/AlbumBulkActionBar";
import { MbProgressStrip } from "../components/MbProgressStrip";
import { useAlbumSelectionLifecycle, useSelectedAlbumIds } from "../hooks/albumSelection";
import { useRemoteIsAdmin } from "../hooks/useRemoteRole";
import { enqueueAlbumEnrichment } from "../hooks/useMbLookupJobs";
import { startBulkEnrichmentReview } from "../../music/hooks/bulkEnrichmentReview";
import { getAllRemotes } from "../../app/services/remotes/remoteManager";
import { getClientForRemote } from "../../app/api/client";
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

export function LibraryView() {
  const [subview, setSubview] = createSignal<LibrarySubview>("table");
  const [remotes] = createResource(getAllRemotes);

  // single-select remote for phase 2; expand to multi later.
  const [selectedRemoteIds, setSelectedRemoteIds] = createSignal<Set<string>>(new Set());

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

  // pick a sensible default once remotes load (first non-offline, else first).
  createEffect(() => {
    const r = remotes();
    if (!r || r.length === 0) return;
    if (selectedRemoteIds().size > 0) return;
    const preferred = r.find((rem) => !rem.is_offline) ?? r[0];
    setSelectedRemoteIds(new Set([preferred.remote_id]));
  });

  const selectedRemoteId = createMemo<string | null>(() => {
    const ids = [...selectedRemoteIds()];
    return ids[0] ?? null;
  });

  const selectedRemote = createMemo<Remote | undefined>(() => {
    const id = selectedRemoteId();
    if (!id) return undefined;
    return (remotes() ?? []).find((r) => r.remote_id === id);
  });

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

  return (
    <div class="flex flex-col h-full">
      {/* header — leaves room on the left for the floating topnav button */}
      <div class="flex items-center justify-between gap-4 px-4 pt-3 pb-2 wide:pl-[140px] flex-wrap">
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

      {/* subview body */}
      <div class="flex-1 min-h-0 overflow-hidden relative">
        <Switch>
          <Match when={subview() === "graph"}>
            <GraphPlaceholder />
          </Match>
          <Match when={subview() === "table"}>
            <TablePlaceholder remote={selectedRemote()} onEnrichAllMatching={triggerEnrichment} />
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
      {(r) => <AlbumsTable remote={r()} onEnrichAllMatching={props.onEnrichAllMatching} />}
    </Show>
  );
}
