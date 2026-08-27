// playlists view - the 2-column list-selection shell: playlist list query,
// selection state, and playlist create/delete. the actual playlist-contents
// display (songs/videos, drag reorder, image carousel, editor, etc.) lives
// in PlaylistDetailPanel - see docs/playlist-unification-plan.md phase 2.
import { useNavigate, useParams, useSearchParams } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { appState } from "../../app/services/storage/db";
import { isRadioPlayerBarActive } from "../../app/services/radio/radioService";
import { setPageInfo, clearPageInfo } from "../../app/services/pageInfo";
import { useViewportHeight, getNavHeight } from "../../utils/viewport";
import { Button } from "../../components/buttons/Button";
import { toast } from "../../components/feedback/Toast";
import { LoadingState } from "../../components/feedback";
import { TwoColumnLayout } from "../../components/layout/TwoColumnLayout";
import { VirtualItemList, type ListItem } from "../../components/virtualized/VirtualItemList";
import { formatRelativeTime } from "../../utils/dateTime";
import { buildRoute, getRoutePrefix } from "../utils/routing";
import { getDataSource, RemoteOfflineError } from "../data";
import { usePlaylistsQuery } from "../queries/playlists";
import { usePlaylistContextMenu } from "../hooks/contextMenu";
import { type Playlist } from "../services/storage/types";
import { debug, error as errorLog } from "../../utils/logger";
import { isNarrowViewport } from "../../config/breakpoints";
import { isTouchDevice } from "../../utils/isMobile";
import { PlaylistDetailPanel } from "./playlists/PlaylistDetailPanel";

export interface PlaylistsViewProps {
  onAddMedia: () => void;
}

