import { getClientForRemote, httpRemote } from "../../api/client";
import { confirm } from "../confirmState";
import { currentRadioStation } from "../storage/currentRadioStation";
import type { MediaItem } from "../storage/mediaItem";
import type { RemoteRef } from "../storage/types";
import { getRemoteByPeerAddr, getRemoteByUrl, getTauriManagedRemote } from "../remotes/remoteManager";
import { isRemoteTargetActive } from "../players/activeTarget";
import { leaveRadio, radioNowPlaying, radioStatus } from "./radioService";
import { toast } from "../../../components/feedback/Toast";
import { isValidHttpUrl } from "../../../utils/urls";

type StationClient = Awaited<ReturnType<typeof getClientForRemote>>;

async function stationItemId(
  client: StationClient,
  item: MediaItem,
  sameSource: boolean
): Promise<string | null> {
  const media = item.kind === "song" ? item.song : item.video;
  if (item.kind === "song") {
    if (!sameSource && !media.blake3) return null;
    const result = await client.music.querySongs({
      filters: media.blake3
        ? { media_blob_blake3: [media.blake3], hide_offline: true }
        : { song_ids: [item.song.remote_song_id || item.song.id], hide_offline: true },
      limit: 1,
    });
    if (!result.success) throw new Error(result.error.issues[0]?.message || "could not check the station library");
    return result.data.items[0]?.song.id ?? null;
  }
  if (!media.blake3 && sameSource) {
    const result = await client.video.getVideo({ id: item.video.id });
    if (!result.success) {
      if (result.error.issues.some((issue) => issue.path.includes("video_not_found"))) return null;
      throw new Error(result.error.issues[0]?.message || "could not check the station library");
    }
    return result.data.is_offline ? null : result.data.id;
  }
  if (!media.blake3) return null;
  const metadata = await client.music.blobMetadataByBlake3({ blake3: media.blake3 });
  if (!metadata.success) {
    if (metadata.error.issues.some((issue) => issue.path.includes("media_blob_not_found"))) return null;
    throw new Error(metadata.error.issues[0]?.message || "could not check the station library");
  }
  const result = await client.video.queryVideos({
    params: { filters: { media_blob_ids: [metadata.data.id], hide_offline: true }, limit: 1 },
    unassigned: false,
  });
  if (!result.success) throw new Error(result.error.issues[0]?.message || "could not check the station library");
  return result.data.items[0]?.id ?? null;
}

/** intercept queue additions before local persistence, syncing, or blob downloads.
 * returns "local" only when no station is active or the user chose local playback. */
export async function queueToTunedStation(
  items: MediaItem[],
  position: "end" | "next" = "end"
): Promise<"handled" | "local"> {
  const station = currentRadioStation();
  if (!station || radioStatus() === "idle" || radioStatus() === "error" || isRemoteTargetActive()) {
    return "local";
  }
  if (items.length === 0) return "handled";
  try {
    const ref: RemoteRef = station.is_local
      ? { is_charnel_managed: true }
      : isValidHttpUrl(station.peer_addr)
        ? httpRemote(station.peer_addr)
        : { peer_addr: station.peer_addr };
    const remote = station.is_local
      ? await getTauriManagedRemote()
      : ref.transport === "http"
        ? await getRemoteByUrl(station.peer_addr)
        : await getRemoteByPeerAddr(station.peer_addr);
    const client = await getClientForRemote(remote ?? ref);
    const stations = await client.app.radioStationsFull();
    if (!stations.success) throw new Error(stations.error.issues[0]?.message || "could not check the station");
    const info = stations.data.stations.find((entry) => entry.station_id === station.station_id);
    if (!info) throw new Error("the tuned station is no longer available");

    const resolved: { kind: "song" | "video"; id: string }[] = [];
    if (info.accepts_requests) {
      for (const item of items) {
        if ((info.content_mode === "audio_only" && item.kind === "video")
          || (info.content_mode === "video_only" && item.kind === "song")) break;
        const media = item.kind === "song" ? item.song : item.video;
        const sameSource = !!remote && media.remote_server_id === remote.remote_id;
        const id = await stationItemId(client, item, sameSource);
        if (!id) break;
        resolved.push({ kind: item.kind, id });
      }
    }
    const stillTuned = () => {
      const current = currentRadioStation();
      return current?.station_id === station.station_id && current?.peer_addr === station.peer_addr;
    };
    if (!stillTuned()) return "handled";
    if (resolved.length !== items.length) {
      const accepted = await confirm({
        title: "use your local queue?",
        message: info.accepts_requests
          ? "this media isn't available for this station. stop listening and add the media to your local queue?"
          : "this station doesn't accept requests. stop listening and add the media to your local queue?",
        confirmText: "stop listening and queue locally",
        cancelText: "cancel",
        variant: "secondary",
        cancelVariant: "danger",
        cancelLast: true,
      });
      if (!accepted) return "handled";
      if (!stillTuned()) return "handled";
      leaveRadio();
      return "local";
    }
    // preserve batch order and never fall back to local downloads after a failed submit.
    const queued = await client.app.radioListRequests({ station_id: info.station_id });
    if (!queued.success) throw new Error(queued.error.issues[0]?.message || "could not check the station queue");
    if (!stillTuned()) return "handled";
    const existing = new Set(queued.data.requests.map((request) => `${request.kind}:${request.item_id}`));
    const playing = radioNowPlaying();
    if (playing?.song_id) existing.add(`${playing.kind ?? "song"}:${playing.song_id}`);
    const additions = resolved.filter((item) => {
      const key = `${item.kind}:${item.id}`;
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    });
    for (const [index, item] of additions.entries()) {
      const result = await client.app.radioSubmitRequest({
        station_id: info.station_id, kind: item.kind, item_id: item.id,
        queue_position: position === "next" ? index : undefined,
      });
      if (!result.success) throw new Error(result.error.issues[0]?.message || "could not queue the station request");
    }
    return "handled";
  } catch (error) {
    toast.error(`could not queue on this station: ${error instanceof Error ? error.message : String(error)}`);
    return "handled";
  }
}
