// feed view — single infinite scrolling list of all activity events
import { useNavigate } from "@solidjs/router";
import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js";
import { useViewportHeight, getNavHeight } from "../../utils/viewport";
import { Icon, IconNames } from "../../components/icons/registry";
import { Button } from "../../components/buttons/Button";
import { LoadingState, LoadingMoreIndicator } from "../../components/feedback";
import { VirtualFeedList } from "../../components/virtualized/VirtualFeedList";
import type { MenuAction } from "../../components/overlays/ContextMenu";
import { appState } from "../../app/services/storage/db";
import { setPageInfo, clearPageInfo, type FeedTypeFilter } from "../../app/services/pageInfo";
import { useHistoryState } from "../../utils/historyState";
import { getCurrentRemote, getCurrentUser, getDataSource, RemoteOfflineError } from "../data";
import type { FeedItem } from "../data/types";
import {
  useActivityFeedInfiniteQuery,
  ALL_FEED_TYPES,
  FEED_TYPE_LABELS,
  type FeedItemTypeFilter,
} from "../queries/analytics";
import { routes } from "../utils/routing";
import { playQueue, addToQueue, resumeHistoryEntry } from "../services/queue/queue";
import { resumeServerSession } from "../services/queue/serverSession";
import { activeHistoryEntryId } from "../services/queue/listenProgress";
import { queueHistory, updateHistoryServerSession } from "../services/queue/queueHistory";
import { toast } from "../../components/feedback/Toast";
import { confirm } from "../../app/services/confirmState";
import {
  showImageCarousel,
  showSongEditor,
  showAlbumEditor,
  showArtistEditor,
} from "../hooks/modals";
import { showPlaylistSelector } from "../hooks/playlistSelectorState";
import { setHighlightedSongId } from "../state/highlightedSong";
import { useQueryClient } from "@tanstack/solid-query";
import { queryKeys } from "../queries/queryKeys";
import { resolveBlobUrl, usesBlobResolver } from "../services/storage/blobResolver";

