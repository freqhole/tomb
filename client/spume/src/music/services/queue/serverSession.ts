// server-side playback session sync — multi-remote fan-out
// creates per-remote playback sessions when a queue contains songs and/or
// videos from multiple servers. each remote gets its own session with only
// its items, and progress is routed to the correct remote as each item
// plays.
//
// progress is item-based, not time-based:
// - progress = highest item index (within this session's item list)
//   completed or skipped (only moves forward)
// - sent to server on item completion (>90%) or skip
// - session auto-completes when progress reaches total_items
//
// generalized (phase 5c of docs/playlist-unification-plan.md) to operate
// on `MediaItem[]` (song ∪ video) instead of `Song[]` only — one session
// can now hold songs, videos, or a genuine mix of both (`session_type`
// "mixed"), matching how `appState.queue` itself is already a unified
// `MediaItem[]`.

import { createSignal } from "solid-js";
import {
  getClientForRemote,
  type Remote,
  type RemoteRef,
  isNetworkError,
} from "../../../app/api/client";
import { getRemoteById } from "../../../app/services/remotes/remoteManager";
import { debug, warn, error as errorLog } from "../../../utils/logger";
import { appState } from "../../../app/services/storage/db";
import type {
  QueueSourceContext,
  VideoQueueSourceContext,
} from "../../../app/services/storage/types";
import {
  mediaItemKey,
  findMediaItemIndex,
  songToMediaItem,
  type MediaItem,
} from "../../../app/services/storage/mediaItem";
import { computeSmartMediaLabel } from "./smartLabel";
import type { Song } from "../storage/types";

import { updateHistoryServerSession, clearHistoryServerSession } from "./queueHistory";

// a "source" describing what's being played — accepted from either the
// song side (`QueueSourceContext`) or the video side
// (`VideoQueueSourceContext`); both share the same shape (`type`/`label`/
// `entity_id`/`image`), just with different `type` unions.
export type AnyQueueSource = QueueSourceContext | VideoQueueSourceContext;

// --- types ---

interface RemoteSession {
  sessionId: string;
  remoteId: string;
  // the original label from the source context (preserved when updating items)
  label: string;
  // session_type this session was created with (already mapped to the
  // server's enum — see resolveSessionType)
  sessionType: string;
  // entity_id if this session is for a named entity (album, playlist, etc.)
  entityId?: string;
  // indices into the *full queue* that belong to this remote
  itemIndices: number[];
  // progress: the next item index to play (0 = just started, total = done)
  // this only moves forward
  progress: number;
}

// active server sessions keyed by remote_server_id
const remoteSessions = new Map<string, RemoteSession>();

// signal exposing the "primary" active session id (first remote, for backward compat)
const [activeServerSessionId, setActiveServerSessionId] = createSignal<string | null>(null);
export { activeServerSessionId };

// --- per-kind item accessors ---
// songs and videos both carry `remote_server_id`/`source_type`/
// `duration_seconds`, but on different underlying objects — these small
// helpers let the rest of this module stay kind-agnostic.

function itemRemoteId(item: MediaItem): string | undefined {
  return item.kind === "song"
    ? (item.song.remote_server_id ?? undefined)
    : item.video.remote_server_id;
}

function itemIsRemote(item: MediaItem): boolean {
  return item.kind === "song"
    ? item.song.source_type === "remote"
    : item.video.source_type === "remote";
}

function itemEntityId(item: MediaItem): string {
  return item.kind === "song" ? item.song.id || item.song.sha256 : item.video.id;
}

function itemDurationMs(item: MediaItem): number {
  const seconds = item.kind === "song" ? item.song.duration_seconds : item.video.duration_seconds;
  // duration_seconds can carry sub-second precision (esp. video) - round or the
  // server's i64 duration_ms field rejects the result (e.g. 50959.135).
  return Math.round((seconds || 0) * 1000);
}

