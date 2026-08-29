// phase 6: thin wrappers around playerPairingClient.sendPlayerCommand for
// the transport-control side of a remote target (pause/resume/skip/seek/
// volume), plus a status poller + push subscription.
//
// player.freqhole.net now has a push channel (control/statusSubscribers.ts,
// wasm-only for now - see playerPairingClient.ts's subscribeToPlayerStatus)
// so status updates arrive immediately instead of waiting for the next poll
// tick. the poll stays on as a reconciliation fallback (cheap, handles a
// dropped/never-established subscription, and is still the only mechanism
// at all in charnel/tauri mode until that transport gets a persistent-
// stream equivalent).
//
// command/status shapes are hand-typed here (not shared with
// player.freqhole.net's zod schema - no cross-package schema sharing
// exists yet between spume and player.freqhole.net).

import { createSignal } from "solid-js";
import { sendPlayerCommand, subscribeToPlayerStatus } from "./playerPairingClient";
import { activeTargetNodeId, isRemoteTargetActive } from "./activeTarget";
import { appState, setQueue } from "../storage/db";
import { isSongItem } from "../storage/mediaItem";

export interface RemoteMediaRef {
  source_peer_addr: string;
  blake3_hash: string;
  size_bytes?: number;
  duration_ms?: number;
  mime_type?: string;
  kind?: "audio" | "video";
  title?: string;
  artist?: string;
  /** small thumbnail (queue rows, synced cheaply to every client). */
  artwork_thumb_url?: string;
  /** full-size art (player's own now-playing view). */
  artwork_full_url?: string;
}

export type RemoteStatus =
  | {
      type: "status";
      state: "now_playing";
      item: RemoteMediaRef;
      position_ms: number;
      server_time_ms: number;
      queue: RemoteMediaRef[];
      auto_download_enabled: boolean;
      volume: number;
      recently_played: string[];
    }
  | {
      type: "status";
      state: "paused";
      position_ms: number;
      queue: RemoteMediaRef[];
      auto_download_enabled: boolean;
      volume: number;
      recently_played: string[];
    }
  | {
      type: "status";
      state: "buffering";
      queue: RemoteMediaRef[];
      auto_download_enabled: boolean;
      volume: number;
      recently_played: string[];
    }
  | {
      type: "status";
      state: "stopped";
      queue: RemoteMediaRef[];
      auto_download_enabled: boolean;
      volume: number;
      recently_played: string[];
    }
  | {
      type: "status";
      state: "error";
      message: string;
      queue: RemoteMediaRef[];
      auto_download_enabled: boolean;
      volume: number;
      recently_played: string[];
    };

/** the shared queue of the active remote target, or an empty array when
 * nothing is active/no status has arrived yet. */
export const remoteQueue = (): RemoteMediaRef[] => remoteStatus()?.queue ?? [];

/** blake3 hashes the active remote target already dealt with this session
 * (played through, manually skipped, or explicitly removed - see
 * player.freqhole.net's playbackEngine.ts `recordRecentlyPlayed()`). used
 * when re-selecting a remote target after having played locally for a
 * while, so the handoff doesn't blindly re-queue songs the player already
 * finished with. */
export const remoteRecentlyPlayed = (): string[] => remoteStatus()?.recently_played ?? [];

/** the currently-playing (or last-known-current, e.g. while paused) queue
 * item for the active remote target. only `now_playing` status carries it
 * directly as `item` - every other state (paused/buffering/stopped/error)
 * only carries `queue`, whose index 0 is "current" by protocol convention
 * (see RemoteStatus above) - `stopped`/`error` genuinely have nothing
 * playing, so those (and an empty queue) return undefined. used so the
 * player bar keeps showing the right title/artist/artwork/duration across
 * a play<->pause transition instead of only while actively playing. */
export const remoteCurrentItem = (): RemoteMediaRef | undefined => {
  const s = remoteStatus();
  if (!s) return undefined;
  if (s.state === "now_playing") return s.item;
  if (s.state === "stopped" || s.state === "error") return undefined;
  return s.queue[0];
};

/** the active remote target's auto-download toggle, mirrored from whichever
 * client last set it via `remoteSetAutoDownloadEnabled()`. */
export const remoteAutoDownloadEnabled = (): boolean =>
  remoteStatus()?.auto_download_enabled ?? false;

/** the active remote target's volume (0-1), mirrored from whichever client
 * last set it via `remoteSetVolume()` - defaults to 1 before any status has
 * arrived, matching the player's own default (`<video>.volume` starts at 1). */
export const remoteVolume = (): number => remoteStatus()?.volume ?? 1;

