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
import { enqueueMbLookup } from "../hooks/useMbLookupJobs";
import { getAllRemotes } from "../../app/services/remotes/remoteManager";
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

  const triggerMbLookup = (albumIds: string[]) => {
    if (albumIds.length === 0) return;
    const remote = selectedRemote();
    if (!remote) return;
    void enqueueMbLookup(remote, albumIds);
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
            <TablePlaceholder remote={selectedRemote()} onMbLookupAllMatching={triggerMbLookup} />
          </Match>
        </Switch>
        <AlbumBulkActionBar
          isAdmin={isRemoteAdmin()}
          onMbLookup={() => triggerMbLookup(selectedAlbumIds())}
        />
      </div>
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
  onMbLookupAllMatching?: (ids: string[]) => void;
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
      {(r) => <AlbumsTable remote={r()} onMbLookupAllMatching={props.onMbLookupAllMatching} />}
    </Show>
  );
}
