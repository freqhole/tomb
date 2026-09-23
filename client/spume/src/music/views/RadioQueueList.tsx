// station "queue" tab for the radio detail panel - lists pending
// member-submitted requests for a station (see grimoire's
// crate::radio::requests), sitting alongside RadioHistoryList.tsx's
// "history" tab. row layout mirrors RadioHistoryList's rows exactly, but
// the thumbnail shows this item's position in the queue (MediaThumbnail's
// `index` overlay, same as the player queue/playlist rows) instead of a
// played-at timestamp. any authenticated user (not just admins) may
// remove a single request or clear the whole queue.

import { createEffect, createSignal, For, on, Show } from "solid-js";
import { getClientForRemote } from "../../app/api/client";
import type { RemoteRef } from "../../app/services/storage/types";
import { resolveBlobUrl } from "../services/storage/blobResolver";
import { MediaThumbnail } from "../../components/media/MediaThumbnail";
import { Icon } from "../../components/icons/registry";
import { toast } from "../../components/feedback/Toast";
import { debug, warn } from "../../utils/logger";

interface QueuedRequestRow {
  id: string;
  kind: string;
  itemId: string;
  requestedBy: string;
  title: string;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
  artBlobId: string | null;
}

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
  const [rows, setRows] = createSignal<QueuedRequestRow[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [confirmingClear, setConfirmingClear] = createSignal(false);
  const [thumbUrls, setThumbUrls] = createSignal<Record<string, string>>({});
  const resolvingThumbIds = new Set<string>();

  const load = async () => {
    if (!props.stationId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const client = await getClientForRemote(props.remoteRef);
      const result = await client.app.radioListRequests({ station_id: props.stationId });
      if (!result.success) {
        warn("radio-queue", "failed to list requests:", result.error.issues[0]?.message);
        setRows([]);
        return;
      }
      setRows(
        result.data.requests.map((r) => ({
          id: r.id,
          kind: r.kind,
          itemId: r.item_id,
          requestedBy: r.requested_by,
          title: r.title,
          artist: r.artist ?? null,
          album: r.album ?? null,
          durationMs: r.duration_ms ?? null,
          artBlobId: r.art_blob_id ?? null,
        }))
      );
    } catch (err) {
      debug("radio-queue", "failed to load queue:", err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  createEffect(
    on(
      () =>
        [
          props.stationId,
          props.remoteRef.remote_id,
          props.remoteRef.peer_addr,
          props.remoteRef.base_url,
          props.remoteRef.is_charnel_managed,
        ] as const,
      () => void load(),
      { defer: false }
    )
  );

  createEffect(
    on(
      rows,
      (currentRows) => {
        const remoteId = props.remoteId;
        if (!remoteId) return;
        for (const row of currentRows) {
          if (!row.artBlobId || thumbUrls()[row.id] || resolvingThumbIds.has(row.id)) continue;
          resolvingThumbIds.add(row.id);
          void (async () => {
            try {
              const url = await resolveBlobUrl(row.artBlobId!, remoteId, "image", undefined, 50);
              setThumbUrls((prev) => ({ ...prev, [row.id]: url }));
            } catch (err) {
              debug("radio-queue", "failed to resolve queue art blob:", err);
            } finally {
              resolvingThumbIds.delete(row.id);
            }
          })();
        }
      },
      { defer: true }
    )
  );

  const handleRemove = async (row: QueuedRequestRow) => {
    // optimistic removal - queue management should feel instant.
    const previous = rows();
    setRows(previous.filter((r) => r.id !== row.id));
    try {
      const client = await getClientForRemote(props.remoteRef);
      const result = await client.app.radioRemoveRequest({
        station_id: props.stationId,
        request_id: row.id,
      });
      if (!result.success) {
        setRows(previous);
        toast.error(result.error.issues[0]?.message || "failed to remove request");
      }
    } catch (err) {
      setRows(previous);
      toast.error(`failed to remove request: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleClear = async () => {
    if (!confirmingClear()) {
      setConfirmingClear(true);
      setTimeout(() => setConfirmingClear(false), 4000);
      return;
    }
    setConfirmingClear(false);
    const previous = rows();
    setRows([]);
    try {
      const client = await getClientForRemote(props.remoteRef);
      const result = await client.app.radioClearRequests({ station_id: props.stationId });
      if (!result.success) {
        setRows(previous);
        toast.error(result.error.issues[0]?.message || "failed to clear queue");
      }
    } catch (err) {
      setRows(previous);
      toast.error(`failed to clear queue: ${err instanceof Error ? err.message : String(err)}`);
    }
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
          <Show when={rows().length > 0}>
            <span class="ml-2 text-neutral-600 normal-case">{rows().length}</span>
          </Show>
        </div>
        <Show when={rows().length > 0}>
          <button
            class="text-xs px-2 py-0.5 rounded border border-neutral-700 hover:border-neutral-500 hover:bg-neutral-800"
            classList={{ "border-red-600 text-red-400": confirmingClear() }}
            onClick={() => void handleClear()}
          >
            {confirmingClear() ? "click again to confirm" : "clear all"}
          </button>
        </Show>
      </header>

      <Show
        when={rows().length > 0}
        fallback={
          <div class="text-sm text-neutral-500 px-1 py-4">
            <Show when={!loading()} fallback={<span>loading…</span>}>
              no requests queued yet.
            </Show>
          </div>
        }
      >
        <ul class="flex flex-col gap-1">
          <For each={rows()}>
            {(row, i) => (
              <li class="flex items-center gap-3 p-2 rounded hover:bg-neutral-900/50">
                <MediaThumbnail
                  thumbnailUrl={thumbUrls()[row.id] ?? null}
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
                  onClick={() => void handleRemove(row)}
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