/** the currently-playing item's duration, in ms, if known - `undefined`
 * while nothing is playing or the item's duration wasn't reported (treated
 * like a live stream by callers, same as radio). */
export const remoteDurationMs = (): number | undefined => remoteCurrentItem()?.duration_ms;

interface CommandAck {
  type: "command_ack";
  ok: boolean;
  reason?: string;
  status?: RemoteStatus;
}

const [remoteStatus, setRemoteStatus] = createSignal<RemoteStatus | null>(null);
export { remoteStatus };

// client-side offline detection: `Date.now()` of the last time a REAL
// status (poll response, push, or command ack) actually landed for the
// currently-active target - distinct from `remoteStatusKnown()` (which
// only asks "have we EVER heard from this target", not "recently").
let lastStatusAt = 0;

function applyRemoteStatus(status: RemoteStatus | null): void {
  if (status) {
    lastStatusAt = Date.now();
    const prevRecentlyPlayed = remoteStatus()?.recently_played ?? [];
    const newlyFinished = status.recently_played.filter((h) => !prevRecentlyPlayed.includes(h));
    if (newlyFinished.length > 0) pruneLocalQueueForFinishedItems(newlyFinished);
  }
  setRemoteStatus(status);
}

/** phase 18: real-time counterpart to selectPlaybackTarget.ts's
 * syncLocalQueueFromRemote() (which only re-syncs once, at the moment the
 * user actually switches back to local) - as soon as the remote player
 * reports an item finished (recently_played grows), drop the matching
 * local queue entry right away, so the local queue is already caught up
 * by the time the user switches back instead of jumping all at once. songs
 * only, matched by blake3 hash - same limitation as
 * syncLocalQueueFromRemote (videos have no stable local hash to match a
 * remote blake3_hash against). fire-and-forget; a failed local write here
 * isn't worth surfacing to the user, and syncLocalQueueFromRemote acts as
 * a final catch-all at switch-back time regardless. */
function pruneLocalQueueForFinishedItems(finishedHashes: string[]): void {
  const state = appState();
  if (!state) return;
  const finished = new Set(finishedHashes);
  const kept = state.queue.filter((item) => {
    if (!isSongItem(item)) return true;
    return !item.song.blake3 || !finished.has(item.song.blake3);
  });
  if (kept.length === state.queue.length) return;
  void setQueue(kept);
}

/** applies a status carried on a raw sendPlayerCommand ack - used by
 * playerQueuePush.ts's replace_queue/append_queue senders, which dial
 * directly via playerPairingClient (not through sendControl below, since
 * they do real work - blob import, artwork resize - before sending) but
 * still get the fresh post-command status back in the same ack, per
 * dispatcher.ts's `{ type: "command_ack", ok: true, status }`. applying it
 * immediately here means the calling client's own queue view updates the
 * instant its own command completes, instead of waiting for the next
 * separate push/poll status cycle - the actual fix for a slow (esp. video)
 * queue add otherwise looking like "nothing happened" for several seconds. */
export function applyRemoteStatusFromAck(status: RemoteStatus): void {
  applyRemoteStatus(status);
}

/** clears any known status for the active target - call right when
 * switching to a (possibly different) remote target, so `remoteStatusKnown()`
 * immediately goes back to false and the playerbar shows its loading state
 * until the new target's real status arrives, instead of briefly showing
 * the PREVIOUS target's stale status (`remoteStatus` otherwise only ever
 * gets cleared by `setRemoteStatusPolling(false)`, i.e. switching back to
 * local - switching directly between two different remote targets never
 * hit that path). */
export function resetRemoteStatus(): void {
  applyRemoteStatus(null);
}

export const remoteIsPlaying = () => remoteStatus()?.state === "now_playing";

// local ticking clock (phase 13): `now_playing` status carries a
// `server_time_ms` (the player's own `Date.now()` when it built that
// status) alongside `position_ms` - extrapolating between polls/pushes
// with our own `Date.now()` gives a smoothly-advancing playbar instead of
// one that visibly freezes for up to a few seconds between updates. ticks
// only run while a remote target is active (see `setRemoteStatusPolling`).
const [tickNow, setTickNow] = createSignal(Date.now());
let tickHandle: ReturnType<typeof setInterval> | null = null;
const TICK_INTERVAL_MS = 250;

export const remotePositionMs = () => {
  const s = remoteStatus();
  if (!s) return 0;
  if (s.state === "now_playing") {
    const elapsed = tickNow() - s.server_time_ms;
    return s.position_ms + Math.max(0, elapsed);
  }
  if ("position_ms" in s) return s.position_ms;
  return 0;
};

