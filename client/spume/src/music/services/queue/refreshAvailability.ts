import { getClientForRemote } from "../../../app/api/client";
import { appState, updateQueueAvailability } from "../../../app/services/storage/db";
import { warn } from "../../../utils/logger";

export async function refreshQueuedAvailability(
  remote: Parameters<typeof getClientForRemote>[0],
  signal?: AbortSignal
): Promise<void> {
  const remoteId = remote.remote_id;
  if (!remoteId) return;
  const items = (appState()?.queue ?? []).filter((item) => {
    const media = item.kind === "song" ? item.song : item.video;
    return media.source_type === "remote" && media.remote_server_id === remoteId;
  });
  if (items.length === 0) return;
  const api = await getClientForRemote(remote);
  const statuses = new Map<string, boolean>();
  const songIds = [...new Set(items.flatMap((item) =>
    item.kind === "song" ? [item.song.id] : []
  ))];
  for (let offset = 0; offset < songIds.length; offset += 200) {
    signal?.throwIfAborted();
    const ids = songIds.slice(offset, offset + 200);
    const response = await api.music.querySongs({
      filters: { song_ids: ids },
      limit: ids.length,
      offset: 0,
    });
    if (!response.success) throw response.error;
    for (const item of response.data.items) {
      if (typeof item.is_offline === "boolean")
        statuses.set(`song:${item.song.id}`, item.is_offline);
    }
  }
  const videoIds = [...new Set(items.flatMap((item) =>
    item.kind === "video" ? [item.video.id] : []
  ))];
  for (let offset = 0; offset < videoIds.length; offset += 8) {
    signal?.throwIfAborted();
    await Promise.all(videoIds.slice(offset, offset + 8).map(async (videoId) => {
      const response = await api.video.getVideo({ id: videoId });
      if (!response.success) {
        if (response.error.issues.some((issue) => issue.path.includes("video_not_found"))) {
          warn("availability", "queued video no longer exists", { remoteId, videoId });
          return;
        }
        throw response.error;
      }
      if (typeof response.data.is_offline === "boolean")
        statuses.set(`video:${videoId}`, response.data.is_offline);
    }));
  }
  signal?.throwIfAborted();
  await updateQueueAvailability(remoteId, statuses, signal);
}
