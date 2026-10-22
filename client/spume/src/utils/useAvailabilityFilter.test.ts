import { createRoot, createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

const { factories, request, methods, fetchQuery } = vi.hoisted(() => ({
  factories: [] as Array<
    () => {
      queryKey: unknown[];
      enabled: boolean;
      queryFn: () => Promise<boolean>;
    }
  >,
  request: vi.fn(),
  fetchQuery: vi.fn(),
  methods: {
    libraryOfflineMedia: vi.fn(),
    querySongs: vi.fn(),
    queryArtists: vi.fn(),
    queryAlbums: vi.fn(),
    queryVideos: vi.fn(),
    queryVideoSeries: vi.fn(),
  },
}));
vi.mock("@tanstack/solid-query", () => ({
  useQueryClient: () => ({ fetchQuery }),
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
      libraryOfflineMedia: methods.libraryOfflineMedia,
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
  fetchQuery.mockReset().mockImplementation(({ queryFn }) => queryFn());
  methods.libraryOfflineMedia.mockResolvedValue({
    success: false,
    error: new ZodError([{ code: "custom", path: ["route_not_found"], message: "unsupported" }]),
  });
});

describe("known offline media probe", () => {
  it("uses one source-scoped existence summary without fetching browse rows", async () => {
    const summary = { songs: true, albums: false, artists: true, videos: false, series: true };
    const cached = new Map<string, Promise<typeof summary>>();
    fetchQuery.mockImplementation(({ queryKey, queryFn }) => {
      const key = JSON.stringify(queryKey);
      if (!cached.has(key)) cached.set(key, queryFn());
      return cached.get(key);
    });
    methods.libraryOfflineMedia.mockResolvedValue({ success: true, data: summary });
    const dispose = createRoot((dispose) => {
      for (const view of ["songs", "albums", "artists", "videos", "series", "library.albums"]) {
        useAvailabilityFilter(view, () => ({ remote_id: "remote" }));
      }
      return dispose;
    });
    try {
      expect(await Promise.all(factories.map((factory) => factory().queryFn())))
        .toEqual([true, false, true, false, true, false]);
      expect(methods.libraryOfflineMedia).toHaveBeenCalledTimes(1);
      expect(request).not.toHaveBeenCalled();
      expect(fetchQuery).toHaveBeenCalledWith(expect.objectContaining({
        queryKey: ["offline-media-summary", "remote"],
        staleTime: 30_000,
        retry: false,
      }));
    } finally {
      dispose();
    }
  });

  it("surfaces summary errors instead of falling back to expensive browse queries", async () => {
    methods.libraryOfflineMedia.mockResolvedValue({ success: false, error: new Error("database unavailable") });
    const dispose = createRoot((dispose) => {
      useAvailabilityFilter("songs", () => ({ remote_id: "remote" }));
      return dispose;
    });
    try {
      await expect(factories[0]().queryFn()).rejects.toThrow("database unavailable");
      expect(request).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

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
          expect(method).toHaveBeenCalledTimes(
            name === expectedMethod[view] || name === "libraryOfflineMedia" ? 1 : 0
          );
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
        await expect(query.queryFn()).rejects.toBe("unavailable");
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
