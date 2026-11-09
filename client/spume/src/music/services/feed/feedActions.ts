import { getClientForRemote } from "../../../app/api/client";
import { tuneRadio } from "../../../app/services/players/playerRadio";
import type { RemoteRef } from "../../../app/services/storage/schemas/remote";
import {
  songToMediaItem,
  videoToMediaItem,
  videosOnly,
  type MediaItem,
} from "../../../app/services/storage/mediaItem";
import { toQueueHistorySourceType } from "../../../app/services/storage/types";
import { toast } from "../../../components/feedback/Toast";
import { RemoteVideoDataSource } from "../../../video/data/remote/remoteSource";
import { playVideoQueue } from "../../../video/services/queue/playVideoQueue";
import { addVideosToQueue } from "../../../video/services/videoQueueActions";
import { RemoteMusicDataSource } from "../../data/remote/remoteSource";
import type { FeedItem, PlaybackSession, QueryParams } from "../../data/types";
import { showImageCarousel } from "../../hooks/modals";
import { setHighlightedSongId } from "../../state/highlightedSong";
import { buildRouteFor, routes } from "../../utils/routing";
import { addToQueue, playQueue } from "../queue/queue";
import { resolveBlobUrl } from "../storage/blobResolver";
import type { Song } from "../storage/types";

type Entity = { type: "song" | "album" | "artist" | "playlist" | "video"; id: string };

export function feedEntity(item: FeedItem): Entity | undefined {
  if (item.video_id) return { type: "video", id: item.video_id };
  if (item.song_id) return { type: "song", id: item.song_id };
  if (item.playlist_id) return { type: "playlist", id: item.playlist_id };
  if (item.album_id) return { type: "album", id: item.album_id };
  if (item.artist_id) return { type: "artist", id: item.artist_id };
}

