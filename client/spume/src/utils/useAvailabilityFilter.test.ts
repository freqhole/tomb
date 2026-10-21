import { createRoot, createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { factories, request, methods } = vi.hoisted(() => ({
  factories: [] as Array<
    () => {
      queryKey: unknown[];
      enabled: boolean;
      queryFn: () => Promise<boolean>;
    }
  >,
  request: vi.fn(),
  methods: {
    querySongs: vi.fn(),
    queryArtists: vi.fn(),
    queryAlbums: vi.fn(),
    queryVideos: vi.fn(),
    queryVideoSeries: vi.fn(),
  },
}));
vi.mock("@tanstack/solid-query", () => ({
  createQuery: (factory: (typeof factories)[number]) => {
    factories.push(factory);
    return { data: undefined };
  },
}));
vi.mock("./historyState", () => ({
  useHistoryState: (_key: string, value: boolean) => [() => value, vi.fn()],
}));
vi.mock("./useLibraryAvailability", () => ({ useLibraryAvailability: vi.fn() }));
vi.mock("../music/data/currentState", () => ({ getCurrentRemote: () => undefined }));
vi.mock("../app/api/client", () => ({
  getClientForRemote: async () => ({
    music: {
      querySongs: methods.querySongs,
      queryArtists: methods.queryArtists,
      queryAlbums: methods.queryAlbums,
    },
    video: { queryVideos: methods.queryVideos, queryVideoSeries: methods.queryVideoSeries },
  }),
}));

import { useAvailabilityFilter } from "./useAvailabilityFilter";

beforeEach(() => {
  factories.length = 0;
  request.mockReset();
  for (const method of Object.values(methods)) {
    method.mockReset().mockImplementation(request);
  }
});

describe("known offline media probe", () => {
  for (const view of [
    "songs",
    "albums",
    "artists",
    "videos",
    "series",
    "library.albums",
  ] as const) {
    it(`${view} checks the source independently of the hidden browse list`, async () => {
      const dispose = createRoot((dispose) => {
        useAvailabilityFilter(view, () => ({ remote_id: "remote" }));
        return dispose;
      });
      try {
        request.mockResolvedValue({ success: true, data: { items: [{ is_offline: true }] } });
        const query = factories[0]();
        expect(query.enabled).toBe(true);
        expect(query.queryKey).toContain("remote");
        expect(await query.queryFn()).toBe(true);
        const expectedMethod = {
          songs: "querySongs",
          albums: "queryAlbums",
          artists: "queryArtists",
          videos: "queryVideos",
          series: "queryVideoSeries",
          "library.albums": "queryAlbums",
        } as const;
        for (const [name, method] of Object.entries(methods)) {
          expect(method).toHaveBeenCalledTimes(name === expectedMethod[view] ? 1 : 0);
        }
        const params = request.mock.calls[0][0];
        expect(view === "videos" ? params.params : params).toMatchObject({
          filters: { offline_only: true },
          limit: 1,
          offset: 0,
        });
        for (const items of [[], [{}], [{ is_offline: false }]]) {
          request.mockResolvedValue({ success: true, data: { items } });
          expect(await query.queryFn()).toBe(false);
        }
        request.mockResolvedValue({ success: false, error: "unavailable" });
        await expect(query.queryFn()).rejects.toThrow("failed to check offline media");
      } finally {
        dispose();
      }
    });
  }

  it("disables local probes and changes cache keys when the selected source changes", () => {
    createRoot((dispose) => {
      const [remote, setRemote] = createSignal<{ remote_id: string }>();
      useAvailabilityFilter("songs", remote);
      expect(factories[0]().enabled).toBe(false);
      setRemote({ remote_id: "one" });
      expect(factories[0]()).toMatchObject({
        enabled: true,
        queryKey: ["known-offline-media", "one", "songs"],
      });
      setRemote({ remote_id: "two" });
      expect(factories[0]().queryKey).toEqual(["known-offline-media", "two", "songs"]);
      dispose();
    });
  });
});
