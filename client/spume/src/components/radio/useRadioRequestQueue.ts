// shared data/logic layer behind every "station request queue" UI -
// list/remove/clear/reorder + thumbnail resolution. extracted from
// RadioQueueList.tsx (the radio detail panel's own "queue" tab) so a
// second UI - the sidebar's live request-queue section (see
// client/spume/src/components/player/QueueSidebar.tsx) - can reuse the
// exact same battle-tested logic instead of duplicating it. both UIs
// stay independently mountable; this hook owns no rendering at all.
//
// props are all accessors, not plain values - unlike a genuine Solid
// component's own `props` (automatically reactive via Solid's proxy),
// this hook is called directly (not via JSX) from non-component call
// sites too (AppLayout.tsx's sidebar wiring), where a plain-object
// literal would freeze every field at whatever it was the one time this
// hook is invoked and never update again. accessors keep both call
// styles (a genuine component wrapping its own reactive props in
// `() => props.x`, or a plain reactive signal) working identically.
import { createEffect, createSignal, on, type Accessor } from "solid-js";
import { getClientForRemote } from "../../app/api/client";
import type { RemoteRef } from "../../app/services/storage/types";
import { resolveBlobUrl } from "../../music/services/storage/blobResolver";
import { toast } from "../feedback/Toast";
import { debug, warn } from "../../utils/logger";

export interface RadioRequestRow {
  id: string;
  kind: string;
  itemId: string;
  requestedBy: string;
  /** resolved display name for `requestedBy` - `null` only if that
   *  user's account has since been deleted. */
  requestedByUsername: string | null;
  title: string;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
  artBlobId: string | null;
}

export interface UseRadioRequestQueueProps {
  stationId: Accessor<string | null | undefined>;
  /** ad-hoc reference the api client can dial regardless of whether this
   *  source has ever been saved as a full remote (see radioDiscovery.ts's
   *  `sourceToRemoteRef` - the same helper station discovery itself uses).
   *  unlike a saved `Remote` row, this always resolves, including for a
   *  self-hosted station or a not-yet-saved pending/query_param source. */
  remoteRef: Accessor<RemoteRef>;
  /** real, persisted remote_id - only used for thumbnail resolution
   *  (`resolveBlobUrl` needs a saved remote row to look up blob
   *  transport). `undefined` when no saved row exists yet; thumbnails
   *  just fall back to the icon in that case. */
  remoteId?: Accessor<string | undefined>;
}

export function useRadioRequestQueue(props: UseRadioRequestQueueProps) {
  const [rows, setRows] = createSignal<RadioRequestRow[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [thumbUrls, setThumbUrls] = createSignal<Record<string, string>>({});
  const resolvingThumbIds = new Set<string>();

  const load = async () => {
    const stationId = props.stationId();
    if (!stationId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const client = await getClientForRemote(props.remoteRef());
      const result = await client.app.radioListRequests({ station_id: stationId });
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
          requestedByUsername: r.requested_by_username ?? null,
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

  // guarded against `remoteRef()` being reactively re-derived to an
  // EQUAL-BY-VALUE but freshly-allocated object upstream (e.g. a station-
  // list refresh recomputing the station this panel is for) - without
  // this, every such incidental re-render refetches the whole queue from
  // the server and replaces every row's object identity, which `<For>`
  // then treats as an entirely new list - a "queue blinks" symptom with
  // nothing actually having changed.
  createEffect(
    on(
      () => {
        const ref = props.remoteRef();
        return [
          props.stationId(),
          ref.remote_id,
          ref.peer_addr,
          ref.base_url,
          ref.is_charnel_managed,
        ] as const;
      },
      (deps, prevDeps) => {
        if (prevDeps && deps.every((v, i) => v === prevDeps[i])) return;
        void load();
      },
      { defer: false }
    )
  );

  createEffect(
    on(
      rows,
      (currentRows) => {
        const remoteId = props.remoteId?.();
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

  const handleRemove = async (requestId: string) => {
    const stationId = props.stationId();
    if (!stationId) return;
    // optimistic removal - queue management should feel instant.
    const previous = rows();
    setRows(previous.filter((r) => r.id !== requestId));
    try {
      const client = await getClientForRemote(props.remoteRef());
      const result = await client.app.radioRemoveRequest({
        station_id: stationId,
        request_id: requestId,
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
    const stationId = props.stationId();
    if (!stationId) return;
    const previous = rows();
    setRows([]);
    try {
      const client = await getClientForRemote(props.remoteRef());
      const result = await client.app.radioClearRequests({ station_id: stationId });
      if (!result.success) {
        setRows(previous);
        toast.error(result.error.issues[0]?.message || "failed to clear queue");
      }
    } catch (err) {
      setRows(previous);
      toast.error(`failed to clear queue: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /** moves one request to `newIndex` (clamped server-side) - same
   *  optimistic-then-confirm shape as `handleRemove`/`handleClear`. used
   *  by a drag-reorder gesture on the sidebar's row list. */
  const handleReorder = async (requestId: string, newIndex: number) => {
    const stationId = props.stationId();
    if (!stationId) return;
    const previous = rows();
    const fromIndex = previous.findIndex((r) => r.id === requestId);
    if (fromIndex < 0) return;
    const clamped = Math.max(0, Math.min(newIndex, previous.length - 1));
    if (clamped === fromIndex) return;
    const next = [...previous];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(clamped, 0, moved);
    setRows(next);
    try {
      const client = await getClientForRemote(props.remoteRef());
      const result = await client.app.radioReorderRequest({
        station_id: stationId,
        request_id: requestId,
        new_index: clamped,
      });
      if (!result.success) {
        setRows(previous);
        toast.error(result.error.issues[0]?.message || "failed to reorder queue");
      }
    } catch (err) {
      setRows(previous);
      toast.error(`failed to reorder queue: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /** removes every request before (or after) `requestId`, keeping that
   *  request itself - mirrors the normal playback queue's existing
   *  "clear above"/"clear below" context-menu actions
   *  (see app/AppLayout.tsx's getContextMenuActions). no dedicated bulk
   *  backend endpoint exists for this (the request queue is small enough
   *  that N individual `radio_remove_request` calls in parallel are
   *  plenty fast) - this just loops the same single-remove call
   *  `handleRemove` itself uses, optimistically, then reconciles with a
   *  fresh `load()` if any individual removal failed (simpler and more
   *  robust than trying to surgically patch a partial failure back in). */
  const handleClearRange = async (requestId: string, direction: "before" | "after") => {
    const stationId = props.stationId();
    if (!stationId) return;
    const previous = rows();
    const targetIndex = previous.findIndex((r) => r.id === requestId);
    if (targetIndex < 0) return;
    const toRemove =
      direction === "before" ? previous.slice(0, targetIndex) : previous.slice(targetIndex + 1);
    if (toRemove.length === 0) return;
    const removeIds = new Set(toRemove.map((r) => r.id));
    setRows(previous.filter((r) => !removeIds.has(r.id)));
    try {
      const client = await getClientForRemote(props.remoteRef());
      const results = await Promise.all(
        toRemove.map((r) => client.app.radioRemoveRequest({ station_id: stationId, request_id: r.id }))
      );
      if (results.some((r) => !r.success)) {
        toast.error("some requests could not be removed");
        void load();
      }
    } catch (err) {
      toast.error(
        `failed to clear requests: ${err instanceof Error ? err.message : String(err)}`
      );
      void load();
    }
  };

  return {
    rows,
    loading,
    thumbUrls,
    handleRemove,
    handleClear,
    handleReorder,
    handleClearRange,
    reload: load,
  };
}
