import { useHistoryState } from "./historyState";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { getCurrentRemote } from "../music/data/currentState";
import { getClientForRemote } from "../app/api/client";
import { createEffect } from "solid-js";
import { error } from "./logger";
import { useLibraryAvailability } from "./useLibraryAvailability";
import { ZodError } from "zod";

export function useAvailabilityFilter(
  view: string,
  remote: () => Parameters<typeof getClientForRemote>[0] | undefined = () =>
    getCurrentRemote() ?? undefined
) {
  useLibraryAvailability(remote);
  const cache = useQueryClient();
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
      try {
        const summary = await cache.fetchQuery({
          queryKey: ["offline-media-summary", target.remote_id],
          staleTime: 30_000,
          retry: false,
          queryFn: async () => {
            const response = await client.music.libraryOfflineMedia();
            if (!response.success) throw response.error;
            return response.data;
          },
        });
        const kind = view === "library.albums" ? "albums" : view;
        switch (kind) {
          case "songs": return summary.songs;
          case "artists": return summary.artists;
          case "videos": return summary.videos;
          case "series": return summary.series;
          default: return summary.albums;
        }
      } catch (cause) {
        if (!(cause instanceof ZodError) ||
          !cause.issues.some((issue) => issue.path.includes("route_not_found"))) {
          throw cause;
        }
        // older peers keep the legacy probe; only an unsupported route falls back.
      }
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
        throw response.error;
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