// map a client-side source `type` (song-side or video-side) to the
// server's `session_type` enum, folding in "mixed" when the item list
// spans both kinds regardless of the source type.
function resolveSessionType(source: AnyQueueSource, items: MediaItem[]): string {
  const hasSong = items.some((i) => i.kind === "song");
  const hasVideo = items.some((i) => i.kind === "video");
  if (hasSong && hasVideo) return "mixed";
  switch (source.type) {
    case "genre":
      return "taxon";
    case "radio_station":
      return "radio";
    case "series":
      return "video_series";
    case "season":
      return "video_season";
    default:
      return source.type;
  }
}

// --- helpers ---

// group items by remote_server_id, returns Map<remoteId, { items, indices }>
function groupItemsByRemote(
  items: MediaItem[]
): Map<string, { items: MediaItem[]; indices: number[] }> {
  const groups = new Map<string, { items: MediaItem[]; indices: number[] }>();
  let skippedCount = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    // only remote items get server sessions
    if (!itemIsRemote(item) || !itemRemoteId(item)) {
      skippedCount++;
      continue;
    }
    const remoteId = itemRemoteId(item) as string;
    let group = groups.get(remoteId);
    if (!group) {
      group = { items: [], indices: [] };
      groups.set(remoteId, group);
    }
    group.items.push(item);
    group.indices.push(i);
  }
  debug(
    `[serverSession] groupItemsByRemote: ${items.length} items, ${groups.size} remotes, ${skippedCount} skipped (not remote or no remote_server_id)`
  );
  return groups;
}

// resolve a remote_server_id to its Remote object via IDB
// accepts HTTP remotes (with base_url), P2P remotes (with peer_addr),
// and charnel-managed remotes (no base_url/peer_addr — dispatches via IPC)
async function resolveRemote(remoteId: string): Promise<Remote | null> {
  try {
    const remote = await getRemoteById(remoteId);
    // valid if has either base_url (HTTP), peer_addr (P2P), or is charnel-managed (IPC)
    if (!remote || (!remote.base_url && !remote.peer_addr && !remote.is_charnel_managed)) {
      warn(
        `[serverSession] resolveRemote: remote ${remoteId} not found or missing base_url/peer_addr/is_charnel_managed`,
        remote
      );
      return null;
    }
    debug(
      `[serverSession] resolveRemote: resolved ${remoteId} → ${remote.name} (base_url=${remote.base_url}, peer_addr=${remote.peer_addr}, charnel=${remote.is_charnel_managed})`
    );
    return remote;
  } catch (e) {
    warn(`[serverSession] resolveRemote: error resolving ${remoteId}`, e);
    return null;
  }
}

// update the primary session id signal (first remote session, or null)
function updatePrimarySessionId(): void {
  const first = remoteSessions.values().next();
  setActiveServerSessionId(first.done ? null : first.value.sessionId);
}

// check whether the currently active session(s) already cover the given
// source (same entity, same session type). used to avoid tearing down and
// recreating a playback session — which mints a new session id and thus a
// new duplicate feed event — when the user is just skipping around within
// the same album/artist/playlist/genre/shuffle they're already playing.
export function activeSessionMatchesSource(source: AnyQueueSource): boolean {
  if (remoteSessions.size === 0 || !source.entity_id) return false;
  for (const session of remoteSessions.values()) {
    if (session.entityId !== source.entity_id || session.sessionType !== source.type) {
      return false;
    }
  }
  return true;
}

// --- public API ---

