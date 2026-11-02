import { QueryClient, QueryObserver } from "@tanstack/solid-query";
import { describe, expect, it, vi } from "vitest";
import { invalidateMusicLibraryQueries } from "./cacheUpdates";
import { queryKeys } from "./queryKeys";

describe("music library write invalidation", () => {
  it("refreshes active artist and album detail song lists after a deletion", async () => {
    const client = new QueryClient();
    let songs = ["deleted", "kept"];
    const keys = [queryKeys.artists.songs("artist"), queryKeys.albums.songs("album")];
    const observers = keys.map(
      (queryKey) =>
        new QueryObserver(client, {
          queryKey,
          queryFn: async () => ({ items: [...songs] }),
          staleTime: Infinity,
          refetchOnMount: false,
        })
    );
    const unsubscribe = observers.map((observer) => observer.subscribe(() => {}));
    try {
      await Promise.all(observers.map((observer) => observer.refetch()));
      songs = ["kept"];
      await invalidateMusicLibraryQueries(client);
      for (const key of keys) {
        expect(client.getQueryData(key)).toEqual({ items: ["kept"] });
      }
    } finally {
      unsubscribe.forEach((dispose) => dispose());
      client.clear();
    }
  });

  it("refreshes inactive caches, including explicit remotes and library album counts", async () => {
    const client = new QueryClient();
    const keys = [
      queryKeys.songs.all(),
      queryKeys.albums.all(),
      queryKeys.artists.all(),
      queryKeys.albums.songs("album", "local"),
      queryKeys.artists.albums("artist"),
      ["library-albums", "local"],
    ];
    const queryFn = vi.fn().mockResolvedValue("before deletion");
    try {
      await Promise.all(keys.map((queryKey) => client.fetchQuery({ queryKey, queryFn })));
      client.setQueryData(["unrelated"], "unchanged");
      client.setQueryData(["songs", "other-remote"], "other source");
      queryFn.mockResolvedValue("after deletion");
      await invalidateMusicLibraryQueries(client);
      for (const key of keys) expect(client.getQueryData(key)).toBe("after deletion");
      expect(client.getQueryData(["unrelated"])).toBe("unchanged");
      expect(client.getQueryState(["songs", "other-remote"])?.isInvalidated).toBe(false);
      expect(queryFn).toHaveBeenCalledTimes(keys.length * 2);
    } finally {
      client.clear();
    }
  });

  it("can target an explicit remote without refetching another source's song queries", async () => {
    const client = new QueryClient();
    const localKey = queryKeys.songs.all();
    const remoteKey = ["songs", "remote"];
    const queryFn = vi.fn().mockResolvedValue("old remote data");
    try {
      client.setQueryData(localKey, "local data");
      await client.fetchQuery({ queryKey: remoteKey, queryFn });
      queryFn.mockResolvedValue("updated remote data");
      await invalidateMusicLibraryQueries(client, "remote");
      expect(client.getQueryData(remoteKey)).toBe("updated remote data");
      expect(client.getQueryState(localKey)?.isInvalidated).toBe(false);
    } finally {
      client.clear();
    }
  });
});