export function FeedView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const remote = getCurrentRemote();

  // filter state (persisted in browser history)
  const [feedTypeFilters, setFeedTypeFilters] = useHistoryState<FeedTypeFilter[]>(
    "feed.typeFilters",
    []
  );
  const [myItemsOnly, setMyItemsOnly] = useHistoryState("feed.myItemsOnly", false);

  // derived filter accessors for the query
  const feedTypesForQuery = () => {
    const filters = feedTypeFilters();
    if (filters.length === 0) return null;

    const includes = filters
      .filter((f) => f.mode === "include")
      .map((f) => f.type as FeedItemTypeFilter);
    const excludes = filters
      .filter((f) => f.mode === "exclude")
      .map((f) => f.type as FeedItemTypeFilter);

    if (includes.length > 0) {
      // include mode: only show these types
      return includes;
    }
    if (excludes.length > 0) {
      // exclude mode: show everything except these types
      return ALL_FEED_TYPES.filter((t) => !excludes.includes(t));
    }
    return null;
  };
  const userIdForQuery = () => {
    if (!myItemsOnly()) return null;
    return getCurrentUser()?.userId ?? null;
  };

  const feedQuery = useActivityFeedInfiniteQuery(50, feedTypesForQuery, userIdForQuery);

  // flatten all pages into a single array
  const allItems = createMemo(() => {
    const pages = feedQuery.data?.pages ?? [];
    return pages.flatMap((page) => page.items);
  });

  // total count from the first page response
  const totalCount = createMemo(() => {
    const pages = feedQuery.data?.pages ?? [];
    return pages.length > 0 ? pages[0].total : 0;
  });
  // ensure totalCount is tracked to avoid unused warning
  void totalCount;

  // responsive list height — reactive to safari toolbar changes
  const viewportHeight = useViewportHeight();
  const playerBarHeight = () => ((appState()?.queue.length || 0) > 0 ? 80 : 0);
  const listHeight = () => viewportHeight() - getNavHeight() - playerBarHeight();

  // set page info with feed filter controls
  createEffect(
    on(
      () => [allItems().length, feedTypeFilters(), myItemsOnly(), showBackToTop()] as const,
      ([count]) => {
        setPageInfo({
          title: "feed",
          count,
          feedTypeOptions: ALL_FEED_TYPES.map((t) => ({
            value: t,
            label: FEED_TYPE_LABELS[t],
          })),
          selectedFeedTypes: feedTypeFilters(),
          onToggleFeedType: (type: string) => {
            setFeedTypeFilters((prev) => {
              const existing = prev.find((f) => f.type === type);
              if (existing) {
                // already selected — remove it
                return prev.filter((f) => f.type !== type);
              }
              // add as include by default
              return [...prev, { type, mode: "include" }];
            });
          },
          onToggleFeedTypeMode: (type: string) => {
            setFeedTypeFilters((prev) =>
              prev.map((f) =>
                f.type === type ? { ...f, mode: f.mode === "include" ? "exclude" : "include" } : f
              )
            );
          },
          onRemoveFeedType: (type: string) => {
            setFeedTypeFilters((prev) => prev.filter((f) => f.type !== type));
          },
          onClearFeedTypes: () => setFeedTypeFilters([]),
          myItemsOnly: myItemsOnly(),
          onToggleMyItems: () => setMyItemsOnly((prev) => !prev),
          showBackToTop: showBackToTop(),
          onBackToTop: handleBackToTop,
        });
      }
    )
  );
  onCleanup(() => clearPageInfo());

  // load more handler
  const loadMore = () => {
    if (!feedQuery.hasNextPage || feedQuery.isFetchingNextPage) return;
    feedQuery.fetchNextPage();
  };

  // handle feed item click — navigate to the relevant entity
  const handleItemClick = (item: FeedItem) => {
    // for new_image, row click opens the image carousel
    if (item.feed_type === "new_image") {
      void handleImageCarousel(item);
      return;
    }

    if (item.feed_type === "listen_session" && item.session_id) {
      // own sessions resume, other users' sessions start over
      const isOwnSession = item.user_id && item.user_id === getCurrentUser()?.userId;
      if (isOwnSession) {
        void playSession(item);
      } else {
        void startSessionOver(item);
      }
      return;
    }
    if (item.album_id) {
      // if navigating to album for a song, highlight the song
      if (item.song_id) {
        setHighlightedSongId(item.song_id);
      }
      navigate(routes.album(item.album_id));
    } else if (item.artist_id) {
      navigate(routes.artist(item.artist_id));
    } else if (item.playlist_id) {
      navigate(routes.playlist(item.playlist_id));
    }
  };

  // helper: fetch songs by IDs via data source (batch request)
  const fetchSongsByIds = async (songIds: string[]) => {
    const dataSource = getDataSource();
    return dataSource.getSongsByIds?.(songIds) ?? [];
  };

  // helper: play a session — resume if active/paused, otherwise start fresh
  const playSession = async (item: FeedItem) => {
    if (!remote || !item.session_id) return;

    // check IDB first for an existing local history entry that matches this server session
    const existingEntry = queueHistory().find((e) => e.server_session_id === item.session_id);

    if (existingEntry) {
      // found in local history — fast resume via IDB
      void resumeHistoryEntry(existingEntry);
      return;
    }

    // not in local history — need to fetch from server (slower)
    const confirmed = await confirm({
      title: "Resume Session",
      message:
        "This session is not in local history and needs to be loaded from the server. This may take a moment.",
      confirmText: "Load Session",
      cancelText: "Cancel",
    });

    if (!confirmed) return;

    try {
      // fetch the full session from server via data source
      const dataSource = getDataSource();
      if (!dataSource.getListenSession) {
        toast.error("listen sessions not supported");
        return;
      }

      const session = await dataSource.getListenSession(item.session_id);

      if (!session) {
        toast.error("failed to load session");
        return;
      }
      const songs = await fetchSongsByIds(session.song_ids);
      if (songs.length === 0) {
        toast.error("no playable songs in session");
        return;
      }

      // a session is effectively done if its status is "completed" or all songs were played
      const isEffectivelyComplete =
        session.status === "completed" || session.songs_completed >= session.total_songs;
      const canResume = !isEffectivelyComplete && session.current_song_index < songs.length;

      if (canResume) {
        // resume: play from current song index
        // skip server session creation — resumeServerSession below handles tracking
        const resumeProgress = {
          listened_seconds: Math.round(session.listened_duration_ms / 1000),
          songs_completed: session.songs_completed,
          current_song_index: session.current_song_index,
          current_song_position: Math.round((session.current_song_position_ms ?? 0) / 1000),
        };

        await playQueue(songs, {
          startIndex: session.current_song_index,
          skipServerSession: true,
          resumeProgress,
          source: {
            type: session.session_type as any,
            label: session.label,
            entity_id: session.entity_id ?? undefined,
          },
        });

        // resume the server session tracking
        const remote = getCurrentRemote();
        if (remote) {
          await resumeServerSession(session.id, { progress: session.songs_completed }, remote, {
            label: session.label,
            entityId: session.entity_id ?? undefined,
          });

          // link the new history entry to the resumed server session
          const entryId = activeHistoryEntryId();
          if (entryId) {
            void updateHistoryServerSession(entryId, session.id, remote.remote_id);
          }
        }

        toast.info("resumed session");
      } else {
        // completed — start fresh as a new session
        await playQueue(songs, {
          source: {
            type: session.session_type as any,
            label: session.label,
            entity_id: session.entity_id ?? undefined,
          },
        });
        toast.info("started new session");
      }
    } catch (error) {
      console.error("failed to play session:", error);
      toast.error("failed to play session");
    }
  };

  // helper: start a session over from the beginning (ignore resume state)
  const startSessionOver = async (item: FeedItem) => {
    if (!remote || !item.session_id) return;

    try {
      const dataSource = getDataSource();
      if (!dataSource.getListenSession) {
        toast.error("listen sessions not supported");
        return;
      }

      const session = await dataSource.getListenSession(item.session_id);

      if (!session) {
        toast.error("failed to load session");
        return;
      }
      const songs = await fetchSongsByIds(session.song_ids);
      if (songs.length === 0) {
        toast.error("no playable songs in session");
        return;
      }

      await playQueue(songs, {
        source: {
          type: session.session_type as any,
          label: session.label,
          entity_id: session.entity_id ?? undefined,
        },
      });
    } catch (error) {
      console.error("failed to start session over:", error);
      toast.error("failed to start session");
    }
  };

  // helper: play a single song by ID
  const playSongById = async (songId: string, title: string) => {
    const dataSource = getDataSource();
    try {
      const song = await dataSource.getSongById(songId);
      if (song) {
        await playQueue([song], { source: { type: "song", label: title } });
      }
    } catch {
      toast.error("failed to play song");
    }
  };

  // helper: play all songs from an album
  const playAlbumById = async (albumId: string, title: string) => {
    const dataSource = getDataSource();
    if (!dataSource.getAlbumSongs) return;
    try {
      const response = await dataSource.getAlbumSongs(albumId);
      if (response.items.length > 0) {
        await playQueue(response.items, {
          source: { type: "album", label: title, entity_id: albumId },
        });
      }
    } catch {
      toast.error("failed to play album");
    }
  };

  // helper: play all songs from a playlist
  const playPlaylistById = async (playlistId: string, title: string) => {
    const dataSource = getDataSource();
    if (!dataSource.getPlaylistSongs) return;
    try {
      const response = await dataSource.getPlaylistSongs(playlistId);
      if (response.items.length > 0) {
        await playQueue(response.items, {
          source: { type: "playlist", label: title, entity_id: playlistId },
        });
      }
    } catch {
      toast.error("failed to play playlist");
    }
  };

  // helper: open image carousel for an item
  const handleImageCarousel = async (item: FeedItem) => {
    const images = item.images;
    if (images && images.length > 0) {
      // filter out waveforms, keep images that have blob_id or remote_url
      const displayableImages = images.filter(
        (img) => img.blob_type !== "waveform" && (img.remote_blob_id || img.remote_url)
      );

      if (displayableImages.length > 0) {
        // check if we need blob resolution (tauri-managed or P2P)
        const firstWithServerId = displayableImages.find((img) => img.remote_server_id);
        const needsResolution = firstWithServerId
          ? await usesBlobResolver(firstWithServerId.remote_server_id!)
          : false;

        let urls: string[];
        if (needsResolution) {
          // resolve all image URLs via blobResolver
          urls = await Promise.all(
            displayableImages.map(async (img) => {
              if (img.remote_blob_id && img.remote_server_id) {
                try {
                  return await resolveBlobUrl(img.remote_blob_id, img.remote_server_id, "image");
                } catch {
                  return img.remote_url ?? "";
                }
              }
              return img.remote_url ?? "";
            })
          );
          urls = urls.filter((u) => u); // remove empty strings
        } else {
          // standard HTTP - use remote_url directly
          urls = displayableImages.filter((img) => img.remote_url).map((img) => img.remote_url!);
        }

        if (urls.length > 0) {
          showImageCarousel({
            images: urls,
            title: item.title ?? undefined,
          });
          return;
        }
      }
    }
  };

  // handle image/thumb click — open carousel if images available, otherwise play
  const handleImageClick = async (item: FeedItem) => {
    if (item.feed_type === "new_image") {
      // for new_image, thumbnail click opens carousel (matches carousel icon on hover)
      await handleImageCarousel(item);
      return;
    }

    // for other types, open carousel or fall back to play
    await handleImageCarousel(item);
    if (
      !(
        item.images &&
        item.images.length > 0 &&
        item.images.some(
          (img) => img.blob_type !== "waveform" && (img.remote_blob_id || img.remote_url)
        )
      )
    ) {
      await handlePlayItem(item);
    }
  };

  // play or resume the feed item (used by context menu + image click fallback)
  const handlePlayItem = async (item: FeedItem) => {
    switch (item.feed_type) {
      case "listen_session":
        await playSession(item);
        break;

      case "recent_listen":
      case "recent_favorite":
      case "recent_rating":
        // song-based items — play the song
        if (item.song_id) {
          await playSongById(item.song_id, item.title);
        } else if (item.album_id) {
          await playAlbumById(item.album_id, item.title);
        }
        break;

      case "recent_album":
        if (item.album_id) {
          await playAlbumById(item.album_id, item.title);
        }
        break;

      case "recent_playlist":
        if (item.playlist_id) {
          await playPlaylistById(item.playlist_id, item.title);
        }
        break;
    }
  };

  // add item to queue (shared between context menu and quick-action button)
  const handleAddToQueue = async (item: FeedItem) => {
    try {
      if (item.song_id) {
        const dataSource = getDataSource();
        const song = await dataSource.getSongById(item.song_id);
        if (song) {
          await addToQueue([song], {
            source: { type: "song", label: item.title },
          });
        }
      } else if (item.album_id) {
        const dataSource = getDataSource();
        if (dataSource.getAlbumSongs) {
          const response = await dataSource.getAlbumSongs(item.album_id);
          if (response.items.length > 0) {
            await addToQueue(response.items, {
              source: { type: "album", label: item.title, entity_id: item.album_id },
            });
          }
        }
      } else if (item.playlist_id) {
        const dataSource = getDataSource();
        if (dataSource.getPlaylistSongs) {
          const response = await dataSource.getPlaylistSongs(item.playlist_id);
          if (response.items.length > 0) {
            await addToQueue(response.items, {
              source: { type: "playlist", label: item.title, entity_id: item.playlist_id },
            });
          }
        }
      }
    } catch {
      toast.error("failed to add to queue");
    }
  };

  // build context menu actions for a feed item
  const getContextMenuActions = (item: FeedItem): MenuAction[] => {
    const actions: MenuAction[] = [];

    // listening sessions get their own menu
    if (item.feed_type === "listen_session") {
      const isOwnSession = item.user_id && item.user_id === getCurrentUser()?.userId;
      const isCompleted =
        item.session_status === "completed" || (item.progress_percent ?? 0) >= 100;

      if (isOwnSession && !isCompleted) {
        actions.push({
          label: "resume",
          icon: IconNames.play,
          onClick: () => void playSession(item),
        });
      }
      actions.push({
        label: "start over",
        icon: IconNames.recent,
        onClick: () => void startSessionOver(item),
      });
      actions.push({
        label: "add to queue",
        icon: IconNames.queue,
        onClick: async () => {
          try {
            if (item.session_id) {
              const dataSource = getDataSource();
              if (!dataSource.getListenSession) {
                toast.error("listen sessions not supported");
                return;
              }
              const session = await dataSource.getListenSession(item.session_id);
              if (session) {
                const songs = await fetchSongsByIds(session.song_ids);
                if (songs.length > 0) {
                  await addToQueue(songs, {
                    source: { type: "song", label: item.title },
                  });
                }
              }
            }
          } catch {
            toast.error("failed to add to queue");
          }
        },
      });

      // delete session (own sessions only)
      if (isOwnSession && item.session_id) {
        actions.push({ type: "separator" });
        actions.push({
          label: "delete session",
          icon: IconNames.delete,
          onClick: async () => {
            try {
              if (item.session_id) {
                const dataSource = getDataSource();
                if (!dataSource.deleteListenSession) {
                  toast.error("cannot delete session");
                  return;
                }
                await dataSource.deleteListenSession(item.session_id);
                toast.info("session deleted");
                // invalidate feed queries to refresh
                void queryClient.invalidateQueries({
                  queryKey: queryKeys.analytics.all(),
                });
              }
            } catch {
              toast.error("failed to delete session");
            }
          },
        });
      }

      return actions;
    }

    // play action
    actions.push({
      label: "play",
      icon: IconNames.play,
      onClick: () => void handlePlayItem(item),
    });

    // add to queue (for items with songs)
    if (item.song_id || item.album_id || item.playlist_id) {
      actions.push({
        label: "add to queue",
        icon: IconNames.queue,
        onClick: () => void handleAddToQueue(item),
      });
    }

    // add to playlist (for items with a song)
    if (item.song_id) {
      actions.push({
        label: "add to playlist...",
        icon: IconNames.playlist,
        onClick: () => {
          showPlaylistSelector([item.song_id!]);
        },
      });
    } else if (item.album_id) {
      actions.push({
        label: "add to playlist...",
        icon: IconNames.playlist,
        onClick: async () => {
          const dataSource = getDataSource();
          if (dataSource.getAlbumSongs) {
            const response = await dataSource.getAlbumSongs(item.album_id!);
            if (response.items.length > 0) {
              showPlaylistSelector(response.items.map((s) => s.id));
            }
          }
        },
      });
    }

    // edit info actions
    const editActions: MenuAction[] = [];
    if (item.song_id) {
      editActions.push({
        label: "edit song info...",
        icon: IconNames.edit,
        onClick: () => showSongEditor({ songId: item.song_id! }),
      });
    }
    if (item.album_id) {
      editActions.push({
        label: "edit album info...",
        icon: IconNames.edit,
        onClick: () => showAlbumEditor({ albumId: item.album_id! }),
      });
    }
    if (item.artist_id && !item.song_id && !item.album_id) {
      editActions.push({
        label: "edit artist info...",
        icon: IconNames.edit,
        onClick: () => showArtistEditor({ artistId: item.artist_id! }),
      });
    }
    if (editActions.length > 0) {
      actions.push({ type: "separator" });
      actions.push(...editActions);
    }

    // navigation actions
    const navActions: MenuAction[] = [];
    if (item.album_id) {
      navActions.push({
        label: "go to album",
        icon: IconNames.album,
        onClick: () => {
          if (item.song_id) {
            setHighlightedSongId(item.song_id);
          }
          navigate(routes.album(item.album_id!));
        },
      });
    }

    if (item.artist_id) {
      navActions.push({
        label: "go to artist",
        icon: IconNames.artist,
        onClick: () => navigate(routes.artist(item.artist_id!)),
      });
    }

    if (item.playlist_id) {
      navActions.push({
        label: "go to playlist",
        icon: IconNames.playlist,
        onClick: () => navigate(routes.playlist(item.playlist_id!)),
      });
    }

    if (navActions.length > 0) {
      actions.push({ type: "separator" });
      actions.push(...navActions);
    }

    return actions;
  };

  // expose scroll ref for refresh button + back-to-top
  let feedListRef: HTMLDivElement | undefined;
  const [showBackToTop, setShowBackToTop] = createSignal(false);

  // track scroll to show/hide back-to-top button (2x window height threshold)
  const handleScroll = (scrollTop: number) => {
    setShowBackToTop(scrollTop > viewportHeight() * 2);
  };

  const handleBackToTop = () => {
    const scrollEl = feedListRef?.querySelector(".overflow-auto") as HTMLElement | null;
    scrollEl?.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div class="h-full relative" ref={feedListRef!}>
      {/* no remote connected */}
      <Show when={!remote}>
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <Icon name="discover" size={48} color="var(--color-text-muted)" />
          <p class="text-[var(--color-text-secondary)] mt-4 text-sm">
            connect to a server to see activity feed
          </p>
        </div>
      </Show>

      <Show when={remote}>
        {/* error state */}
        <Show when={feedQuery.isError}>
          <div class="flex flex-col items-center justify-center py-16 text-center">
            <Icon name="alertTriangle" size={32} color="var(--color-error)" />
            {feedQuery.error instanceof RemoteOfflineError ? (
              <>
                <p class="text-[var(--color-text-secondary)] mt-2">
                  {(feedQuery.error as RemoteOfflineError).remoteName} is offline
                </p>
                <p class="text-sm text-[var(--color-text-muted)] mt-1">
                  switch to a different remote or use local library
                </p>
              </>
            ) : (
              <>
                <p class="text-[var(--color-text-secondary)] mt-2 text-sm">failed to load feed</p>
                <Button variant="secondary" onClick={() => void feedQuery.refetch()} class="mt-3">
                  retry
                </Button>
              </>
            )}
          </div>
        </Show>

        <Show when={!feedQuery.isError}>
          <Show
            when={!feedQuery.isLoading}
            fallback={
              <div class="flex items-center justify-center py-12">
                <LoadingState text="loading feed..." />
              </div>
            }
          >
            <Show
              when={allItems().length > 0}
              fallback={
                <div class="flex flex-col items-center justify-center py-16 text-center">
                  <Icon name="recent" size={32} color="var(--color-text-muted)" />
                  <p class="text-[var(--color-text-muted)] mt-2 text-sm">
                    {feedTypeFilters().length > 0 || myItemsOnly()
                      ? "no items match the filters"
                      : "no activity yet — start listening to build the feed"}
                  </p>
                  <Show when={feedTypeFilters().length > 0 || myItemsOnly()}>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setFeedTypeFilters([]);
                        setMyItemsOnly(false);
                      }}
                      class="mt-3"
                    >
                      clear filters
                    </Button>
                  </Show>
                </div>
              }
            >
              <VirtualFeedList
                items={allItems()}
                height={listHeight()}
                scrollPaddingTop={72}
                onItemClick={handleItemClick}
                onImageClick={handleImageClick}
                onAddToQueue={handleAddToQueue}
                getContextMenuActions={getContextMenuActions}
                onNearEnd={loadMore}
                scrollKey="feed-view"
                onScroll={handleScroll}
              />
              <LoadingMoreIndicator isLoading={feedQuery.isFetchingNextPage} />
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
