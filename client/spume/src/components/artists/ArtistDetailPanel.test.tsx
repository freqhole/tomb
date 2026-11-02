// @vitest-environment jsdom

// regression test for a real bug: `secondaryActionItems` (feeding the
// mobile/desktop ResponsiveActionBar) was originally declared via
// `createMemo` *before* `pendingAction`/`handleShuffle`/`handleAddToQueue`
// were declared further down the component body. `createMemo` evaluates its
// callback eagerly/synchronously at creation time, and some of those
// action entries referenced the not-yet-initialized consts directly (not
// wrapped in a further closure), so mounting with any songs present threw
// `ReferenceError: Cannot access '...' before initialization`. this test
// just needs to mount without throwing - it doesn't exercise the
// ResponsiveActionBar's resize behavior (jsdom can't do real layout).
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtistDetailPanel } from "./ArtistDetailPanel";
import type { Song } from "../../music/services/storage/types";

vi.mock("../../music/hooks/contextMenu", () => ({
  useAlbumContextMenu: () => [],
  useArtistContextMenu: () => [],
  useSongContextMenu: () => [],
}));
vi.mock("../../app/hooks/useBackgroundImageSource", () => ({
  useBackgroundImageFromImages: () => {},
}));
vi.mock("../../app/services/backgroundImage", () => ({
  hasBackgroundImage: () => false,
}));
vi.mock("../../music/data/permissions", () => ({
  canUpdateArtist: () => false,
  canSetFavorite: () => false,
  canSetRating: () => false,
}));
vi.mock("../../app/services/charnel", () => ({
  isCharnelMode: () => false,
}));
vi.mock("../../music/hooks/stationSelectorState", () => ({
  showStationSelector: vi.fn(),
}));
vi.mock("../../music/hooks/modals", () => ({
  useImageCarouselLoading: () => ({ loading: () => false }),
  showShareModal: vi.fn(),
}));
vi.mock("../../music/data", () => ({
  getCurrentRemote: () => undefined,
}));
vi.mock("../../video/queries/videos", () => ({
  useVideosByArtistQuery: () => ({ data: [] }),
}));

let dispose: (() => void) | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  dispose?.();
  host?.remove();
  vi.unstubAllGlobals();
});

describe("ArtistDetailPanel", () => {
  it("shows release date taxons and sorts newest albums first instead of using song years", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );
    const song = (album: string, year: number | null, releaseDate?: string): Song =>
      ({
        id: album,
        sha256: "",
        title: `song ${album}`,
        artist_id: "artist",
        artist_name: "artist",
        album_id: album,
        album_title: album,
        track_number: 1,
        disc_number: 1,
        duration_seconds: 180,
        year,
        album_taxons: releaseDate
          ? [{ id: `date-${album}`, kind_slug: "release_date", label: releaseDate }]
          : [],
      }) as Song;
    const [songs, setSongs] = createSignal([
      song("older", 2099),
      { ...song("older", 2099, "2024-01-02"), id: "older-track-2", track_number: 2 },
      song("unknown", null),
      song("year only", null, "2024"),
      song("newest", 1999, "2024-12-01"),
      song("legacy", 2023),
      song("month only", null, "2024-06"),
    ]);
    host = document.createElement("div");
    document.body.appendChild(host);
    dispose = render(
      () => (
        <QueryClientProvider client={new QueryClient()}>
          <ArtistDetailPanel
            artist={{
              artist_id: "artist",
              name: "artist",
              song_count: 7,
              album_count: 6,
              total_duration: 1260,
            }}
            songs={songs()}
          />
        </QueryClientProvider>
      ),
      host!
    );
    const headers = () => [...host!.querySelectorAll(".sticky")].map((el) => el.textContent);
    expect(headers()).toHaveLength(6);
    for (const [index, title] of [
      "newest",
      "month only",
      "older",
      "year only",
      "legacy",
      "unknown",
    ].entries()) {
      expect(headers()[index]).toContain(title);
    }
    expect(headers()[0]).toContain("2024-12-01");
    expect(headers()[0]).not.toContain("1999");
    expect(headers()[2]).not.toContain("2099");
    expect(headers()[0]).not.toContain("release_date·");
    setSongs((previous) => previous.filter((item) => item.album_id !== "newest"));
    expect(headers()).toHaveLength(5);
    expect(headers()[0]).toContain("month only");
    setSongs((previous) =>
      previous.map((item) =>
        item.album_id === "older"
          ? {
              ...item,
              album_taxons: [{ id: "updated-date", kind_slug: "release_date", label: "2025-02" }],
            }
          : item
      )
    );
    expect(headers()[0]).toContain("older");
    expect(headers()[0]).toContain("2025-02");
  });

  it("mounts without throwing when songs are present (exercises the shuffle/queue action items)", () => {
    // jsdom has no ResizeObserver - ResponsiveActionBar (used for the
    // action bar in this panel) needs one to observe its container.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );

    const song: Song = {
      id: "song-1",
      sha256: "",
      title: "a song",
      artist_id: "artist-1",
      album_id: "album-1",
      track_number: 1,
      disc_number: 1,
      duration_seconds: 180,
      year: 2024,
      bpm: null,
      track_artist: null,
      lyrics: null,
      metadata: null,
      created_at: 0,
      updated_at: 0,
      artist_name: "an artist",
      album_title: "an album",
      album_added_at: 0,
      album_primary_genre_id: null,
    } as Song;

    host = document.createElement("div");
    document.body.appendChild(host);
    const queryClient = new QueryClient();

    expect(() => {
      dispose = render(
        () => (
          <QueryClientProvider client={queryClient}>
            <ArtistDetailPanel
              artist={{
                artist_id: "artist-1",
                name: "an artist",
                song_count: 1,
                album_count: 1,
                total_duration: 180,
              }}
              songs={[song]}
            />
          </QueryClientProvider>
        ),
        host!
      );
    }).not.toThrow();
  });
});
