// playlists view - displays playlists in two-column layout with detail panel
import * as apiClient from "freqhole-api-client";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { appState, setQueue } from "../../app/services/storage/db";
import { Button } from "../../components/buttons/Button";
import { IconButton } from "../../components/buttons/IconButton";
import { HeadingSection } from "../../components/layout/HeadingSection";
import { TwoColumnLayout } from "../../components/layout/TwoColumnLayout";
import {
  DraggableRow,
  DraggableRowSongContent,
} from "../../components/lists/DraggableRow";
import {
  VirtualItemList,
  type ListItem,
} from "../../components/virtualized/VirtualItemList";
import { getCurrentRemote, getDataSource } from "../data";
import type { Song } from "../data/types";
import { usePlaylistSongsQuery, usePlaylistsQuery } from "../queries/playlists";
import { playSong } from "../services/audio/player";

export interface PlaylistsViewProps {
  onAddMusic: () => void;
}

export function PlaylistsView(props: PlaylistsViewProps) {
  const [selectedPlaylistId, setSelectedPlaylistId] = createSignal<
    string | null
  >(null);
  const [search, setSearch] = createSignal<string>();
  const [lastClickedId, setLastClickedId] = createSignal<string | null>(null);
  const [clickTimeout, setClickTimeout] = createSignal<number | null>(null);

  // fetch playlists using infinite query
  const playlistsQuery = usePlaylistsQuery({
    search: () => search(),
  });

  // flatten pages into single array
  const playlists = createMemo(() => {
    const pages = playlistsQuery.data?.pages;
    if (!pages) return [];
    return pages.flatMap((page) => page.items);
  });

  const totalCount = createMemo(() => {
    const pages = playlistsQuery.data?.pages;
    if (!pages || pages.length === 0) return 0;
    return pages[0].total;
  });

  // fetch songs for selected playlist
  const playlistSongsQuery = usePlaylistSongsQuery({
    playlistId: () => selectedPlaylistId(),
  });

  // flatten playlist songs
  const playlistSongs = createMemo(() => {
    const pages = playlistSongsQuery.data?.pages;
    if (!pages) return [];
    return pages.flatMap((page) => page.items);
  });

  // get selected playlist metadata
  const selectedPlaylist = createMemo(() => {
    const id = selectedPlaylistId();
    if (!id) return null;
    return playlists().find((p) => p.playlist_id === id);
  });

  // convert playlists to list items for VirtualItemList
  const playlistListItems = createMemo((): ListItem[] => {
    return playlists().map((playlist) => ({
      id: playlist.playlist_id,
      title: playlist.title,
      subtitle: `${playlist.song_count} ${playlist.song_count === 1 ? "song" : "songs"}`,
      metadata: playlist.description || undefined,
    }));
  });

  // restore selected playlist from app state
  createEffect(() => {
    const state = appState();
    if (state?.queue.length && state.queue[0]) {
      // could restore last viewed playlist here if we track it
    }
  });

  // handle playlist selection with double-click support
  const handlePlaylistClick = (item: ListItem) => {
    const playlistId = item.id;
    const now = Date.now();
    const lastClick = lastClickedId();
    const timeout = clickTimeout();

    // check if this is a double-click (same item within 300ms)
    if (lastClick === playlistId && timeout && now - timeout < 300) {
      // double-click: play all playlist songs
      clearTimeout(timeout);
      setClickTimeout(null);
      setLastClickedId(null);
      handlePlayAll();
    } else {
      // potential single-click: wait to see if double-click follows
      setLastClickedId(playlistId);
      setClickTimeout(now);

      // if no second click within 300ms, treat as single click
      setTimeout(() => {
        if (clickTimeout() === now) {
          // single-click: select playlist
          setSelectedPlaylistId(playlistId);
          setClickTimeout(null);
        }
      }, 300);
    }
  };

  // handle song double-click (play song)
  const handleSongDoubleClick = async (song: Song) => {
    await setQueue(playlistSongs());
    await playSong(song);
  };

  // handle add song to queue
  const handleAddSongToQueue = async (song: Song) => {
    const state = appState();
    const currentQueue = state?.queue || [];
    await setQueue([...currentQueue, song]);
  };

  // fetch more playlists when scrolling near end
  const handlePlaylistsLoadMore = () => {
    if (playlistsQuery.hasNextPage && !playlistsQuery.isFetchingNextPage) {
      playlistsQuery.fetchNextPage();
    }
  };

  // fetch more songs when scrolling near end
  const handleSongsLoadMore = () => {
    if (
      playlistSongsQuery.hasNextPage &&
      !playlistSongsQuery.isFetchingNextPage
    ) {
      playlistSongsQuery.fetchNextPage();
    }
  };

  // construct thumbnail URL for selected playlist
  const thumbnailUrl = createMemo(() => {
    const playlist = selectedPlaylist();
    if (!playlist?.thumbnail_blob_id) return null;

    const remote = getCurrentRemote();
    if (!remote) return null;

    return apiClient.utils.getBlobUrl(remote.url, playlist.thumbnail_blob_id);
  });

  // calculate total duration
  const totalDuration = createMemo(() => {
    const songs = playlistSongs();
    return songs.reduce((sum, song) => sum + (song.duration_seconds || 0), 0);
  });

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours} hr ${minutes} min`;
    }
    return `${minutes} min`;
  };

  // play all songs in selected playlist
  const handlePlayAll = async () => {
    const songs = playlistSongs();
    if (songs.length > 0) {
      await setQueue(songs);
      await playSong(songs[0]);
    }
  };

  // add all songs to queue
  const handleAddToQueue = async () => {
    const songs = playlistSongs();
    if (songs.length > 0) {
      const state = appState();
      const currentQueue = state?.queue || [];
      await setQueue([...currentQueue, ...songs]);
    }
  };

  return (
    <div class="flex flex-col h-full">
      {/* header */}
      {/* header */}
      <div class="flex items-center justify-between p-4 border-b border-[var(--color-border-default)] ml-[150px]">
        <div>
          <h1 class="text-2xl font-bold text-[var(--color-text-primary)]">
            playlists
          </h1>
          <p class="text-sm text-[var(--color-text-secondary)]">
            {playlistsQuery.isLoading
              ? "loading..."
              : `${playlists().length} ${playlists().length === 1 ? "playlist" : "playlists"}`}
          </p>
        </div>
        <Button variant="primary" onClick={props.onAddMusic}>
          add music
        </Button>
      </div>

      {/* two-column layout */}
      <div class="flex-1 overflow-hidden">
        <Show
          when={!playlistsQuery.isLoading}
          fallback={
            <div class="flex items-center justify-center h-full">
              <div class="text-[var(--color-text-secondary)]">
                loading playlists...
              </div>
            </div>
          }
        >
          <Show
            when={playlistListItems().length > 0}
            fallback={
              <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
                <div class="text-center max-w-md">
                  <p class="text-lg text-[var(--color-text-secondary)] mb-2">
                    no playlists in your library yet
                  </p>
                  <p class="text-sm text-[var(--color-text-tertiary)] mb-6">
                    playlists let you organize your music into custom
                    collections
                  </p>
                </div>
              </div>
            }
          >
            <TwoColumnLayout
              leftColumn={
                <VirtualItemList
                  items={playlistListItems()}
                  selectedId={selectedPlaylistId()}
                  onItemClick={handlePlaylistClick}
                  onEndReached={handlePlaylistsLoadMore}
                />
              }
              rightColumn={
                <Show
                  when={selectedPlaylistId()}
                  fallback={
                    <div class="flex items-center justify-center h-full">
                      <p class="text-[var(--color-text-secondary)]">
                        select a playlist to view songs
                      </p>
                    </div>
                  }
                >
                  <div class="flex flex-col h-full">
                    {/* playlist header */}
                    <div class="flex-shrink-0 p-6 border-b border-[var(--color-border-default)]">
                      <div class="flex gap-4 items-start">
                        {/* thumbnail */}
                        <Show when={thumbnailUrl()}>
                          <div class="flex-shrink-0 w-32 h-32 rounded-lg overflow-hidden bg-[var(--color-bg-tertiary)]">
                            <img
                              src={thumbnailUrl()!}
                              alt={selectedPlaylist()?.title || "playlist"}
                              class="w-full h-full object-cover"
                            />
                          </div>
                        </Show>

                        {/* metadata */}
                        <div class="flex-1">
                          <h2 class="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
                            {selectedPlaylist()?.title || "untitled playlist"}
                          </h2>
                          <Show when={selectedPlaylist()?.description}>
                            <p class="text-sm text-[var(--color-text-secondary)] mb-3">
                              {selectedPlaylist()!.description}
                            </p>
                          </Show>
                          <Show when={!playlistSongsQuery.isLoading}>
                            <div class="flex items-center gap-3 text-sm text-[var(--color-text-secondary)] mb-4">
                              <span>
                                {playlistSongs().length}{" "}
                                {playlistSongs().length === 1
                                  ? "song"
                                  : "songs"}
                              </span>
                              <Show when={totalDuration() > 0}>
                                <span>•</span>
                                <span>{formatDuration(totalDuration())}</span>
                              </Show>
                            </div>
                          </Show>

                          {/* action buttons */}
                          <Show when={playlistSongs().length > 0}>
                            <div class="flex gap-2">
                              <Button variant="primary" onClick={handlePlayAll}>
                                play all
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={handleAddToQueue}
                              >
                                + add to queue
                              </Button>
                            </div>
                          </Show>
                        </div>
                      </div>
                    </div>

                    {/* songs list */}
                    <div class="flex-1 overflow-hidden">
                      <Show
                        when={!playlistSongsQuery.isLoading}
                        fallback={
                          <div class="flex items-center justify-center h-full">
                            <div class="text-[var(--color-text-secondary)]">
                              loading songs...
                            </div>
                          </div>
                        }
                      >
                        <Show
                          when={playlistSongs().length > 0}
                          fallback={
                            <div class="flex items-center justify-center h-full">
                              <p class="text-[var(--color-text-secondary)]">
                                this playlist is empty
                              </p>
                            </div>
                          }
                        >
                          <div class="overflow-auto h-full p-4">
                            <div class="space-y-1">
                              <For each={playlistSongs()}>
                                {(song, index) => (
                                  <DraggableRow
                                    id={song.song_id}
                                    index={index()}
                                    onDoubleClick={() =>
                                      handleSongDoubleClick(song)
                                    }
                                    disabled={true}
                                  >
                                    <DraggableRowSongContent
                                      title={song.title}
                                      artist={song.artist_name}
                                      album={song.album_title}
                                      durationSeconds={song.duration_seconds}
                                      actions={
                                        <IconButton
                                          icon="queue"
                                          size="sm"
                                          variant="ghost"
                                          onClick={(e: MouseEvent) => {
                                            e.stopPropagation();
                                            handleAddSongToQueue(song);
                                          }}
                                          aria-label="add to queue"
                                        />
                                      }
                                    />
                                  </DraggableRow>
                                )}
                              </For>
                            </div>
                          </div>
                        </Show>
                      </Show>
                    </div>
                  </div>
                </Show>
              }
            />
          </Show>
        </Show>
      </div>
    </div>
  );
}
