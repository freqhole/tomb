// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentRemoteInfo } from "../../music/data/currentState";
import {
  useArtistAutocompleteQuery,
  useAlbumAutocompleteQuery,
} from "../../music/queries/autocomplete";
import { useVideoSeriesListQuery, useVideoSeasonsQuery } from "../../video/queries/series";

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  activeArtists: vi.fn(),
  activeAlbums: vi.fn(),
  localArtists: vi.fn(),
  localAlbums: vi.fn(),
  localSeries: vi.fn(),
  localSeasons: vi.fn(),
}));
vi.mock("../../app/api/client", () => ({
  getClientForRemote: mocks.getClient,
  isNetworkError: () => false,
}));
vi.mock("../../music/data", () => ({
  getDataSource: () => ({ getArtists: mocks.activeArtists, getAlbums: mocks.activeAlbums }),
}));
vi.mock("../../music/data/local/localSource", () => ({
  localDataSource: { getArtists: mocks.localArtists, getAlbums: mocks.localAlbums },
}));
vi.mock("../../video/data/local/localSource", () => ({
  localVideoDataSource: {
    getVideoSeriesList: mocks.localSeries,
    getVideoSeasons: mocks.localSeasons,
  },
}));
vi.mock("../../music/data/remote/remoteSource", () => ({
  RemoteOfflineError: class extends Error {},
}));
vi.mock("../../music/data/currentState", () => ({
  getCurrentRemote: () => ({ remote_id: "browsed", name: "unrelated library" }),
}));

const a: CurrentRemoteInfo = { remote_id: "a", name: "fetch destination" };
const b: CurrentRemoteInfo = { remote_id: "b", name: "another destination" };
function client(id: string) {
  const page = { items: [], total_count: 0, offset: 0, limit: 15, has_more: false };
  return {
    music: {
      queryArtists: vi.fn(async () => ({ success: true, data: page })),
      queryAlbums: vi.fn(async () => ({ success: true, data: page })),
    },
    video: {
      queryVideoSeries: vi.fn(async () => ({
        success: true,
        data: {
          ...page,
          items: [{ id: `${id}-series`, title: id }],
        },
      })),
      listVideoSeasons: vi.fn(async () => ({ success: true, data: [{ id: `${id}-season` }] })),
    },
  };
}
const clients = new Map<string, ReturnType<typeof client>>();
let dispose: (() => void) | undefined;
let queryClient: QueryClient;

function lookups(origin: CurrentRemoteInfo | null | undefined) {
  return {
    artist: useArtistAutocompleteQuery(
      () => "search",
      () => origin
    ),
    album: useAlbumAutocompleteQuery(
      () => "search",
      () => "artist",
      () => origin
    ),
    series: useVideoSeriesListQuery({ keyScope: "autocomplete", remote: () => origin }),
    season: useVideoSeasonsQuery(
      () => "same-series-id",
      () => origin
    ),
  };
}
function mount(origins: (CurrentRemoteInfo | null | undefined)[]) {
  const queries: ReturnType<typeof lookups>[] = [];
  function Probe() {
    for (const origin of origins) queries.push(lookups(origin));
    return null;
  }
  dispose = render(
    () => (
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    ),
    document.createElement("div")
  );
  return queries;
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.clear();
  for (const id of ["a", "b", "browsed"]) clients.set(id, client(id));
  mocks.getClient.mockImplementation(async (remote: CurrentRemoteInfo) =>
    clients.get(remote.remote_id)
  );
  const page = { items: [], total: 0, offset: 0, limit: 15, has_more: false };
  mocks.activeArtists.mockResolvedValue(page);
  mocks.activeAlbums.mockResolvedValue(page);
  mocks.localArtists.mockResolvedValue(page);
  mocks.localAlbums.mockResolvedValue(page);
  mocks.localSeries.mockResolvedValue({ items: [], total_count: 0, offset: 0, has_more: false });
  mocks.localSeasons.mockResolvedValue([]);
});
afterEach(() => {
  dispose?.();
  queryClient.clear();
});

describe("review lookup library routing", () => {
  it("uses the review library for artist, album, series, and season searches", async () => {
    const [queries] = mount([a]);
    await vi.waitFor(() => {
      for (const query of Object.values(queries)) expect(query.isSuccess).toBe(true);
    });
    const api = clients.get("a")!;
    expect(api.music.queryArtists).toHaveBeenCalled();
    expect(api.music.queryAlbums).toHaveBeenCalled();
    expect(api.video.queryVideoSeries).toHaveBeenCalled();
    expect(api.video.listVideoSeasons).toHaveBeenCalledWith({ series_id: "same-series-id" });
    expect(mocks.activeArtists).not.toHaveBeenCalled();
    expect(mocks.activeAlbums).not.toHaveBeenCalled();
    expect(clients.get("browsed")!.video.queryVideoSeries).not.toHaveBeenCalled();
    expect(clients.get("browsed")!.video.listVideoSeasons).not.toHaveBeenCalled();
  });

  it("keeps local file review lookups local while browsing a remote", async () => {
    const [queries] = mount([null]);
    await vi.waitFor(() => {
      for (const query of Object.values(queries)) expect(query.isSuccess).toBe(true);
    });
    expect(mocks.localArtists).toHaveBeenCalled();
    expect(mocks.localAlbums).toHaveBeenCalled();
    expect(mocks.localSeries).toHaveBeenCalled();
    expect(mocks.localSeasons).toHaveBeenCalledWith("same-series-id");
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.activeArtists).not.toHaveBeenCalled();
    expect(mocks.activeAlbums).not.toHaveBeenCalled();
  });

  it("keeps two libraries' series and season caches separate", async () => {
    const [first, second] = mount([a, b]);
    await vi.waitFor(() => {
      expect(first.series.data?.pages[0].items[0].id).toBe("a-series");
      expect(second.series.data?.pages[0].items[0].id).toBe("b-series");
      expect(first.season.data?.[0].id).toBe("a-season");
      expect(second.season.data?.[0].id).toBe("b-season");
    });
  });

  it("preserves active-library lookup behavior when no review origin is supplied", async () => {
    const [queries] = mount([undefined]);
    await vi.waitFor(() => {
      for (const query of Object.values(queries)) expect(query.isSuccess).toBe(true);
    });
    expect(mocks.activeArtists).toHaveBeenCalled();
    expect(mocks.activeAlbums).toHaveBeenCalled();
    expect(clients.get("browsed")!.video.queryVideoSeries).toHaveBeenCalled();
    expect(clients.get("browsed")!.video.listVideoSeasons).toHaveBeenCalled();
    expect(mocks.localArtists).not.toHaveBeenCalled();
    expect(mocks.localSeries).not.toHaveBeenCalled();
  });
});
