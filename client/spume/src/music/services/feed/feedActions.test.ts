import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedItem, FeedItemType } from "../../data/types";

const mocks = vi.hoisted(() => ({
  song: vi.fn(async (id: string) => ({ id, sha256: id, title: id, album_id: "song-album" })),
  video: vi.fn(async (id: string) => ({ id, title: id, series_id: "series" })),
  album: vi.fn(),
  artist: vi.fn(),
  session: vi.fn(),
  playlist: vi.fn(),
  play: vi.fn(),
  append: vi.fn(),
  playVideo: vi.fn(),
  appendVideos: vi.fn(),
  navigate: vi.fn(),
  highlight: vi.fn(),
  carousel: vi.fn(),
  resolveImage: vi.fn(async () => "blob:resolved"),
  error: vi.fn(),
  tune: vi.fn(),
  musicRemote: vi.fn(),
  videoRemote: vi.fn(),
}));
vi.mock("../../data/remote/remoteSource", () => ({
  RemoteMusicDataSource: class {
    constructor(remote: unknown) {
      mocks.musicRemote(remote);
    }
    getSongById = mocks.song;
    getAlbumSongs = mocks.album;
    getArtistSongs = mocks.artist;
    getPlaybackSession = mocks.session;
  },
}));
vi.mock("../../../video/data/remote/remoteSource", () => ({
  RemoteVideoDataSource: class {
    constructor(remote: unknown) {
      mocks.videoRemote(remote);
    }
    getVideoById = mocks.video;
  },
}));
vi.mock("../../../app/api/client", () => ({
  getClientForRemote: async () => ({ entities: { listPlaylistItems: mocks.playlist } }),
}));
vi.mock("../queue/queue", () => ({ playQueue: mocks.play, addToQueue: mocks.append }));
vi.mock("../../../video/services/queue/playVideoQueue", () => ({
  playVideoQueue: mocks.playVideo,
}));
vi.mock("../../../video/services/videoQueueActions", () => ({
  addVideosToQueue: mocks.appendVideos,
}));
vi.mock("../../state/highlightedSong", () => ({ setHighlightedSongId: mocks.highlight }));
vi.mock("../../hooks/modals", () => ({ showImageCarousel: mocks.carousel }));
vi.mock("../storage/blobResolver", () => ({ resolveBlobUrl: mocks.resolveImage }));
vi.mock("../../../components/feedback/Toast", () => ({ toast: { error: mocks.error } }));
vi.mock("../../../app/services/players/playerRadio", () => ({ tuneRadio: mocks.tune }));
vi.mock("../../utils/routing", () => {
  const route = (remote: string, path: string) => `/${remote}${path}`;
  return {
    buildRouteFor: route,
    routes: {
      albumOn: (remote: string, id: string) => route(remote, `/albums/${id}`),
      artistOn: (remote: string, id: string) => route(remote, `/artists/${id}`),
      playlistOn: (remote: string, id: string) => route(remote, `/playlists/${id}`),
      videoDetailOn: (remote: string, id: string) => route(remote, `/video/${id}`),
      videoSeriesOn: (remote: string, id: string) => route(remote, `/video/series/${id}`),
      radioStation: (id: string) => `/radio?station_id=${id}`,
    },
  };
});

import { createFeedActions } from "./feedActions";

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: "event",
    feed_type: "recent_album",
    title: "title",
    song_id: null,
    album_id: null,
    artist_id: null,
    playlist_id: null,
    video_id: null,
    entity_id: null,
    subtitle: null,
    images: null,
    created_at: 1,
    user_id: null,
    username: null,
    play_count: null,
    rating: null,
    target_type: null,
    session_id: null,
    session_type: null,
    session_status: null,
    progress_percent: null,
    songs_completed: null,
    total_songs: null,
    artist_name: null,
    album_title: null,
    genre: null,
    genre_id: null,
    year: null,
    song_count: null,
    songs_added: null,
    total_duration_ms: null,
    image_count: null,
    urls: null,
    description: null,
    tags: null,
    is_favorite: false,
    is_initial_add: true,
    collage_images: null,
    entity_created_at: null,
    ...overrides,
  };
}
const remote = { remote_id: "non-active-remote", peer_addr: "peer", transport: "app" as const };
const actions = createFeedActions(() => remote, mocks.navigate);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.album.mockResolvedValue({ items: [{ id: "song" }], has_more: false });
  mocks.artist.mockResolvedValue({ items: [{ id: "song" }], has_more: false });
  mocks.playlist.mockResolvedValue({
    success: true,
    data: [
      { entity_type: "video", entity_id: "episode", position: 1 },
      { entity_type: "song", entity_id: "track", position: 0 },
    ],
  });
  mocks.session.mockResolvedValue({
    session_type: "mixed",
    items: [
      { entity_type: "video", entity_id: "episode" },
      { entity_type: "song", entity_id: "track" },
    ],
  });
});

