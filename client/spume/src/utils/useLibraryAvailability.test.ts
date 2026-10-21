import { createRoot } from "solid-js";
import { ZodError } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Options = {
  queryKey: unknown[];
  enabled: boolean;
  queryFn: () => Promise<unknown>;
  retry: (count: number, error: unknown) => boolean;
  refetchInterval: (query: { state: { error: unknown } }) => number | false;
};
const mocks = vi.hoisted(() => ({
  factories: [] as Array<() => Options>,
  request: vi.fn(),
  invalidate: vi.fn(),
  cached: undefined as string | undefined,
  remoteId: "one",
}));
vi.mock("@tanstack/solid-query", () => ({
  createQuery: (factory: () => Options) => {
    mocks.factories.push(factory);
    return {};
  },
  useQueryClient: () => ({
    getQueryData: () => mocks.cached,
    invalidateQueries: mocks.invalidate,
  }),
}));
vi.mock("../music/data/currentState", () => ({
  getCurrentRemote: () => ({ remote_id: mocks.remoteId }),
}));
vi.mock("../app/api/client", () => ({
  getClientForRemote: async () => ({
    music: { libraryAvailabilityRevision: mocks.request },
  }),
}));
vi.mock("../app/services/storage/db", () => ({ appState: () => null }));
vi.mock("../music/services/queue/refreshAvailability", () => ({
  refreshQueuedAvailability: vi.fn(),
}));
import { useLibraryAvailability } from "./useLibraryAvailability";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.factories.length = 0;
  mocks.cached = undefined;
  mocks.remoteId = "one";
});

describe("library availability invalidation", () => {
  it("refreshes media, count and offline-probe caches, but not unrelated data or itself", async () => {
    const dispose = createRoot((dispose) => {
      useLibraryAvailability();
      return dispose;
    });
    try {
      mocks.request.mockResolvedValue({ success: true, data: { revision: "new" } });
      const options = mocks.factories[0]();
      expect(await options.queryFn()).toBe("new");
      const { predicate } = mocks.invalidate.mock.calls[0][0];
      for (const key of [
        ["songs", "one"], ["library-albums", "one"], ["album-status-counts", "one"],
        ["known-offline-media", "one", "songs"], ["video-series", "one"],
        ["playlists", "playlist-id", "songs"],
      ]) expect(predicate({ queryKey: key })).toBe(true);
      expect(predicate({ queryKey: ["library-availability-revision", "one"] })).toBe(false);
      expect(predicate({ queryKey: ["users", "one"] })).toBe(false);
      mocks.cached = "new";
      await options.queryFn();
      expect(mocks.invalidate).toHaveBeenCalledTimes(1);
      mocks.cached = "old";
      await options.queryFn();
      expect(mocks.invalidate).toHaveBeenCalledTimes(2);
    } finally { dispose(); }
  });

  it("does not reinterpret failures as availability changes and stops polling unsupported peers", async () => {
    const dispose = createRoot((dispose) => {
      useLibraryAvailability(() => ({ remote_id: "two" }));
      return dispose;
    });
    try {
      const options = mocks.factories[0]();
      const failure = new ZodError([{ code: "custom", path: ["route_not_found"], message: "old peer" }]);
      mocks.request.mockResolvedValue({ success: false, error: failure });
      await expect(options.queryFn()).rejects.toBe(failure);
      expect(mocks.invalidate).not.toHaveBeenCalled();
      expect(options.retry(0, failure)).toBe(false);
      expect(options.refetchInterval({ state: { error: failure } })).toBe(false);
      expect(options.refetchInterval({ state: { error: new Error("network") } })).toBe(5000);
      mocks.request.mockResolvedValue({ success: true, data: { revision: "new" } });
      await options.queryFn();
      const { predicate } = mocks.invalidate.mock.calls[0][0];
      expect(predicate({ queryKey: ["songs", "one"] })).toBe(false);
      expect(predicate({ queryKey: ["songs", "two"] })).toBe(true);
    } finally { dispose(); }
  });

  it("disables probes without a remote", () => {
    createRoot((dispose) => {
      useLibraryAvailability(() => undefined);
      expect(mocks.factories[0]().enabled).toBe(false);
      expect(mocks.factories[1]().enabled).toBe(false);
      dispose();
    });
  });
});
