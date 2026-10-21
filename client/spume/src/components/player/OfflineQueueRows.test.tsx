// @vitest-environment jsdom

import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueueSongRow } from "./QueueSongRow";
import { VideoQueueRow } from "./VideoQueueRow";
import { SongRow } from "../songs/SongRow";
import type { Song } from "../../music/services/storage/types";

vi.mock("../../app/services/charnel", () => ({ isCharnelMode: () => false }));
vi.mock("../../utils/isMobile", () => ({ isMobile: () => false }));
vi.mock("../icons/registry", () => ({
  Icon: () => null,
  PlayIcon: () => null,
  PauseIcon: () => null,
}));
vi.mock("../text/MarqueeText", () => ({
  MarqueeText: (props: { text: string }) => <span>{props.text}</span>,
}));
vi.mock("../media/MediaThumbnail", () => ({
  MediaThumbnail: () => <span>thumbnail</span>,
}));
vi.mock("../../music/services/cache/blobCache", () => ({
  isRemoteBlobCachedReactive: () => false,
}));
vi.mock("../../music/services/download", () => ({
  isSongOnDiskEphemeral: () => false,
  isSongSyncedLocally: () => false,
  getLoadingProgress: () => undefined,
}));
vi.mock("../../music/services/storage/audioAccess", () => ({
  isPlayingDirectURLReactive: () => false,
}));
vi.mock("../../music/services/storage/blobResolver", () => ({
  useResolvedP2PImageUrl: () => () => undefined,
}));
vi.mock("../../music/services/storage/blobs", () => ({
  getCachedBlobObjectURL: () => undefined,
}));
vi.mock("../../video/components/VideoCard", () => ({
  useLocalVideoPosterUrl: () => () => undefined,
}));
vi.mock("../../video/queries/series", () => ({
  useVideoSeriesListQuery: () => ({ data: { pages: [] } }),
  useVideoSeasonsQuery: () => ({ data: [] }),
}));
vi.mock("../forms/VideoSeasonAutocomplete", () => ({ formatSeasonLabel: vi.fn() }));
vi.mock("../../video/services/syncState", () => ({ isVideoSyncedLocally: () => false }));

const song: Song = {
  id: "song",
  title: "song",
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
  remote_song_id: "song",
  blake3: null,
  added_at: 0,
};

let dispose: (() => void) | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  dispose?.();
  host?.remove();
});

describe("offline row feedback", () => {
  it.each(["song", "video"])(
    "%s queue badges update without changing removal, drag or manual-play callbacks",
    (kind) => {
      const [offline, setOffline] = createSignal<boolean>();
      const play = vi.fn();
      const remove = vi.fn((e: MouseEvent) => e.stopPropagation());
      const drag = vi.fn();
      const props = {
        index: 3,
        isCurrentlyPlaying: false,
        isUpNext: true,
        isDragging: false,
        isDropTarget: false,
        top: 204,
        progress: 0,
        onClick: play,
        onDoubleClick: play,
        onRemove: remove,
        onDragStart: drag,
        onDragOver: vi.fn(),
        onDragLeave: vi.fn(),
        onDragEnd: vi.fn(),
        onDrop: vi.fn(),
        onPointerDown: vi.fn(),
      };
      host = document.createElement("div");
      document.body.appendChild(host);
      dispose = render(
        () =>
          kind === "song" ? (
            <QueueSongRow {...props} song={{ ...song, is_offline: offline() }} />
          ) : (
            <VideoQueueRow
              {...props}
              video={{
                id: "video",
                title: "video",
                content_type: "movie",
                media_blob_id: "blob",
                created_at: 0,
                updated_at: 0,
                source_type: "remote",
                is_offline: offline() ?? false,
              }}
            />
          ),
        host
      );
      expect(host.querySelector('[title="media is on offline storage"]')).toBeNull();
      setOffline(true);
      expect(host.querySelectorAll('[title="media is on offline storage"]')).toHaveLength(1);
      const row = host.firstElementChild!;
      expect(row.getAttribute("draggable")).toBe("true");
      row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      row.dispatchEvent(new Event("dragstart", { bubbles: true }));
      host.querySelector<HTMLButtonElement>('[aria-label="remove from queue"]')!.click();
      expect(play).toHaveBeenCalledTimes(1);
      expect(drag).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledTimes(1);
      setOffline(false);
      expect(host.querySelector('[title="media is on offline storage"]')).toBeNull();
    }
  );

  it("detail song badges leave existing row actions unchanged", () => {
    const [offline, setOffline] = createSignal(true);
    const play = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    dispose = render(
      () => <SongRow title="song" duration="0:42" isOffline={offline()} onDoubleClick={play} />,
      host
    );
    expect(host.querySelectorAll('[title="media is on offline storage"]')).toHaveLength(1);
    host.firstElementChild!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(play).toHaveBeenCalledTimes(1);
    setOffline(false);
    expect(host.querySelector('[title="media is on offline storage"]')).toBeNull();
  });
});
