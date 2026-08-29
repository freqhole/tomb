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
      queue: RemoteMediaRef[];
      auto_download_enabled: boolean;
    }
  | {
      type: "status";
      state: "paused";
      position_ms: number;
      queue: RemoteMediaRef[];
      auto_download_enabled: boolean;
    }
  | { type: "status"; state: "buffering"; queue: RemoteMediaRef[]; auto_download_enabled: boolean }
  | { type: "status"; state: "stopped"; queue: RemoteMediaRef[]; auto_download_enabled: boolean }
  | {
      type: "status";
      state: "error";
      message: string;
      queue: RemoteMediaRef[];
      auto_download_enabled: boolean;
    };

/** the shared queue of the active remote target, or an empty array when
 * nothing is active/no status has arrived yet. */
export const remoteQueue = (): RemoteMediaRef[] => remoteStatus()?.queue ?? [];

/** the active remote target's auto-download toggle, mirrored from whichever
 * client last set it via `remoteSetAutoDownloadEnabled()`. */
export const remoteAutoDownloadEnabled = (): boolean =>
  remoteStatus()?.auto_download_enabled ?? false;

interface CommandAck {
  type: "command_ack";
  ok: boolean;
  reason?: string;
  status?: RemoteStatus;
}

const [remoteStatus, setRemoteStatus] = createSignal<RemoteStatus | null>(null);
export { remoteStatus };

export const remoteIsPlaying = () => remoteStatus()?.state === "now_playing";
export const remotePositionMs = () => {
  const s = remoteStatus();
  return s && "position_ms" in s ? s.position_ms : 0;
};

async function sendControl(command: Record<string, unknown>): Promise<CommandAck | null> {
  const nodeId = activeTargetNodeId();
  if (!nodeId) return null;
  const ack = (await sendPlayerCommand(nodeId, { type: "control", ...command })) as CommandAck;
  if (ack?.status) setRemoteStatus(ack.status);
  return ack;
}

export async function remotePause(): Promise<void> {
  await sendControl({ command: "pause" });
}

export async function remoteResume(): Promise<void> {
  await sendControl({ command: "resume" });
}

export async function remoteSkip(): Promise<void> {
  await sendControl({ command: "skip" });
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
  await sendControl({ command: "seek", position_ms: Math.max(0, Math.round(positionMs)) });
}

export async function remoteSetVolume(volume: number): Promise<void> {
  await sendControl({ command: "set_volume", volume: Math.min(1, Math.max(0, volume)) });
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
  }
}
