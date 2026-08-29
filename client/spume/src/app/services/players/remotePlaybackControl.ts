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

export interface RemoteMediaRef {
  source_peer_addr: string;
  blake3_hash: string;
  size_bytes?: number;
  duration_ms?: number;
  mime_type?: string;
  kind?: "audio" | "video";
  title?: string;
  artist?: string;
  artwork_url?: string;
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
    }
  | {
      type: "status";
      state: "paused";
      position_ms: number;
      queue: RemoteMediaRef[];
      auto_download_enabled: boolean;
      volume: number;
    }
  | {
      type: "status";
      state: "buffering";
      queue: RemoteMediaRef[];
      auto_download_enabled: boolean;
      volume: number;
    }
  | {
      type: "status";
      state: "stopped";
      queue: RemoteMediaRef[];
      auto_download_enabled: boolean;
      volume: number;
    }
  | {
      type: "status";
      state: "error";
      message: string;
      queue: RemoteMediaRef[];
      auto_download_enabled: boolean;
      volume: number;
    };

/** the shared queue of the active remote target, or an empty array when
 * nothing is active/no status has arrived yet. */
export const remoteQueue = (): RemoteMediaRef[] => remoteStatus()?.queue ?? [];

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
export const remoteDurationMs = (): number | undefined => {
  const s = remoteStatus();
  return s?.state === "now_playing" ? s.item.duration_ms : undefined;
};

interface CommandAck {
  type: "command_ack";
  ok: boolean;
  reason?: string;
  status?: RemoteStatus;
}

const [remoteStatus, setRemoteStatus] = createSignal<RemoteStatus | null>(null);
export { remoteStatus };

/** clears any known status for the active target - call right when
 * switching to a (possibly different) remote target, so `remoteStatusKnown()`
 * immediately goes back to false and the playerbar shows its loading state
 * until the new target's real status arrives, instead of briefly showing
 * the PREVIOUS target's stale status (`remoteStatus` otherwise only ever
 * gets cleared by `setRemoteStatusPolling(false)`, i.e. switching back to
 * local - switching directly between two different remote targets never
 * hit that path). */
export function resetRemoteStatus(): void {
  setRemoteStatus(null);
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

/** true once at least one real status (poll response, push, or command ack)
 * has arrived for the currently-active remote target - lets callers show a
 * neutral "syncing" state instead of a possibly-wrong default (e.g. looking
 * paused) right after connecting or after a subscription drop/reconnect. */
export const remoteStatusKnown = () => remoteStatus() !== null;

// command-pending feedback (phase 13): sendControl callers below opt in via
// `trackPending: true` for the handful of playerbar-driven commands (play/
// pause, skip, seek, volume) so the UI can show a brief loading state while
// waiting on the ack - NOT set for the background status poll/get_status,
// which would otherwise flicker the same indicator every 3s.
const [pendingCount, setPendingCount] = createSignal(0);
export const remoteCommandPending = () => pendingCount() > 0;

async function sendControl(
  command: Record<string, unknown>,
  opts?: { trackPending?: boolean }
): Promise<CommandAck | null> {
  const nodeId = activeTargetNodeId();
  if (!nodeId) return null;
  if (opts?.trackPending) setPendingCount((n) => n + 1);
  try {
    const ack = (await sendPlayerCommand(nodeId, { type: "control", ...command })) as CommandAck;
    if (ack?.status) setRemoteStatus(ack.status);
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
  await sendControl({ command: "remove_from_queue", index });
}

/** moves a not-yet-playing queue entry from one position to another. */
export async function remoteReorderQueue(fromIndex: number, toIndex: number): Promise<void> {
  await sendControl({ command: "reorder_queue", from_index: fromIndex, to_index: toIndex });
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

const POLL_INTERVAL_MS = 3000;
let pollHandle: ReturnType<typeof setInterval> | null = null;
let unsubscribeStatus: (() => void) | null = null;

/** start/stop polling get_status + the push subscription while a remote
 * target is active - call once (e.g. from an effect watching
 * isRemoteTargetActive()). */
export function setRemoteStatusPolling(enabled: boolean): void {
  if (enabled && !pollHandle) {
    void remoteGetStatus();
    pollHandle = setInterval(() => {
      if (isRemoteTargetActive()) void remoteGetStatus();
    }, POLL_INTERVAL_MS);

    if (!tickHandle) {
      setTickNow(Date.now());
      tickHandle = setInterval(() => setTickNow(Date.now()), TICK_INTERVAL_MS);
    }

    const nodeId = activeTargetNodeId();
    if (nodeId) {
      unsubscribeStatus = subscribeToPlayerStatus(nodeId, (status) => {
        setRemoteStatus(status as RemoteStatus);
      });
    }
  } else if (!enabled && pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
    setRemoteStatus(null);
    unsubscribeStatus?.();
    unsubscribeStatus = null;
    if (tickHandle) {
      clearInterval(tickHandle);
      tickHandle = null;
    }
  }
}
