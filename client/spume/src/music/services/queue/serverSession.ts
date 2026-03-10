// server-side listen session sync — multi-remote fan-out
// creates per-remote listen sessions when a queue contains songs from multiple servers.
// each remote gets its own session with only its songs, and progress is routed
// to the correct remote as each song plays.
//
// progress is song-based, not time-based:
// - progress = highest song index completed or skipped (only moves forward)
// - sent to server on song completion (>90%) or skip
// - session auto-completes when progress reaches total_songs

import { createSignal } from "solid-js";
import { getClientForRemote, type Remote, type RemoteRef } from "../../../app/api/client";
import { getRemoteById } from "../../../app/services/remotes/remoteManager";
import type { QueueSourceContext } from "../../../app/services/storage/types";
import type { Song } from "../storage/types";
import { computeSmartLabel } from "./smartLabel";

import { updateHistoryServerSession, clearHistoryServerSession } from "./queueHistory";

// --- types ---

interface RemoteSession {
  sessionId: string;
  remoteId: string;
  // the original label from the source context (preserved when updating songs)
  label: string;
  // entity_id if this session is for a named entity (album, playlist, etc.)
  entityId?: string;
  // indices into the *full queue* that belong to this remote
  songIndices: number[];
  // progress: the next song index to play (0 = just started, total = done)
  // this only moves forward
  progress: number;
}

// active server sessions keyed by remote_server_id
const remoteSessions = new Map<string, RemoteSession>();

// signal exposing the "primary" active session id (first remote, for backward compat)
const [activeServerSessionId, setActiveServerSessionId] = createSignal<string | null>(null);
export { activeServerSessionId };

// --- helpers ---

// group songs by remote_server_id, returns Map<remoteId, { songs, indices }>
function groupSongsByRemote(songs: Song[]): Map<string, { songs: Song[]; indices: number[] }> {
  const groups = new Map<string, { songs: Song[]; indices: number[] }>();
  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];
    // only remote songs get server sessions
    if (song.source_type !== "remote" || !song.remote_server_id) continue;
    const remoteId = song.remote_server_id;
    let group = groups.get(remoteId);
    if (!group) {
      group = { songs: [], indices: [] };
      groups.set(remoteId, group);
    }
    group.songs.push(song);
    group.indices.push(i);
  }
  return groups;
}

// resolve a remote_server_id to its Remote object via IDB
// accepts both HTTP remotes (with base_url) and P2P remotes (with peer_addr)
async function resolveRemote(remoteId: string): Promise<Remote | null> {
  try {
    const remote = await getRemoteById(remoteId);
    // valid if has either base_url (HTTP) or peer_addr (P2P)
    if (!remote || (!remote.base_url && !remote.peer_addr)) return null;
    return remote;
  } catch {
    return null;
  }
}

// update the primary session id signal (first remote session, or null)
function updatePrimarySessionId(): void {
  const first = remoteSessions.values().next();
  setActiveServerSessionId(first.done ? null : first.value.sessionId);
}

// --- public API ---

// create server-side listen sessions when playQueue/addToQueue is called.
// fans out to one session per remote that has songs in the queue.
// optionally links to a history entry for reconnection after page reload.
export async function createServerSessions(
  songs: Song[],
  source: QueueSourceContext,
  historyEntryId?: string,
): Promise<Map<string, string>> {
  // stop any previous sessions before creating new ones
  await stopAllServerSessions("paused");

  const groups = groupSongsByRemote(songs);
  const created = new Map<string, string>(); // remoteId → sessionId

  // create sessions in parallel
  const promises = Array.from(groups.entries()).map(
    async ([remoteId, group]) => {
      const remote = await resolveRemote(remoteId);
      if (!remote) return;

      try {
        const totalDurationMs = group.songs.reduce(
          (sum, s) => sum + (s.duration_seconds || 0) * 1000,
          0,
        );

        const client = await getClientForRemote(remote);
        const result = await client.music.createListenSession({
          session_type: source.type,
          entity_id: source.entity_id ?? null,
          label: source.label,
          song_ids: group.songs.map((s) => s.id || s.sha256),
          total_songs: group.songs.length,
          total_duration_ms: totalDurationMs,
        });

        if (result.success) {
          const session: RemoteSession = {
            sessionId: result.data.id,
            remoteId,
            label: source.label,
            entityId: source.entity_id,
            songIndices: group.indices,
            progress: 0,
          };
          remoteSessions.set(remoteId, session);
          created.set(remoteId, result.data.id);
        } else {
          console.error(
            `failed to create server session on remote ${remoteId}:`,
            (result as any).error,
          );
        }
      } catch (error) {
        console.error(
          `failed to create server session on remote ${remoteId}:`,
          error,
        );
      }
    },
  );

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
  songs: Song[],
  source: QueueSourceContext,
  historyEntryId?: string,
): Promise<string | null> {
  const created = await createServerSessions(songs, source, historyEntryId);
  return created.values().next().value ?? null;
}