export function PlaylistsView(_props: PlaylistsViewProps) {
  const params = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();
  const [isResetting, setIsResetting] = createSignal(false);
  const navigate = useNavigate();

  // detect touch device once - stable for the session
  const isTouch = isTouchDevice();

  // restore selected playlist from history state on mount, fallback to params.id
  const initialPlaylistId =
    typeof window !== "undefined"
      ? (window.history.state?.selectedPlaylistId as string | null) || params.id || null
      : params.id || null;

  // responsive: track narrow viewport
  const [isNarrow, setIsNarrow] = createSignal(isNarrowViewport());

  // reactive viewport height for safari toolbar handling
  const viewportHeight = useViewportHeight();
  const playerBarHeight = () =>
    (appState()?.queue.length || 0) > 0 || isRadioPlayerBarActive() ? 80 : 0;
  const listHeight = () => {
    const vh = viewportHeight();
    const pb = playerBarHeight();
    const navH = getNavHeight();
    const result = vh - navH - pb;
    debug("PlaylistsView", `listHeight=${result}px (viewport=${vh}, nav=${navH}, playerBar=${pb})`);
    return result;
  };

  // track whether detail is showing on narrow (for back navigation)
  // initialize to true if we have an initial ID and are on a narrow screen
  const [showingDetailOnNarrow, setShowingDetailOnNarrow] = createSignal(
    isNarrowViewport() && !!initialPlaylistId
  );

  const [selectedPlaylistId, setSelectedPlaylistId] = createSignal<string | null>(
    initialPlaylistId
  );
  const [editMode, setEditMode] = createSignal(false);

  onMount(() => {
    const handleResize = () => {
      const narrow = isNarrowViewport();
      setIsNarrow(narrow);
      // reset detail view state when going from narrow to wide
      if (!narrow) {
        setShowingDetailOnNarrow(false);
      }
    };
    window.addEventListener("resize", handleResize);

    onCleanup(() => {
      window.removeEventListener("resize", handleResize);
      clearPageInfo(); // clear page info when leaving view
    });
  });
  const [scrollToIndex, setScrollToIndex] = createSignal<((index: number) => void) | null>(null);
  const [isLocalClick, setIsLocalClick] = createSignal(false);

  // save selected playlist to history state when it changes
  createEffect(() => {
    const playlistId = selectedPlaylistId();
    if (typeof window !== "undefined") {
      const currentState = window.history.state || {};
      if (playlistId) {
        window.history.replaceState({ ...currentState, selectedPlaylistId: playlistId }, "");
      } else {
        const { selectedPlaylistId: _ignored, ...rest } = currentState;
        window.history.replaceState(rest, "");
      }
    }
  });

  // sync URL params with selected playlist
  createEffect(() => {
    const urlPlaylistId = params.id;

    if (urlPlaylistId && urlPlaylistId !== selectedPlaylistId()) {
      setSelectedPlaylistId(urlPlaylistId);

      // show detail view if on narrow and have a playlist selected
      if (isNarrow() && urlPlaylistId) {
        setShowingDetailOnNarrow(true);
      }

      // only scroll if this is from navigation (back/forward/initial), not from clicking in the list
      const shouldScroll = !isLocalClick();
      if (shouldScroll && scrollToIndex()) {
        const playlistIndex = playlists().findIndex((p) => p.playlist_id === urlPlaylistId);
        if (playlistIndex >= 0) {
          scrollToIndex()!(playlistIndex);
        }
      }

      // reset flag after capturing its value
      setIsLocalClick(false);
    }
  });

  // query client for invalidation
  const queryClient = useQueryClient();

  // fetch playlists using infinite query
  const playlistsQuery = usePlaylistsQuery({
    search: () => {
      const q = searchParams.q;
      return Array.isArray(q) ? q[0] : q;
    },
  });

  // reset virtual list when query param changes
  createEffect(() => {
    // track query param changes to reset list
    searchParams.q; // read to create dependency
    // briefly show resetting state to force list to remount
    setIsResetting(true);
    setTimeout(() => setIsResetting(false), 0);
  });

  // flatten pages into single array
  const playlists = createMemo(() => {
    const pages = playlistsQuery.data?.pages;
    if (!pages) return [];
    return pages.flatMap((page) => page.items);
  });

  // get selected playlist metadata

  const selectedPlaylist = createMemo(() => {
    const id = selectedPlaylistId();
    if (!id) return null;

    const summary = playlists().find((p) => p.playlist_id === id);
    if (!summary) return null;

    // return the summary from cache (gets optimistically updated for instant UI feedback)
    // this works for both local and remote since the cache is the source of truth
    return summary as unknown as Playlist;
  });

  // update page info for TopNav (mobile displays "playlists (N)"). when a
  // playlist is selected, use its actual title for the browser tab title.
  createEffect(() => {
    const count = playlists().length;
    setPageInfo({ title: "playlists", count, documentTitle: selectedPlaylist()?.title });
  });

  // convert playlists to list items for VirtualItemList
  const playlistListItems = createMemo((): ListItem[] => {
    return playlists().map((playlist) => {
      return {
        id: playlist.playlist_id,
        title: playlist.title,
        subtitle: `${playlist.song_count} ${playlist.song_count === 1 ? "song" : "songs"}`,
        metadata: `updated ${formatRelativeTime(playlist.updated_at)}`,
        images: playlist.images,
      };
    });
  });

  // read URL parameter on mount (for standalone page support)
  createEffect(() => {
    const id = params.id;
    if (id && !selectedPlaylistId()) {
      setSelectedPlaylistId(id);
    }
  });

  // auto-select first playlist when data loads (like ArtistsView/GenresView)
  createEffect(() => {
    const items = playlists();
    if (items.length > 0 && !selectedPlaylistId()) {
      setSelectedPlaylistId(items[0].playlist_id);
    }
  });

  // clear edit mode when navigating to a different playlist
  createEffect(() => {
    selectedPlaylistId();
    setEditMode(false);
  });

  // handle playlist selection (simple click, like ArtistsView/GenresView)
  const handlePlaylistClick = (item: ListItem) => {
    setIsLocalClick(true);
    // on narrow, show detail view
    if (isNarrow()) {
      setShowingDetailOnNarrow(true);
    }
    navigate(buildRoute(`/playlists/${item.id}`));
  };

  // handle back navigation on narrow
  const handleBack = () => {
    setShowingDetailOnNarrow(false);
  };

  // fetch more playlists when scrolling near end
  const handlePlaylistsLoadMore = () => {
    if (playlistsQuery.hasNextPage && !playlistsQuery.isFetchingNextPage) {
      playlistsQuery.fetchNextPage();
    }
  };

  // handle create playlist
  const handleCreatePlaylist = async () => {
    const dataSource = getDataSource();

    try {
      const result = await dataSource.createPlaylist?.({
        title: "new playlist",
        description: null,
        is_public: false,
      });

      if (result) {
        // invalidate queries
        await queryClient.invalidateQueries({ queryKey: ["playlists"] });

        // select the new playlist
        setSelectedPlaylistId(result.playlist_id);
        const prefix = getRoutePrefix();
        navigate(`${prefix}/playlists/${result.playlist_id}`, {
          replace: true,
        });

        // enter edit mode
        setEditMode(true);
      }
    } catch (error) {
      errorLog("failed to create playlist:", error);
      toast.error(error instanceof Error ? error.message : "failed to create playlist", {
        title: "creation failed",
      });
    }
  };

  // callbacks for PlaylistDetailPanel/PlaylistEditor
  const handlePlaylistDeleted = (deletedPlaylistId: string) => {
    const all = playlists();
    const remaining = all.filter((p) => p.playlist_id !== deletedPlaylistId);

    // no playlists left: clear selection and show empty state
    if (remaining.length === 0) {
      setSelectedPlaylistId(null);
      const prefix = getRoutePrefix();
      navigate(`${prefix}/playlists`, { replace: true });
      return;
    }

    // pick the next playlist by preserving list position where possible
    const deletedIndex = all.findIndex((p) => p.playlist_id === deletedPlaylistId);
    const nextIndex = deletedIndex >= 0 ? Math.min(deletedIndex, remaining.length - 1) : 0;
    const fallback = remaining[Math.max(0, nextIndex)];

    setSelectedPlaylistId(fallback.playlist_id);
    const prefix = getRoutePrefix();
    navigate(`${prefix}/playlists/${fallback.playlist_id}`, { replace: true });
  };

  // debug: log actual rendered heights
  let containerRef: HTMLDivElement | undefined;
  onMount(() => {
    setTimeout(() => {
      if (containerRef) {
        const rect = containerRef.getBoundingClientRect();
        const parentRect = containerRef.parentElement?.getBoundingClientRect();
        debug("PlaylistsView", "rendered heights:", {
          containerHeight: rect.height,
          containerTop: rect.top,
          containerBottom: rect.bottom,
          parentHeight: parentRect?.height,
          parentTop: parentRect?.top,
          viewportHeight: viewportHeight(),
          listHeightCalc: listHeight(),
          windowHeight: window.innerHeight,
        });
      }
    }, 500);
  });

  return (
    <div ref={containerRef} class="flex flex-col" style={{ height: `${listHeight()}px` }}>
      {/* two-column layout */}
      <div class="flex-1 overflow-hidden">
        <Show
          when={!playlistsQuery.isLoading}
          fallback={
            <div class="flex items-center justify-center h-full">
              <LoadingState text="loading playlists..." />
            </div>
          }
        >
          <Show
            when={!playlistsQuery.isError}
            fallback={
              <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
                <div class="text-center max-w-md">
                  <Show
                    when={playlistsQuery.error instanceof RemoteOfflineError}
                    fallback={
                      <p class="text-lg text-[var(--color-text-secondary)] mb-2">
                        failed to load playlists
                      </p>
                    }
                  >
                    <p class="text-lg text-[var(--color-text-secondary)] mb-2">
                      {(playlistsQuery.error as RemoteOfflineError).remoteName} is offline
                    </p>
                    <p class="text-sm text-[var(--color-text-muted)]">
                      switch to a different remote or use local library
                    </p>
                  </Show>
                </div>
              </div>
            }
          >
            <Show
              when={playlistListItems().length > 0}
              fallback={
                <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
                  <div class="text-center max-w-md">
                    <p class="text-lg text-[var(--color-text-secondary)] mb-4">
                      no playlists found!
                    </p>
                    <Button variant="primary" onClick={handleCreatePlaylist}>
                      create playlist
                    </Button>
                  </div>
                </div>
              }
            >
              {isResetting() ? (
                <div class="flex items-center justify-center h-full">
                  <div class="text-[var(--color-text-secondary)]">loading...</div>
                </div>
              ) : (
                <TwoColumnLayout
                  leftColumn={
                    <>
                      <VirtualItemList
                        items={playlistListItems()}
                        selectedId={selectedPlaylistId()}
                        scrollPaddingTop={100}
                        scrollPaddingBottom={68}
                        height={listHeight()}
                        onItemClick={handlePlaylistClick}
                        onVirtualizerReady={(scrollFn) => {
                          setScrollToIndex(() => scrollFn);

                          // only scroll if current playlist matches the initial one (prevents scroll on subsequent clicks)
                          const current = selectedPlaylistId();
                          if (current && current === initialPlaylistId) {
                            const index = playlists().findIndex((p) => p.playlist_id === current);
                            if (index >= 0) {
                              setTimeout(() => scrollFn(index), 50);
                            }
                          }
                        }}
                        onEndReached={handlePlaylistsLoadMore}
                        getContextMenuActions={(item) => {
                          const playlist = playlists().find((p) => p.playlist_id === item.id);
                          if (!playlist) return [];

                          return usePlaylistContextMenu(
                            {
                              id: playlist.playlist_id,
                              title: playlist.title,
                              song_count: playlist.song_count,
                              images: playlist.images,
                            },
                            {
                              showPlayActions: true,
                              isFavorite: false, // playlist-level favorites not yet implemented on frontend
                            }
                          );
                        }}
                      />
                      <div class="sticky bottom-0 p-4">
                        <Button variant="primary" fullWidth={true} onClick={handleCreatePlaylist}>
                          create playlist
                        </Button>
                      </div>
                    </>
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
                      {(playlistId) => (
                        <PlaylistDetailPanel
                          playlistId={playlistId}
                          playlist={selectedPlaylist}
                          isNarrow={isNarrow}
                          isTouch={isTouch}
                          showingDetailOnNarrow={showingDetailOnNarrow}
                          onBack={handleBack}
                          editMode={editMode}
                          setEditMode={setEditMode}
                          onPlaylistDeleted={handlePlaylistDeleted}
                        />
                      )}
                    </Show>
                  }
                  showDetail={showingDetailOnNarrow()}
                  onBack={handleBack}
                />
              )}
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
}
