// single entry point for "tune into this radio station" from anywhere in the
// ui (radio view, queue sidebar, history, request-and-listen). when this
// device is the active playback target it just tunes in locally; when a
// paired cenotaph player is, the player is told to tune in itself (it pulls
// the stream straight from the broadcasting remote, using its html
// mediasource radio sink - never the experimental libmpv player).
//
// the player needs its own access to the broadcasting remote for private
// stations. when it doesn't have it, this mirrors the queue's cross-remote
// bridge (playerQueuePush.ts's `tryBridgeToSourceRemote`): if this device is
// admin on that remote, it grants the player read access via `peers_allow`
// and retries once. otherwise it explains what happened in a toast, with an
// action that makes the player send its own access request.

import { adminClientFor, getLocalAdminClient } from "../../api/adminClient";
import { getLocalNodeIdAsync } from "../../api/client";
import { toast } from "../../../components/feedback/Toast";
import { leaveRadio, radioStatus, tuneIntoRadio } from "../radio/radioService";
import { getRemoteByPeerAddr, getTauriManagedRemote } from "../remotes/remoteManager";
import { isP2PRemote } from "../storage/schemas/remote";
import { warn } from "../../../utils/logger";
import { activeTarget } from "./activeTarget";
import {
  remoteRequestSourceAccess,
  remoteTrackPending,
  remoteTuneRadio,
  type CommandAck,
} from "./remotePlaybackControl";

export type RadioTuneOptions = NonNullable<Parameters<typeof tuneIntoRadio>[1]>;

type PlayerTarget = { node_id: string; username: string };

/** tunes into a station on whichever target is active - see this file's
 * header. never rejects for a player target (every failure is reported via
 * toast); local tunes reject exactly like `tuneIntoRadio` does. */
export async function tuneRadio(peerAddr: string, opts: RadioTuneOptions = {}): Promise<void> {
  const target = activeTarget();
  if (target.kind !== "player") {
    await tuneIntoRadio(peerAddr, opts);
    return;
  }
  await tuneRadioOnPlayer(target, peerAddr, opts);
}

/** where the player should dial, plus a human name for that remote. local
 * stations are addressed as "self"/a source id on this device, which the
 * player can't dial - it needs this device's own node id instead. */
async function resolveSource(
  peerAddr: string,
  isLocal: boolean | undefined
): Promise<{ peerAddr: string; name: string } | null> {
  if (isLocal) {
    const nodeId = await getLocalNodeIdAsync();
    if (!nodeId) return null;
    const managed = await getTauriManagedRemote().catch(() => null);
    return { peerAddr: nodeId, name: managed?.name || "this device" };
  }
  const remote = await getRemoteByPeerAddr(peerAddr).catch(() => undefined);
  return { peerAddr, name: remote?.name || shortPeer(peerAddr) };
}

function shortPeer(peerAddr: string): string {
  return peerAddr.length > 16 ? `${peerAddr.slice(0, 8)}…` : peerAddr;
}

/** grants `playerNodeId` read access on the station's remote, if this
 * device is admin there. false on any failure (not admin, not P2P,
 * offline, remote_admin disabled, ...). */
async function tryGrantPlayerAccess(
  peerAddr: string,
  isLocal: boolean | undefined,
  playerNodeId: string
): Promise<boolean> {
  try {
    if (isLocal) {
      const client = getLocalAdminClient();
      if (!client) return false;
      await client.dispatchOrThrow("peers_allow", { node_id: playerNodeId });
      return true;
    }
    const remote = await getRemoteByPeerAddr(peerAddr);
    if (!remote || !isP2PRemote(remote)) return false;
    const client = await adminClientFor(remote);
    await client.dispatchOrThrow("peers_allow", { node_id: playerNodeId });
    return true;
  } catch (e) {
    warn("playerRadio", `peers_allow bridge for radio failed: ${String(e)}`);
    return false;
  }
}

/** tells `player` to tune in, handling source access (see header). resolves
 * false only when the player itself couldn't be reached (the transport
 * threw) - every other failure is the player's own answer, already toasted. */
export async function tuneRadioOnPlayer(
  player: PlayerTarget,
  peerAddr: string,
  opts: RadioTuneOptions
): Promise<boolean> {
  const source = await resolveSource(peerAddr, opts.isLocal);
  if (!source) {
    toast.error(`couldn't work out how ${player.username} can reach this device's station`, {
      title: "radio-tune-failed",
    });
    return true;
  }

  // don't play in two places at once - same reasoning as the target
  // picker's handoff (selectPlaybackTarget.ts).
  if (radioStatus() !== "idle") leaveRadio();

  const send = () => remoteTrackPending(remoteTuneRadio(source.peerAddr, opts.stationId));

  let ack: CommandAck | null;
  try {
    ack = await send();
    if (ack?.ok === false && ack.reason === "source_access_denied") {
      if (await tryGrantPlayerAccess(peerAddr, opts.isLocal, player.node_id)) {
        ack = await send();
      }
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : `couldn't reach ${player.username}`, {
      title: "remote-player-connection-error",
    });
    return false;
  }

  if (ack?.ok === false) reportTuneFailure(player, source, ack, opts.stationName);
  return true;
}

function reportTuneFailure(
  player: PlayerTarget,
  source: { peerAddr: string; name: string },
  ack: CommandAck,
  stationName: string | undefined
): void {
  const station = stationName ? `"${stationName}"` : "that station";
  switch (ack.reason) {
    case "source_access_denied":
      toast.error(
        `${player.username} doesn't have access to ${source.name}, so it can't play ${station}`,
        {
          title: "radio-source-access-denied",
          persistent: true,
          action: {
            label: "request access",
            onClick: () => void sendPlayerAccessRequest(player, source, stationName),
          },
        }
      );
      return;
    case "source_unreachable":
      toast.error(`${player.username} couldn't reach ${source.name} to play ${station}`, {
        title: "radio-source-unreachable",
      });
      return;
    case "tune_failed":
      toast.error(
        ack.detail
          ? `${player.username} couldn't tune into ${station}: ${ack.detail}`
          : `${player.username} couldn't tune into ${station}`,
        { title: "radio-tune-failed" }
      );
      return;
    default:
      // any other reason (not_in_session, invalid_command from an older
      // player, ...) already got sendControl's generic toast.
      return;
  }
}

async function sendPlayerAccessRequest(
  player: PlayerTarget,
  source: { peerAddr: string; name: string },
  stationName: string | undefined
): Promise<void> {
  const message = stationName
    ? `player "${player.username}" would like to tune into ${stationName}`
    : `player "${player.username}" would like to tune into your radio`;
  let ack: CommandAck | null;
  try {
    ack = await remoteRequestSourceAccess(source.peerAddr, player.username, message);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : `couldn't reach ${player.username}`, {
      title: "remote-player-connection-error",
    });
    return;
  }
  if (!ack) return;
  if (ack.ok) {
    toast.success(
      `${player.username} asked ${source.name} for access - try again once it's approved`,
      { title: "radio-access-requested" }
    );
    return;
  }
  if (ack.reason === "request_access_failed") {
    toast.error(
      ack.detail
        ? `${player.username} couldn't send an access request to ${source.name}: ${ack.detail}`
        : `${player.username} couldn't send an access request to ${source.name}`,
      { title: "radio-access-request-failed" }
    );
  }
}
