import { useHistoryState } from "./historyState";
import { createQuery } from "@tanstack/solid-query";
import { getCurrentRemote } from "../music/data/currentState";
import { getClientForRemote } from "../app/api/client";
import { createEffect } from "solid-js";
import { error } from "./logger";
import { useLibraryAvailability } from "./useLibraryAvailability";

export function useAvailabilityFilter(
  view: string,
  remote: () => Parameters<typeof getClientForRemote>[0] | undefined = () =>
    getCurrentRemote() ?? undefined
) {
  useLibraryAvailability(remote);
  const [showOffline, setShowOffline] = useHistoryState(`${view}.showOffline`, false);
  const knownOffline = createQuery(() => ({
    queryKey: ["known-offline-media", remote()?.remote_id, view],
    enabled: !!remote(),
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const target = remote();
      if (!target) return false;
      const client = await getClientForRemote(target);
      const params = { filters: { offline_only: true }, limit: 1, offset: 0 };
      const response = await (view === "songs"
        ? client.music.querySongs(params)
        : view === "artists"
          ? client.music.queryArtists(params)
          : view === "videos"
            ? client.video.queryVideos({ params, unassigned: false })
            : view === "series"
              ? client.video.queryVideoSeries(params)
              : client.music.queryAlbums(params));
      if (!response.success)
        throw new Error("failed to check offline media", { cause: response.error });
      // older peers may ignore offline_only; require an explicit annotation.
      return response.data.items.some((item) => item.is_offline === true);
    },
  }));
  createEffect(() => {
    if (knownOffline.error)
      error("availability", "failed to check offline media", knownOffline.error);
  });
  return {
    hideOffline: () => !showOffline(),
    pageInfo: () => ({
      availabilityFilterSelected: showOffline(),
      availabilityFilterAvailable: knownOffline.data === true,
      onAddAvailabilityFilter: () => setShowOffline(true),
      onRemoveAvailabilityFilter: () => setShowOffline(false),
    }),
  };
}
