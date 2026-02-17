// feed view — single infinite scrolling list of all activity events
import { useNavigate } from "@solidjs/router";
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import { Icon, IconNames } from "../../components/icons/registry";
import { Button } from "../../components/buttons/Button";
import { VirtualFeedList } from "../../components/virtualized/VirtualFeedList";
import type { MenuAction } from "../../components/overlays/ContextMenu";
import { appState } from "../../app/services/storage/db";
import { setPageInfo, clearPageInfo } from "../../app/services/pageInfo";
import { getCurrentRemote, getCurrentUserId, getDataSource } from "../data";
import type { FeedItem } from "../data/types";
import { useActivityFeedInfiniteQuery } from "../queries/analytics";
import { routes } from "../utils/routing";
import { playQueue, addToQueue } from "../services/queue/queue";
import { resumeServerSession } from "../services/queue/serverSession";
import * as apiClient from "freqhole-api-client";
import { toast } from "../../components/feedback/Toast";
import { showImageCarousel } from "../modals";

export function FeedView() {
  const navigate = useNavigate();
  const feedQuery = useActivityFeedInfiniteQuery(50);
  const remote = getCurrentRemote();

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

  // responsive list height
  const playerBarHeight = () => ((appState()?.queue.length || 0) > 0 ? 80 : 0);
  const [listHeight, setListHeight] = createSignal(window.innerHeight - playerBarHeight());

  onMount(() => {
    let resizeTimeout: number | undefined;
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = window.setTimeout(() => {
        setListHeight(window.innerHeight - playerBarHeight());
      }, 100);
    };
    window.addEventListener("resize", handleResize);
    onCleanup(() => {
      clearTimeout(resizeTimeout);
      window.removeEventListener("resize", handleResize);
    });
  });

  // update list height when player bar changes
  createEffect(
    on(
      () => playerBarHeight(),
      () => setListHeight(window.innerHeight - playerBarHeight())
    )
  );

  // set page info
  createEffect(
    on(
      () => allItems().length,
      (count) => {
        setPageInfo({ title: "feed", count });
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
      const isOwnSession = item.user_id && item.user_id === getCurrentUserId();
      if (isOwnSession) {
        void playSession(item);
      } else {
        void startSessionOver(item);
      }
      return;
    }
    if (item.album_id) {
      navigate(routes.album(item.album_id));
    } else if (item.artist_id) {
      navigate(routes.artist(item.artist_id));
    } else if (item.playlist_id) {
      navigate(routes.playlist(item.playlist_id));
    }
  };

  // helper: fetch songs by IDs via data source
  const fetchSongsByIds = async (songIds: string[]) => {
    const dataSource = getDataSource();
    const songs = [];
    for (const id of songIds) {
      try {
        const song = await dataSource.getSongById(id);
        if (song) songs.push(song);
      } catch {
        // skip songs we can't fetch
      }
    }
    return songs;
  };

  // helper: play a session — resume if active/paused, otherwise start fresh
  const playSession = async (item: FeedItem) => {
    if (!remote || !item.session_id) return;

    try {
      // fetch the full session from server
      const sessionResult = await apiClient.music.getListenSession(
        remote.base_url,
        item.session_id
      );

      if (!sessionResult.success || !sessionResult.data) {
        toast.error("failed to load session");
        return;
      }

      const session = sessionResult.data;
      const songs = await fetchSongsByIds(session.song_ids);
      if (songs.length === 0) {
        toast.error("no playable songs in session");
        return;
      }

      // only completed sessions can't be resumed — active, paused, and abandoned all can
      const canResume = session.status !== "completed" && session.current_song_index < songs.length;

      if (canResume) {
        // resume: play from current song index
        // skip server session creation — resumeServerSession below handles tracking
        await playQueue(songs, {
          startIndex: session.current_song_index,
          skipServerSession: true,
          source: {
            type: session.session_type as any,
            label: session.label,
            entity_id: session.entity_id ?? undefined,
          },
        });

        // resume the server session tracking
        await resumeServerSession(session.id, {
          listened_duration_ms: session.listened_duration_ms,
          songs_completed: session.songs_completed,
          current_song_index: session.current_song_index,
          current_song_position_ms: session.current_song_position_ms,
        });

        toast.info("resumed session");
      } else {
        // completed — start fresh
        await playQueue(songs, {
          source: {
            type: session.session_type as any,
            label: session.label,
            entity_id: session.entity_id ?? undefined,
          },
        });
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
      const sessionResult = await apiClient.music.getListenSession(
        remote.base_url,
        item.session_id
      );

      if (!sessionResult.success || !sessionResult.data) {
        toast.error("failed to load session");
        return;
      }

      const session = sessionResult.data;
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
      const urls = images
        .filter((img) => img.blob_type !== "waveform" && img.remote_url)
        .map((img) => img.remote_url!);

      if (urls.length > 0) {
        showImageCarousel({
          images: urls,
          title: item.title ?? undefined,
        });
        return;
      }
    }
  };

  // handle image/thumb click — for new_image, play/navigate instead; otherwise open carousel
  const handleImageClick = async (item: FeedItem) => {
    if (item.feed_type === "new_image") {
      // for new_image, image click navigates to the entity
      if (item.album_id) {
        navigate(routes.album(item.album_id));
      } else if (item.artist_id) {
        navigate(routes.artist(item.artist_id));
      } else if (item.playlist_id) {
        navigate(routes.playlist(item.playlist_id));
      }
      return;
    }

    // for other types, open carousel or fall back to play
    await handleImageCarousel(item);
    if (
      !(
        item.images &&
        item.images.length > 0 &&
        item.images.some((img) => img.blob_type !== "waveform" && img.remote_url)
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

  // build context menu actions for a feed item
  const getContextMenuActions = (item: FeedItem): MenuAction[] => {
    const actions: MenuAction[] = [];

    // listening sessions get their own menu
    if (item.feed_type === "listen_session") {
      const isOwnSession = item.user_id && item.user_id === getCurrentUserId();

      if (isOwnSession) {
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
            if (item.session_id && remote) {
              const sessionResult = await apiClient.music.getListenSession(
                remote.base_url,
                item.session_id
              );
              if (sessionResult.success && sessionResult.data) {
                const songs = await fetchSongsByIds(sessionResult.data.song_ids);
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
        onClick: async () => {
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
        },
      });
    }

    // navigation actions
    const navActions: MenuAction[] = [];
    if (item.album_id) {
      navActions.push({
        label: "go to album",
        icon: IconNames.album,
        onClick: () => navigate(routes.album(item.album_id!)),
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

  // expose scroll ref for refresh button
  let feedListRef: HTMLDivElement | undefined;

  const handleRefresh = () => {
    // scroll to top of the feed list's scroll container
    const scrollEl = feedListRef?.querySelector(".overflow-auto") as HTMLElement | null;
    scrollEl?.scrollTo({ top: 0, behavior: "smooth" });
    void feedQuery.refetch();
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
        <Show
          when={!feedQuery.isLoading}
          fallback={
            <div class="flex items-center justify-center py-12">
              <Icon name="loader" size={24} color="var(--color-text-muted)" />
              <span class="text-[var(--color-text-muted)] ml-2 text-sm">loading feed...</span>
            </div>
          }
        >
          <Show
            when={allItems().length > 0}
            fallback={
              <div class="flex flex-col items-center justify-center py-16 text-center">
                <Icon name="recent" size={32} color="var(--color-text-muted)" />
                <p class="text-[var(--color-text-muted)] mt-2 text-sm">
                  no activity yet — start listening to build your feed
                </p>
              </div>
            }
          >
            <VirtualFeedList
              items={allItems()}
              height={listHeight()}
              scrollPaddingTop={72}
              onItemClick={handleItemClick}
              onImageClick={handleImageClick}
              getContextMenuActions={getContextMenuActions}
              onNearEnd={loadMore}
              isFetchingMore={feedQuery.isFetchingNextPage}
              scrollKey="feed-view"
            />

            {/* fixed refresh button — centered in feed column, just below nav */}
            <div
              class="fixed z-50"
              style={{ top: "12px", left: "50%", transform: "translateX(-50%)" }}
            >
              <Button variant="primary" onClick={handleRefresh}>
                refresh feed
              </Button>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
