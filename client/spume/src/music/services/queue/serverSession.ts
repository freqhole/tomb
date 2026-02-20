// server-side listen session sync — multi-remote fan-out
// creates per-remote listen sessions when a queue contains songs from multiple servers.
// each remote gets its own session with only its songs, and progress is routed
// to the correct remote as each song plays.

import { createSignal } from "solid-js";
import * as apiClient from "freqhole-api-client";
import { getRemoteById } from "../../../app/services/remotes/remoteManager";
import type { QueueSourceContext } from "../../../app/services/storage/types";
import type { Song } from "../storage/types";
import { computeSmartLabel } from "./smartLabel";

import { updateHistoryServerSession } from "./queueHistory";

// --- types ---

interface RemoteSession {
  sessionId: string;
  remoteId: string;
  baseUrl: string;
  // the original label from the source context (preserved when updating songs)
  label: string;
  // entity_id if this session is for a named entity (album, playlist, etc.)
  entityId?: string;
  // indices into the *full queue* that belong to this remote
  songIndices: number[];
  // accumulated progress state for this remote's session
  accumulatedMs: number;
  completedSongs: Set<number>; // indices into the full queue
  lastSongIndex: number; // last reported song index (remote-local)
  lastSongPositionMs: number;
}

// active server sessions keyed by remote_server_id
const remoteSessions = new Map<string, RemoteSession>();

// signal exposing the "primary" active session id (first remote, for backward compat)
const [activeServerSessionId, setActiveServerSessionId] = createSignal<string | null>(null);
export { activeServerSessionId };

// flush interval for server progress updates
let serverFlushIntervalId: ReturnType<typeof setInterval> | null = null;
const SERVER_FLUSH_INTERVAL_MS = 30_000;

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

