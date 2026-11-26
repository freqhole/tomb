import type { Remote } from "../../../app/services/storage/schemas/remote";
import type { PlaylistSelectorItem } from "../../hooks/playlistSelectorState";
import { RemoteMusicDataSource } from "../../data/remote/remoteSource";
import { RemoteVideoDataSource } from "../../../video/data/remote/remoteSource";
import { syncVideoToLocal } from "../../../video/services/sync/syncVideoToLocal";
import { syncSongToLocal } from "./syncSongToLocal";

/** import the source items before adding destination-specific ids to a local playlist. */
export async function importPlaylistItemsToLocal(
  items: PlaylistSelectorItem[],
  source: Remote
): Promise<PlaylistSelectorItem[]> {
  const music = new RemoteMusicDataSource(source);
  const video = new RemoteVideoDataSource(source);
  const imported: PlaylistSelectorItem[] = [];

  for (const item of items) {
    if (item.entity_type === "song") {
      const song = await music.getSongById(item.entity_id);
      if (!song) throw new Error(`song not found on ${source.name}: ${item.entity_id}`);
      const result = await syncSongToLocal(
        { ...song, remote_server_id: source.remote_id },
        undefined,
        source
      );
      if (!result.success || !result.localSongId) {
        throw new Error(`failed to import "${song.title}": ${result.error ?? "local song id missing"}`);
      }
      imported.push({ entity_type: "song", entity_id: result.localSongId });
    } else {
      const found = await video.getVideoById(item.entity_id);
      if (!found) throw new Error(`video not found on ${source.name}: ${item.entity_id}`);
      const result = await syncVideoToLocal(found, source, { force: true, originalOnly: true });
      if (!result.success || !result.videoId) {
        throw new Error(`failed to import "${found.title}": ${result.error ?? "local video id missing"}`);
      }
      imported.push({ entity_type: "video", entity_id: result.videoId });
    }
  }
  return imported;
}
