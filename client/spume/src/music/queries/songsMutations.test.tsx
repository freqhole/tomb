// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";
import { useBulkDeleteSongsMutation } from "./songs";
import { queryKeys } from "./queryKeys";

const { bulkDeleteSongs, warning } = vi.hoisted(() => ({
  bulkDeleteSongs: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("../data", () => ({
  getDataSource: () => ({ bulkDeleteSongs }),
}));
vi.mock("../data/remote/remoteSource", () => ({
  RemoteMusicDataSource: class {},
}));
vi.mock("../../components/feedback/Toast", () => ({
  toast: { warning, error: vi.fn() },
}));

describe("bulk song deletion", () => {
  it.each([false, true])(
    "refreshes artist and album detail caches after deletion (partial failure: %s)",
    async (partialFailure) => {
      const client = new QueryClient();
      const host = document.createElement("div");
      let mutation!: ReturnType<typeof useBulkDeleteSongsMutation>;
      let songs = ["deleted", "kept"];
      const keys = [queryKeys.artists.songs("artist"), queryKeys.albums.songs("album")];
      await Promise.all(
        keys.map((queryKey) =>
          client.fetchQuery({ queryKey, queryFn: async () => ({ items: [...songs] }) })
        )
      );
      bulkDeleteSongs.mockImplementationOnce(async () => {
        songs = ["kept"];
        return { deleted_count: 1, failed_ids: partialFailure ? ["kept"] : [] };
      });
      function Probe() {
        mutation = useBulkDeleteSongsMutation();
        return null;
      }
      const dispose = render(
        () => (
          <QueryClientProvider client={client}>
            <Probe />
          </QueryClientProvider>
        ),
        host
      );
      try {
        await mutation.mutateAsync(["deleted", "kept"]);
        for (const key of keys) {
          expect(client.getQueryData(key)).toEqual({ items: ["kept"] });
        }
        if (partialFailure) expect(warning).toHaveBeenCalledWith("deleted 1 songs, 1 failed");
      } finally {
        dispose();
        client.clear();
        vi.clearAllMocks();
      }
    }
  );
});
