// feed view — single infinite scrolling list of all activity events
import { useNavigate } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js";
import { confirm } from "../../app/services/confirmState";
import { clearPageInfo, setPageInfo, type FeedTypeFilter } from "../../app/services/pageInfo";
import { appState } from "../../app/services/storage/db";
import {
  toQueueHistorySourceType,
  type VideoQueueSourceContext,
} from "../../app/services/storage/types";
import { isRadioPlayerBarActive } from "../../app/services/radio/radioService";
import { isNarrowViewport, getPlayerBarHeightPx } from "../../config/breakpoints";
import { Button } from "../../components/buttons/Button";
import { LoadingMoreIndicator, LoadingState } from "../../components/feedback";
import { toast } from "../../components/feedback/Toast";
import { Icon, IconNames } from "../../components/icons/registry";
import type { MenuAction } from "../../components/overlays/ContextMenu";
import { VirtualFeedList } from "../../components/virtualized/VirtualFeedList";
import { useHistoryState } from "../../utils/historyState";
import { getNavHeight, useViewportHeight } from "../../utils/viewport";
import { getCurrentRemote, getCurrentUser, getDataSource, RemoteOfflineError } from "../data";
import { isAdmin } from "../data/permissions";
import type { FeedItem, PlaybackSession } from "../data/types";
import { showAlbumEditor, showArtistEditor, showSongEditor } from "../hooks/modals";
import { showPlaylistSelector } from "../hooks/playlistSelectorState";
import {
  ALL_FEED_TYPES,
  FEED_TYPE_LABELS,
  useActivityFeedInfiniteQuery,
  type FeedItemTypeFilter,
} from "../queries/analytics";
import { queryKeys } from "../queries/queryKeys";
import { activeHistoryEntryId } from "../services/queue/listenProgress";
import { createFeedActions } from "../services/feed/feedActions";
import { addToQueue, playQueue, resumeHistoryEntry } from "../services/queue/queue";
import { queueHistory, updateHistoryServerSession } from "../services/queue/queueHistory";
import { resumeServerSession } from "../services/queue/serverSession";
import { setHighlightedSongId } from "../state/highlightedSong";
import { routes } from "../utils/routing";
import {
  videoToMediaItem,
  songToMediaItem,
  videosOnly,
  type MediaItem,
} from "../../app/services/storage/mediaItem";
import { getVideoDataSource } from "../../video/data";
import type { VideoSummary } from "../../video/data/types";
import {
  videoQueueHistory,
  updateVideoHistoryServerSession,
} from "../../video/services/queue/videoQueueHistory";
import { playVideoQueue, resumeVideoHistoryEntry } from "../../video/services/queue/playVideoQueue";
import { activeVideoHistoryEntryId } from "../../video/services/queue/videoListenProgress";
import { addVideosToQueue } from "../../video/services/videoQueueActions";
import { fetchVideoProgressForVideos, resumePositionFor } from "../../video/queries/progress";
import type { Song } from "../services/storage/types";

function videoSessionSource(session: PlaybackSession): VideoQueueSourceContext {
  return {
    type:
      session.session_type === "video_series"
        ? "series"
        : session.session_type === "video_season"
          ? "season"
          : "video",
    label: session.label,
    entity_id: session.entity_id ?? undefined,
  };
}

