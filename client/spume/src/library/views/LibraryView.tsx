// explore view — top-level view for browsing the music library across all remotes.
// hosts the albums force-graph with lasso-driven bulk-tag mode.

import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { useRemoteSelection } from "../../components/forms/useRemoteSelection";
import { useRemoteIsAdmin } from "../hooks/useRemoteRole";
import { queryClient } from "../../queryClient";
import { TagSelectorModal } from "../../components/modals/TagSelectorModal";
import { LibraryGraphSubview } from "./graph/LibraryGraphSubview";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { useTopNavSlots } from "../../app/shell/topNavSlots";

export function ExploreView() {
  const slots = useTopNavSlots();

  // remote selection — provides remotes list for the graph subview and
  // selection state for bulk-tag mode.
  const { remotes, selectedRemoteIds, setSelectedRemoteIds, selectedRemoteId, selectedRemote } =
    useRemoteSelection();

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

  // auto-exit if admin status is revoked.
  createEffect(() => {
    if (!bulkTagMode()) return;
    if (!isRemoteAdmin()) setBulkTagMode(false);
  });

  // keyboard: `t` toggles bulk-tag mode, `esc` exits. only active when the
  // user isn't typing into an input. gated on admin.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
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

  // clear the topnav slot on mount and unmount; the graph subview
  // manages its own slot content on wide viewports.
  onMount(() => {
    slots.setRightContent(undefined);
    onCleanup(() => slots.setRightContent(undefined));
  });

  return (
    <div class="flex flex-col h-full">
      <div class="flex-1 min-h-0 overflow-hidden relative">
        <LibraryGraphSubview
          remotes={remotes() ?? []}
          isActive={() => true}
          bulkTagMode={bulkTagMode}
          onLassoAlbums={(remote, ids) => {
            if (ids.length === 0) return;
            setTagSelectorRemote(remote);
            setTagSelectorAlbumIds(ids);
            setShowTagSelectorModal(true);
          }}
        />
      </div>

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
