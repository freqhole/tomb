// playlist detail panel - the right-column content of PlaylistsView.tsx
// (header, actions, interleaved song+video item list, drag reorder, image
// carousel, editor) extracted out of the former monolithic view so the
// 2-column list-selection shell (PlaylistsView.tsx) stays focused on
// playlist selection/list rendering only. see docs/playlist-unification-plan.md
// phase 2's "extract a PlaylistDetailPanel" item.
//
// this file itself was further decomposed (still per that same doc's
// file-size guidance) into: usePlaylistMergedItems.ts (song+video
// data/merge/reorder+remove mutations), usePlaylistDragReorder.ts
// (drag/pointer mechanics), usePlaylistImageCarousel.ts +
// usePlaylistBackgroundImage.ts (image-related side effects), and
// PlaylistSongRow.tsx/PlaylistVideoRow.tsx (per-kind row rendering) -
// this file is now the orchestrator that wires them together and
// renders the header/action buttons/item list shell.
import { createMemo, createSignal, For, Show } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import { playQueue, addToQueue } from "../../services/queue/queue";
import { Button } from "../../../components/buttons/Button";
import { IconButton } from "../../../components/buttons/IconButton";
import { ImageCarouselModal } from "../../../components/modals/ImageCarouselModal";
import { HeadingSection } from "../../../components/layout/HeadingSection";
import { MarqueeText } from "../../../components/text/MarqueeText";
import { ClickDropdownMenu, type MenuAction } from "../../../components/overlays/ContextMenu";
import { FavoriteToggle } from "../../../utils/FavoriteToggle";
import { formatRelativeTime } from "../../../utils/dateTime";
import { formatHumanDuration } from "../../../utils/formatDuration";
import { getCurrentRemote, getRemoteClient } from "../../data";
import type { EntityUrl } from "../../data/types";
import { useToggleFavoriteMutation } from "../../queries/favorites";
import { ShareButton } from "../../../components/buttons/ShareButton";
import { EntityLinks } from "../../../components/media/EntityLinks";
import { showStationSelector } from "../../hooks/stationSelectorState";
import { showShareModal } from "../../hooks/modals";
import { createCurrentRemoteFull } from "../../../app/services/remotes/currentRemoteFull";
import type { SendPayload } from "../../services/send/sendToRemote";
import type { RemoteSong } from "../../data/remote/adapters";
import { canUpdatePlaylist } from "../../data/permissions";
import type { Playlist } from "../../services/storage/types";
import { PlaylistEditor } from "./PlaylistEditor";
import {
  DownloadPlaylistZipBundleButton,
  downloadPlaylistZipWithToast,
} from "./DownloadPlaylistZipBundleButton";
import {
  usePlaylistMergedItems,
  mergedItemToMediaItem,
  type MergedPlaylistItem,
} from "./usePlaylistMergedItems";
import { usePlaylistDragReorder } from "./usePlaylistDragReorder";
import { usePlaylistImageCarousel } from "./usePlaylistImageCarousel";
import { usePlaylistBackgroundImage } from "./usePlaylistBackgroundImage";
import { PlaylistSongRow } from "./PlaylistSongRow";
import { PlaylistVideoRow } from "./PlaylistVideoRow";

export interface PlaylistDetailPanelProps {
  /** the currently selected playlist id - this panel is only mounted while truthy. */
  playlistId: Accessor<string>;
  /** the playlist summary from the list query cache - may briefly lag
   *  behind `playlistId` for a deep-linked playlist not yet in the loaded
   *  page of results, so every read below falls back gracefully. */
  playlist: Accessor<Playlist | null>;
  isNarrow: Accessor<boolean>;
  isTouch: boolean;
  showingDetailOnNarrow: Accessor<boolean>;
  onBack: () => void;
  editMode: Accessor<boolean>;
  setEditMode: (value: boolean) => void;
  onPlaylistDeleted: (deletedPlaylistId: string) => void;
}

