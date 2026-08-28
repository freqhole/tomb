// phase 6: thin wrappers around playerPairingClient.sendPlayerCommand for
// the transport-control side of a remote target (pause/resume/skip/seek/
// volume), plus a lightweight status poller.
//
// player.freqhole.net's control protocol (control/schema.ts) has no push
// channel yet - status only comes back as an ack on a command, or via an
// explicit get_status - so this polls on an interval while a remote
// target is active rather than reacting to real pushes. matches the
// "no unsolicited push yet" gap already documented for phase 4/4b.
//
// command/status shapes are hand-typed here (not shared with
// player.freqhole.net's zod schema - no cross-package schema sharing
// exists yet between spume and player.freqhole.net).

import { createSignal } from "solid-js";
import { sendPlayerCommand } from "./playerPairingClient";
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
  | { type: "status"; state: "now_playing"; item: RemoteMediaRef; position_ms: number }
  | { type: "status"; state: "paused"; position_ms: number }
  | { type: "status"; state: "buffering" }
  | { type: "status"; state: "stopped" }
  | { type: "status"; state: "error"; message: string };

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

export async function remoteSeek(positionMs: number): Promise<void> {
  await sendControl({ command: "seek", position_ms: Math.max(0, Math.round(positionMs)) });
}

export async function remoteSetVolume(volume: number): Promise<void> {
  await sendControl({ command: "set_volume", volume: Math.min(1, Math.max(0, volume)) });
}

export async function remoteGetStatus(): Promise<void> {
  await sendControl({ command: "get_status" });
}

const POLL_INTERVAL_MS = 3000;
let pollHandle: ReturnType<typeof setInterval> | null = null;

/** start/stop polling get_status while a remote target is active - call
 * once (e.g. from an effect watching isRemoteTargetActive()). */
export function setRemoteStatusPolling(enabled: boolean): void {
  if (enabled && !pollHandle) {
    void remoteGetStatus();
    pollHandle = setInterval(() => {
      if (isRemoteTargetActive()) void remoteGetStatus();
    }, POLL_INTERVAL_MS);
  } else if (!enabled && pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
    setRemoteStatus(null);
  }
}
