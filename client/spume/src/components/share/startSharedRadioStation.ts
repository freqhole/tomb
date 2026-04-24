import { isCharnelMode } from "../../app/services/charnel";
import {
  createPendingRemote,
  getPendingRemoteByPeerAddr,
} from "../../app/services/storage/db";
import { debug } from "../../utils/logger";

export interface StartSharedRadioStationOptions {
  nodeId: string;
  stationId: string;
  stationName?: string;
}

export async function ensurePendingRemoteForNode(nodeId: string): Promise<void> {
  const trimmed = nodeId.trim();
  if (!trimmed) return;

  try {
    const existing = await getPendingRemoteByPeerAddr(trimmed);
    if (existing) return;

    await createPendingRemote({
      peer_addr: trimmed,
      transport: isCharnelMode() ? "app" : "wasm",
      stage: "connected",
      server_name: null,
      server_description: null,
      server_version: null,
      server_image_data: null,
      server_image_type: null,
      knock_username: null,
      knock_message: null,
      error_message: null,
    });
  } catch (error) {
    // pending remotes are a convenience; failure should not block playback.
    debug("shared-radio", "failed to persist pending remote:", error);
  }
}

export async function startSharedRadioStation(opts: StartSharedRadioStationOptions): Promise<void> {
  const nodeId = opts.nodeId.trim();
  if (!nodeId) return;

  await ensurePendingRemoteForNode(nodeId);

  const params = new URLSearchParams();
  params.append("node_id", nodeId);
  params.append("station_id", opts.stationId);
  if (opts.stationName?.trim()) {
    params.append("station_name", opts.stationName.trim());
  }

  window.location.hash = `/radio?${params.toString()}`;
}