describe("feed detail navigation", () => {
  it.each([
    ["recent_listen", { song_id: "song" }, "/albums/song-album"],
    ["recent_favorite", { album_id: "album" }, "/albums/album"],
    ["recent_rating", { artist_id: "artist" }, "/artists/artist"],
    ["recent_album", { album_id: "album" }, "/albums/album"],
    ["recent_playlist", { playlist_id: "playlist" }, "/playlists/playlist"],
    ["recent_video", { video_id: "video", album_id: "music-album" }, "/video/video"],
    ["recent_video_favorite", { video_id: "video" }, "/video/video"],
    ["recent_video_watch", { video_id: "video" }, "/video/video"],
    ["new_image", { album_id: "album" }, "/albums/album"],
  ] satisfies [FeedItemType, Partial<FeedItem>, string][])(
    "opens details without playing for %s",
    async (feed_type, fields, path) => {
      await actions.navigateTo(item({ feed_type, ...fields }));
      expect(mocks.navigate).toHaveBeenCalledWith(`/non-active-remote${path}`);
      expect(mocks.play).not.toHaveBeenCalled();
      expect(mocks.playVideo).not.toHaveBeenCalled();
      expect(mocks.carousel).not.toHaveBeenCalled();
    }
  );

  it.each(["mixed", "shuffle", "genre", "video", "song"])(
    "opens the first entity in a %s session",
    async (session_type) => {
      await actions.navigateTo(
        item({ feed_type: "listen_session", session_id: "session", session_type })
      );
      expect(mocks.navigate).toHaveBeenCalledWith("/non-active-remote/video/episode");
    }
  );

  it.each([
    ["album", "/albums/entity"],
    ["artist", "/artists/entity"],
    ["playlist", "/playlists/entity"],
    ["video_series", "/video/series/entity"],
    ["video_season", "/video/series/series"],
  ])("opens the named entity for a %s session", async (session_type, path) => {
    await actions.navigateTo(
      item({
        feed_type: "listen_session",
        session_id: "session",
        session_type,
        entity_id: "entity",
      })
    );
    expect(mocks.navigate).toHaveBeenCalledWith(`/non-active-remote${path}`);
  });

  it("navigates to radio details without tuning", async () => {
    await actions.navigateTo(
      item({ feed_type: "listen_session", session_type: "radio", entity_id: "station" })
    );
    expect(mocks.navigate).toHaveBeenCalledWith("/radio?station_id=station");
    expect(mocks.tune).not.toHaveBeenCalled();
  });
});