// create server-side playback sessions when playQueue/addToQueue (or
// their video-side equivalents) is called. fans out to one session per
// remote that has items in the queue. optionally links to a history entry
// for reconnection after page reload.
export async function createServerSessions(
  items: MediaItem[],
  source: AnyQueueSource,
  historyEntryId?: string
): Promise<Map<string, string>> {
  debug(
    `[serverSession] createServerSessions called with ${items.length} items, source=${source.type}`
  );

  // stop any previous sessions before creating new ones
  await stopAllServerSessions("paused");

  const groups = groupItemsByRemote(items);
  const created = new Map<string, string>(); // remoteId → sessionId
  const sessionType = resolveSessionType(source, items);

  debug(
    `[serverSession] will attempt to create sessions for ${groups.size} remotes (session_type=${sessionType})`
  );

  // create sessions in parallel
  const promises = Array.from(groups.entries()).map(async ([remoteId, group]) => {
    const remote = await resolveRemote(remoteId);
    if (!remote) {
      warn(`[serverSession] skipping remote ${remoteId}: could not resolve`);
      return;
    }

    try {
      const totalDurationMs = group.items.reduce((sum, i) => sum + itemDurationMs(i), 0);

      debug(
        `[serverSession] creating session on remote ${remoteId} (${remote.name}) with ${group.items.length} items`
      );
      const client = await getClientForRemote(remote);
      const result = await client.music.createPlaybackSession({
        session_type: sessionType,
        entity_id: source.entity_id ?? null,
        label: source.label,
        items: group.items.map((i) => ({ entity_type: i.kind, entity_id: itemEntityId(i) })),
        total_items: group.items.length,
        total_duration_ms: totalDurationMs,
      });

      if (result.success) {
        debug(`[serverSession] created session ${result.data.id} on remote ${remoteId}`);
        const session: RemoteSession = {
          sessionId: result.data.id,
          remoteId,
          label: source.label,
          sessionType,
          entityId: source.entity_id,
          itemIndices: group.indices,
          progress: 0,
        };
        remoteSessions.set(remoteId, session);
        created.set(remoteId, result.data.id);
      } else {
        errorLog("queue.session", `create session failed on ${remoteId}:`, (result as any).error);
      }
    } catch (error) {
      errorLog("queue.session", `create session threw on ${remoteId}:`, error);
    }
  });

  await Promise.allSettled(promises);
  updatePrimarySessionId();

  // link history entry to the primary server session for reconnection
  if (historyEntryId && created.size > 0) {
    const entry = created.entries().next().value;
    if (entry) {
      const [remoteId, sessionId] = entry;
      void updateHistoryServerSession(historyEntryId, sessionId, remoteId);
    }
  }

  return created;
}

// backward-compat wrapper — createServerSession still works for single-remote callers
export async function createServerSession(
  items: MediaItem[],
  source: AnyQueueSource,
  historyEntryId?: string
): Promise<string | null> {
  const created = await createServerSessions(items, source, historyEntryId);
  return created.values().next().value ?? null;
}

// advance server progress when an item (song or video) is completed
// (>90%) or skipped. resolves the item's *current* global queue position
// itself (via appState().queue) rather than requiring the caller to track
// an index — callers already track their own kind-relative index
// (song-only or video-only) for local history bookkeeping, which is a
// different index space than this session's queue-order-relative one.
// server enforces forward-only with MAX(), so calling with an earlier
// index is a no-op.
export function advanceServerProgress(currentItem: MediaItem | null): void {
  if (remoteSessions.size === 0 || !currentItem) return;

  const remoteId = itemRemoteId(currentItem);
  if (!remoteId) return; // local item, skip server tracking

  const session = remoteSessions.get(remoteId);
  if (!session) return;

  const queue = appState()?.queue ?? [];
  const globalIdx = findMediaItemIndex(queue, mediaItemKey(currentItem));
  if (globalIdx === -1) return;

  // convert global queue index to remote-local index
  const localIdx = session.itemIndices.indexOf(globalIdx);
  if (localIdx === -1) return; // item not in this remote's list

  // advance progress to the next item (localIdx + 1)
  const newProgress = localIdx + 1;

  // only advance if this is forward progress
  if (newProgress <= session.progress) return;

  session.progress = newProgress;

  // send progress to server
  void sendProgress(session);
}