/** phase 14e: optimistic client-side prediction of "has the currently
 * playing item already finished" - purely a DISPLAY-layer prediction, it
 * never mutates `remoteQueue()`/`remoteStatus()` themselves, so the next
 * real status update (which always wholesale-replaces `remoteStatus`)
 * automatically reconciles/corrects it - there's no persisted "advanced"
 * state to undo. deliberately only ever predicts a single step ahead
 * (not cascading through multiple finished songs) - "not too aggressive",
 * mirrors the same restraint the user asked for on the offline-timeout
 * item. used by QueueSidebar's remote-queue rendering to avoid visibly
 * freezing on a finished track for up to one heartbeat interval (30s,
 * see POLL_INTERVAL_MS) or a dropped push subscription. */
export const remoteOptimisticCurrentIndex = (): number => {
  const s = remoteStatus();
  if (!s || s.state !== "now_playing") return 0;
  const dur = s.item.duration_ms;
  if (dur === undefined) return 0;
  return remotePositionMs() >= dur ? 1 : 0;
};

/** true once at least one real status (poll response, push, or command ack)
 * has arrived for the currently-active remote target - lets callers show a
 * neutral "syncing" state instead of a possibly-wrong default (e.g. looking
 * paused) right after connecting or after a subscription drop/reconnect. */
export const remoteStatusKnown = () => remoteStatus() !== null;

// client-side "haven't heard from this player in N seconds" timeout -
// user explicitly asked for this ("good for clients to have some timeout
// mechanism in case the player goes offline - shouldn't be too aggressive,
// but also not too lax and slow"). tuned the same way as the player-side
// DISCONNECT_GRACE_MS (connectedControllers.ts): comfortably above the
// 30s heartbeat/poll interval (so one slow/delayed tick doesn't falsely
// flag offline) while still resolving a genuine outage well under a
// minute. re-derives every tick of the existing `tickNow` clock (250ms,
// already running whenever a remote target is active), so no extra timer
// is needed - it simply stops ticking (and this signal stops updating)
// once polling is disabled, same as remotePositionMs() above.
const OFFLINE_TIMEOUT_MS = 45_000;

/** true once we've gone suspiciously long (`OFFLINE_TIMEOUT_MS`) without a
 * real status landing for the active target - covers both a dead poll
 * (dial/fetch throwing, e.g. player unreachable) and a silently-dropped
 * push subscription. gated on `remoteStatusKnown()` first so a
 * still-connecting target (never heard from at all yet) shows the
 * existing "syncing" state instead of a premature "offline". */
export const remoteTargetOffline = (): boolean =>
  remoteStatusKnown() && tickNow() - lastStatusAt > OFFLINE_TIMEOUT_MS;

// command-pending feedback (phase 13): sendControl callers below opt in via
// `trackPending: true` for the handful of playerbar-driven commands (play/
// pause, skip, seek, volume) so the UI can show a brief loading state while
// waiting on the ack - NOT set for the background status poll/get_status,
// which would otherwise flicker the same indicator every heartbeat tick.
const [pendingCount, setPendingCount] = createSignal(0);
export const remoteCommandPending = () => pendingCount() > 0;

/** wraps an arbitrary in-flight remote-queue operation (e.g. playerQueuePush's
 * appendSongsToPlayer/pushSongsToPlayer, called from remoteQueueMirror.ts)
 * so it feeds the same `remoteCommandPending()` indicator sendControl's
 * `trackPending` option provides for its own commands - these two don't go
 * through sendControl themselves (they send `append_queue`/`replace_queue`
 * directly via playerPairingClient, plus do real work - blob import,
 * artwork resize - before ever sending anything), but the user should still
 * see the same "syncing with player" feedback while that's in flight. */
export async function remoteTrackPending<T>(work: Promise<T>): Promise<T> {
  setPendingCount((n) => n + 1);
  try {
    return await work;
  } finally {
    setPendingCount((n) => Math.max(0, n - 1));
  }
}

async function sendControl(
  command: Record<string, unknown>,
  opts?: { trackPending?: boolean }
): Promise<CommandAck | null> {
  const nodeId = activeTargetNodeId();
  if (!nodeId) return null;
  if (opts?.trackPending) setPendingCount((n) => n + 1);
  try {
    const ack = (await sendPlayerCommand(nodeId, { type: "control", ...command })) as CommandAck;
    if (ack?.status) applyRemoteStatus(ack.status);
    return ack;
  } finally {
    if (opts?.trackPending) setPendingCount((n) => Math.max(0, n - 1));
  }
}

