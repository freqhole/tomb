// playlist detail view - shows songs in a playlist
import { useNavigate, useParams } from "@solidjs/router";
import * as apiClient from "freqhole-api-client";
import { createMemo, createResource, createSignal, Show } from "solid-js";
import { setQueue } from "../../app/services/storage/db";
import { Button } from "../../components/buttons/Button";
import { MediaImage } from "../../components/media/MediaImage";
import {
  VirtualItemList,
  type ListItem,
} from "../../components/virtualized/VirtualItemList";
import { getCurrentRemote, getDataSource } from "../data";
import type { Song } from "../data/types";
import { usePlaylistSongsQuery } from "../queries/playlists";
import { playSong } from "../services/audio/player";
import { buildRoute } from "../utils/routing";

export function PlaylistDetailView() {
  const params = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = createSignal<string>();

  // fetch playlist metadata
  const [playlistData] = createResource(
    () => params.id,
    async (playlistId) => {
      const dataSource = getDataSource();
      if (!dataSource.getPlaylists) {
        return null;
      }

      // fetch the specific playlist
      const response = await dataSource.getPlaylists({
        limit: 1000, // get all playlists to find this one
      });

      return response.items.find((p) => p.playlist_id === playlistId);
    },
  );

  // fetch playlist songs using infinite query
  const songsQuery = usePlaylistSongsQuery({
    playlistId: () => params.id,
    search: () => search(),
  });

  // flatten pages into single array
  const songs = createMemo(() => {
    const pages = songsQuery.data?.pages;
    if (!pages) return [];
    return pages.flatMap((page) => page.items);
  });

  // construct image URL for playlist thumbnail
  const thumbnailUrl = createMemo(() => {
    const playlist = playlistData();
    if (!playlist?.thumbnail_blob_id) return null;

    const remote = getCurrentRemote();
    if (!remote) return null;

    return apiClient.utils.getBlobUrl(
      remote.base_url,
      playlist.thumbnail_blob_id,
    );
  });

  // convert songs to list items for VirtualItemList
  const listItems = createMemo((): ListItem[] => {
    return songs().map((song) => {
      const duration = song.duration_seconds
        ? `${Math.floor(song.duration_seconds / 60)}:${String(song.duration_seconds % 60).padStart(2, "0")}`
        : "0:00";

      return {
        id: song.sha256,
        title: song.title,
        subtitle: `${song.artist_name} • ${song.album_title}`,
        metadata: duration,
      };
    });
  });

  const totalCount = createMemo(() => {
    const pages = songsQuery.data?.pages;
    if (!pages || pages.length === 0) return 0;
    return pages[0].total;
  });

  // calculate total duration
  const totalDuration = createMemo(() => {
    const allSongs = songs();
    return allSongs.reduce(
      (sum, song) => sum + (song.duration_seconds || 0),
      0,
    );
  });

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours} hr ${minutes} min`;
    }
    return `${minutes} min`;
  };

  // fetch more when scrolling near end
  const handleLoadMore = () => {
    if (songsQuery.hasNextPage && !songsQuery.isFetchingNextPage) {
      songsQuery.fetchNextPage();
    }
  };

  const handleItemClick = async (item: ListItem) => {
    // find the actual song by id
    const song = songs().find((s) => s.sha256 === item.id);
    if (song) {
      await setQueue(songs());
      await playSong(song);
    }
  };

  return (
    <div class="flex flex-col h-full">
      {/* header with playlist info */}
      <div class="flex-shrink-0 p-6 border-b border-[var(--color-border-default)]">
        <div class="flex gap-6">
          {/* playlist thumbnail */}
          <div class="flex-shrink-0">
            <div class="w-48 h-48 rounded-lg overflow-hidden bg-[var(--color-bg-tertiary)]">
              <Show
                when={playlistData()?.thumbnail_blob_id}
                fallback={
                  <div class="w-full h-full flex items-center justify-center">
                    <div class="text-[var(--color-text-tertiary)] text-6xl">
                      🎵
                    </div>
                  </div>
                }
              >
                <MediaImage
                  imageUrl={thumbnailUrl()}
                  alt={playlistData()?.title || "playlist"}
                  class="w-full h-full object-cover"
                />
              </Show>
            </div>
          </div>

          {/* playlist metadata */}
          <div class="flex-1 flex flex-col justify-end">
            <div class="mb-2">
              <Button
                variant="ghost"
                onClick={() => navigate(buildRoute("/playlists"))}
              >
                ← back to playlists
              </Button>
            </div>
            <h1 class="text-4xl font-bold text-[var(--color-text-primary)] mb-2">
              {playlistData()?.title || "untitled playlist"}
            </h1>
            <Show when={playlistData()?.description}>
              <p class="text-[var(--color-text-secondary)] mb-3">
                {playlistData()!.description}
              </p>
            </Show>
            <Show when={!songsQuery.isLoading}>
              <div class="flex items-center gap-4 text-sm text-[var(--color-text-secondary)]">
                <span>
                  {totalCount()} {totalCount() === 1 ? "song" : "songs"}
                </span>
                <Show when={totalDuration() > 0}>
                  <span>•</span>
                  <span>{formatDuration(totalDuration())}</span>
                </Show>
              </div>
            </Show>
          </div>
        </div>
      </div>

      {/* songs list */}
      <div class="flex-1 overflow-hidden">
        <Show
          when={!songsQuery.isLoading}
          fallback={
            <div class="flex items-center justify-center h-full">
              <div class="text-[var(--color-text-secondary)]">
                loading songs...
              </div>
            </div>
          }
        >
          <Show
            when={songs().length > 0}
            fallback={
              <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
                <div class="text-center max-w-md">
                  <p class="text-lg text-[var(--color-text-secondary)] mb-2">
                    this playlist is empty
                  </p>
                  <p class="text-sm text-[var(--color-text-tertiary)]">
                    add songs to get started
                  </p>
                </div>
              </div>
            }
          >
            <VirtualItemList
              items={listItems()}
              onItemClick={handleItemClick}
            />
          </Show>
        </Show>
      </div>
    </div>
  );
}