// send current progress to server
// if progress >= total songs, auto-completes the session
async function sendProgress(session: RemoteSession): Promise<void> {
  const remote = await resolveRemote(session.remoteId);
  if (!remote) {
    warn("queue.session", `cannot send progress: remote ${session.remoteId} not found`);
    remoteSessions.delete(session.remoteId);
    updatePrimarySessionId();
    return;
  }

  const client = await getClientForRemote(remote);
  const result = await client.music.updatePlaybackSessionProgress(session.sessionId, {
    id: session.sessionId,
    progress: session.progress,
  });

  if (!result.success) {
    const error = (
      result as { success: false; error: { issues: Array<{ code: string; path: string[] }> } }
    ).error;
    const isSessionNotFound = error.issues.some(
      (issue) =>
        issue.code === "custom" &&
        (issue.path.includes("session_not_found") || issue.path.includes("not_found"))
    );

    if (isSessionNotFound) {
      warn(
        "queue.session",
        `session ${session.sessionId} not found on ${session.remoteId}, stopping tracking`
      );
      remoteSessions.delete(session.remoteId);
      updatePrimarySessionId();
      return;
    }

    // transient connectivity blips with the remote peer (iroh discovery
    // miss, peer offline, etc.) shouldn't spam the console — progress is
    // resent on the next song boundary anyway.
    if (isNetworkError(result)) {
      warn(
        "serverSession",
        `transient network error updating progress on remote ${session.remoteId} — will retry next tick`
      );
      return;
    }

    errorLog("queue.session", `update progress failed on ${session.remoteId}:`, error);
    return;
  }

  // if we've finished all items for this remote, clean up locally
  // (server trigger auto-marks as completed)
  if (session.progress >= session.itemIndices.length) {
    remoteSessions.delete(session.remoteId);
    updatePrimarySessionId();
  }
}

// update the item list of all active server sessions.
// called when items are added to or removed from the queue, or when an
// existing session is being reused for a replayed/reshuffled queue instead
// of being torn down and recreated. if historyEntryId is given, relinks the
// (possibly new) local history entry to the reused session for reconnection
// after a page reload.
export async function updateServerSessionItems(
  items: MediaItem[],
  historyEntryId?: string
): Promise<void> {
  if (remoteSessions.size === 0) return;

  const groups = groupItemsByRemote(items);

  const promises: Promise<void>[] = [];

  // update existing sessions with new item lists
  for (const [remoteId, session] of remoteSessions) {
    const group = groups.get(remoteId);
    if (!group || group.items.length === 0) {
      // this remote has no items left — abandon the session
      promises.push(
        (async () => {
          try {
            const remote = await resolveRemote(remoteId);
            if (remote) {
              const client = await getClientForRemote(remote);
              await client.music.updatePlaybackSessionStatus(session.sessionId, "abandoned");
            }
          } catch (error) {
            errorLog("queue.session", `abandon failed on ${remoteId}:`, error);
          }
          remoteSessions.delete(remoteId);
        })()
      );
    } else {
      // update the session with the new item list
      session.itemIndices = group.indices;
      const totalDurationMs = group.items.reduce((sum, i) => sum + itemDurationMs(i), 0);
      // preserve original label if session is for a named entity (album, playlist, etc.)
      // otherwise recompute smart label for dynamic item groups
      const updatedLabel = session.entityId ? session.label : computeSmartMediaLabel(group.items);
      promises.push(
        (async () => {
          try {
            const remote = await resolveRemote(remoteId);
            if (remote) {
              const client = await getClientForRemote(remote);
              await client.music.updatePlaybackSessionItems(session.sessionId, {
                id: session.sessionId,
                items: group.items.map((i) => ({
                  entity_type: i.kind,
                  entity_id: itemEntityId(i),
                })),
                label: updatedLabel,
                total_items: group.items.length,
                total_duration_ms: totalDurationMs,
              });
              if (historyEntryId) {
                void updateHistoryServerSession(historyEntryId, session.sessionId, remoteId);
              }
            }
          } catch (error) {
            errorLog("queue.session", `update items failed on ${remoteId}:`, error);
          }
        })()
      );
    }
  }

  await Promise.allSettled(promises);
  updatePrimarySessionId();
}

// stop all server sessions with the given status
export async function stopAllServerSessions(
  status: "completed" | "paused" | "abandoned" = "paused"
): Promise<void> {
  if (remoteSessions.size === 0) return;

  // status update for all sessions (no flush needed, progress is already sent)
  const promises = Array.from(remoteSessions.values()).map(async (session) => {
    try {
      const remote = await resolveRemote(session.remoteId);
      if (remote) {
        const client = await getClientForRemote(remote);
        await client.music.updatePlaybackSessionStatus(session.sessionId, status);
      }
    } catch (error) {
      errorLog("queue.session", `update status failed on ${session.remoteId}:`, error);
    }
  });

  await Promise.allSettled(promises);
  remoteSessions.clear();
  setActiveServerSessionId(null);
}

