import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo } from "solid-js";
import { ZodError } from "zod";
import { getClientForRemote } from "../app/api/client";
import { getCurrentRemote } from "../music/data/currentState";
import { error } from "./logger";
import { refreshQueuedAvailability } from "../music/services/queue/refreshAvailability";
import { appState } from "../app/services/storage/db";

const MEDIA_QUERY_ROOTS = new Set([
  "songs", "albums", "album", "artists", "artist", "playlists",
  "videos", "video-series", "playlist-video-items", "search", "favorites",
  "library-albums", "album-status-counts", "known-offline-media",
]);

function unsupported(cause: unknown): boolean {
  return cause instanceof ZodError &&
    cause.issues.some((issue) => issue.path.includes("route_not_found"));
}

export function useLibraryAvailability(
  remote: () => Parameters<typeof getClientForRemote>[0] | undefined = () =>
    getCurrentRemote() ?? undefined
) {
  const client = useQueryClient();
  const revision = createQuery<string>(() => ({
    queryKey: ["library-availability-revision", remote()?.remote_id],
    enabled: !!remote(),
    staleTime: 5_000,
    refetchInterval: (query) => unsupported(query.state.error) ? false : 5_000,
    retry: (count, cause) => count < 1 && !unsupported(cause),
    queryFn: async () => {
      const target = remote();
      if (!target) throw new Error("library availability requires a remote");
      const api = await getClientForRemote(target);
      const response = await api.music.libraryAvailabilityRevision();
      if (!response.success) throw response.error;
      const key = ["library-availability-revision", target.remote_id];
      if (client.getQueryData(key) !== response.data.revision) {
        await client.invalidateQueries({
          predicate: (query) => {
            const root = query.queryKey[0];
            if (typeof root !== "string" || !MEDIA_QUERY_ROOTS.has(root)) return false;
            // some detail/playlist keys predate source scoping. refresh those
            // too when the active library changes, without flushing other data.
            return query.queryKey.includes(target.remote_id) ||
              getCurrentRemote()?.remote_id === target.remote_id;
          },
        });
      }
      return response.data.revision;
    },
  }));
  const queueKey = createMemo(() => JSON.stringify(
    (appState()?.queue ?? []).flatMap((item) => {
      const media = item.kind === "song" ? item.song : item.video;
      return media.source_type === "remote" && media.remote_server_id === remote()?.remote_id
        ? [[item.kind, media.id, media.queue_entry_id]]
        : [];
    })
  ));
  const queue = createQuery<boolean>(() => ({
    queryKey: ["queue-availability", remote()?.remote_id, revision.data, queueKey()],
    enabled: !!remote() && revision.isSuccess && queueKey() !== "[]",
    staleTime: 5_000,
    retry: 1,
    refetchInterval: (query) => query.state.error ? 5_000 : false,
    queryFn: async ({ signal }) => {
      const target = remote();
      if (!target) throw new Error("queue availability requires a remote");
      await refreshQueuedAvailability(target, signal);
      return true;
    },
  }));
  createEffect(() => {
    if (revision.error)
      error("availability", "failed to refresh library availability", revision.error);
    if (queue.error)
      error("availability", "failed to refresh queued media availability", queue.error);
  });
}
