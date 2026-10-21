import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";

type QueryOptions = {
  queryKey: readonly unknown[];
  queryFn: (context: { pageParam: number }) => Promise<unknown>;
};

const { factories, fetchPage } = vi.hoisted(() => ({
  factories: [] as Array<() => QueryOptions>,
  fetchPage: vi.fn(async (_params: unknown) => ({
    items: [], total: 0, offset: 0, has_more: false,
  })),
}));

vi.mock("@tanstack/solid-query", () => ({
  createInfiniteQuery: (factory: () => QueryOptions) => {
    factories.push(factory);
    return {};
  },
}));
vi.mock("../music/data", () => ({
  getDataSource: () => ({
    getSongs: fetchPage, getAlbums: fetchPage, getArtists: fetchPage,
  }),
}));
vi.mock("../music/data/remote/remoteSource", () => ({ RemoteMusicDataSource: class {} }));
vi.mock("../music/data/currentState", () => ({ getCurrentRemote: () => null }));
vi.mock("../video/data", () => ({
  getVideoDataSource: () => ({ getVideos: fetchPage, getVideoSeriesList: fetchPage }),
}));
vi.mock("../app/api/client", () => ({ getClientForRemote: vi.fn() }));
vi.mock("../components/feedback/Toast", () => ({ toast: {} }));
vi.mock("./logger", () => ({ debug: vi.fn() }));

import { useSongsInfiniteQuery, useAlbumsQuery, useArtistsQuery } from "../music/queries/songs";
import { useVideosQuery } from "../video/queries/videos";
import { useVideoSeriesListQuery } from "../video/queries/series";

beforeEach(() => {
  factories.length = 0;
  fetchPage.mockClear();
});

describe("browse availability query wiring", () => {
  for (const [name, hook] of [
    ["songs", useSongsInfiniteQuery],
    ["albums", useAlbumsQuery],
    ["artists", useArtistsQuery],
    ["videos", useVideosQuery],
    ["series", useVideoSeriesListQuery],
  ] as const) {
    it(`${name} sends the filter and separates hidden/shown cache entries`, async () => {
      const state = createRoot((dispose) => {
        const [hide, setHide] = createSignal(true);
        hook({ hideOffline: hide });
        return { dispose, setHide };
      });
      try {
        const hidden = factories[0]();
        await hidden.queryFn({ pageParam: 0 });
        expect(fetchPage).toHaveBeenLastCalledWith(expect.objectContaining({ hide_offline: true }));
        state.setHide(false);
        const shown = factories[0]();
        expect(shown.queryKey).not.toEqual(hidden.queryKey);
        await shown.queryFn({ pageParam: 0 });
        expect(fetchPage).toHaveBeenLastCalledWith(expect.objectContaining({ hide_offline: false }));
      } finally {
        state.dispose();
      }
    });

    it(`${name} leaves non-browse callers unfiltered unless explicitly requested`, async () => {
      const dispose = createRoot((dispose) => {
        hook();
        return dispose;
      });
      try {
        await factories[0]().queryFn({ pageParam: 0 });
        expect(fetchPage).toHaveBeenLastCalledWith(expect.objectContaining({ hide_offline: undefined }));
      } finally {
        dispose();
      }
    });
  }
});