export function createFeedActions(
  getRemote: (item: FeedItem) => RemoteRef | undefined,
  navigate: (path: string) => void
) {
  function sources(item: FeedItem) {
    const remote = getRemote(item);
    if (!remote) throw new Error("remote not found for this feed item");
    return {
      remote,
      music: new RemoteMusicDataSource(remote),
      video: new RemoteVideoDataSource(remote),
    };
  }

  async function sessionFor(item: FeedItem) {
    const { music } = sources(item);
    if (!item.session_id) throw new Error("session not found for this feed item");
    const session = await music.getPlaybackSession(item.session_id);
    if (!session) throw new Error("failed to load session");
    return session;
  }

  async function resolveItems(
    item: FeedItem,
    refs: { entity_type: string; entity_id: string }[]
  ): Promise<MediaItem[]> {
    const { music, video } = sources(item);
    const items = await Promise.all(
      refs.map(async (ref): Promise<MediaItem> => {
        if (ref.entity_type === "song") {
          const song = await music.getSongById(ref.entity_id);
          if (song) return songToMediaItem(song);
        } else if (ref.entity_type === "video") {
          const value = await video.getVideoById(ref.entity_id);
          if (value) return videoToMediaItem(value);
        }
        throw new Error(`couldn't load ${ref.entity_type} ${ref.entity_id}`);
      })
    );
    return items;
  }

  async function goToEntity(item: FeedItem, entity: Entity) {
    const { remote, music } = sources(item);
    const id = remote.remote_id;
    switch (entity.type) {
      case "video":
        navigate(routes.videoDetailOn(id, entity.id));
        break;
      case "album":
        navigate(routes.albumOn(id, entity.id));
        break;
      case "artist":
        navigate(routes.artistOn(id, entity.id));
        break;
      case "playlist":
        navigate(routes.playlistOn(id, entity.id));
        break;
      case "song": {
        setHighlightedSongId(entity.id);
        const song = await music.getSongById(entity.id);
        const albumId = song?.album_id ?? item.album_id;
        navigate(albumId ? routes.albumOn(id, albumId) : buildRouteFor(id, "/songs"));
        break;
      }
    }
  }

  async function navigateTo(item: FeedItem): Promise<void> {
    try {
      if (item.feed_type === "listen_session") {
        const { remote, video } = sources(item);
        if (item.session_type === "radio" && item.entity_id) {
          navigate(routes.radioStation(item.entity_id, remote.peer_addr));
          return;
        }
        if (item.entity_id) {
          if (item.session_type === "video_series") {
            navigate(routes.videoSeriesOn(remote.remote_id, item.entity_id));
            return;
          }
          if (
            item.session_type === "album" ||
            item.session_type === "artist" ||
            item.session_type === "playlist"
          ) {
            await goToEntity(item, { type: item.session_type, id: item.entity_id });
            return;
          }
        }
        const session = await sessionFor(item);
        const first = session.items[0];
        if (!first) throw new Error("no items in session");
        if (item.session_type === "video_season" && first.entity_type === "video") {
          const value = await video.getVideoById(first.entity_id);
          if (value?.series_id) {
            navigate(routes.videoSeriesOn(remote.remote_id, value.series_id));
            return;
          }
        }
        if (first.entity_type !== "song" && first.entity_type !== "video") {
          throw new Error(`unsupported session item: ${first.entity_type}`);
        }
        await goToEntity(item, { type: first.entity_type, id: first.entity_id });
        return;
      }
      const entity = feedEntity(item);
      if (!entity) throw new Error("no detail view for this feed item");
      await goToEntity(item, entity);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "failed to open feed item");
    }
  }

  async function mediaFor(item: FeedItem): Promise<{
    items: MediaItem[];
    session?: PlaybackSession;
  }> {
    const { remote, music } = sources(item);
    if (item.feed_type === "listen_session") {
      const session = await sessionFor(item);
      return { items: await resolveItems(item, session.items), session };
    }
    const entity = feedEntity(item);
    if (!entity) throw new Error("no playable media for this feed item");
    if (entity.type === "playlist") {
      const client = await getClientForRemote(remote);
      const result = await client.entities.listPlaylistItems({ playlist_id: entity.id });
      if (!result.success) throw new Error("failed to load playlist");
      const refs = [...result.data].sort((a, b) => a.position - b.position);
      return { items: await resolveItems(item, refs) };
    }
    if (entity.type === "album" || entity.type === "artist") {
      const load = (params: QueryParams) =>
        entity.type === "album"
          ? music.getAlbumSongs(entity.id, params)
          : music.getArtistSongs(entity.id, params);
      const songs: Song[] = [];
      let offset = 0;
      for (;;) {
        const page = await load({ offset, limit: 200 });
        songs.push(...page.items);
        if (!page.has_more) break;
        if (!page.items.length) throw new Error("received an empty page while loading feed media");
        offset += page.items.length;
      }
      return { items: songs.map(songToMediaItem) };
    }
    return {
      items: await resolveItems(item, [{ entity_type: entity.type, entity_id: entity.id }]),
    };
  }

  async function play(item: FeedItem, append = false): Promise<void> {
    try {
      if (item.session_type === "radio" && item.entity_id) {
        if (append) throw new Error("radio streams cannot be added to the media queue");
        const { remote } = sources(item);
        if (!remote.peer_addr && !remote.is_charnel_managed) {
          throw new Error("station host has no peer address");
        }
        await tuneRadio(remote.peer_addr || "self", {
          stationId: item.entity_id,
          isLocal: !!remote.is_charnel_managed,
        });
        return;
      }
      const { items, session } = await mediaFor(item);
      if (!items.length) throw new Error("no playable items in this feed item");
      const entity = feedEntity(item);
      const source = {
        type: toQueueHistorySourceType(session?.session_type ?? entity?.type ?? "mixed"),
        label: item.title,
        entity_id: session?.entity_id ?? entity?.id,
      };
      if (items.every((value) => value.kind === "video")) {
        const videoSource = {
          type:
            session?.session_type === "video_series"
              ? ("series" as const)
              : session?.session_type === "video_season"
                ? ("season" as const)
                : entity?.type === "playlist"
                  ? ("playlist" as const)
                  : ("video" as const),
          label: item.title,
          entity_id: source.entity_id,
        };
        if (append) await addVideosToQueue(videosOnly(items), videoSource);
        else await playVideoQueue(videosOnly(items), 0, videoSource);
      } else if (append) {
        await addToQueue(items, { source });
      } else {
        await playQueue(items, { source });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "failed to play feed item");
    }
  }

  async function openImages(item: FeedItem): Promise<void> {
    try {
      const images = (item.images ?? []).filter((img) => img.blob_type !== "waveform");
      const urls = await Promise.all(
        images.map(async (img) => {
          if (img.remote_blob_id && img.remote_server_id) {
            return resolveBlobUrl(img.remote_blob_id, img.remote_server_id, "image");
          }
          return img.remote_url;
        })
      );
      const slides = urls.filter((url): url is string => !!url).map((url) => ({ url }));
      if (!slides.length) throw new Error("no images available for this feed item");
      showImageCarousel({ images: slides, title: item.title });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "failed to load images");
    }
  }

  async function thumbnail(item: FeedItem): Promise<void> {
    if (item.feed_type === "new_image") await openImages(item);
    else await play(item);
  }

  return { navigateTo, play, openImages, thumbnail };
}