// advance server progress when a song is completed (>90%) or skipped.
// songIndex is the queue index of the song that just finished/was skipped.
// progress advances to songIndex + 1 (the next song to play).
// server enforces forward-only with MAX(), so calling with an earlier index is a no-op.
export function advanceServerProgress(
  songIndex: number,
  currentSong: Song | null,
): void {
  if (remoteSessions.size === 0) return;

  const remoteId = currentSong?.remote_server_id;
  if (!remoteId) return; // local song, skip server tracking

  const session = remoteSessions.get(remoteId);
  if (!session) return;

  // convert global songIndex to remote-local index
  const localIdx = session.songIndices.indexOf(songIndex);
  if (localIdx === -1) return; // song not in this remote's list

  // advance progress to the next song (localIdx + 1)
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
    console.warn(`cannot send progress - remote ${session.remoteId} not found`);
    remoteSessions.delete(session.remoteId);
    updatePrimarySessionId();
    return;
  }

  const client = await getClientForRemote(remote);
  const result = await client.music.updateListenSessionProgress(
    session.sessionId,
    { progress: session.progress },
  );

  if (!result.success) {
    const error = (result as { success: false; error: { issues: Array<{ code: string; path: string[] }> } }).error;
    const isSessionNotFound = error.issues.some(
      (issue) =>
        issue.code === "custom" &&
        (issue.path.includes("session_not_found") || issue.path.includes("not_found")),
    );

    if (isSessionNotFound) {
      console.warn(
        `server session ${session.sessionId} not found, stopping tracking`,
      );
      remoteSessions.delete(session.remoteId);
      updatePrimarySessionId();
      return;
    }

    console.error(
      `failed to update server session progress on remote ${session.remoteId}:`,
      error,
    );
    return;
  }

  // if we've finished all songs for this remote, clean up locally
  // (server trigger auto-marks as completed)
  if (session.progress >= session.songIndices.length) {
    remoteSessions.delete(session.remoteId);
    updatePrimarySessionId();
  }
}

// update the song list of all active server sessions.
// called when songs are added to or removed from the queue.
// re-groups the new queue by remote and updates each session.
export async function updateServerSessionSongs(songs: Song[]): Promise<void> {
  if (remoteSessions.size === 0) return;

  const groups = groupSongsByRemote(songs);

  const promises: Promise<void>[] = [];

  // update existing sessions with new song lists
  for (const [remoteId, session] of remoteSessions) {
    const group = groups.get(remoteId);
    if (!group || group.songs.length === 0) {
      // this remote has no songs left — abandon the session
      promises.push(
        (async () => {
          try {
            const remote = await resolveRemote(remoteId);
            if (remote) {
              const client = await getClientForRemote(remote);
              await client.music.updateListenSessionStatus(
                session.sessionId,
                "abandoned",
              );
            }
          } catch (error) {
            console.error(
              `failed to abandon server session on remote ${remoteId}:`,
              error,
            );
          }
          remoteSessions.delete(remoteId);
        })(),
      );
    } else {
      // update the session with the new song list
      session.songIndices = group.indices;
      const totalDurationMs = group.songs.reduce(
        (sum, s) => sum + (s.duration_seconds || 0) * 1000,
        0,
      );
      // preserve original label if session is for a named entity (album, playlist, etc.)
      // otherwise recompute smart label for dynamic song groups
      const updatedLabel = session.entityId
        ? session.label
        : computeSmartLabel(group.songs);
      promises.push(
        (async () => {
          try {
            const remote = await resolveRemote(remoteId);
            if (remote) {
              const client = await getClientForRemote(remote);
              await client.music.updateListenSessionSongs(
                session.sessionId,
                {
                  song_ids: group.songs.map((s) => s.id || s.sha256),
                  label: updatedLabel,
                  total_songs: group.songs.length,
                  total_duration_ms: totalDurationMs,
                },
              );
            }
          } catch (error) {
            console.error(
              `failed to update server session songs on remote ${remoteId}:`,
              error,
            );
          }
        })(),
      );
    }
  }

  await Promise.allSettled(promises);
  updatePrimarySessionId();
}