// backward-compat wrapper
export async function stopServerSession(
  status: "completed" | "paused" | "abandoned" = "paused"
): Promise<void> {
  await stopAllServerSessions(status);
}

// resume an existing server session (from feed UI or page reload).
// this only resumes a single session on the specified remote.
// if items are provided, rebuilds itemIndices for proper progress tracking.
export async function resumeServerSession(
  sessionId: string,
  resumeState: {
    progress: number;
  },
  remote: RemoteRef,
  sessionContext?: {
    label: string;
    sessionType?: string;
    entityId?: string;
  },
  historyEntryId?: string,
  items?: MediaItem[]
): Promise<void> {
  const remoteId = remote.remote_id;
  if (!remoteId) {
    throw new Error("remote_id required to resume server session");
  }

  // stop any active sessions first
  await stopAllServerSessions("paused");

  // rebuild itemIndices from provided items (maps queue index to this remote's items)
  const itemIndices: number[] = [];
  if (items) {
    for (let i = 0; i < items.length; i++) {
      if (itemRemoteId(items[i]) === remoteId) {
        itemIndices.push(i);
      }
    }
  }

  // create a session entry for this remote
  const session: RemoteSession = {
    sessionId,
    remoteId,
    label: sessionContext?.label ?? "",
    sessionType: sessionContext?.sessionType ?? "",
    entityId: sessionContext?.entityId,
    itemIndices,
    progress: resumeState.progress,
  };

  remoteSessions.set(remoteId, session);
  updatePrimarySessionId();

  // update status to active on the remote
  const client = await getClientForRemote(remote);
  const statusResult = await client.music.updatePlaybackSessionStatus(sessionId, "active");

  // check if the session no longer exists on server
  if (!statusResult.success) {
    const error = (
      statusResult as { success: false; error: { issues: Array<{ code: string; path: string[] }> } }
    ).error;
    const isSessionNotFound = error.issues.some(
      (issue) =>
        issue.code === "custom" &&
        (issue.path.includes("session_not_found") || issue.path.includes("not_found"))
    );

    if (isSessionNotFound) {
      warn("queue.session", `session ${sessionId} not found during resume, cleaning up`);
      remoteSessions.delete(remoteId);
      updatePrimarySessionId();
      // also clear the stale server session info from the history entry
      if (historyEntryId) {
        void clearHistoryServerSession(historyEntryId);
      }
      return;
    }

    errorLog("queue.session", "resume failed:", error);
  }
}

// get the session id for a specific remote (used by analytics to attach session_id)
export function getSessionIdForRemote(remoteId: string): string | null {
  return remoteSessions.get(remoteId)?.sessionId ?? null;
}

// reconnect server session after page reload.
// called from listenProgress.reconnectProgressTracking after finding a matching history entry.
// uses the stored server_session_id and server_remote_id to resume tracking.
// songs are passed to rebuild itemIndices for proper progress tracking (this
// reconnection path is song-only, fed by the song-side QueueHistoryEntry).
export async function reconnectServerSession(historyEntry: {
  id: string;
  server_session_id?: string;
  server_remote_id?: string;
  label: string;
  type?: string;
  entity_id?: string;
  songs_completed: number;
  songs: Song[];
}): Promise<void> {
  // skip if no server session info stored
  if (!historyEntry.server_session_id || !historyEntry.server_remote_id) return;

  const remote = await resolveRemote(historyEntry.server_remote_id);
  if (!remote) {
    warn("queue.session", "cannot reconnect: remote not found");
    return;
  }

  // resume the server session with progress = songs_completed
  // pass items so itemIndices can be rebuilt for progress tracking
  await resumeServerSession(
    historyEntry.server_session_id,
    { progress: historyEntry.songs_completed },
    remote,
    {
      label: historyEntry.label,
      sessionType: historyEntry.type,
      entityId: historyEntry.entity_id,
    },
    historyEntry.id,
    historyEntry.songs.map(songToMediaItem)
  );
}
