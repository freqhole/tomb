// station "queue" tab for the radio detail panel - lists pending
// member-submitted requests for a station (see grimoire's
// crate::radio::requests), sitting alongside RadioHistoryList.tsx's
// "history" tab. row layout mirrors RadioHistoryList's rows exactly, but
// the thumbnail shows this item's position in the queue (MediaThumbnail's
// `index` overlay, same as the player queue/playlist rows) instead of a
// played-at timestamp. any authenticated user (not just admins) may
// remove a single request or clear the whole queue.
//
// the actual list/remove/clear logic lives in
// components/radio/useRadioRequestQueue.ts, shared with the sidebar's own
// live request-queue section - this file is purely the rendering for
// this specific tab's layout.
import { createSignal, For, Show } from "solid-js";
import type { RemoteRef } from "../../app/services/storage/types";
import { useRadioRequestQueue } from "../../components/radio/useRadioRequestQueue";
import { MediaThumbnail } from "../../components/media/MediaThumbnail";
import { Icon } from "../../components/icons/registry";

interface RadioQueueListProps {
  stationId: string;
  /** ad-hoc reference the api client can dial regardless of whether this
   *  source has ever been saved as a full remote (see radioDiscovery.ts's
   *  `sourceToRemoteRef` - the same helper station discovery itself uses).
   *  unlike a saved `Remote` row, this always resolves, including for a
   *  self-hosted station or a not-yet-saved pending/query_param source. */
  remoteRef: RemoteRef;
  /** real, persisted remote_id - only used for thumbnail resolution
   *  (`resolveBlobUrl` needs a saved remote row to look up blob
   *  transport). `undefined` when no saved row exists yet; thumbnails
   *  just fall back to the icon in that case. */
  remoteId?: string;
}

export function RadioQueueList(props: RadioQueueListProps) {
  const queue = useRadioRequestQueue({
    stationId: () => props.stationId,
    remoteRef: () => props.remoteRef,
    remoteId: () => props.remoteId,
  });
  const [confirmingClear, setConfirmingClear] = createSignal(false);

  const handleClearClick = () => {
    if (!confirmingClear()) {
      setConfirmingClear(true);
      setTimeout(() => setConfirmingClear(false), 4000);
      return;
    }
    setConfirmingClear(false);
    void queue.handleClear();
  };

  const formatDuration = (ms: number | null) => {
    if (!ms) return null;
    const totalSeconds = Math.round(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div class="flex flex-col gap-2 w-full">
      <header class="flex items-center justify-between px-1">
        <div class="text-xs uppercase tracking-wide text-neutral-500">
          queue
          <Show when={queue.rows().length > 0}>
            <span class="ml-2 text-neutral-600 normal-case">{queue.rows().length}</span>
          </Show>
        </div>
        <Show when={queue.rows().length > 0}>
          <button
            class="text-xs px-2 py-0.5 rounded border border-neutral-700 hover:border-neutral-500 hover:bg-neutral-800"
            classList={{ "border-red-600 text-red-400": confirmingClear() }}
            onClick={handleClearClick}
          >
            {confirmingClear() ? "click again to confirm" : "clear all"}
          </button>
        </Show>
      </header>

      <Show
        when={queue.rows().length > 0}
        fallback={
          <div class="text-sm text-neutral-500 px-1 py-4">
            <Show when={!queue.loading()} fallback={<span>loading…</span>}>
              no requests queued yet.
            </Show>
          </div>
        }
      >
        <ul class="flex flex-col gap-1">
          <For each={queue.rows()}>
            {(row, i) => (
              <li class="flex items-center gap-3 p-2 rounded hover:bg-neutral-900/50">
                <MediaThumbnail
                  thumbnailUrl={queue.thumbUrls()[row.id] ?? null}
                  index={i()}
                  showPlayIcon={false}
                  enablePlayClick={false}
                  cornerBadgeIcon={row.kind === "video" ? "video" : undefined}
                  size={40}
                />
                <div class="flex-1 min-w-0">
                  <div class="text-sm truncate">{row.title}</div>
                  <div class="text-xs text-neutral-400 truncate">
                    {row.artist ?? "unknown artist"}
                    <Show when={row.album}> — {row.album}</Show>
                  </div>
                </div>
                <div class="flex-shrink-0 text-xs text-neutral-500 text-right">
                  <Show when={formatDuration(row.durationMs)}>{(d) => <div>{d()}</div>}</Show>
                </div>
                <button
                  class="flex-shrink-0 p-1.5 text-neutral-500 hover:text-red-400 hover:bg-red-500/20 rounded transition-colors"
                  onClick={() => void queue.handleRemove(row.id)}
                  title="remove from queue"
                  aria-label="remove from queue"
                >
                  <Icon name="close" size={14} />
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