// resolve a remote_server_id to its base_url via IDB
async function resolveRemoteBaseUrl(remoteId: string): Promise<string | null> {
  try {
    const remote = await getRemoteById(remoteId);
    return remote?.base_url ?? null;
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
      const baseUrl = await resolveRemoteBaseUrl(remoteId);
      if (!baseUrl) return;

      try {
        const totalDurationMs = group.songs.reduce(
          (sum, s) => sum + (s.duration_seconds || 0) * 1000,
          0,
        );

        const result = await apiClient.music.createListenSession(baseUrl, {
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
            baseUrl,
            label: source.label,
            entityId: source.entity_id,
            songIndices: group.indices,
            accumulatedMs: 0,
            completedSongs: new Set(),
            lastSongIndex: 0,
            lastSongPositionMs: 0,
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

  // start periodic flush if we have any sessions
  if (remoteSessions.size > 0) {
    if (serverFlushIntervalId) clearInterval(serverFlushIntervalId);
    serverFlushIntervalId = setInterval(() => {
      void flushAllServerProgress();
    }, SERVER_FLUSH_INTERVAL_MS);
  }

  // link history entry to the primary server session for reconnection
  if (historyEntryId && created.size > 0) {
    const [remoteId, sessionId] = created.entries().next().value;
    void updateHistoryServerSession(historyEntryId, sessionId, remoteId);
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

// update server progress for the currently playing song.
// routes to the correct remote session based on the song's remote_server_id.
export function recordServerProgress(
  deltaMs: number,
  songIndex: number,
  songPositionMs: number,
  currentSong: Song | null,
): void {
  if (remoteSessions.size === 0) return;

  // find which remote session owns this song
  const remoteId = currentSong?.remote_server_id;
  if (!remoteId) return; // local song, skip server tracking

  const session = remoteSessions.get(remoteId);
  if (!session) return;

  session.accumulatedMs += deltaMs;
  // convert global songIndex to remote-local index
  const localIdx = session.songIndices.indexOf(songIndex);
  if (localIdx !== -1) {
    session.lastSongIndex = localIdx;
  }
  session.lastSongPositionMs = songPositionMs;
}

// mark a song as completed on the appropriate remote session
export function markServerSongCompleted(
  songIndex: number,
  currentSong: Song | null,
): void {
  if (remoteSessions.size === 0) return;

  const remoteId = currentSong?.remote_server_id;
  if (!remoteId) return;

  const session = remoteSessions.get(remoteId);
  if (!session) return;

  session.completedSongs.add(songIndex);

  // auto-complete this remote's session if all its songs are done
  if (session.completedSongs.size >= session.songIndices.length) {
    void flushAndCompleteSession(session);
  }
}

// flush progress for a single session and mark it completed
async function flushAndCompleteSession(session: RemoteSession): Promise<void> {
  await flushSessionProgress(session);
  try {
    await apiClient.music.updateListenSessionStatus(
      session.baseUrl,
      session.sessionId,
      "completed",
    );
  } catch (error) {
    console.error(
      `failed to complete server session on remote ${session.remoteId}:`,
      error,
    );
  }
  remoteSessions.delete(session.remoteId);
  updatePrimarySessionId();

  // stop flush interval if no sessions remain
  if (remoteSessions.size === 0 && serverFlushIntervalId) {
    clearInterval(serverFlushIntervalId);
    serverFlushIntervalId = null;
  }
}

// flush progress for a single remote session
async function flushSessionProgress(session: RemoteSession): Promise<void> {
  try {
    await apiClient.music.updateListenSessionProgress(
      session.baseUrl,
      session.sessionId,
      {
        songs_completed: session.completedSongs.size,
        listened_duration_ms: Math.round(session.accumulatedMs),
        current_song_index: session.lastSongIndex,
        current_song_position_ms: Math.round(session.lastSongPositionMs),
      },
    );
  } catch (error) {
    console.error(
      `failed to flush server session progress on remote ${session.remoteId}:`,
      error,
    );
  }
}

// flush progress for all active remote sessions
async function flushAllServerProgress(): Promise<void> {
  const promises = Array.from(remoteSessions.values()).map((session) =>
    flushSessionProgress(session),
  );
  await Promise.allSettled(promises);
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
          await flushSessionProgress(session);
          try {
            await apiClient.music.updateListenSessionStatus(
              session.baseUrl,
              session.sessionId,
              "abandoned",
            );
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
            await apiClient.music.updateListenSessionSongs(
              session.baseUrl,
              session.sessionId,
              {
                song_ids: group.songs.map((s) => s.id || s.sha256),
                label: updatedLabel,
                total_songs: group.songs.length,
                total_duration_ms: totalDurationMs,
              },
            );
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

  // final flush + status update for all sessions
  const promises = Array.from(remoteSessions.values()).map(async (session) => {
    await flushSessionProgress(session);
    try {
      await apiClient.music.updateListenSessionStatus(
        session.baseUrl,
        session.sessionId,
        status,
      );
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

  if (serverFlushIntervalId) {
    clearInterval(serverFlushIntervalId);
    serverFlushIntervalId = null;
  }
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
    listened_duration_ms: number;
    songs_completed: number;
    current_song_index: number;
    current_song_position_ms: number;
  },
  remoteId: string,
  baseUrl: string,
  sessionContext?: {
    label: string;
    entityId?: string;
  },
): Promise<void> {
  // stop any active sessions first
  await stopAllServerSessions("paused");

  // create a session entry for this remote
  const session: RemoteSession = {
    sessionId,
    remoteId,
    baseUrl,
    label: sessionContext?.label ?? "",
    entityId: sessionContext?.entityId,
    songIndices: [], // will be populated if updateServerSessionSongs is called
    accumulatedMs: resumeState.listened_duration_ms,
    completedSongs: new Set(),
    lastSongIndex: resumeState.current_song_index,
    lastSongPositionMs: resumeState.current_song_position_ms,
  };

  // populate completed songs set
  for (let i = 0; i < resumeState.songs_completed; i++) {
    session.completedSongs.add(i);
  }

  remoteSessions.set(remoteId, session);
  updatePrimarySessionId();

  // update status to active on the remote
  try {
    await apiClient.music.updateListenSessionStatus(
      baseUrl,
      sessionId,
      "active",
    );
  } catch (error) {
    console.error("failed to resume server session:", error);
  }

  // start periodic flush
  if (serverFlushIntervalId) clearInterval(serverFlushIntervalId);
  serverFlushIntervalId = setInterval(() => {
    void flushAllServerProgress();
  }, SERVER_FLUSH_INTERVAL_MS);
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
    server_session_id?: string;
    server_remote_id?: string;
    label: string;
    entity_id?: string;
    listened_seconds: number;
    songs_completed: number;
    current_song_index: number;
    current_song_position: number;
  },
): Promise<void> {
  // skip if no server session info stored
  if (!historyEntry.server_session_id || !historyEntry.server_remote_id) return;

  // note: we don't skip if remoteSessions.size > 0 anymore because:
  // 1. resumeServerSession already calls stopAllServerSessions first
  // 2. resuming from feed needs to switch from one session to another

  const baseUrl = await resolveRemoteBaseUrl(historyEntry.server_remote_id);
  if (!baseUrl) {
    console.warn("could not resolve base url for server session reconnection");
    return;
  }

  // resume the server session
  await resumeServerSession(
    historyEntry.server_session_id,
    {
      listened_duration_ms: historyEntry.listened_seconds * 1000,
      songs_completed: historyEntry.songs_completed,
      current_song_index: historyEntry.current_song_index,
      current_song_position_ms: historyEntry.current_song_position * 1000,
    },
    historyEntry.server_remote_id,
    baseUrl,
    {
      label: historyEntry.label,
      entityId: historyEntry.entity_id,
    },
  );
}
