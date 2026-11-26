// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/solid-query";
import { render } from "solid-js/web";
import { expect, it, vi } from "vitest";
import { useDeletePlaylistMutation } from "./playlists";

const mocks = vi.hoisted(() => ({ deletePlaylist: vi.fn() }));
vi.mock("../data", () => ({
  getDataSource: () => ({ deletePlaylist: mocks.deletePlaylist }),
}));

it("removes a deleted playlist from its source caches without waiting for refetches", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = { items: [{ playlist_id: "deleted" }, { playlist_id: "kept" }], total: 2, offset: 0, limit: 50, has_more: false };
  const data = { pages: [page], pageParams: [0] };
  const listKey = ["playlists", "source", "infinite", undefined, false];
  const selectorKey = ["playlists", "source", "infinite", "selector", ""];
  const recentKey = ["playlists", "source", "recent", 5, true];
  const otherKey = ["playlists", "other", "infinite", undefined, false];
  client.setQueryData(listKey, data);
  client.setQueryData(selectorKey, data);
  client.setQueryData(recentKey, page.items);
  client.setQueryData(otherKey, data);
  const refetch = vi.fn(() => new Promise<never>(() => {}));
  const observer = new QueryObserver(client, { queryKey: listKey, queryFn: refetch, staleTime: Infinity });
  const unsubscribe = observer.subscribe(() => {});
  const host = document.createElement("div");
  const onDeleted = vi.fn(() => {
    expect(client.getQueryData(listKey)).toEqual(data);
  });
  let mutation!: ReturnType<typeof useDeletePlaylistMutation>;
  function Harness() {
    mutation = useDeletePlaylistMutation(onDeleted);
    return null;
  }
  const dispose = render(() => <QueryClientProvider client={client}><Harness /></QueryClientProvider>, host);
  try {
    mocks.deletePlaylist.mockResolvedValue(undefined);
    await mutation.mutateAsync({ playlistId: "deleted", sourceId: "source" });
    expect(mocks.deletePlaylist).toHaveBeenCalledWith("deleted");
    expect(onDeleted).toHaveBeenCalledWith("deleted");
    for (const key of [listKey, selectorKey]) {
      expect(client.getQueryData<typeof data>(key)?.pages[0]).toMatchObject({
        items: [{ playlist_id: "kept" }], total: 1,
      });
    }
    expect(client.getQueryData(recentKey)).toEqual([{ playlist_id: "kept" }]);
    expect(client.getQueryData(otherKey)).toEqual(data);
    expect(refetch).toHaveBeenCalled();
  } finally {
    dispose();
    unsubscribe();
    client.clear();
  }
});

it("keeps the cache unchanged when deletion fails", async () => {
  const client = new QueryClient();
  const key = ["playlists", "source", "recent", 5, true];
  const data = [{ playlist_id: "not-deleted" }];
  client.setQueryData(key, data);
  const host = document.createElement("div");
  let mutation!: ReturnType<typeof useDeletePlaylistMutation>;
  function Harness() {
    mutation = useDeletePlaylistMutation();
    return null;
  }
  const dispose = render(() => <QueryClientProvider client={client}><Harness /></QueryClientProvider>, host);
  try {
    mocks.deletePlaylist.mockRejectedValue(new Error("offline"));
    await expect(mutation.mutateAsync({ playlistId: "not-deleted", sourceId: "source" })).rejects.toThrow("offline");
    expect(client.getQueryData(key)).toEqual(data);
  } finally {
    dispose();
    client.clear();
  }
});
