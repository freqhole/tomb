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
import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js";
import { getClientForRemote } from "../../app/api/client";
import type { RemoteRef } from "../../app/services/storage/types";
import { resolveBlobUrl } from "../../music/services/storage/blobResolver";
import { toast } from "../feedback/Toast";
import { debug, warn, error as errorLog } from "../../utils/logger";
import { RadioQueueEventsStreamClosed, type RadioQueueEvent } from "@freqhole/api-client";

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

  /** maps the wire shape (`radio_list_requests`' response rows, or a
   *  `Submitted` event's embedded `request`) to this hook's own row
   *  shape - shared by `load()` and the live subscription below so
   *  there's exactly one place that knows the field-name mapping. */
  const toRow = (r: {
    id: string;
    kind: string;
    item_id: string;
    requested_by: string;
    requested_by_username?: string | null;
    title: string;
    artist?: string | null;
    album?: string | null;
    duration_ms?: number | null;
    art_blob_id?: string | null;
  }): RadioRequestRow => ({
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
  });

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
      setRows(result.data.requests.map(toRow));
    } catch (err) {
      debug("radio-queue", "failed to load queue:", err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  /** applies one live `RadioQueueEvent` to `rows` in place - no
   *  server round-trip, since the event already carries everything
   *  needed (full metadata for `Submitted`, bare ids for the rest). */
  const applyEvent = (evt: RadioQueueEvent) => {
    switch (evt.kind) {
      case "Submitted": {
        const row = toRow(evt.request);
        setRows((prev) => (prev.some((r) => r.id === row.id) ? prev : [...prev, row]));
        break;
      }
      case "Removed": {
        setRows((prev) => prev.filter((r) => r.id !== evt.request_id));
        break;
      }
      case "Reordered": {
        setRows((prev) => {
          const fromIndex = prev.findIndex((r) => r.id === evt.request_id);
          if (fromIndex < 0) return prev;
          const clamped = Math.max(0, Math.min(evt.new_index, prev.length - 1));
          if (clamped === fromIndex) return prev;
          const next = [...prev];
          const [moved] = next.splice(fromIndex, 1);
          next.splice(clamped, 0, moved);
          return next;
        });
        break;
      }
      case "Cleared": {
        setRows([]);
        break;
      }
    }
  };

  // live subscription: reconnects with capped exponential backoff on any
  // recoverable drop (same precedent as jobService.ts's job-tracking
  // subscription), re-`load()`-ing on every (re)connect to resync past
  // anything that happened while disconnected, then applying incremental
  // `RadioQueueEvent`s as they arrive. `abortController` is re-created by
  // the station/remote-change effect below, which also tears down the
  // previous one first.
  const RECONNECT_BASE_MS = 1000;
  const RECONNECT_MAX_MS = 30_000;

  const subscribeLive = (stationId: string, signal: AbortSignal) => {
    let reconnectDelay = RECONNECT_BASE_MS;
    let reconnectTimerId: ReturnType<typeof setTimeout> | undefined;

    const scheduleReconnect = () => {
      if (signal.aborted) return;
      const delay = reconnectDelay;
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
      reconnectTimerId = setTimeout(run, delay);
    };

    const run = async () => {
      if (signal.aborted) return;
      try {
        // re-snapshot on every (re)connect - a drop could have swallowed
        // events for anything that changed while we were disconnected.
        await load();
        if (signal.aborted) return;
        const client = await getClientForRemote(props.remoteRef());
        for await (const evt of client.radioQueue.events.subscribe(
          { station_id: stationId },
          signal
        )) {
          reconnectDelay = RECONNECT_BASE_MS;
          applyEvent(evt);
          if (signal.aborted) return;
        }
        // stream ended cleanly (e.g. polling fallback's abort path) -
        // nothing more to do once aborted; otherwise treat as a drop.
        if (!signal.aborted) scheduleReconnect();
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof RadioQueueEventsStreamClosed) {
          warn("radio-queue", `events stream closed: ${err.reason.kind}, reconnecting`);
        } else {
          errorLog("radio-queue", "events subscription error, reconnecting:", err);
        }
        scheduleReconnect();
      }
    };

    signal.addEventListener(
      "abort",
      () => {
        if (reconnectTimerId) clearTimeout(reconnectTimerId);
      },
      { once: true }
    );
    void run();
  };

  // guarded against `remoteRef()` being reactively re-derived to an
  // EQUAL-BY-VALUE but freshly-allocated object upstream (e.g. a station-
  // list refresh recomputing the station this panel is for) - without
  // this, every such incidental re-render refetches the whole queue from
  // the server and replaces every row's object identity, which `<For>`
  // then treats as an entirely new list - a "queue blinks" symptom with
  // nothing actually having changed.
  //
  // owns the live subscription's lifetime too: every station/remote
  // change tears down the previous subscription (if any) before
  // `subscribeLive` kicks off a fresh `load()` + subscribe for the new
  // station - one `AbortController` per station, not per mount.
  let liveAbort: AbortController | undefined;
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
        liveAbort?.abort();
        liveAbort = undefined;
        const stationId = props.stationId();
        if (!stationId) {
          setRows([]);
          return;
        }
        liveAbort = new AbortController();
        subscribeLive(stationId, liveAbort.signal);
      },
      { defer: false }
    )
  );
  onCleanup(() => liveAbort?.abort());

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
