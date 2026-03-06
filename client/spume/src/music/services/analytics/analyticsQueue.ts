// analytics event queue — offline-first analytics sync to server
// events are queued locally in IDB, synced FIFO with per-event retry logic.
// each event carries its target remote info so events route to the correct server.

import { createHttpClient } from "../../../app/api/client";
import { createSignal } from "solid-js";
import { initAppDB } from "../../../app/services/storage/db";
import {
  STORE_ANALYTICS_EVENTS,
  type AnalyticsEvent,
  type AnalyticsEventType,
} from "../../../app/services/storage/types";
import { getCurrentRemote } from "../../data";
import { getRemoteById } from "../../../app/services/remotes/remoteManager";
import { getSessionIdForRemote } from "../queue/serverSession";

const MAX_RETRIES = 5;
const SYNC_INTERVAL_MS = 30_000; // try syncing every 30 seconds

// reactive count of pending events
const [pendingEventCount, setPendingEventCount] = createSignal(0);
export { pendingEventCount };

let syncIntervalId: ReturnType<typeof setInterval> | null = null;
let isSyncing = false;

// queue a new analytics event (stored locally, synced later).
// captures the target remote from the payload so it syncs to the correct server.
export async function queueAnalyticsEvent(
  type: AnalyticsEventType,
  payload: AnalyticsEvent["payload"],
): Promise<void> {
  try {
    const db = await initAppDB();

    // attach session_id for the target remote if one is active
    const remoteId = payload.target_remote_id;
    if (remoteId && !payload.session_id) {
      const sessionId = getSessionIdForRemote(remoteId);
      if (sessionId) {
        payload.session_id = sessionId;
      }
    }

    const event: AnalyticsEvent = {
      id: crypto.randomUUID(),
      type,
      payload,
      status: "pending",
      retry_count: 0,
      max_retries: MAX_RETRIES,
      created_at: Date.now(),
    };

    await db.put(STORE_ANALYTICS_EVENTS, event);
    await refreshPendingCount();

    // trigger an immediate sync attempt
    void syncEvents();
  } catch (error) {
    console.error("failed to queue analytics event:", error);
  }
}

// start the periodic sync loop
export function startAnalyticsSync(): void {
  if (syncIntervalId) return;

  syncIntervalId = setInterval(() => {
    void syncEvents();
  }, SYNC_INTERVAL_MS);

  // also sync immediately on start
  void syncEvents();
}

// stop the sync loop
export function stopAnalyticsSync(): void {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
}

// sync pending events to server (FIFO order).
// routes each event to its target remote, falling back to the current remote.
async function syncEvents(): Promise<void> {
  if (isSyncing) return;

  isSyncing = true;

  try {
    const db = await initAppDB();

    // get all pending/failed events, sorted by created_at (FIFO)
    const allEvents: AnalyticsEvent[] = await db.getAll(STORE_ANALYTICS_EVENTS);
    const syncable = allEvents
      .filter((e) => e.status === "pending" || e.status === "failed")
      .filter((e) => e.retry_count < e.max_retries)
      .sort((a, b) => a.created_at - b.created_at);

    // resolve base URLs: events with target_remote_id go to that remote,
    // events without go to the currently active remote
    const fallbackRemote = getCurrentRemote();

    for (const event of syncable) {
      let baseUrl: string | null = null;

      if (event.payload.target_base_url) {
        baseUrl = event.payload.target_base_url;
      } else if (event.payload.target_remote_id) {
        const remote = await getRemoteById(event.payload.target_remote_id);
        baseUrl = remote?.base_url ?? null;
      }

      // fall back to current remote
      if (!baseUrl) {
        baseUrl = fallbackRemote?.base_url ?? null;
      }

      if (!baseUrl) {
        // no remote to send to — skip this event for now
        continue;
      }

      await syncSingleEvent(db, event, baseUrl);
    }

    // cleanup: remove sent events older than 24 hours
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const sent = allEvents.filter(
      (e) => e.status === "sent" && e.created_at < cutoff,
    );
    if (sent.length > 0) {
      const tx = db.transaction(STORE_ANALYTICS_EVENTS, "readwrite");
      for (const e of sent) {
        await tx.store.delete(e.id);
      }
      await tx.done;
    }

    // also cleanup events that exceeded max retries (>24h old)
    const expired = allEvents.filter(
      (e) =>
        e.status === "failed" &&
        e.retry_count >= e.max_retries &&
        e.created_at < cutoff,
    );
    if (expired.length > 0) {
      const tx = db.transaction(STORE_ANALYTICS_EVENTS, "readwrite");
      for (const e of expired) {
        await tx.store.delete(e.id);
      }
      await tx.done;
    }

    await refreshPendingCount();
  } catch (error) {
    console.error("analytics sync error:", error);
  } finally {
    isSyncing = false;
  }
}

// sync a single event to the server
async function syncSingleEvent(
  db: Awaited<ReturnType<typeof initAppDB>>,
  event: AnalyticsEvent,
  baseUrl: string,
): Promise<void> {
  // mark as sending
  const sending: AnalyticsEvent = {
    ...event,
    status: "sending",
    last_attempt_at: Date.now(),
  };
  await db.put(STORE_ANALYTICS_EVENTS, sending);

  try {
    switch (event.type) {
      case "play_complete": {
        if (!event.payload.media_blob_id || !event.payload.song_id) {
          // invalid event, mark as sent to skip it
          await db.put(STORE_ANALYTICS_EVENTS, { ...sending, status: "sent" });
          return;
        }
        const result = await createHttpClient(baseUrl).music.recordPlay({
          media_blob_id: event.payload.media_blob_id,
          song_id: event.payload.song_id,
          session_id: event.payload.session_id ?? null,
          event_data: event.payload.event_data ?? null,
        });
        if (!result.success) {
          throw new Error(`record play failed: ${"error" in result ? result.error.message : "unknown error"}`);
        }
        break;
      }
      // TODO: handle favorite/unfavorite/rate events when server endpoints exist
      default:
        // unknown event type, mark as sent to skip
        break;
    }

    // success — mark as sent
    await db.put(STORE_ANALYTICS_EVENTS, {
      ...sending,
      status: "sent",
    });
  } catch (error) {
    // failure — increment retry count
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    const failed: AnalyticsEvent = {
      ...sending,
      status: "failed",
      retry_count: event.retry_count + 1,
      error: errorMessage,
    };
    await db.put(STORE_ANALYTICS_EVENTS, failed);

    console.warn(
      `analytics event ${event.id} failed (attempt ${failed.retry_count}/${event.max_retries}):`,
      errorMessage,
    );
  }
}

// refresh the pending count signal
async function refreshPendingCount(): Promise<void> {
  try {
    const db = await initAppDB();
    const all: AnalyticsEvent[] = await db.getAll(STORE_ANALYTICS_EVENTS);
    const pending = all.filter(
      (e) => e.status === "pending" || e.status === "failed",
    ).length;
    setPendingEventCount(pending);
  } catch {
    // ignore
  }
}
