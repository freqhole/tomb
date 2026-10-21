// @vitest-environment jsdom

import { createSignal, type JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VirtualSongList } from "./VirtualSongList";
import type { Song } from "../../music/data/types";

const layout = vi.hoisted(() => ({ narrow: false, mobile: false }));
vi.mock("../../config/breakpoints", () => ({ isNarrowViewport: () => layout.narrow }));
vi.mock("../../utils/isMobile", () => ({ isMobile: () => layout.mobile }));
vi.mock("@tanstack/solid-virtual", () => ({
  createVirtualizer: (options: { count: number }) => ({
    getTotalSize: () => 128,
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({ index, start: index * 64 })),
    measure: vi.fn(),
  }),
}));
vi.mock("../media/MediaThumbnail", () => ({
  MediaThumbnail: (props: { enablePlayClick: boolean; onPlayClick: () => void }) => (
    <button data-thumbnail disabled={!props.enablePlayClick} onClick={() => props.onPlayClick()}>
      play
    </button>
  ),
}));
vi.mock("../text/MarqueeText", () => ({
  MarqueeText: (props: { text: string }) => <span>{props.text}</span>,
}));
vi.mock("../ratings/FavoriteHeart", () => ({ FavoriteHeart: () => null }));
vi.mock("../ratings/Rating", () => ({ Rating: () => null }));
vi.mock("../overlays/ContextMenu", () => ({
  ContextMenu: (props: { children: JSX.Element }) => <>{props.children}</>,
}));

const song: Song = {
  id: "offline",
  title: "an offline song",
  sha256: "",
  artist_id: "artist",
  album_id: "album",
  track_number: 1,
  disc_number: 1,
  duration_seconds: 42,
  year: null,
  bpm: null,
  track_artist: null,
  lyrics: null,
  metadata: null,
  created_at: 0,
  updated_at: 0,
  artist_name: "artist",
  album_title: "album",
  album_added_at: 0,
  album_primary_genre_id: null,
  source_type: "remote",
  opfs_path: null,
  file_name: null,
  file_size: null,
  last_modified: null,
  mime_type: null,
  source_url: null,
  downloaded_at: null,
  remote_server_id: "remote",
  remote_song_id: "offline",
  blake3: null,
  added_at: 0,
  is_offline: true,
};
let host: HTMLDivElement | undefined;
let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  dispose?.();
  host?.remove();
  vi.unstubAllGlobals();
});

describe("revealed offline songs", () => {
  it.each([false, true])(
    "preserves order, inspection and availability changes (compact: %s)",
    (narrow) => {
      layout.narrow = narrow;
      layout.mobile = narrow;
      const [offline, setOffline] = createSignal(true);
      const inspect = vi.fn();
      const play = vi.fn();
      host = document.createElement("div");
      document.body.appendChild(host);
      dispose = render(
        () => (
          <VirtualSongList
            songs={[
              { ...song, is_offline: offline() },
              { ...song, id: "online", title: "an online song", is_offline: false },
            ]}
            height={300}
            onSongClick={inspect}
            onSongDoubleClick={play}
            onPlayClick={play}
          />
        ),
        host
      );
      const rows = () => host!.querySelectorAll<HTMLElement>("[data-row-index]");
      expect(rows()).toHaveLength(2);
      expect(rows()[0].textContent).toContain("an offline song");
      expect(rows()[1].textContent).toContain("an online song");
      expect(host.querySelectorAll('[title="media is on offline storage"]')).toHaveLength(1);
      expect(rows()[0].querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
      rows()[0].dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
      expect(play).not.toHaveBeenCalled();
      if (!narrow) {
        rows()[0].dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
        expect(inspect).toHaveBeenCalledTimes(1);
      }
      rows()[1].querySelector<HTMLButtonElement>("button")!.click();
      expect(play).toHaveBeenCalledTimes(1);
      setOffline(false);
      expect(rows()).toHaveLength(2);
      expect(host.querySelectorAll('[title="media is on offline storage"]')).toHaveLength(0);
      rows()[0].querySelector<HTMLButtonElement>("button")!.click();
      expect(play).toHaveBeenCalledTimes(2);
    }
  );
});