export function FeedView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const remote = getCurrentRemote();
  const feedActions = createFeedActions(() => remote ?? undefined, navigate);

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
  const playerBarHeight = () =>
    getPlayerBarHeightPx(
      isNarrowViewport(),
      (appState()?.queue.length || 0) > 0 || isRadioPlayerBarActive()
    );
  const listHeight = () => viewportHeight() - playerBarHeight();

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
  const handleItemClick = (item: FeedItem) => void feedActions.navigateTo(item);

  // helper: fetch songs by IDs via data source (batch request)
  const fetchSongsByIds = async (songIds: string[]) => {
    if (songIds.length === 0) return [];
    const dataSource = getDataSource();
    return dataSource.getSongsByIds?.(songIds) ?? [];
  };

  // helper: fetch videos by IDs (no batch endpoint on the video data source
  // yet, so fetched individually in parallel — mirrors fetchSongsByIds)
  const fetchVideosByIds = async (videoIds: string[]): Promise<VideoSummary[]> => {
    if (videoIds.length === 0) return [];
    const videoDataSource = getVideoDataSource();
    const videos = await Promise.all(videoIds.map((id) => videoDataSource.getVideoById(id)));
    return videos.filter((v): v is VideoSummary => v != null);
  };

  // helper: resolve a playback session's item list (song ∪ video, any mix)
  // back into playable objects, preserving the session's original item order.
  const fetchMediaItemsForSession = async (session: PlaybackSession): Promise<MediaItem[]> => {
    const songIds = session.items.filter((i) => i.entity_type === "song").map((i) => i.entity_id);
    const videoIds = session.items.filter((i) => i.entity_type === "video").map((i) => i.entity_id);

    const [songs, videos] = await Promise.all([
      fetchSongsByIds(songIds),
      fetchVideosByIds(videoIds),
    ]);

    // songs may have been recorded with either their own id or sha256 as
    // entity_id (see serverSession.ts's itemEntityId) — index by both.
    const songById = new Map<string, Song>();
    for (const s of songs) {
      songById.set(s.id, s);
      songById.set(s.sha256, s);
    }
    const videoById = new Map(videos.map((v) => [v.id, v] as const));

    const items: MediaItem[] = [];
    for (const sessionItem of session.items) {
      if (sessionItem.entity_type === "song") {
        const song = songById.get(sessionItem.entity_id);
        if (song) items.push(songToMediaItem(song));
      } else if (sessionItem.entity_type === "video") {
        const video = videoById.get(sessionItem.entity_id);
        if (video) items.push(videoToMediaItem(video));
      }
    }
    return items;
  };

  // helper: play a session — resume if active/paused, otherwise start fresh
  const playSession = async (item: FeedItem) => {
    if (!remote || !item.session_id) return;

    // check IDB first for an existing local history entry that matches this
    // server session — song-side history first (also covers mixed sessions,
    // which are always linked to the song-side entry, see queue.ts), then
    // video-side history (linked only for video-only sessions, see
    // playVideoQueue.ts).
    const existingSongEntry = queueHistory().find((e) => e.server_session_id === item.session_id);
    if (existingSongEntry) {
      // found in local history — fast resume via IDB
      void resumeHistoryEntry(existingSongEntry);
      return;
    }
    const existingVideoEntry = videoQueueHistory().find(
      (e) => e.server_session_id === item.session_id
    );
    if (existingVideoEntry) {
      void resumeVideoHistoryEntry(existingVideoEntry);
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
      if (!dataSource.getPlaybackSession) {
        toast.error("playback sessions not supported");
        return;
      }

      const session = await dataSource.getPlaybackSession(item.session_id);

      if (!session) {
        toast.error("failed to load session");
        return;
      }
      const mediaItems = await fetchMediaItemsForSession(session);
      if (mediaItems.length === 0) {
        toast.error("no playable items in session");
        return;
      }
      const isSongOnlySession = session.items.every((i) => i.entity_type === "song");
      const sessionVideos = videosOnly(mediaItems);
      const isVideoOnlySession = sessionVideos.length === mediaItems.length;

      // a session is effectively done if its status is "completed" or all items were played
      const isEffectivelyComplete =
        session.status === "completed" || session.items_completed >= session.total_items;
      const canResume = !isEffectivelyComplete && session.current_item_index < mediaItems.length;

      if (canResume) {
        // resume: play from current item index
        // skip server session creation — resumeServerSession below handles tracking
        const resumeProgress = isSongOnlySession
          ? {
              listened_seconds: Math.round(session.played_duration_ms / 1000),
              songs_completed: session.items_completed,
              current_song_index: session.current_item_index,
              current_song_position: Math.round((session.current_item_position_ms ?? 0) / 1000),
            }
          : undefined;

        if (isVideoOnlySession) {
          const progress = await fetchVideoProgressForVideos(sessionVideos);
          await playVideoQueue(
            sessionVideos,
            session.current_item_index,
            videoSessionSource(session),
            resumePositionFor(sessionVideos[session.current_item_index].id, progress),
            { skipServerSession: true }
          );
        } else {
          await playQueue(mediaItems, {
            startIndex: session.current_item_index,
            skipServerSession: true,
            resumeProgress,
            source: {
              type: toQueueHistorySourceType(session.session_type),
              label: session.label,
              entity_id: session.entity_id ?? undefined,
            },
          });
        }

        // resume the server session tracking
        const remote = getCurrentRemote();
        if (remote) {
          await resumeServerSession(
            session.id,
            { progress: session.items_completed },
            remote,
            {
              label: session.label,
              sessionType: session.session_type,
              entityId: session.entity_id ?? undefined,
            },
            undefined,
            mediaItems
          );

          // link the new history entry to the resumed server session
          const entryId = isVideoOnlySession ? activeVideoHistoryEntryId() : activeHistoryEntryId();
          if (entryId && isVideoOnlySession) {
            void updateVideoHistoryServerSession(entryId, session.id, remote.remote_id);
          } else if (entryId) {
            void updateHistoryServerSession(entryId, session.id, remote.remote_id);
          }
        }

        toast.info("resumed session");
      } else {
        // completed — start fresh as a new session
        if (isVideoOnlySession) {
          await playVideoQueue(sessionVideos, 0, videoSessionSource(session));
        } else {
          await playQueue(mediaItems, {
            source: {
              type: toQueueHistorySourceType(session.session_type),
              label: session.label,
              entity_id: session.entity_id ?? undefined,
            },
          });
        }
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
      if (!dataSource.getPlaybackSession) {
        toast.error("playback sessions not supported");
        return;
      }

      const session = await dataSource.getPlaybackSession(item.session_id);

      if (!session) {
        toast.error("failed to load session");
        return;
      }
      const mediaItems = await fetchMediaItemsForSession(session);
      if (mediaItems.length === 0) {
        toast.error("no playable items in session");
        return;
      }

      if (mediaItems.every((item) => item.kind === "video")) {
        await playVideoQueue(videosOnly(mediaItems), 0, videoSessionSource(session));
      } else {
        await playQueue(mediaItems, {
          source: {
            type: toQueueHistorySourceType(session.session_type),
            label: session.label,
            entity_id: session.entity_id ?? undefined,
          },
        });
      }
    } catch (error) {
      console.error("failed to start session over:", error);
      toast.error("failed to start session");
    }
  };

  // image events open the viewer; every play overlay starts playback.
  const handleImageClick = async (item: FeedItem) => {
    if (item.feed_type === "listen_session" && item.session_type !== "radio") {
      await handlePlayItem(item);
    } else await feedActions.thumbnail(item);
  };

  // play or resume the feed item (used by context menu + image click fallback)
  const handlePlayItem = async (item: FeedItem) => {
    if (item.feed_type === "listen_session" && item.session_type !== "radio") {
      if (item.user_id === getCurrentUser()?.userId) await playSession(item);
      else await startSessionOver(item);
    } else {
      await feedActions.play(item);
    }
  };

  // add item to queue (shared between context menu and quick-action button)
  const handleAddToQueue = async (item: FeedItem) => {
    await feedActions.play(item, true);
  };

  // build context menu actions for a feed item
  const getContextMenuActions = (item: FeedItem): MenuAction[] => {
    const actions: MenuAction[] = [];

    // listening sessions get their own menu
    if (item.feed_type === "listen_session") {
      const isOwnSession = item.user_id && item.user_id === getCurrentUser()?.userId;
      const isCompleted =
        item.session_status === "completed" || (item.progress_percent ?? 0) >= 100;

      // radio sessions have no queue to resume — link to the station instead.
      if (item.session_type === "radio" && item.entity_id) {
        actions.push({
          label: "play",
          icon: IconNames.play,
          onClick: () => void feedActions.play(item),
        });
        actions.push({
          label: "go to station",
          icon: IconNames.headphones,
          onClick: () => navigate(routes.radioStation(item.entity_id!, remote?.peer_addr)),
        });
        if ((isOwnSession || isAdmin()) && item.session_id) {
          actions.push({ type: "separator" });
          actions.push({
            label: isOwnSession ? "delete session" : "delete feed item",
            icon: IconNames.delete,
            onClick: async () => {
              try {
                const dataSource = getDataSource();
                if (isOwnSession && dataSource.deletePlaybackSession) {
                  await dataSource.deletePlaybackSession(item.session_id!);
                } else if (isAdmin() && dataSource.deleteFeedEvent) {
                  await dataSource.deleteFeedEvent(item.id);
                } else {
                  toast.error("cannot delete");
                  return;
                }
                toast.info(isOwnSession ? "session deleted" : "feed item deleted");
                void queryClient.invalidateQueries({
                  queryKey: queryKeys.analytics.all(),
                });
              } catch {
                toast.error(
                  isOwnSession ? "failed to delete session" : "failed to delete feed item"
                );
              }
            },
          });
        }
        return actions;
      }

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
              if (!dataSource.getPlaybackSession) {
                toast.error("playback sessions not supported");
                return;
              }
              const session = await dataSource.getPlaybackSession(item.session_id);
              if (session) {
                const mediaItems = await fetchMediaItemsForSession(session);
                if (mediaItems.length > 0) {
                  if (mediaItems.every((item) => item.kind === "video")) {
                    await addVideosToQueue(videosOnly(mediaItems), videoSessionSource(session));
                  } else {
                    await addToQueue(mediaItems, {
                      source: {
                        type: toQueueHistorySourceType(session.session_type),
                        label: item.title,
                      },
                    });
                  }
                }
              }
            }
          } catch {
            toast.error("failed to add to queue");
          }
        },
      });

      // delete session (own sessions, or admin can delete any)
      if ((isOwnSession || isAdmin()) && item.session_id) {
        actions.push({ type: "separator" });
        actions.push({
          label: isOwnSession ? "delete session" : "delete feed item",
          icon: IconNames.delete,
          onClick: async () => {
            try {
              const dataSource = getDataSource();
              if (isOwnSession && dataSource.deletePlaybackSession) {
                await dataSource.deletePlaybackSession(item.session_id!);
              } else if (isAdmin() && dataSource.deleteFeedEvent) {
                await dataSource.deleteFeedEvent(item.id);
              } else {
                toast.error("cannot delete");
                return;
              }
              toast.info(isOwnSession ? "session deleted" : "feed item deleted");
              void queryClient.invalidateQueries({
                queryKey: queryKeys.analytics.all(),
              });
            } catch {
              toast.error(isOwnSession ? "failed to delete session" : "failed to delete feed item");
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
    if (item.song_id || item.album_id || item.playlist_id || item.artist_id || item.video_id) {
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

    if (item.video_id) {
      navActions.push({
        label: "go to video",
        icon: IconNames.video,
        onClick: () => navigate(routes.videoDetailOn(remote?.peer_addr, item.video_id!)),
      });
    }

    if (navActions.length > 0) {
      actions.push({ type: "separator" });
      actions.push(...navActions);
    }

    // admin can delete any feed item
    if (isAdmin()) {
      const dataSource = getDataSource();
      if (dataSource.deleteFeedEvent) {
        actions.push({ type: "separator" });
        actions.push({
          label: "delete feed item",
          icon: IconNames.delete,
          onClick: async () => {
            try {
              await dataSource.deleteFeedEvent!(item.id);
              toast.info("feed item deleted");
              void queryClient.invalidateQueries({
                queryKey: queryKeys.analytics.all(),
              });
            } catch {
              toast.error("failed to delete feed item");
            }
          },
        });
      }
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
                scrollPaddingTop={isNarrowViewport() ? getNavHeight() : 100}
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