// stop all server sessions with the given status
export async function stopAllServerSessions(
  status: "completed" | "paused" | "abandoned" = "paused",
): Promise<void> {
  if (remoteSessions.size === 0) return;

  // status update for all sessions (no flush needed, progress is already sent)
  const promises = Array.from(remoteSessions.values()).map(async (session) => {
    try {
      const remote = await resolveRemote(session.remoteId);
      if (remote) {
        const client = await getClientForRemote(remote);
        await client.music.updateListenSessionStatus(
          session.sessionId,
          status,
        );
      }
    } catch (error) {
      console.error(
        `failed to update server session status on remote ${session.remoteId}:`,
        error,
      );
    }
  });

  await Promise.allSettled(promises);
  remoteSessions.clear();
  setActiveServerSessionId(null);
}

// backward-compat wrapper
export async function stopServerSession(
  status: "completed" | "paused" | "abandoned" = "paused",
): Promise<void> {
  await stopAllServerSessions(status);
}

// resume an existing server session (from feed UI).
// this only resumes a single session on the specified remote.
export async function resumeServerSession(
  sessionId: string,
  resumeState: {
    progress: number;
  },
  remote: RemoteRef,
  sessionContext?: {
    label: string;
    entityId?: string;
  },
  historyEntryId?: string,
): Promise<void> {
  // stop any active sessions first
  await stopAllServerSessions("paused");

  // create a session entry for this remote
  const session: RemoteSession = {
    sessionId,
    remoteId: remote.remote_id,
    label: sessionContext?.label ?? "",
    entityId: sessionContext?.entityId,
    songIndices: [], // will be populated if updateServerSessionSongs is called
    progress: resumeState.progress,
  };

  remoteSessions.set(remote.remote_id, session);
  updatePrimarySessionId();

  // update status to active on the remote
  const client = await getClientForRemote(remote);
  const statusResult = await client.music.updateListenSessionStatus(
    sessionId,
    "active",
  );

  // check if the session no longer exists on server
  if (!statusResult.success) {
    const error = (statusResult as { success: false; error: { issues: Array<{ code: string; path: string[] }> } }).error;
    const isSessionNotFound = error.issues.some(
      (issue) =>
        issue.code === "custom" &&
        (issue.path.includes("session_not_found") || issue.path.includes("not_found")),
    );

    if (isSessionNotFound) {
      console.warn(
        `server session ${sessionId} not found during resume, cleaning up`,
      );
      remoteSessions.delete(remote.remote_id);
      updatePrimarySessionId();
      // also clear the stale server session info from the history entry
      if (historyEntryId) {
        void clearHistoryServerSession(historyEntryId);
      }
      return;
    }

    console.error("failed to resume server session:", error);
  }
}

// get the session id for a specific remote (used by analytics to attach session_id)
export function getSessionIdForRemote(remoteId: string): string | null {
  return remoteSessions.get(remoteId)?.sessionId ?? null;
}

// reconnect server session after page reload.
// called from listenProgress.reconnectProgressTracking after finding a matching history entry.
// uses the stored server_session_id and server_remote_id to resume tracking.
export async function reconnectServerSession(
  historyEntry: {
    id: string;
    server_session_id?: string;
    server_remote_id?: string;
    label: string;
    entity_id?: string;
    songs_completed: number;
  },
): Promise<void> {
  // skip if no server session info stored
  if (!historyEntry.server_session_id || !historyEntry.server_remote_id) return;

  const remote = await resolveRemote(historyEntry.server_remote_id);
  if (!remote) {
    console.warn("could not resolve remote for server session reconnection");
    return;
  }

  // resume the server session with progress = songs_completed
  await resumeServerSession(
    historyEntry.server_session_id,
    { progress: historyEntry.songs_completed },
    remote,
    {
      label: historyEntry.label,
      entityId: historyEntry.entity_id,
    },
    historyEntry.id,
  );
}