describe("feed playback and queue actions", () => {
  it.each([
    "recent_video",
    "recent_video_favorite",
    "recent_video_watch",
    "recent_rating",
  ] as const)("plays and queues videos for %s", async (feed_type) => {
    const event = item({ feed_type, video_id: "video", album_id: "music-album" });
    await actions.play(event);
    expect(mocks.playVideo).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "video" })],
      0,
      expect.anything()
    );
    await actions.play(event, true);
    expect(mocks.appendVideos).toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.videoRemote).toHaveBeenCalledWith(remote);
  });

  it.each(["song", "album", "artist", "playlist"] as const)(
    "plays and queues a %s",
    async (type) => {
      const event = item({ [`${type}_id`]: "entity" });
      await actions.play(event);
      expect(mocks.play).toHaveBeenCalled();
      await actions.play(event, true);
      expect(mocks.append).toHaveBeenCalled();
      expect(mocks.musicRemote).toHaveBeenCalledWith(remote);
    }
  );

  it("preserves mixed playlist order and includes every page of album songs", async () => {
    await actions.play(item({ playlist_id: "playlist" }));
    expect(mocks.play.mock.calls[0][0]).toMatchObject([
      { kind: "song", song: { id: "track" } },
      { kind: "video", video: { id: "episode" } },
    ]);
    mocks.album
      .mockResolvedValueOnce({ items: [{ id: "first" }], has_more: true })
      .mockResolvedValueOnce({ items: [{ id: "second" }], has_more: false });
    await actions.play(item({ album_id: "album" }));
    expect(mocks.album).toHaveBeenLastCalledWith("album", { offset: 1, limit: 200 });
    expect(mocks.play.mock.calls[1][0]).toMatchObject([
      { kind: "song", song: { id: "first" } },
      { kind: "song", song: { id: "second" } },
    ]);
  });

  it("plays and queues mixed sessions in their recorded order", async () => {
    const event = item({ feed_type: "listen_session", session_id: "session" });
    await actions.play(event);
    await actions.play(event, true);
    expect(mocks.play.mock.calls[0][0]).toMatchObject([
      { kind: "video", video: { id: "episode" } },
      { kind: "song", song: { id: "track" } },
    ]);
    expect(mocks.append).toHaveBeenCalled();
  });

  it.each(["song", "album", "artist", "playlist", "genre", "shuffle", "mixed"])(
    "plays and queues all recorded items for %s sessions",
    async (session_type) => {
      mocks.session
        .mockResolvedValueOnce({
          session_type,
          items: [{ entity_type: "song", entity_id: "track" }],
        })
        .mockResolvedValueOnce({
          session_type,
          items: [{ entity_type: "song", entity_id: "track" }],
        });
      const event = item({ feed_type: "listen_session", session_id: "session", session_type });
      await actions.play(event);
      await actions.play(event, true);
      expect(mocks.play).toHaveBeenCalledWith(
        [expect.objectContaining({ kind: "song" })],
        expect.anything()
      );
      expect(mocks.append).toHaveBeenCalledWith(
        [expect.objectContaining({ kind: "song" })],
        expect.anything()
      );
    }
  );

  it.each([
    ["video", "video"],
    ["video_series", "series"],
    ["video_season", "season"],
  ])("dispatches %s sessions to video playback and queue", async (session_type, sourceType) => {
    mocks.session.mockResolvedValue({
      session_type,
      entity_id: "entity",
      items: [{ entity_type: "video", entity_id: "episode" }],
    });
    const event = item({ feed_type: "listen_session", session_id: "session", session_type });
    await actions.play(event);
    await actions.play(event, true);
    expect(mocks.playVideo).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "episode" })],
      0,
      expect.objectContaining({ type: sourceType, entity_id: "entity" })
    );
    expect(mocks.appendVideos).toHaveBeenCalled();
    expect(mocks.play).not.toHaveBeenCalled();
  });

  it("dispatches thumbnails to the carousel only for image events", async () => {
    const images = [
      { remote_url: "https://example.test/art", blob_type: "thumbnail" as const, is_primary: true },
    ];
    await actions.thumbnail(item({ feed_type: "new_image", song_id: "song", images }));
    expect(mocks.carousel).toHaveBeenCalled();
    expect(mocks.play).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    await actions.thumbnail(item({ feed_type: "recent_listen", song_id: "song", images }));
    expect(mocks.play).toHaveBeenCalled();
    expect(mocks.carousel).toHaveBeenCalledTimes(1);
  });

  it("tunes into radio on the active target", async () => {
    await actions.play(item({ session_type: "radio", entity_id: "station" }));
    expect(mocks.tune).toHaveBeenCalledWith("peer", { stationId: "station", isLocal: false });
  });

  it("resolves carousel images through the owning remote, excluding waveforms", async () => {
    await actions.openImages(
      item({
        images: [
          {
            remote_blob_id: "art",
            remote_server_id: remote.remote_id,
            blob_type: "thumbnail",
            is_primary: true,
          },
          {
            remote_blob_id: "wave",
            remote_server_id: remote.remote_id,
            blob_type: "waveform",
            is_primary: false,
          },
        ],
      })
    );
    expect(mocks.resolveImage).toHaveBeenCalledExactlyOnceWith("art", remote.remote_id, "image");
    expect(mocks.carousel).toHaveBeenCalledWith({
      images: [{ url: "blob:resolved" }],
      title: "title",
    });
    expect(mocks.play).not.toHaveBeenCalled();
  });

  it("reports missing remotes and unavailable media", async () => {
    await createFeedActions(() => undefined, mocks.navigate).play(item({ video_id: "video" }));
    expect(mocks.error).toHaveBeenCalledWith("remote not found for this feed item");
    mocks.session.mockResolvedValueOnce(null);
    await actions.play(item({ feed_type: "listen_session", session_id: "missing" }));
    expect(mocks.error).toHaveBeenCalledWith("failed to load session");
  });
});
