// playlists view - displays playlists in two-column layout with detail panel
import { useNavigate, useParams } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
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
import {
  usePlaylistSongsQuery,
  usePlaylistsQuery,
  useReorderPlaylistSongsMutation,
  useUpdatePlaylistMutation,
} from "../queries/playlists";
import { playSong } from "../services/audio/player";

export interface PlaylistsViewProps {
  onAddMusic: () => void;
}

// type guard helper for SafeParseResult
function isSuccess<T>(result: {
  success: boolean;
  data?: T;
  error?: any;
}): result is { success: true; data: T } {
  return result.success === true;
}

export function PlaylistsView(props: PlaylistsViewProps) {
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();

  const [selectedPlaylistId, setSelectedPlaylistId] = createSignal<
    string | null
  >(params.id || null);
  const [search, setSearch] = createSignal<string>();
  const [lastClickedId, setLastClickedId] = createSignal<string | null>(null);
  const [clickTimeout, setClickTimeout] = createSignal<number | null>(null);
  const [editMode, setEditMode] = createSignal(false);
  const [editTitle, setEditTitle] = createSignal("");
  const [editDescription, setEditDescription] = createSignal("");
  const [uploadingImage, setUploadingImage] = createSignal(false);
  const [uploadProgress, setUploadProgress] = createSignal(0);
  const [draggedSongId, setDraggedSongId] = createSignal<string | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = createSignal<number | null>(
    null,
  );

  // mutations for updating playlist
  const updatePlaylistMutation = useUpdatePlaylistMutation();
  const reorderSongsMutation = useReorderPlaylistSongsMutation();

  // query client for invalidation
  const queryClient = useQueryClient();

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

  // sync URL parameter with selected playlist
  createEffect(() => {
    const id = params.id;
    if (id && id !== selectedPlaylistId()) {
      setSelectedPlaylistId(id);
    }
  });

  // update URL when playlist selection changes
  createEffect(() => {
    const id = selectedPlaylistId();
    if (id && id !== params.id) {
      navigate(`/playlists/${id}`, { replace: true });
    } else if (!id && params.id) {
      navigate("/playlists", { replace: true });
    }
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

  // toggle edit mode
  const handleEditToggle = () => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    if (!editMode()) {
      // entering edit mode - populate fields
      setEditTitle(playlist.title);
      setEditDescription(playlist.description || "");
      setEditMode(true);
    } else {
      // exiting edit mode without saving
      setEditMode(false);
    }
  };

  // save playlist changes
  const handleSavePlaylist = async () => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    try {
      await updatePlaylistMutation.mutateAsync({
        playlistId: playlist.playlist_id,
        title: editTitle() || null,
        description: editDescription() || null,
      });

      setEditMode(false);
    } catch (error) {
      console.error("failed to update playlist:", error);
    }
  };

  // cancel edit mode
  const handleCancelEdit = () => {
    setEditMode(false);
  };

  // handle image upload
  const handleImageUpload = async () => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    const remote = getCurrentRemote();
    if (!remote) {
      console.error("no remote source - image upload only works with remote");
      return;
    }

    // create file input
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      // validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        console.error("file too large (max 10MB)");
        return;
      }

      setUploadingImage(true);
      setUploadProgress(0);

      try {
        // upload image with playlist association
        // the server will automatically update the playlist's thumbnail_blob_id
        const uploadResult = await apiClient.utils.uploadImage(
          remote.url,
          file,
          {
            associate: {
              entity_type: "playlist",
              entity_id: playlist.playlist_id,
              is_primary: true,
            },
          },
        );

        if (!isSuccess(uploadResult)) {
          const errorMsg = uploadResult.error.issues
            .map((i) => i.message)
            .join(", ");
          console.error("upload failed:", errorMsg);
          return;
        }

        // type guard ensures uploadResult.data exists after success check
        const uploadData = uploadResult.data;
        console.log("image uploaded successfully:", uploadData);

        // poll for job completion before refreshing
        const jobCompleted = await pollJobUntilComplete(
          remote.url,
          uploadData.job_id,
        );

        if (jobCompleted) {
          // invalidate queries to refresh the UI
          await queryClient.invalidateQueries({
            queryKey: ["playlists"],
            refetchType: "all",
          });

          // small delay to ensure server has written to database
          await new Promise((resolve) => setTimeout(resolve, 200));

          // force a fresh refetch
          await playlistsQuery.refetch();
        } else {
          console.warn(
            "job did not complete in time, UI may not update immediately",
          );
        }
      } catch (error) {
        console.error("failed to upload image:", error);
      } finally {
        setUploadingImage(false);
        setUploadProgress(0);
      }
    };

    input.click();
  };

  // poll for job completion
  const pollJobUntilComplete = async (
    baseUrl: string,
    jobId: string,
    timeoutMs: number = 10000,
  ): Promise<boolean> => {
    const startTime = Date.now();
    const pollInterval = 500; // check every 500ms

    while (Date.now() - startTime < timeoutMs) {
      const jobResult = await apiClient.music.getJobStatus(baseUrl, {
        job_id: jobId,
      });

      if (!isSuccess(jobResult)) {
        console.error("failed to get job status:", jobResult.error);
        return false;
      }

      // type guard ensures jobResult.data exists after success check
      const jobData = jobResult.data;
      const status = jobData.status;

      if (status === "Completed") {
        return true;
      } else if (status === "Failed" || status === "Cancelled") {
        console.error("job failed or was cancelled:", jobData.error_message);
        return false;
      }

      // wait before polling again
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    console.warn("job polling timed out");
    return false;
  };

  // handle drag start
  const handleDragStart = (songId: string) => (e: DragEvent) => {
    setDraggedSongId(songId);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
    }
  };

  // handle drag over
  const handleDragOver = (index: number) => (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
    setDropTargetIndex(index);
  };

  // handle drag leave
  const handleDragLeave = () => {
    setDropTargetIndex(null);
  };

  // handle drop
  const handleDrop = async (targetIndex: number) => {
    const draggedId = draggedSongId();
    if (!draggedId) return;

    const playlist = selectedPlaylist();
    if (!playlist) return;

    const songs = playlistSongs();
    const draggedIndex = songs.findIndex((s) => s.song_id === draggedId);
    if (draggedIndex === -1) return;

    // don't do anything if dropped on same position
    if (draggedIndex === targetIndex) {
      setDraggedSongId(null);
      setDropTargetIndex(null);
      return;
    }

    // calculate new position (1-based)
    const newPosition = targetIndex + 1;

    try {
      await reorderSongsMutation.mutateAsync({
        playlistId: playlist.playlist_id,
        songIds: [draggedId],
        newPosition,
      });

      console.log(
        `moved song from position ${draggedIndex + 1} to ${newPosition}`,
      );
    } catch (error) {
      console.error("failed to reorder songs:", error);
    } finally {
      setDraggedSongId(null);
      setDropTargetIndex(null);
    }
  };

  // handle image removal
  const handleRemoveImage = async () => {
    const playlist = selectedPlaylist();
    if (!playlist || !playlist.thumbnail_blob_id) return;

    const remote = getCurrentRemote();
    if (!remote) return;

    try {
      const result = await apiClient.music.removePlaylistThumbnail(remote.url, {
        playlist_id: playlist.playlist_id,
        cleanup_blob: true,
        deleted_by: null,
      });

      if (!isSuccess(result)) {
        throw new Error("failed to remove thumbnail");
      }

      console.log("image removed successfully");

      // invalidate queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
    } catch (error) {
      console.error("failed to remove image:", error);
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
                  <div
                    class="flex flex-col h-full relative"
                    style={{
                      ...(thumbnailUrl() && {
                        "background-image": `url('${thumbnailUrl()}')`,
                        "background-size": "cover",
                        "background-position": "center top",
                        "background-repeat": "no-repeat",
                      }),
                    }}
                  >
                    {/* background overlay */}
                    <Show when={thumbnailUrl()}>
                      <div class="absolute inset-0 bg-black/70 z-0" />
                    </Show>

                    {/* playlist header */}
                    <div class="flex-shrink-0 p-6 border-b border-[var(--color-border-default)] relative z-10">
                      <div class="flex-1">
                        <Show
                          when={editMode()}
                          fallback={
                            <>
                              <div class="flex items-center gap-2 mb-2">
                                <h2 class="text-2xl font-bold text-[var(--color-text-primary)]">
                                  {selectedPlaylist()?.title ||
                                    "untitled playlist"}
                                </h2>
                                <button
                                  class="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                                  onClick={handleEditToggle}
                                  aria-label="edit playlist"
                                >
                                  <svg
                                    class="w-4 h-4"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      stroke-linecap="round"
                                      stroke-linejoin="round"
                                      stroke-width="2"
                                      d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                                    />
                                  </svg>
                                </button>
                              </div>
                              <Show when={selectedPlaylist()?.description}>
                                <p class="text-sm text-[var(--color-text-secondary)] mb-3">
                                  {selectedPlaylist()!.description}
                                </p>
                              </Show>
                            </>
                          }
                        >
                          <div class="space-y-2 mb-3">
                            <input
                              type="text"
                              class="w-full px-2 py-1 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] text-xl font-bold focus:outline-none focus:border-[var(--color-accent-500)]"
                              value={editTitle()}
                              onInput={(e) =>
                                setEditTitle(e.currentTarget.value)
                              }
                              placeholder="playlist title"
                            />
                            <textarea
                              class="w-full px-2 py-1 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-secondary)] text-sm focus:outline-none focus:border-[var(--color-accent-500)] resize-none"
                              rows="2"
                              value={editDescription()}
                              onInput={(e) =>
                                setEditDescription(e.currentTarget.value)
                              }
                              placeholder="description (optional)"
                            />
                            <div class="flex gap-2">
                              <Button
                                variant="primary"
                                onClick={handleSavePlaylist}
                              >
                                save
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={handleCancelEdit}
                              >
                                cancel
                              </Button>
                            </div>
                          </div>
                        </Show>
                        <Show when={!playlistSongsQuery.isLoading}>
                          <div class="flex items-center gap-3 text-sm text-[var(--color-text-secondary)] mb-4">
                            <span>
                              {playlistSongs().length}{" "}
                              {playlistSongs().length === 1 ? "song" : "songs"}
                            </span>
                            <Show when={totalDuration() > 0}>
                              <span>•</span>
                              <span>{formatDuration(totalDuration())}</span>
                            </Show>
                          </div>
                        </Show>

                        {/* action buttons */}
                        <Show when={playlistSongs().length > 0 && !editMode()}>
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

                        {/* image upload controls (edit mode only) */}
                        <Show when={editMode()}>
                          <div class="mt-4 flex gap-2">
                            <Show
                              when={!uploadingImage()}
                              fallback={
                                <div class="text-[var(--color-text-secondary)] text-sm">
                                  uploading... {uploadProgress()}%
                                </div>
                              }
                            >
                              <button
                                class="px-3 py-1 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white text-sm rounded"
                                onClick={handleImageUpload}
                              >
                                {thumbnailUrl()
                                  ? "change background"
                                  : "upload background"}
                              </button>
                              <Show when={thumbnailUrl()}>
                                <button
                                  class="px-3 py-1 bg-red-500 hover:bg-red-600 text-white text-sm rounded"
                                  onClick={handleRemoveImage}
                                >
                                  remove background
                                </button>
                              </Show>
                            </Show>
                          </div>
                        </Show>
                      </div>
                    </div>

                    {/* songs list */}
                    <div class="flex-1 overflow-hidden relative z-10">
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
                                    isDragging={
                                      draggedSongId() === song.song_id
                                    }
                                    isDropTarget={dropTargetIndex() === index()}
                                    onDragStart={handleDragStart(song.song_id)}
                                    onDragOver={handleDragOver(index())}
                                    onDragLeave={handleDragLeave}
                                    onDrop={() => handleDrop(index())}
                                    onDoubleClick={() =>
                                      handleSongDoubleClick(song)
                                    }
                                    disabled={false}
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