export async function remotePause(): Promise<void> {
  await sendControl({ command: "pause" }, { trackPending: true });
}

export async function remoteResume(): Promise<void> {
  await sendControl({ command: "resume" }, { trackPending: true });
}

export async function remoteSkip(): Promise<void> {
  await sendControl({ command: "skip" }, { trackPending: true });
}

/** removes the queue entry at `index` (0 = currently playing). */
export async function remoteRemoveFromQueue(index: number): Promise<void> {
  await sendControl({ command: "remove_from_queue", index }, { trackPending: true });
}

/** moves a not-yet-playing queue entry from one position to another. */
export async function remoteReorderQueue(fromIndex: number, toIndex: number): Promise<void> {
  await sendControl(
    { command: "reorder_queue", from_index: fromIndex, to_index: toIndex },
    { trackPending: true }
  );
}

export async function remoteSetAutoDownloadEnabled(enabled: boolean): Promise<void> {
  await sendControl({ command: "set_auto_download_enabled", enabled });
}

export async function remoteSeek(positionMs: number): Promise<void> {
  await sendControl(
    { command: "seek", position_ms: Math.max(0, Math.round(positionMs)) },
    { trackPending: true }
  );
}

export async function remoteSetVolume(volume: number): Promise<void> {
  await sendControl(
    { command: "set_volume", volume: Math.min(1, Math.max(0, volume)) },
    { trackPending: true }
  );
}

export async function remoteGetStatus(): Promise<void> {
  await sendControl({ command: "get_status" });
}

/** fetches the active target's current status directly, without relying
 * on the `remoteStatus` signal already being populated (e.g. right after
 * `setActiveTargetToPlayer`, before the poll/subscription have run) - used
 * by selectPlaybackTarget.ts to decide whether to replace or append to an
 * already-in-progress remote queue. also updates `remoteStatus` as a side
 * effect, same as every other command here. */
export async function fetchRemoteStatus(): Promise<RemoteStatus | null> {
  const ack = await sendControl({ command: "get_status" });
  return ack?.status ?? null;
}

// this used to poll every 3s, but that's redundant/wasteful now: every
// state change (play/pause/seek/skip/queue edit, from ANY connected
// client, plus the player's own auto-advance-on-track-end) already gets
// pushed immediately via broadcastStatus() -> subscribeToPlayerStatus()
// (wasm) or reflected instantly in the issuing client's own command ack
// (see sendControl() above) - and playback POSITION is handled entirely
// by the local `tickNow` extrapolation clock below, never by this poll.
// so this interval is really just an idle keep-alive/heartbeat (mirrors
// how a websocket ping/pong stays quiet while idle): a periodic resync
// fallback in case a push was missed (dropped subscription, reconnect
// race) and, for charnel/tauri mode (no persistent subscribe stream at
// all - see subscribeToPlayerStatus()'s wasm-only comment), the ONLY way
// another client's changes ever get picked up. 30s keeps this comfortably
// debounced against other network traffic while still catching a missed
// push reasonably promptly. DISCONNECT_GRACE_MS (player.freqhole.net's
// connectedControllers.ts) is tuned to comfortably outlast this interval.
const POLL_INTERVAL_MS = 30_000;
let pollHandle: ReturnType<typeof setInterval> | null = null;
let unsubscribeStatus: (() => void) | null = null;

/** start/stop polling get_status + the push subscription while a remote
 * target is active - call once (e.g. from an effect watching
 * isRemoteTargetActive()). */
export function setRemoteStatusPolling(enabled: boolean): void {
  if (enabled && !pollHandle) {
    void remoteGetStatus();
    pollHandle = setInterval(() => {
      // swallow dial/fetch failures here (e.g. player unreachable) rather
      // than letting them surface as unhandled rejections - a run of
      // these failing silently is exactly what remoteTargetOffline() above
      // is watching for (lastStatusAt just stops advancing).
      if (isRemoteTargetActive()) void remoteGetStatus().catch(() => {});
    }, POLL_INTERVAL_MS);

    if (!tickHandle) {
      setTickNow(Date.now());
      tickHandle = setInterval(() => setTickNow(Date.now()), TICK_INTERVAL_MS);
    }

    const nodeId = activeTargetNodeId();
    if (nodeId) {
      unsubscribeStatus = subscribeToPlayerStatus(nodeId, (status) => {
        applyRemoteStatus(status as RemoteStatus);
      });
    }
  } else if (!enabled && pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
    applyRemoteStatus(null);
    unsubscribeStatus?.();
    unsubscribeStatus = null;
    if (tickHandle) {
      clearInterval(tickHandle);
      tickHandle = null;
    }
  }
}
