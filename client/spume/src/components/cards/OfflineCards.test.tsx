// @vitest-environment jsdom

import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CollectionCard } from "./CollectionCard";
import { ArtistCard } from "./ArtistCard";
import { VideoCard } from "../../video/components/VideoCard";
import { VideoSeriesCard } from "../../video/components/VideoSeriesCard";
import type { VideoSummary } from "../../video/data/types";

vi.mock("../media/MediaImage", () => ({ MediaImage: () => null }));
vi.mock("../icons/registry", () => ({ PlayIcon: () => null }));
vi.mock("../text/MarqueeText", () => ({
  MarqueeText: (props: { text: string }) => <span>{props.text}</span>,
}));
vi.mock("../ratings/FavoriteHeart", () => ({
  FavoriteHeart: (props: { onToggle: (value: boolean) => void }) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        props.onToggle(true);
      }}
    >
      favorite
    </button>
  ),
}));
vi.mock("../badges/TaxonChips", () => ({ TaxonChipList: () => null }));
vi.mock("../../app/services/storage/db", () => ({ appState: () => null }));
vi.mock("../../video/services/opfs/helpers", () => ({ readVideoPosterFromOPFS: vi.fn() }));
vi.mock("../../video/queries/taxons", () => ({ useVideoTaxonsQuery: () => ({ data: [] }) }));
vi.mock("../../video/queries/tags", () => ({ useVideoEntityTagsQuery: () => ({ data: [] }) }));
vi.mock("../../video/queries/series", () => ({
  useVideoSeriesListQuery: () => ({ data: { pages: [] } }),
  useVideoSeasonsQuery: () => ({ data: [] }),
}));
vi.mock("../forms/VideoSeasonAutocomplete", () => ({ formatSeasonLabel: vi.fn() }));

const video: VideoSummary = {
  id: "video",
  title: "a video",
  content_type: "movie",
  media_blob_id: "blob",
  created_at: 0,
  updated_at: 0,
  added_at: 0,
  source_type: "remote",
  is_offline: true,
};
let host: HTMLDivElement | undefined;
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  host?.remove();
});

describe("offline browse cards", () => {
  it("artist badges follow known availability without changing navigation or play actions", () => {
    const [offline, setOffline] = createSignal<boolean>();
    const navigate = vi.fn();
    const play = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    dispose = render(
      () => (
        <ArtistCard
          artist={{
            artist_id: "artist",
            name: "artist",
            song_count: 2,
            album_count: 1,
            total_duration: 42,
            is_offline: offline(),
          }}
          onClick={navigate}
          onPlay={play}
        />
      ),
      host
    );
    expect(host.textContent).not.toContain("offline");
    setOffline(true);
    expect(host.querySelectorAll('[title="media is on offline storage"]')).toHaveLength(1);
    host.firstElementChild!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    host.querySelector<HTMLButtonElement>('[title="play artist"]')!.click();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(1);
    setOffline(false);
    expect(host.textContent).not.toContain("offline");
  });

  it.each(["album", "video", "series"])(
    "%s keeps metadata and favorites usable but disables direct play until reconnect",
    (kind) => {
      const [offline, setOffline] = createSignal(true);
      const navigate = vi.fn();
      const play = vi.fn();
      const favorite = vi.fn();
      host = document.createElement("div");
      document.body.appendChild(host);
      dispose = render(() => {
        if (kind === "album")
          return (
            <CollectionCard
              collection={{
                id: "album",
                title: "an album",
                domainType: "album",
                isOffline: offline(),
                isFavorite: false,
              }}
              onClick={navigate}
              onPlay={play}
              onFavoriteToggle={favorite}
            />
          );
        if (kind === "video")
          return (
            <VideoCard
              video={{ ...video, is_offline: offline() }}
              onClick={navigate}
              onPlay={play}
              isFavorite={false}
              onFavoriteToggle={favorite}
            />
          );
        return (
          <VideoSeriesCard
            series={{
              id: "series",
              title: "a series",
              created_at: 0,
              updated_at: 0,
              is_offline: offline(),
            }}
            onClick={navigate}
            onPlay={play}
            isFavorite={false}
            onFavoriteToggle={favorite}
          />
        );
      }, host);
      const playButton = () => host!.querySelector<HTMLButtonElement>("button[title]")!;
      expect(host.querySelectorAll('[title="media is on offline storage"]')).toHaveLength(2);
      expect(playButton().disabled).toBe(true);
      playButton().click();
      expect(play).not.toHaveBeenCalled();
      host.firstElementChild!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(navigate).toHaveBeenCalledTimes(1);
      host.querySelector<HTMLButtonElement>("button:not([title])")!.click();
      expect(favorite).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledTimes(1);
      setOffline(false);
      expect(host.querySelectorAll('[title="media is on offline storage"]')).toHaveLength(0);
      expect(playButton().disabled).toBe(false);
      playButton().click();
      expect(play).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledTimes(1);
    }
  );
});