export function PlaylistDetailPanel(props: PlaylistDetailPanelProps) {
  const isTouch = props.isTouch;

  // tracks which of play/add-to-queue/shuffle is currently fetching + queueing
  // songs, so the buttons can show immediate feedback for however long that
  // takes (and so a second click can't queue the same songs twice).
  const [playlistActionPending, setPlaylistActionPending] = createSignal<
    "play" | "queue" | "shuffle" | null
  >(null);

  const {
    playlistSongsQuery,
    playlistSongs,
    playlistVideoItemsQuery,
    playlistVideoItems,
    videoSeriesList,
    favoriteVideoIds,
    mergedPlaylistItems,
    totalDuration,
    commitReorder,
    handleRemoveSongFromPlaylist,
    handleRemoveVideoFromPlaylist,
  } = usePlaylistMergedItems(props.playlistId);

  const {
    dropTargetIndex,
    effectiveDraggedItemKey,
    setScrollRef,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDragEnd,
    handlePointerDown,
    handleDrop,
  } = usePlaylistDragReorder(mergedPlaylistItems, isTouch, commitReorder);

  const {
    showImageCarousel,
    setShowImageCarousel,
    carouselImages,
    carouselInitialIndex,
    carouselLoading,
    handleOpenImageCarousel,
  } = usePlaylistImageCarousel(props.playlist, playlistSongs);

  // side-effect only - syncs the playlist's primary image into the
  // app-wide background, cleans up on unmount.
  usePlaylistBackgroundImage(props.playlist);

  const toggleFavoriteMutation = useToggleFavoriteMutation();

  // check if viewing remote playlists
  const isViewingRemote = createMemo(() => getCurrentRemote() !== null);

  // current remote (full Remote record) — used as the source for "send to remote".
  const currentRemoteFull = createCurrentRemoteFull();

  // build a SendPayload describing the selected playlist for the flyout.
  const buildPlaylistSendPayload = (): SendPayload => {
    const pl = props.playlist();
    const list = playlistSongs();
    return {
      kind: "playlist",
      playlistId: pl?.playlist_id ?? "",
      title: pl?.title ?? "untitled playlist",
      description: pl?.description ?? null,
      images: pl?.images ?? [],
      songs: list as unknown as RemoteSong[],
    };
  };

  // play a playlist row (song or video) - queues every item in the
  // playlist (mixed song+video queue, phase 4a) starting at the clicked
  // row's position, so playback continues into whatever kind comes next.
  const handleItemDoubleClick = async (item: MergedPlaylistItem) => {
    const items = mergedPlaylistItems();
    const startIndex = items.findIndex((i) => i.key === item.key);
    const playlist = props.playlist();
    await playQueue(items.map(mergedItemToMediaItem), {
      startIndex: Math.max(0, startIndex),
      source: {
        type: "playlist",
        label: playlist?.title ?? "playlist",
        entity_id: playlist?.playlist_id,
        image: playlist?.images?.[0],
      },
    });
  };

  // send the current playlist to a radio station as a `playlist` filter.
  // opens the AddToStationModal which lists existing stations; when the
  // user picks one we dispatch `radio_filters_add` with
  // `filter_type: "playlist"`. the server resolves the playlist's
  // current contents at tune time, so later edits to the playlist
  // automatically flow through to every station seeded by it.
  const handleAddToStation = async () => {
    const playlist = props.playlist();
    if (!playlist) return;
    await showStationSelector(
      {
        kind: "playlist",
        playlistId: playlist.playlist_id,
        playlistTitle: playlist.title,
      },
      getCurrentRemote()?.remote_id ?? null
    );
  };

  // play every item (songs + videos) in selected playlist, in playlist
  // order - true mixed-queue playback (phase 4a).
  const handlePlayAll = async () => {
    if (playlistActionPending()) return;
    const items = mergedPlaylistItems();
    if (items.length > 0) {
      setPlaylistActionPending("play");
      try {
        const playlist = props.playlist();
        await playQueue(items.map(mergedItemToMediaItem), {
          source: {
            type: "playlist",
            label: playlist?.title ?? "playlist",
            entity_id: playlist?.playlist_id,
            image: playlist?.images?.[0],
          },
        });
        // fire-and-forget: record initiated playlist play
        if (playlist?.playlist_id) {
          try {
            const remoteClient = await getRemoteClient();
            if (remoteClient) {
              void remoteClient.music.recordPlaylistPlay(playlist.playlist_id);
            }
          } catch (err) {
            console.warn("[playlist] recordPlaylistPlay failed:", err);
          }
        }
      } finally {
        setPlaylistActionPending(null);
      }
    }
  };

  // add every item (songs + videos) to the queue
  const handleAddToQueue = async () => {
    if (playlistActionPending()) return;
    const items = mergedPlaylistItems();
    if (items.length > 0) {
      setPlaylistActionPending("queue");
      try {
        const playlist = props.playlist();
        await addToQueue(items.map(mergedItemToMediaItem), {
          source: {
            type: "playlist",
            label: playlist?.title ?? "playlist",
            entity_id: playlist?.playlist_id,
            image: playlist?.images?.[0],
          },
        });
      } finally {
        setPlaylistActionPending(null);
      }
    }
  };

  // shuffle every item (songs + videos) and replace the current queue.
  // uses fisher-yates for an unbiased shuffle and tags the source as
  // "shuffle" so playQueue wipes the existing queue (same behavior as
  // picking an album/playlist).
  const handleShuffleAll = async () => {
    if (playlistActionPending()) return;
    const items = mergedPlaylistItems();
    if (items.length === 0) return;
    setPlaylistActionPending("shuffle");
    try {
      const shuffled = items.map(mergedItemToMediaItem);
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const playlist = props.playlist();
      await playQueue(shuffled, {
        source: {
          type: "shuffle",
          label: playlist?.title ? `shuffle: ${playlist.title}` : "shuffle",
          entity_id: playlist?.playlist_id,
          image: playlist?.images?.[0],
        },
      });
      if (playlist?.playlist_id) {
        try {
          const remoteClient = await getRemoteClient();
          if (remoteClient) {
            void remoteClient.music.recordPlaylistPlay(playlist.playlist_id);
          }
        } catch (err) {
          console.warn("[playlist] recordPlaylistPlay failed:", err);
        }
      }
    } finally {
      setPlaylistActionPending(null);
    }
  };

  // toggle edit mode
  const handleEditToggle = () => {
    const playlist = props.playlist();
    if (!playlist) return;

    props.setEditMode(!props.editMode());
  };

  // narrow view: most header actions collapse into a "..." flyout to save
  // horizontal space - play, shuffle, image carousel, and the favorite
  // toggle stay directly visible (see narrow header row below).
  const narrowOverflowActions = (): MenuAction[] => {
    const playlist = props.playlist();
    const hasSongs = playlistSongs().length > 0;
    const actions: MenuAction[] = [];

    if (canUpdatePlaylist(playlist?.created_by_id ?? null)) {
      actions.push({ label: "edit playlist", icon: "edit", onClick: handleEditToggle });
    }
    if (hasSongs) {
      actions.push({
        label: "add to queue",
        icon: "queue",
        onClick: () => void handleAddToQueue(),
      });
      // radio is a remote/server feature - not available for local-library-only playlists
      if (isViewingRemote()) {
        actions.push({
          label: "send to radio station",
          icon: "radioTower",
          onClick: () => void handleAddToStation(),
        });
      }
    }
    actions.push({
      label: "share",
      icon: "share",
      onClick: () =>
        showShareModal({
          target: {
            kind: "playlist",
            id: playlist?.playlist_id || "",
            displayTitle: playlist?.title || "",
          },
          source: () => currentRemoteFull(),
          buildSendPayload: buildPlaylistSendPayload,
        }),
    });
    if (hasSongs && playlist) {
      actions.push({
        label: "download zip",
        icon: "downloadZip",
        onClick: () => void downloadPlaylistZipWithToast(playlist, playlistSongs()),
      });
    }
    return actions;
  };

  // callbacks for PlaylistEditor
  const handlePlaylistSaved = () => {
    props.setEditMode(false);
  };

  const handlePlaylistDeleted = (deletedPlaylistId: string) => {
    props.onPlaylistDeleted(deletedPlaylistId);
  };

  const handlePlaylistEditCancelled = () => {
    props.setEditMode(false);
  };

  return (
    <div class={`flex flex-col h-full min-h-0 relative ${props.isNarrow() ? "overflow-auto" : ""}`}>
      {/* sticky header with back button for mobile */}
      <Show when={props.isNarrow() && props.showingDetailOnNarrow()}>
        <HeadingSection
          title={props.playlist()?.title || "playlist"}
          titleElement={
            <MarqueeText text={props.playlist()?.title || "playlist"} hoverOnly={true} />
          }
          variant="detail"
          sticky
          showBackButton={true}
          onBack={props.onBack}
          class="px-4 py-3 relative z-20 !bg-transparent backdrop-blur-sm"
        />
      </Show>

      {/* playlist header */}
      <div class="flex-shrink-0 p-6 relative z-10">
        <div class="flex-1">
          <Show
            when={props.editMode()}
            fallback={
              <>
                <Show when={!props.isNarrow()}>
                  <div class="flex items-center gap-2 mb-2">
                    <h2 class="text-2xl font-bold text-[var(--color-text-primary)]">
                      {props.playlist()?.title || "untitled playlist"}
                    </h2>
                  </div>
                </Show>

                <Show when={props.playlist()?.description}>
                  <p class="text-sm text-[var(--color-text-secondary)] mb-3">
                    {props.playlist()!.description}
                  </p>
                </Show>

                <Show when={(props.playlist()?.play_count ?? 0) > 0}>
                  <p
                    class="text-xs text-[var(--color-text-muted)] mb-3"
                    title="number of times this playlist's play button has been pressed"
                  >
                    played {props.playlist()!.play_count}
                    {(props.playlist()!.play_count ?? 0) === 1 ? " time" : " times"}
                  </p>
                </Show>

                {/* entity links — independently collapsible row */}
                <Show when={(props.playlist()?.urls?.length ?? 0) > 0}>
                  <div class="mb-3">
                    <EntityLinks
                      urls={props.playlist()?.urls as EntityUrl[] | undefined}
                      collapsible
                    />
                  </div>
                </Show>
              </>
            }
          >
            <PlaylistEditor
              playlist={props.playlist()!}
              onSaved={handlePlaylistSaved}
              onDeleted={handlePlaylistDeleted}
              onCancelled={handlePlaylistEditCancelled}
            />
          </Show>

          <Show when={!playlistSongsQuery.isLoading && !playlistVideoItemsQuery.isLoading}>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--color-text-secondary)] mb-4">
              <Show when={playlistSongs().length > 0}>
                <span>
                  {playlistSongs().length} {playlistSongs().length === 1 ? "song" : "songs"}
                </span>
              </Show>
              <Show when={playlistVideoItems().length > 0}>
                <span>
                  {playlistVideoItems().length}{" "}
                  {playlistVideoItems().length === 1 ? "video" : "videos"}
                </span>
              </Show>
              <Show when={totalDuration() > 0}>
                <span>{formatHumanDuration(totalDuration())}</span>
              </Show>
              {/* line break on narrow screens */}
              <div class="basis-full wide:hidden" />
              <Show when={props.playlist()?.created_at}>
                <span>created {formatRelativeTime(props.playlist()!.created_at)}</span>
              </Show>
            </div>
          </Show>

          {/* action buttons - only render here on wide screens */}
          <Show when={!props.editMode() && !props.isNarrow()}>
            <div class="flex gap-2 sticky top-0 py-2 z-10">
              <Show when={canUpdatePlaylist(props.playlist()?.created_by_id ?? null)}>
                <IconButton
                  icon="edit"
                  size="default"
                  variant="ghost"
                  onClick={handleEditToggle}
                  aria-label="edit playlist"
                  title="edit playlist"
                />
              </Show>
              <Show when={playlistSongs().length > 0}>
                <Button
                  variant="primary"
                  loading={playlistActionPending() === "play"}
                  disabled={playlistActionPending() !== null}
                  onClick={handlePlayAll}
                  title="play all songs in this playlist"
                >
                  play all
                </Button>
                <Button
                  variant="secondary"
                  loading={playlistActionPending() === "queue"}
                  disabled={playlistActionPending() !== null}
                  onClick={handleAddToQueue}
                  title="add all songs to the end of the queue"
                >
                  add to queue
                </Button>
                <IconButton
                  icon="shuffle"
                  size="default"
                  variant="ghost"
                  loading={playlistActionPending() === "shuffle"}
                  disabled={playlistActionPending() !== null}
                  onClick={handleShuffleAll}
                  aria-label="shuffle playlist"
                  title="shuffle playlist"
                />
              </Show>
              <IconButton
                icon="carousel"
                size="default"
                loading={carouselLoading()}
                onClick={handleOpenImageCarousel}
                aria-label="view all images"
                title="view all playlist images"
              />
              {/* radio is a remote/server feature - not available for local-library-only playlists */}
              <Show when={playlistSongs().length > 0 && isViewingRemote()}>
                <IconButton
                  icon="radioTower"
                  size="default"
                  variant="ghost"
                  onClick={handleAddToStation}
                  aria-label="send playlist to a radio station"
                  title="send playlist to a radio station"
                />
              </Show>
              <FavoriteToggle
                targetType="playlist"
                targetId={props.playlist()?.playlist_id || ""}
                isFavorite={props.playlist()?.is_favorite ?? false}
              />
              <ShareButton
                target={{
                  kind: "playlist",
                  id: props.playlist()?.playlist_id || "",
                  displayTitle: props.playlist()?.title || "",
                }}
                source={() => currentRemoteFull()}
                buildSendPayload={buildPlaylistSendPayload}
              />
              <Show when={playlistSongs().length > 0}>
                <DownloadPlaylistZipBundleButton
                  playlist={props.playlist()!}
                  songs={playlistSongs()}
                />
              </Show>
            </div>
          </Show>
        </div>
      </div>

      {/* sticky action buttons for narrow - direct child of scroll container.
          most actions collapse into the "..." flyout to save horizontal
          space; play, shuffle, image carousel, and favorite stay directly
          visible. */}
      <Show when={!props.editMode() && props.isNarrow()}>
        <div class="flex gap-2 justify-between flex-wrap sticky top-12 backdrop-blur-sm px-6 py-2 z-20">
          <Show when={playlistSongs().length > 0}>
            <IconButton
              icon="play"
              size="default"
              variant="ghost"
              loading={playlistActionPending() === "play"}
              disabled={playlistActionPending() !== null}
              onClick={handlePlayAll}
              aria-label="play all songs in this playlist"
              title="play all songs in this playlist"
            />
            <IconButton
              icon="shuffle"
              size="default"
              variant="ghost"
              loading={playlistActionPending() === "shuffle"}
              disabled={playlistActionPending() !== null}
              onClick={handleShuffleAll}
              aria-label="shuffle playlist"
              title="shuffle playlist (replaces current queue)"
            />
          </Show>
          <IconButton
            icon="carousel"
            size="default"
            loading={carouselLoading()}
            onClick={handleOpenImageCarousel}
            aria-label="view all images"
            title="view all playlist images"
          />
          <FavoriteToggle
            targetType="playlist"
            targetId={props.playlist()?.playlist_id || ""}
            isFavorite={props.playlist()?.is_favorite ?? false}
          />
          <ClickDropdownMenu
            trigger={
              <IconButton
                icon="more"
                size="default"
                variant="ghost"
                aria-label="more playlist actions"
                title="more playlist actions"
                data-testid="btn-more-playlist"
              />
            }
            actions={narrowOverflowActions()}
          />
        </div>
      </Show>

      {/* playlist items - songs and videos interleaved in one
          shared position space (see usePlaylistMergedItems), sharing the
          same drag-reorder machinery via PlaylistSongRow/PlaylistVideoRow. */}
      <div class={`relative z-10 ${props.isNarrow() ? "" : "flex-1 overflow-hidden"}`}>
        <Show
          when={!playlistSongsQuery.isLoading && !playlistVideoItemsQuery.isLoading}
          fallback={
            <div class="flex items-center justify-center h-full">
              <div class="text-[var(--color-text-secondary)]">loading songs...</div>
            </div>
          }
        >
          <Show
            when={mergedPlaylistItems().length > 0}
            fallback={
              <div class="flex items-center justify-center h-full">
                <p class="text-[var(--color-text-secondary)]">this playlist is empty</p>
              </div>
            }
          >
            <div
              class={`${props.isNarrow() ? "" : "overflow-auto h-full"}`}
              ref={(el) => setScrollRef(el)}
            >
              <div class="space-y-1" data-playlist-items>
                <For each={mergedPlaylistItems()}>
                  {(item, index) => {
                    // entity-type-keyed render registry (not an if/else
                    // chain) - a third playlist item kind slots in here
                    // as a new entry.
                    const rowRenderers: Record<MergedPlaylistItem["kind"], () => JSX.Element> = {
                      video: () => (
                        <PlaylistVideoRow
                          item={item as Extract<MergedPlaylistItem, { kind: "video" }>}
                          index={index()}
                          playlistId={props.playlistId()}
                          isTouch={isTouch}
                          isNarrow={props.isNarrow}
                          editMode={props.editMode}
                          favoriteVideoIds={favoriteVideoIds}
                          videoSeriesList={videoSeriesList}
                          isDragging={effectiveDraggedItemKey() === item.key}
                          isDropTarget={dropTargetIndex() === index()}
                          onDragStart={handleDragStart(item.key)}
                          onDragOver={handleDragOver(index())}
                          onDragLeave={handleDragLeave}
                          onDrop={() => void handleDrop(index())}
                          onDragEnd={handleDragEnd}
                          onPointerDown={handlePointerDown(item.key)}
                          onDoubleClick={() => void handleItemDoubleClick(item)}
                          onFavoriteToggle={(videoId, isFavorite) => {
                            toggleFavoriteMutation.mutate({
                              targetType: "video",
                              targetId: videoId,
                              isFavorite,
                            });
                          }}
                          onRemove={handleRemoveVideoFromPlaylist}
                        />
                      ),
                      song: () => (
                        <PlaylistSongRow
                          item={item as Extract<MergedPlaylistItem, { kind: "song" }>}
                          index={index()}
                          playlistId={props.playlistId()}
                          playlistOwnerId={props.playlist()?.created_by_id ?? null}
                          isTouch={isTouch}
                          isNarrow={props.isNarrow}
                          editMode={props.editMode}
                          isDragging={effectiveDraggedItemKey() === item.key}
                          isDropTarget={dropTargetIndex() === index()}
                          onDragStart={handleDragStart(item.key)}
                          onDragOver={handleDragOver(index())}
                          onDragLeave={handleDragLeave}
                          onDrop={() => void handleDrop(index())}
                          onDragEnd={handleDragEnd}
                          onPointerDown={handlePointerDown(item.key)}
                          onDoubleClick={() => void handleItemDoubleClick(item)}
                          onFavoriteToggle={(songId, sha256, isFavorite) => {
                            toggleFavoriteMutation.mutate({
                              targetType: "song",
                              targetId: songId,
                              sha256,
                              isFavorite,
                            });
                          }}
                          onRemove={(song) => void handleRemoveSongFromPlaylist(song)}
                        />
                      ),
                    };

                    return rowRenderers[item.kind]();
                  }}
                </For>
              </div>
            </div>
          </Show>
        </Show>
      </div>

      {/* image carousel modal */}
      <Show when={showImageCarousel()}>
        <ImageCarouselModal
          images={carouselImages()}
          initialIndex={carouselInitialIndex()}
          onClose={() => setShowImageCarousel(false)}
        />
      </Show>
    </div>
  );
}
